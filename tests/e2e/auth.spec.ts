import { expect, test } from "@playwright/test";

import {
  createUser,
  localNumber,
  logSize,
  readOtp,
  service,
  signInCookies,
  sql,
  toE164,
} from "./helpers";

test("register with a WhatsApp code → account; sign out; sign in again", async ({
  page,
}) => {
  const local = localNumber();
  const phone = toE164(local);
  await page.goto("/ar/register");
  const mark = logSize();
  await page.fill("#phone", local);
  await page.getByRole("button", { name: "إرسال الرمز" }).click();
  await expect(page.locator("#code")).toBeVisible();

  const code = await readOtp(phone, mark);
  await page.fill("#code", code);
  await page.fill("#fullName", "عميل تجريبي");
  await page.fill("#password", "a-strong-password-1");
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();
  await expect(page).toHaveURL(/\/ar\/account$/);
  await expect(page.getByTestId("kyc-status")).toHaveText("غير موثق");

  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(page).toHaveURL(/\/ar\/login$/);
  await page.fill("#phone", local);
  await page.fill("#password", "a-strong-password-1");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(/\/ar\/account$/);
});

test("a wrong code is refused and the account is not created", async ({
  page,
}) => {
  const local = localNumber();
  const phone = toE164(local);
  await page.goto("/en/register");
  const mark = logSize();
  await page.fill("#phone", local);
  await page.getByRole("button", { name: "Send code" }).click();
  const code = await readOtp(phone, mark);
  const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, "0");
  await page.fill("#code", wrong);
  await page.fill("#fullName", "Test User");
  await page.fill("#password", "a-strong-password-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.locator("[data-tone=error]")).toContainText(
    "Wrong code. Attempts left: 4.",
  );
  expect(
    sql(`select count(*) from auth.users where phone = '${phone.slice(1)}'`),
  ).toBe("0");
});

test("abandoned registration (code requested, never verified) leaves NO account", async ({
  page,
}) => {
  const local = localNumber();
  const phone = toE164(local);
  await page.goto("/ar/register");
  await page.fill("#phone", local);
  await page.getByRole("button", { name: "إرسال الرمز" }).click();
  await expect(page.locator("#code")).toBeVisible();
  // walk away here
  expect(
    sql(`select count(*) from auth.users where phone = '${phone.slice(1)}'`),
  ).toBe("0");
  await page.goto("/ar/login");
  await page.fill("#phone", local);
  await page.fill("#password", "anything-at-all-1");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.locator("[data-tone=error]")).toContainText(
    "رقم الهاتف أو كلمة المرور غير صحيحة",
  );
});

test("password reset: new password works, old one no longer does", async ({
  page,
}) => {
  const user = await createUser();
  const local = "0" + user.phone.slice(4);
  await page.goto("/ar/reset-password");
  const mark = logSize();
  await page.fill("#phone", local);
  await page.getByRole("button", { name: "إرسال الرمز" }).click();
  const code = await readOtp(user.phone, mark);
  await page.fill("#code", code);
  await page.fill("#password", "brand-new-password-2");
  await page.getByRole("button", { name: "حفظ كلمة المرور الجديدة" }).click();
  await expect(page).toHaveURL(/\/ar\/account$/);

  const old = await service().auth.signInWithPassword({
    phone: user.phone,
    password: user.password,
  });
  expect(old.error?.message).toMatch(/Invalid login credentials/);
});

test("a half-finished account (phone not verified) cannot reach ANY authenticated route", async ({
  page,
  context,
}) => {
  // A real session for a user who is also an admin with every permission...
  const user = await createUser({
    admin: {
      permissions: [
        "orders",
        "products",
        "kyc",
        "customers",
        "invoices",
        "comments",
        "settings",
      ],
    },
  });
  await signInCookies(context, user.phone, user.password);
  // ...then put it in the state a Google sign-in leaves: provider google, no verified phone.
  sql(`update auth.users set phone = null, phone_confirmed_at = null,
         raw_app_meta_data = '{"provider":"google","providers":["google"]}' where id = '${user.id}'`);
  expect(
    sql(
      `select phone_verified_at is null from public.profiles where id = '${user.id}'`,
    ),
  ).toBe("t");

  const routes = [
    "/ar/account",
    "/ar/account/kyc",
    "/ar/admin",
    "/ar/admin/kyc",
    "/en/account",
    "/en/admin",
  ];
  for (const route of routes) {
    await page.goto(route);
    const locale = route.split("/")[1];
    await expect(page, route).toHaveURL(
      new RegExp(`/${locale}/complete-account$`),
    );
    console.log(`[demo] ${route} -> ${new URL(page.url()).pathname}`);
  }

  // Finishing the phone step unlocks the account.
  const local = localNumber();
  await page.goto("/ar/complete-account");
  const mark = logSize();
  await page.fill("#phone", local);
  await page.getByRole("button", { name: "إرسال الرمز" }).click();
  await page.fill("#code", await readOtp(toE164(local), mark));
  await page.getByRole("button", { name: "تحقق ومتابعة" }).click();
  await expect(page).toHaveURL(/\/ar\/account$/);
  await page.goto("/ar/admin/kyc");
  await expect(page).toHaveURL(/\/ar\/admin\/kyc$/);
});

test("non-admins get 404 on admin routes; admins without kyc get 404 on the KYC queue", async ({
  browser,
}) => {
  const cases: [Parameters<typeof createUser>[0], string][] = [
    [{}, "/ar/admin"],
    [{ admin: { permissions: ["orders"] } }, "/ar/admin/kyc"],
  ];
  for (const [spec, route] of cases) {
    const context = await browser.newContext();
    const user = await createUser(spec);
    await signInCookies(context, user.phone, user.password);
    const page = await context.newPage();
    const res = await page.goto(`http://localhost:3100${route}`);
    expect(res?.status(), route).toBe(404);
    await context.close();
  }
});

test("login form checks input in the browser (shared rules, no Zod shipped) before calling the server", async ({
  page,
}) => {
  const actionCalls: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.headers()["next-action"])
      actionCalls.push(r.url());
  });
  await page.goto("/en/login");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
  await page.fill("#phone", "0812345678");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("#phone-help")).toHaveText(
    "Enter a valid Sudanese mobile number.",
  );
  await expect(page.locator("#password-help")).toHaveText(
    "Enter your password.",
  );
  await expect(page.locator("#phone")).toBeFocused();
  await expect(page.locator("#phone")).toHaveAttribute("aria-invalid", "true");
  expect(actionCalls).toHaveLength(0);

  // Editing a field clears its message; Arabic-Indic digits are accepted.
  await page.fill("#phone", "٠٩١٢٣٤٥٦٧٨");
  await expect(page.locator("#phone-help")).toHaveText(
    "Sudanese number, e.g. 0912345678",
  );
  await page.fill("#password", "wrong-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByText("Phone number or password is incorrect."),
  ).toBeVisible();
  expect(actionCalls).toHaveLength(1);
});
