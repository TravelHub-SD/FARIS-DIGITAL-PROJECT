import { type Browser, expect, test } from "@playwright/test";

import { createUser, signInCookies, sql, type TestUser } from "./helpers";

// Security review F4: when today's verification codes reach the daily budget,
// sign-ups stop; settings staff see it on every admin page. Staff without the
// settings permission never see it.

const today = () =>
  Number(
    sql(`select count(*) from private.otp_codes
          where created_at >= (date_trunc('day', now() at time zone 'Africa/Khartoum') at time zone 'Africa/Khartoum')`),
  );

async function adminPage(browser: Browser, user: TestUser, path: string) {
  const ctx = await browser.newContext({ baseURL: "http://localhost:3100" });
  await signInCookies(ctx, user.phone, user.password);
  const page = await ctx.newPage();
  await page.goto(path);
  return { ctx, page };
}

test("OTP budget alert: shown to settings staff near and at the limit, never to others", async ({
  browser,
}) => {
  const settings = await createUser({ admin: { permissions: ["settings"] } });
  const orders = await createUser({ admin: { permissions: ["orders"] } });
  const original = sql("select otp_daily_budget from security_settings");
  // At least 4 codes today, so a budget exists that is over 80 % used but
  // not reached (4 of 5).
  sql(`insert into private.otp_codes (phone_e164, purpose, code_hash, expires_at)
         select '+249900000999', 'register', repeat('0', 64), now()
           from generate_series(1, 4)`);
  try {
    const used = today();
    sql(`update security_settings set otp_daily_budget = ${used}`);
    const s = await adminPage(browser, settings, "/en/admin");
    const alert = s.page.getByTestId("otp-budget-alert");
    await expect(alert).toContainText(
      `limit of verification codes is reached (${used} of ${used})`,
    );
    await alert.getByRole("link").click();
    await expect(s.page).toHaveURL(/\/en\/admin\/settings#otp_daily_budget$/);
    await s.ctx.close();

    const o = await adminPage(browser, orders, "/ar/admin/orders");
    await expect(o.page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(o.page.getByTestId("otp-budget-alert")).toHaveCount(0);
    await o.ctx.close();

    // 80 % of the budget: a warning, in Arabic.
    sql(
      `update security_settings set otp_daily_budget = ${Math.floor(used / 0.8)}`,
    );
    const near = await adminPage(browser, settings, "/ar/admin");
    await expect(near.page.getByTestId("otp-budget-alert")).toContainText(
      "رموز التحقق اليوم",
    );
    await near.ctx.close();

    // Well under the limit: nothing.
    sql(`update security_settings set otp_daily_budget = ${used * 10 + 100}`);
    const calm = await adminPage(browser, settings, "/en/admin");
    await expect(calm.page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(calm.page.getByTestId("otp-budget-alert")).toHaveCount(0);
    await calm.ctx.close();
  } finally {
    sql(`update security_settings set otp_daily_budget = ${original}`);
  }
});
