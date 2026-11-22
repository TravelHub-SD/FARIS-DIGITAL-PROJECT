import { randomBytes } from "node:crypto";

import { devices, expect, type Page, test } from "@playwright/test";

import {
  completeOrderWithInvoice,
  createCustomProduct,
  createUser,
  ownerUser,
  signInCookies,
  sql,
} from "./helpers";

// Custom-amount products in the browser (item 6, decisions.md 2026-11-21).
// Seed rates (placeholders): EUR 2,800, USD = the store rate 2,600. The test
// product charges 1.5% + 200 SDG and takes EUR 1–500 and USD 5–1000.
//   56.50 EUR: 158,200 + 2,373 + 200 = 160,773 SDG
//   50 USD:    130,000 + 1,950 + 200 = 132,150 SDG
//   56 EUR:    156,800 + 2,352 + 200 = 159,352 SDG; at 2,900: 165,036

const PHONE = {
  ...devices["Pixel 7"],
  viewport: { width: 360, height: 780 },
  baseURL: "http://localhost:3100",
};
const text = (page: Page, id: string) =>
  page
    .getByTestId(id)
    .first()
    .evaluate((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim());

/**
 * The formula's words in the order they appear on screen (line, then x).
 * Equal to the text order only if it reads left to right in an Arabic page
 * too: a bidi mistake reorders "2,573 رسوم = 160,773" visually.
 */
const visual = (page: Page, id: string) =>
  page
    .getByTestId(id)
    .first()
    .evaluate((el) => {
      const words: { t: string; x: number; y: number }[] = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        for (const m of (n.textContent ?? "").matchAll(/\S+/g)) {
          const r = document.createRange();
          r.setStart(n, m.index!);
          r.setEnd(n, m.index! + m[0].length);
          const b = r.getBoundingClientRect();
          words.push({ t: m[0], x: b.left, y: b.top });
        }
      }
      return words
        .sort((a, b) => (Math.abs(a.y - b.y) > 4 ? a.y - b.y : a.x - b.x))
        .map((w) => w.t)
        .join(" ");
    });

async function type(page: Page, value: string) {
  const input = page.getByTestId("amount-input");
  await input.fill("");
  await input.pressSequentially(value);
}

