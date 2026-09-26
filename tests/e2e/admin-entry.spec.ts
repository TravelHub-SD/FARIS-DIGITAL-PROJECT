import { expect, test } from "@playwright/test";

import { createUser, signInCookies, sql, type TestUser } from "./helpers";

// Staff reach the dashboard from their account page; customers (and staff
// whose access was switched off) get no link and no hint that it exists.

async function accountPage(
  browser: import("@playwright/test").Browser,
  user: TestUser,
  locale: "ar" | "en",
) {
  const ctx = await browser.newContext({ baseURL: "http://localhost:3100" });
  await signInCookies(ctx, user.phone, user.password);
  const page = await ctx.newPage();
  await page.goto(`/${locale}/account`);
  await expect(page.getByTestId("kyc-status")).toBeVisible();
  return { ctx, page };
}

const adminLinks = (page: import("@playwright/test").Page) =>
  page.locator('a[href$="/admin"], a[href*="/admin/"]');

test("staff see a dashboard entry on their account page; customers and deactivated staff do not", async ({
  browser,
}) => {
  const customer = await createUser();
  const staff = await createUser({ admin: { permissions: ["orders"] } });
  const former = await createUser({ admin: { permissions: ["orders"] } });
  sql(`update admins set is_active = false where user_id = '${former.id}'`);

  const c = await accountPage(browser, customer, "ar");
  await expect(c.page.getByTestId("admin-entry")).toHaveCount(0);
  await expect(adminLinks(c.page)).toHaveCount(0);
  await expect(c.page.locator("body")).not.toContainText("لوحة الإدارة");
  await c.ctx.close();

  const f = await accountPage(browser, former, "en");
  await expect(f.page.getByTestId("admin-entry")).toHaveCount(0);
  await expect(adminLinks(f.page)).toHaveCount(0);
  await f.ctx.close();

  for (const locale of ["ar", "en"] as const) {
    const s = await accountPage(browser, staff, locale);
    const entry = s.page.getByTestId("admin-entry");
    await expect(entry).toBeVisible();
    await entry.getByRole("link").click();
    await expect(s.page).toHaveURL(new RegExp(`/${locale}/admin$`));
    await expect(s.page.getByTestId("dashboard-card").first()).toBeVisible();
    await s.ctx.close();
  }
  console.log(
    "[demo] admin entry: customer → none; deactivated staff → none; orders staff (ar, en) → link → dashboard",
  );
});
