import { expect, type Page, test } from "@playwright/test";

import { createUser, signInCookies, sql } from "./helpers";

// The cart in the browser: several lines, quantity and details edited in the
// cart, one checkout = one order with every line. Prices shown are the
// database's (my_cart / checkout_cart), never computed in the page.

const BASE = "http://localhost:3100";

async function add(
  page: Page,
  slug: string,
  fill: Record<string, string>,
  opts: { option?: string; select?: Record<string, string> } = {},
) {
  await page.goto(`${BASE}/en/p/${slug}`);
  const form = page.getByTestId("add-to-cart-form");
  await expect(form.locator("button[type=submit]")).toBeEnabled();
  if (opts.option)
    await form
      .getByTestId("variant-option")
      .filter({ hasText: opts.option })
      .click();
  for (const [id, value] of Object.entries(fill)) await page.fill(id, value);
  for (const [id, value] of Object.entries(opts.select ?? {}))
    await page.selectOption(id, value);
  await form.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByTestId("added-to-cart")).toBeVisible();
}

const line = (page: Page, text: string) =>
  page.getByTestId("cart-line").filter({ hasText: text });

test("several lines, edited in the cart, become one order with every line", async ({
  browser,
}) => {
  const customer = await createUser();
  const ctx = await browser.newContext();
  await signInCookies(ctx, customer.phone, customer.password);
  const page = await ctx.newPage();

  await add(page, "pubg-uc", { "#f-player_id": "5123456789" });
  await add(
    page,
    "free-fire-diamonds",
    { "#f-player_id": "123456" },
    { select: { "#f-server": "mena" } },
  );
  await add(page, "zain-airtime", { "#f-target_phone": "0912345678" });
  await expect(page.getByTestId("cart-count").first()).toHaveText("3");

  await page.goto(`${BASE}/en/cart`);
  await expect(page.getByTestId("cart-line")).toHaveCount(3);
  // 60 UC: ceil(1.10 × 2600) = 2,860; diamonds 2,600; airtime 5,200.
  await expect(page.getByTestId("cart-total")).toHaveText("SDG 10,660");

  // Quantity: +1 on the diamonds line → ceil(1.00 × 2 × 2600) = 5,200.
  await line(page, "Free Fire")
    .getByRole("button", { name: "Increase" })
    .click();
  await expect(line(page, "Free Fire").getByTestId("line-quantity")).toHaveText(
    "2",
  );
  await expect(page.getByTestId("cart-total")).toHaveText("SDG 13,260");

  // Details: an invalid player ID is refused by the server, field by field.
  const pubg = line(page, "PUBG UC");
  await pubg.getByText("Edit details").click();
  await pubg.locator("input[name='f.player_id']").fill("abcde");
  await pubg.getByRole("button", { name: "Save" }).click();
  await expect(pubg.locator("[data-field-error=player_id]")).toHaveText(
    "Invalid format.",
  );
  await pubg.locator("input[name='f.player_id']").fill("5999999999");
  await pubg.getByRole("button", { name: "Save" }).click();
  await expect(line(page, "PUBG UC")).toContainText("5999999999");

  // Remove the airtime line.
  await line(page, "رصيد زين").getByTestId("remove-line").click();
  await expect(page.getByTestId("cart-line")).toHaveCount(2);
  await expect(page.getByTestId("cart-total")).toHaveText("SDG 8,060");
  await page.screenshot({ path: ".e2e/cart-lines.png", fullPage: true });

  // Checkout: one order, both lines, the cart's total.
  await page.getByTestId("checkout-link").click();
  await page.waitForURL(/\/en\/checkout$/);
  await expect(page.getByTestId("checkout-lines").locator("li")).toHaveCount(2);
  await expect(page.getByTestId("checkout-total")).toHaveText("SDG 8,060");
  await page.getByTestId("confirm-order").click();
  await page.waitForURL(/\/en\/account\/orders\/FD-\d{7}\?placed=1$/);
  const reference = new URL(page.url()).pathname.split("/").pop()!;
  await expect(page.getByTestId("order-placed")).toBeVisible();
  await expect(page.getByTestId("order-line")).toHaveCount(2);
  await expect(page.getByTestId("order-total")).toHaveText("SDG 8,060");
  await expect(page.getByTestId("order-lines")).toContainText("5999999999");
  await page.screenshot({ path: ".e2e/order-placed.png", fullPage: true });

  expect(
    sql(
      `select count(*) || ':' || sum(total_sdg)::bigint from public.orders where user_id = '${customer.id}'`,
    ),
  ).toBe("1:8060");
  expect(
    sql(
      `select count(*) from public.cart_items where user_id = '${customer.id}'`,
    ),
  ).toBe("0");
  // The badge disappears with the empty cart.
  await expect(page.getByTestId("cart-count")).toHaveCount(0);

  await page.goto(`${BASE}/en/account/orders`);
  await expect(page.getByTestId("orders-list")).toContainText(reference);
  await expect(page.getByTestId("orders-list")).toContainText("+ 1 more item");
});

test("a package hidden after it was added: shown as unavailable, not in the total, checkout blocked until removed", async ({
  browser,
}) => {
  const customer = await createUser();
  const ctx = await browser.newContext();
  await signInCookies(ctx, customer.phone, customer.password);
  const page = await ctx.newPage();
  await add(page, "pubg-uc", { "#f-player_id": "5123456789" });
  await add(
    page,
    "pubg-uc",
    { "#f-player_id": "5123456789" },
    { option: "325 UC" },
  );
  try {
    sql(
      "update public.product_variants set is_active = false where id = '00000000-0000-4000-c000-000000000003'",
    );
    await page.goto(`${BASE}/en/cart`);
    await expect(page.getByTestId("cart-unavailable")).toBeVisible();
    await expect(
      page.locator("[data-testid=cart-line][data-available=false]"),
    ).toHaveCount(1);
    await expect(page.getByTestId("cart-total")).toHaveText("SDG 2,860");
    await expect(page.getByTestId("checkout-link")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await page.goto(`${BASE}/en/checkout`);
    await expect(page.getByTestId("checkout-blocked")).toBeVisible();
    await expect(page.getByTestId("confirm-order")).toHaveCount(0);

    await page.goto(`${BASE}/en/cart`);
    await page
      .locator("[data-testid=cart-line][data-available=false]")
      .getByTestId("remove-line")
      .click();
    await expect(page.getByTestId("cart-line")).toHaveCount(1);
    await expect(page.getByTestId("cart-unavailable")).toHaveCount(0);
    await expect(page.getByTestId("checkout-link")).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
  } finally {
    sql(
      "update public.product_variants set is_active = true where id = '00000000-0000-4000-c000-000000000003'",
    );
  }
});