test("customer (ar, 360 px): Arabic digits, live calculator, limits; the cart, checkout, order, staff screen and invoice show the database's price", async ({
  browser,
}) => {
  const bill = createCustomProduct();
  const customer = await createUser({ name: "عميل الفاتورة" });
  const ctx = await browser.newContext({ ...PHONE, locale: "ar-SD" });
  await signInCookies(ctx, customer.phone, customer.password);
  const page = await ctx.newPage();
  await page.goto(`/ar/p/${bill.slug}`);
  await expect(page.getByTestId("amount-input")).toBeEnabled(); // hydrated
  await expect(page.getByTestId("custom-amount-form")).toBeVisible();
  await expect(page.getByTestId("calc-rate")).toHaveText("1 EUR = 2,800 SDG");
  const submit = page.getByRole("button", { name: "أضف إلى السلة" });
  await expect(submit).toBeDisabled();

  // Arabic-Indic digits and the Arabic decimal separator.
  await type(page, "٥٦٫٥");
  await expect(page.getByTestId("calc-subtotal")).toHaveText(
    "56.50 EUR × 2,800",
  );
  await expect(page.getByTestId("calc-fee")).toHaveText("2,573 SDG");
  await expect(page.getByTestId("calc-total")).toContainText("160,773");
  await expect(page.getByTestId("order-total")).toContainText("160,773");
  await expect(submit).toBeEnabled();

  // What the calculator refuses (the server refuses the same, see below).
  for (const [value, problem] of [
    ["56.505", "decimals"],
    ["٦٠٠", "above_max"],
    ["0", "zero"],
    ["-3", "negative"],
    ["5.5.5", "malformed"],
  ] as const) {
    await type(page, value);
    await expect(page.getByTestId("amount-help")).toHaveAttribute(
      "data-problem",
      problem,
    );
    await expect(submit).toBeDisabled();
  }
  await type(page, "٦٠٠");
  await expect(page.getByTestId("amount-help")).toHaveText(
    "الحد الأقصى 500.00 EUR.",
  );

  // Another currency: its own rate and limits.
  await page.getByTestId("currency-select").selectOption("USD");
  await type(page, "٥٠");
  await expect(page.getByTestId("calc-total")).toContainText("132,150");
  await page.getByTestId("currency-select").selectOption("EUR");
  await type(page, "٥٦٫٥٠");
  await expect(page.getByTestId("calc-total")).toContainText("160,773");
  await page.fill("#f-bill_link", "https://pay.example/inv/77");
  await page.fill("#f-email", "bill@example.com");
  await page.screenshot({ path: ".e2e/custom-amount-ar.png", fullPage: true });
  await submit.click();
  await expect(page.getByTestId("added-to-cart")).toBeVisible();

  // A forged price in the form is not even read: the same form again with
  // "total", "rate" and "fee" fields added by hand.
  await page.evaluate(() => {
    const form = document.querySelector<HTMLFormElement>(
      "[data-testid=custom-amount-form]",
    )!;
    for (const [name, value] of [
      ["totalSdg", "1"],
      ["rate", "1"],
      ["fee", "0"],
      ["line_total_sdg", "1"],
    ]) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.append(input);
    }
  });
  await submit.click();
  await expect(page.getByTestId("added-to-cart")).toBeVisible();
  await expect
    .poll(() =>
      sql(
        `select count(*) from public.cart_items where user_id = '${customer.id}'`,
      ),
    )
    .toBe("2");

  // The cart: the database's live price, the formula for each line.
  await page.goto("/ar/cart");
  await expect(page.getByTestId("cart-line")).toHaveCount(2);
  expect(await text(page, "line-formula")).toBe(
    "56.50 EUR × 2,800 + 2,573 رسوم = 160,773 SDG",
  );
  expect(await visual(page, "line-formula")).toBe(
    "56.50 EUR × 2,800 + 2,573 رسوم = 160,773 SDG",
  );
  await expect(page.getByTestId("cart-total")).toContainText("321,546");
  await expect(
    page.getByTestId("cart-line").first().getByTestId("line-quantity"),
  ).toHaveCount(0); // no quantity control on an amount
  await page.getByTestId("remove-line").last().click();
  await expect(page.getByTestId("cart-line")).toHaveCount(1);
  await expect(page.getByTestId("cart-total")).toContainText("160,773");
  await page.screenshot({
    path: ".e2e/custom-amount-cart-ar.png",
    fullPage: true,
  });

  // Checkout → order with the snapshot.
  await page.goto("/ar/checkout");
  await expect(page.getByTestId("checkout-total")).toContainText("160,773");
  await page.getByTestId("confirm-order").click();
  await page.waitForURL(/\/ar\/account\/orders\/FD-\d{7}\?placed=1$/);
  const reference = new URL(page.url()).pathname.split("/").pop()!;
  await expect(page.getByTestId("line-amount")).toHaveText("56.50 EUR");
  expect(await text(page, "line-formula")).toBe(
    "56.50 EUR × 2,800 + 2,573 رسوم = 160,773 SDG",
  );
  expect(
    sql(`select i.amount || '|' || i.currency_code || '|' || i.currency_rate_sdg || '|' || i.fee_sdg || '|' || i.line_total_sdg
           from public.order_items i join public.orders o on o.id = i.order_id
          where o.reference = '${reference}'`),
  ).toBe("56.5|EUR|2800.0000|2573.00|160773.00");
  await ctx.close();

  // Staff: the amount and currency stand out on the order screen.
  const owner = await ownerUser();
  const staff = await browser.newContext({ baseURL: PHONE.baseURL });
  await signInCookies(staff, owner.phone, owner.password);
  const admin = await staff.newPage();
  await admin.goto(`/en/admin/orders/${reference}`);
  await expect(admin.getByTestId("line-amount")).toHaveText("56.50 EUR");
  expect(await text(admin, "line-formula")).toBe(
    "56.50 EUR × 2,800 + 2,573 fee = 160,773 SDG",
  );
  await admin.screenshot({
    path: ".e2e/custom-amount-admin-order.png",
    fullPage: true,
  });
  await staff.close();

  // The invoice line, Arabic and English.
  const order = JSON.parse(
    sql(
      `select row_to_json(o) from (select id, user_id from public.orders where reference = '${reference}') o`,
    ),
  );
  const { invoice } = await completeOrderWithInvoice(order);
  const again = await browser.newContext({ ...PHONE, locale: "ar-SD" });
  await signInCookies(again, customer.phone, customer.password);
  const inv = await again.newPage();
  for (const [locale, fee] of [
    ["ar", "رسوم"],
    ["en", "fee"],
  ]) {
    await inv.goto(`/${locale}/account/invoices/${invoice.invoice_number}`);
    expect(await text(inv, "invoice-line-formula")).toBe(
      `56.50 EUR × 2,800 + 2,573 ${fee} = 160,773 SDG`,
    );
    expect(await visual(inv, "invoice-line-formula")).toBe(
      `56.50 EUR × 2,800 + 2,573 ${fee} = 160,773 SDG`,
    );
    await expect(inv.getByTestId("invoice-total")).toContainText("160,773");
    await expect(inv.getByTestId("invoice-rate")).toHaveCount(0); // no package line
  }
  await inv.screenshot({
    path: ".e2e/custom-amount-invoice-en.png",
    fullPage: true,
  });
  await again.close();
  console.log(
    `[demo] ${reference}: ٥٦٫٥ typed → 56.50 EUR × 2,800 + 2,573 = 160,773 SDG on page, cart, checkout, order, staff screen and ${invoice.invoice_number}`,
  );
});

