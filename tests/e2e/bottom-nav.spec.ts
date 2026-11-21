import { devices, expect, type Page, test } from "@playwright/test";

import { createUser, signInCookies } from "./helpers";

// Bug (client feedback round 1): the bottom bar kept the first page's tab
// after client navigation (Categories tapped, Home still marked), because
// the root layout that holds it is not rendered again. Every tab, both
// languages, without a full reload; and the shop's bar and chat button
// leave and come back when moving to the dashboard and back.

const PHONE = {
  ...devices["Pixel 7"],
  viewport: { width: 360, height: 780 },
  baseURL: "http://localhost:3100",
};

const marked = (page: Page) =>
  page.getByTestId("bottom-nav").locator('[aria-current="page"]');

async function markDocument(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __sameDocument: boolean }).__sameDocument = true;
  });
}
const sameDocument = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __sameDocument?: boolean }).__sameDocument,
  );

test("bottom navigation marks the current tab after every client navigation", async ({
  browser,
}) => {
  const customer = await createUser();
  const ctx = await browser.newContext(PHONE);
  await signInCookies(ctx, customer.phone, customer.password);
  const page = await ctx.newPage();

  for (const locale of ["ar", "en"] as const) {
    await page.goto(`/${locale}`);
    await page.waitForLoadState("networkidle"); // hydrated: links navigate client-side
    await expect(marked(page)).toHaveAttribute("data-tab", "home");
    await markDocument(page);
    const route: [string, RegExp][] = [
      ["categories", new RegExp(`/${locale}/categories$`)],
      ["cart", new RegExp(`/${locale}/cart$`)],
      ["orders", new RegExp(`/${locale}/account/orders$`)],
      ["account", new RegExp(`/${locale}/account$`)],
      ["home", new RegExp(`/${locale}$`)],
    ];
    for (const [tab, url] of route) {
      await page.getByTestId("bottom-nav").locator(`[data-tab=${tab}]`).click();
      await expect(page).toHaveURL(url);
      await expect(marked(page)).toHaveCount(1);
      await expect(marked(page), `${locale} → ${tab}`).toHaveAttribute(
        "data-tab",
        tab,
      );
    }
    // A link inside a page counts too: a product belongs to Categories.
    await page.goto(`/${locale}/categories`);
    await page.waitForLoadState("networkidle");
    await markDocument(page);
    await page.locator(`a[href="/${locale}/c/games"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/c/games$`));
    await expect(marked(page)).toHaveAttribute("data-tab", "categories");
    expect(await sameDocument(page), "no full page load").toBe(true);
  }
  await ctx.close();
  console.log(
    "[demo] bottom nav: home → categories → cart → orders → account → home (ar, en), client-side, the tapped tab marked each time",
  );
});

test("moving between the shop and the dashboard hides and restores the shop's bar and chat button", async ({
  browser,
}) => {
  const staff = await createUser({ admin: { permissions: ["orders"] } });
  const ctx = await browser.newContext(PHONE);
  await signInCookies(ctx, staff.phone, staff.password);
  const page = await ctx.newPage();
  await page.goto("/en/account");
  await page.waitForLoadState("networkidle");
  await markDocument(page);
  await expect(page.getByTestId("bottom-nav")).toBeVisible();
  await expect(page.getByTestId("whatsapp-button")).toBeVisible();

  await page.getByTestId("admin-entry").getByRole("link").click();
  await expect(page).toHaveURL(/\/en\/admin$/);
  await expect(page.getByTestId("bottom-nav")).toHaveCount(0);
  await expect(page.getByTestId("whatsapp-button")).toBeHidden();

  await page.getByTestId("site-header").getByRole("link").first().click();
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.getByTestId("bottom-nav")).toBeVisible();
  await expect(marked(page)).toHaveAttribute("data-tab", "home");
  await expect(page.getByTestId("whatsapp-button")).toBeVisible();
  expect(await sameDocument(page), "no full page load").toBe(true);
  await ctx.close();
});
