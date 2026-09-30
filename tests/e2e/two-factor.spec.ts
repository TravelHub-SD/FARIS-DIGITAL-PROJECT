import {
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  test,
} from "@playwright/test";

import { totp } from "../integration/totp";
import {
  createUser,
  ownerUser,
  signInCookies,
  sql,
  type TestUser,
} from "./helpers";

// Staff two-step sign-in, through the real screens: first sign-in sets up an
// authenticator (Arabic), later sign-ins ask for its code (English), wrong
// codes are limited, a backup authenticator can be added and removed, and the
// owner can reset a staff member (who is then signed out). Customers never
// see any of it.

const BASE = "http://localhost:3100";

async function passwordSignIn(
  browser: Browser,
  user: TestUser,
  locale: "ar" | "en",
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto(`/${locale}/login`);
  await page.fill("#phone", "0" + user.phone.slice(4));
  await page.fill("#password", user.password);
  await page
    .getByRole("button", { name: locale === "ar" ? "دخول" : "Sign in" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/account$`));
  return { ctx, page };
}

/** Reads the key shown under the QR code, as a person would type it. */
const shownSecret = async (page: Page) =>
  (await page.getByTestId("totp-secret").innerText()).replace(/\s/g, "");

test("first sign-in sets up the authenticator (Arabic); the next one asks for its code (English)", async ({
  browser,
}) => {
  const staff = await createUser({
    admin: { permissions: ["orders"] },
    mfa: false,
  });
  sql(`delete from auth.mfa_factors where user_id = '${staff.id}'`);

  // 1. Arabic: account card → dashboard → set up.
  const a = await passwordSignIn(browser, staff, "ar");
  await a.page.getByTestId("admin-entry").getByRole("link").click();
  await expect(a.page).toHaveURL(/\/ar\/two-factor$/);
  await expect(a.page.locator("h1")).toHaveText("تفعيل الدخول بخطوتين");
  await a.page.getByRole("button", { name: "إعداد تطبيق المصادقة" }).click();
  await expect(a.page.getByTestId("totp-setup")).toBeVisible();
  await expect(a.page.getByRole("img", { name: /رمز QR/ })).toHaveAttribute(
    "src",
    /^data:image\/svg\+xml/,
  );
  const secret = await shownSecret(a.page);
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  await a.page.fill("#totp-code", "000000");
  await a.page.getByRole("button", { name: "تأكيد ومتابعة" }).click();
  await expect(a.page.locator("[data-tone=error]")).toContainText(
    "الرمز غير صحيح",
  );
  // Arabic-Indic digits are accepted, as on the other code screens.
  const code = totp(secret).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
  await a.page.fill("#totp-code", code);
  await a.page.getByRole("button", { name: "تأكيد ومتابعة" }).click();
  await expect(a.page).toHaveURL(/\/ar\/admin\/security$/);
  await expect(a.page.getByTestId("backup-advice")).toBeVisible();
  await expect(a.page.getByTestId("authenticators").locator("li")).toHaveCount(
    1,
  );
  await a.page.goto("/ar/admin/orders");
  await expect(a.page.locator("h1")).toHaveText("الطلبات");
  await a.ctx.close();

  // 2. English, a new device: password, then the code.
  const e = await passwordSignIn(browser, staff, "en");
  await e.page.goto("/en/admin/orders");
  await expect(e.page).toHaveURL(/\/en\/two-factor$/);
  await expect(e.page.locator("h1")).toHaveText(
    "Enter your authenticator code",
  );
  await e.page.fill("#totp-code", totp(secret));
  await e.page.getByRole("button", { name: "Continue" }).click();
  await expect(e.page).toHaveURL(/\/en\/admin$/);
  await e.page.goto("/en/admin/orders");
  await expect(e.page.locator("h1")).toHaveText("Orders");
  await e.ctx.close();
});

test("wrong codes are limited to 5 per 15 minutes per staff member", async ({
  browser,
}) => {
  const staff = await createUser({ admin: { permissions: ["orders"] } });
  sql(`delete from private.rate_limit_events where key = '${staff.id}'`);
  const { ctx, page } = await passwordSignIn(browser, staff, "en");
  await page.goto("/en/two-factor");
  const submit = page.getByRole("button", { name: "Continue" });
  const alert = page.locator("[data-tone=error]");
  const failures = () =>
    Number(
      sql(`select count(*) from private.rate_limit_events
             where bucket = 'mfa_fail_user' and key = '${staff.id}'`),
    );
  for (let i = 1; i <= 5; i++) {
    await page.fill("#totp-code", "123456");
    await submit.click();
    await expect.poll(failures).toBe(i);
    await expect(alert).toContainText("Wrong code");
  }
  // The sixth attempt is refused before the code is even checked, so the
  // right code does not help an attacker who keeps guessing.
  const staffSecret = sql(
    `select secret from auth.mfa_factors where user_id = '${staff.id}' limit 1`,
  );
  await page.fill("#totp-code", totp(staffSecret));
  await submit.click();
  await expect(alert).toContainText("Too many attempts");
  await expect(page).toHaveURL(/\/en\/two-factor$/);
  console.log(
    `[demo] 5 wrong codes recorded (${failures()}); 6th attempt with the RIGHT code → "Too many attempts"`,
  );
  await ctx.close();
});

test("password-only staff reach nothing; customers never see the step", async ({
  browser,
}) => {
  const staff = await createUser({ admin: { permissions: ["orders"] } });
  const ctx = await browser.newContext({ baseURL: BASE });
  await signInCookies(ctx, staff.phone, staff.password, { mfa: false });
  const page = await ctx.newPage();
  for (const path of ["/en/admin", "/en/admin/orders", "/en/admin/security"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/en\/two-factor$/);
  }
  await ctx.close();

  const customer = await createUser();
  const c = await browser.newContext({ baseURL: BASE });
  await signInCookies(c, customer.phone, customer.password);
  const res = await (await c.newPage()).goto("/en/two-factor");
  expect(res!.status()).toBe(404);
  await c.close();
});

test("a backup authenticator is added and removed; the only one cannot be removed", async ({
  browser,
}) => {
  const staff = await createUser({ admin: { permissions: ["orders"] } });
  const ctx = await browser.newContext({ baseURL: BASE });
  await signInCookies(ctx, staff.phone, staff.password);
  const page = await ctx.newPage();
  await page.goto("/en/admin/security");
  const list = page.getByTestId("authenticators").locator("li");
  await expect(list).toHaveCount(1);
  await expect(list.getByRole("button", { name: "Remove" })).toHaveCount(0);

  await page.getByRole("button", { name: "Add another authenticator" }).click();
  const secret = await shownSecret(page);
  await page.fill("#totp-code", totp(secret));
  await page.getByRole("button", { name: "Confirm and continue" }).click();
  await expect(list).toHaveCount(2);
  await expect(page.getByTestId("backup-advice")).toHaveCount(0);

  page.once("dialog", (d) => d.accept());
  await list.first().getByRole("button", { name: "Remove" }).click();
  await expect(list).toHaveCount(1);
  expect(
    sql(
      `select count(*) from auth.mfa_factors where user_id = '${staff.id}' and status = 'verified'`,
    ),
  ).toBe("1");
  await ctx.close();
});

test("owner resets a staff member: their open session ends and they set up again", async ({
  browser,
}) => {
  const owner = await ownerUser();
  const staff = await createUser({
    admin: { permissions: ["orders"] },
    name: "Reset Target",
  });
  const staffCtx = await browser.newContext({ baseURL: BASE });
  await signInCookies(staffCtx, staff.phone, staff.password);
  const staffPage = await staffCtx.newPage();
  await staffPage.goto("/en/admin/orders");
  await expect(staffPage.locator("h1")).toHaveText("Orders");

  const ownerCtx = await browser.newContext({ baseURL: BASE });
  await signInCookies(ownerCtx, owner.phone, owner.password);
  const ownerPage = await ownerCtx.newPage();
  await ownerPage.goto("/en/admin/admins");
  const card = ownerPage
    .getByTestId("admin-entry")
    .filter({ hasText: "Reset Target" });
  ownerPage.once("dialog", (d) => d.accept());
  await card.getByRole("button", { name: "Reset two-step sign-in" }).click();
  await expect(card.getByTestId("admin-reset-mfa")).toContainText(
    "They will set up a new authenticator",
  );
  await ownerCtx.close();

  // The staff member's browser is signed out at the next page.
  await staffPage.goto("/en/admin/orders");
  await expect(staffPage).toHaveURL(/\/en\/login$/);
  await staffCtx.close();

  const again = await passwordSignIn(browser, staff, "en");
  await again.page.goto("/en/admin");
  await expect(again.page).toHaveURL(/\/en\/two-factor$/);
  await expect(again.page.locator("h1")).toHaveText("Set up two-step sign-in");
  await again.ctx.close();
});