test("a rate changed while the checkout page was open: the price-changed confirmation, then the order at the new rate; a disabled currency disappears", async ({
  browser,
}) => {
  const bill = createCustomProduct();
  const customer = await createUser();
  sql(`insert into public.cart_items (user_id, product_id, currency_code, amount, fulfillment_data)
       values ('${customer.id}', '${bill.id}', 'EUR', 56, '{"bill_link":"https://pay.example/1","email":"a@example.com"}')`);
  const ctx = await browser.newContext({ baseURL: PHONE.baseURL });
  await signInCookies(ctx, customer.phone, customer.password);
  const page = await ctx.newPage();
  try {
    await page.goto("/en/checkout");
    await expect(page.getByTestId("checkout-total")).toHaveText("SDG 159,352");
    sql("update public.currencies set sdg_rate = 2900 where code = 'EUR'");
    await page.getByTestId("confirm-order").click();
    await expect(page.getByTestId("price-changed")).toContainText(
      "SDG 165,036",
    );
    await expect(page.getByTestId("checkout-total")).toHaveText("SDG 165,036");
    expect(
      sql(
        `select count(*) from public.orders where user_id = '${customer.id}'`,
      ),
    ).toBe("0");
    await page.screenshot({
      path: ".e2e/custom-amount-price-changed.png",
      fullPage: true,
    });
    await page.getByTestId("confirm-order").click();
    await page.waitForURL(/\/en\/account\/orders\/FD-\d{7}\?placed=1$/);
    expect(
      sql(`select i.currency_rate_sdg || '|' || o.total_sdg from public.order_items i
             join public.orders o on o.id = i.order_id where o.user_id = '${customer.id}'`),
    ).toBe("2900.0000|165036.00");

    // Disabled: no longer offered on the page.
    sql("update public.currencies set is_active = false where code = 'EUR'");
    await page.goto(`/en/p/${bill.slug}`);
    await expect(
      page.getByTestId("currency-select").locator("option"),
    ).toHaveText(["USD · US dollar"]);
  } finally {
    sql(
      "update public.currencies set sdg_rate = 2800, is_active = true where code = 'EUR'",
    );
    await ctx.close();
  }
});

