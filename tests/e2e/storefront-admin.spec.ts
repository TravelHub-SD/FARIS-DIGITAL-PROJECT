import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

import { expect, test } from "@playwright/test";
import sharp from "sharp";

import { createUser, signInCookies, sql } from "./helpers";

// The storefront controls added with the redesign, set from the dashboard
// and seen on the site: a home section, a category icon, the "New" badge and
// a compare-at ("was") price. The compare-at price is display only: an order
// is still charged the package price (pgTAP 09 checks that in the database).

const BASE = "http://localhost:3100";
const VARIANT = "00000000-0000-4000-c000-000000000001"; // 60 UC, 1.10 USD

test("sections, category icon, New badge and compare-at price from the dashboard", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const t = randomBytes(3).toString("hex");
  const staff = await createUser({ admin: { permissions: ["products"] } });
  const ctx = await browser.newContext();
  await signInCookies(ctx, staff.phone, staff.password);
  const page = await ctx.newPage();
  const games = sql("select id from public.categories where slug = 'games'");
  const before = JSON.parse(
    sql(
      `select json_build_object('section', c.section_id, 'image', c.image_path,
              'is_new', p.is_new, 'compare', v.compare_at_price_usd)
         from public.categories c, public.products p, public.product_variants v
        where c.slug = 'games' and p.slug = 'pubg-uc' and v.id = '${VARIANT}'`,
    ),
  );

  try {
    // 1. A new section, first on the home page.
    await page.goto(`${BASE}/en/admin/catalog`);
    const form = page.getByTestId("new-section-form");
    await form.locator("input[name=name_ar]").fill(`عروض ${t}`);
    await form.locator("input[name=name_en]").fill(`Deals ${t}`);
    await form.locator("input[name=sort_order]").fill("-50");
    await form.getByRole("button", { name: "Add section" }).click();
    await expect(form.locator('[data-result="ok"]')).toBeVisible();

    // 2. The games category moves into it and gets a square icon.
    await page.goto(`${BASE}/en/admin/catalog/categories/${games}`);
    await page.selectOption("#section_id", { label: `Deals ${t}` });
    await page
      .getByTestId("category-form")
      .getByRole("button", { name: "Save" })
      .click();
    await expect(
      page.getByTestId("category-form").locator('[data-result="ok"]'),
    ).toBeVisible();
    const icon = ".e2e/category-icon.png";
    writeFileSync(
      icon,
      await sharp({
        create: { width: 400, height: 400, channels: 3, background: "#7c3aed" },
      })
        .png()
        .toBuffer(),
    );
    const iconBox = page.getByTestId("category-icon");
    await iconBox.locator("input[type=file]").setInputFiles(icon);
    await iconBox.getByRole("button", { name: "Upload image" }).click();
    await expect(page.getByTestId("category-icon-preview")).toBeVisible();
    // Stored as WebP (full + thumbnail) under categories/<id>/.
    expect(
      sql(
        `select image_path like 'categories/${games}/%.webp' from public.categories where id = '${games}'`,
      ),
    ).toBe("t");

    // 3. "New" on PUBG UC, and a compare-at price on its 60 UC package.
    const pubg = sql("select id from public.products where slug = 'pubg-uc'");
    await page.goto(`${BASE}/en/admin/catalog/products/${pubg}`);
    await page.getByLabel("“New” badge").check();
    await page
      .getByTestId("product-form")
      .getByRole("button", { name: "Save" })
      .click();
    await expect(
      page.getByTestId("product-form").locator('[data-result="ok"]'),
    ).toBeVisible();
    await page.goto(`${BASE}/en/admin/catalog/variants/${VARIANT}`);
    await page.fill("#compare_at_price_usd", "1.50");
    await page
      .getByTestId("variant-form")
      .getByRole("button", { name: "Save" })
      .click();
    await expect(
      page.getByTestId("variant-form").locator('[data-result="ok"]'),
    ).toBeVisible();

    // On the site: the section leads the home page with the games tile and
    // its icon; the card and the package show "New" and the struck price.
    const visitor = await (await browser.newContext()).newPage();
    await visitor.goto(`${BASE}/en`);
    const first = visitor.getByTestId("home-section").first();
    await expect(first).toContainText(`Deals ${t}`);
    await expect(
      first.getByTestId("category-tile").locator("img"),
    ).toHaveAttribute("src", /categories%2F|categories\//);
    await visitor.goto(`${BASE}/en/c/games`);
    const card = visitor
      .getByTestId("product-card")
      .filter({ hasText: "PUBG UC" });
    await expect(card.getByTestId("badge-new")).toBeVisible();
    // ceil(1.50 × 2600) = 3,900 struck next to 2,860.
    await expect(card.getByTestId("card-compare-at")).toContainText("3,900");
    await visitor.goto(`${BASE}/en/p/pubg-uc`);
    await expect(
      visitor.getByTestId("variant-option").filter({ hasText: "60 UC" }),
    ).toContainText("SDG 3,900");
    await expect(visitor.getByTestId("order-total")).toHaveText("SDG 2,860");
    await visitor.screenshot({
      path: ".e2e/product-compare-at.png",
      fullPage: true,
    });

    // A compare-at below the price is not shown (no fake discount).
    sql(
      `update public.product_variants set compare_at_price_usd = 1.00 where id = '${VARIANT}'`,
    );
    await visitor.goto(`${BASE}/en/c/games`);
    await expect(
      visitor
        .getByTestId("product-card")
        .filter({ hasText: "PUBG UC" })
        .getByTestId("card-compare-at"),
    ).toHaveCount(0);
  } finally {
    sql(
      `update public.categories set section_id = ${before.section ? `'${before.section}'` : "null"},
              image_path = ${before.image ? `'${before.image}'` : "null"} where id = '${games}';
       update public.products set is_new = ${before.is_new} where slug = 'pubg-uc';
       update public.product_variants set compare_at_price_usd = ${before.compare ?? "null"} where id = '${VARIANT}';
       delete from public.category_sections where name_en = 'Deals ${t}';`,
    );
  }
});