test("dashboard: settings staff add a currency and allow it with limits and a fee; the page prices with it; product staff only read; a new custom product sells nothing until configured", async ({
  browser,
}) => {
  const bill = createCustomProduct();
  const owner = await ownerUser();
  const ctx = await browser.newContext({ baseURL: PHONE.baseURL });
  await signInCookies(ctx, owner.phone, owner.password);
  const page = await ctx.newPage();
  const letter = () => String.fromCharCode(67 + (randomBytes(1)[0] % 23));
  const code = `X${letter()}${letter()}`;
  sql(`delete from public.currencies where code = '${code}' and not exists
         (select 1 from public.custom_amount_currencies where currency_code = '${code}')`);

  // Currencies page: add one; the rate and its "last updated" are listed.
  await page.goto("/en/admin/currencies");
  const add = page.getByTestId("currency-form-new");
  await add.locator("#code-new").fill(code.toLowerCase());
  await add.locator("#name_ar-new").fill("عملة تجربة");
  await add.locator("#name_en-new").fill("Trial money");
  await add.locator("#symbol-new").fill("T$");
  await add.locator("#rate-new").fill("123.45");
  await add.getByRole("button", { name: "Add currency" }).click();
  await expect(add.locator('[data-result="ok"]')).toBeVisible();
  const row = page.locator(`[data-currency="${code}"]`);
  await expect(row.getByTestId("currency-rate")).toHaveText(
    `1 ${code} = 123.45 SDG`,
  );
  await expect(row.getByTestId("currency-updated")).toContainText(
    "Rate updated",
  );
  const edit = page.getByTestId(`currency-form-${code}`);
  await edit.locator(`#rate-${code}`).fill("130");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(edit.locator('[data-result="ok"]')).toBeVisible();
  await expect(row.getByTestId("currency-rate")).toHaveText(
    `1 ${code} = 130 SDG`,
  );
  // USD: read-only, the store's rate.
  await expect(page.getByTestId("rate-USD")).toHaveAttribute("readonly", "");
  await page.screenshot({
    path: ".e2e/custom-amount-currencies.png",
    fullPage: true,
  });

  // The product: allow it (2–50), fee 2.5% + 200.
  await page.goto(`/en/admin/catalog/products/${bill.id}`);
  const section = page.getByTestId("custom-amount-settings");
  const allow = section.getByTestId("add-amount-currency");
  await allow.locator("#new-currency").selectOption(code);
  await allow.locator("#new-min").fill("2");
  await allow.locator("#new-max").fill("50");
  await allow.getByRole("button", { name: "Allow currency" }).click();
  await expect(section.locator(`tr[data-currency="${code}"]`)).toBeVisible();
  const form = section.getByTestId("custom-amount-settings-form");
  await form.locator("#fee_percent").fill("2.5");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.locator('[data-result="ok"]')).toBeVisible();
  await page.screenshot({
    path: ".e2e/custom-amount-product-admin.png",
    fullPage: true,
  });
  expect(
    sql(`select string_agg(action, ',' order by created_at) from public.audit_logs
          where actor_id = '${owner.id}' and created_at > now() - interval '5 minutes'
            and entity_type in ('currencies', 'custom_amount_currencies', 'custom_amount_products')`),
  ).toMatch(
    /currencies\.insert,currencies\.update,custom_amount_currencies\.insert,custom_amount_products\.update$/,
  );

  // The public page prices with it at once: 10 × 130 = 1,300 + 32.50 + 200.
  const shop = await browser.newContext({ baseURL: PHONE.baseURL });
  const pub = await shop.newPage();
  await pub.goto(`/en/p/${bill.slug}`);
  await expect(pub.getByTestId("amount-input")).toBeEnabled();
  await pub.getByTestId("currency-select").selectOption(code);
  await type(pub, "10");
  await expect(pub.getByTestId("calc-total")).toHaveText("SDG 1,533");
  await expect(pub.getByTestId("amount-help")).toHaveText(
    `From 2.00 to 50.00 ${code}`,
  );

  // Product staff without the settings permission: read only.
  const catalog = await createUser({ admin: { permissions: ["products"] } });
  const staff = await browser.newContext({ baseURL: PHONE.baseURL });
  await signInCookies(staff, catalog.phone, catalog.password);
  const ro = await staff.newPage();
  await ro.goto(`/en/admin/catalog/products/${bill.id}`);
  await expect(ro.getByTestId("custom-amount-readonly")).toBeVisible();
  await expect(ro.getByTestId("add-amount-currency")).toHaveCount(0);
  await expect(ro.getByTestId("custom-amount-settings-form")).toHaveCount(0);
  const denied = await ro.goto("/en/admin/currencies");
  expect(denied?.status()).toBe(404);

  // Disabling the currency removes it from the page.
  await page.goto("/en/admin/currencies");
  const again = page.getByTestId(`currency-form-${code}`);
  await again.getByLabel("Active").uncheck();
  await again.getByRole("button", { name: "Save" }).click();
  await expect(again.locator('[data-result="ok"]')).toBeVisible();
  await pub.goto(`/en/p/${bill.slug}`);
  await expect(pub.getByTestId("currency-select").locator("option")).toHaveText(
    ["EUR · Euro", "USD · US dollar"],
  );

  // A new custom-amount product from the dashboard: safe defaults, so it is
  // not for sale (404) until a currency is allowed.
  const slug = `bill-${randomBytes(3).toString("hex")}`;
  await page.goto("/en/admin/catalog/products/new");
  const product = page.getByTestId("product-form");
  await product.locator("#name_en").fill("Pay any bill");
  await product.locator("#slug").fill(slug);
  await product.getByLabel("Custom amount").check();
  await product.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/\/en\/admin\/catalog\/products\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("product-kind")).toContainText("Custom amount");
  await expect(page.getByTestId("custom-amount-settings")).toContainText(
    "No currency yet",
  );
  expect(
    sql(`select c.amount_decimals || '|' || c.fee_percent || '|' || c.fee_fixed_sdg
           from public.custom_amount_products c join public.products p on p.id = c.product_id
          where p.slug = '${slug}'`),
  ).toBe("2|0.00|0.00");
  expect((await pub.goto(`/en/p/${slug}`))?.status()).toBe(404);

  // The category page lists the configured one as "Any amount".
  await pub.goto("/en/c/games");
  await expect(
    pub
      .getByTestId("product-card")
      .filter({ hasText: "Pay a bill with Visa" })
      .first(),
  ).toContainText("Any amount");
  await Promise.all([ctx.close(), shop.close(), staff.close()]);
});

test("a rate saved in the dashboard shows on the product page at once, for every visitor (shared catalog cache)", async ({
  browser,
}) => {
  test.skip(
    process.env.E2E_SERVER !== "prod",
    "the catalog cache only exists on `next start` (E2E_SERVER=prod)",
  );
  const BASE = "http://localhost:3101"; // the same build with the cache on
  const letter = () => String.fromCharCode(67 + (randomBytes(1)[0] % 23));
  const code = `X${letter()}${letter()}`;
  sql(`insert into public.currencies (code, name_ar, name_en, symbol, sdg_rate)
       values ('${code}', 'عملة', 'Cache test', 'C', 1000)
       on conflict (code) do update set sdg_rate = 1000, is_active = true`);
  const bill = createCustomProduct({ currencies: [[code, "1", "100"]] });
  const rateOnPage = async () => {
    const ctx = await browser.newContext({ baseURL: BASE });
    const page = await ctx.newPage();
    await page.goto(`/en/p/${bill.slug}`);
    const shown = await page.getByTestId("calc-rate").innerText();
    await ctx.close();
    return shown;
  };
  expect(await rateOnPage()).toBe(`1 ${code} = 1,000 SDG`); // fills the cache
  // Behind the app's back: not seen while the entry is fresh (the cache is real).
  sql(`update public.currencies set sdg_rate = 1100 where code = '${code}'`);
  expect(await rateOnPage()).toBe(`1 ${code} = 1,000 SDG`);
  // A dashboard save expires it at once.
  const owner = await ownerUser();
  const admin = await browser.newContext({ baseURL: BASE });
  await signInCookies(admin, owner.phone, owner.password);
  const page = await admin.newPage();
  await page.goto("/en/admin/currencies");
  const form = page.getByTestId(`currency-form-${code}`);
  await form.locator(`#rate-${code}`).fill("1200");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.locator('[data-result="ok"]')).toBeVisible();
  await admin.close();
  expect(await rateOnPage()).toBe(`1 ${code} = 1,200 SDG`);
  console.log(
    `[demo] cache: ${code} 1,000 shown; SQL 1,100 unseen while fresh; dashboard 1,200 shown at once`,
  );
});
