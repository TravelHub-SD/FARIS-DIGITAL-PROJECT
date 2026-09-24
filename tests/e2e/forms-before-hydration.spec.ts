import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { createUser, ownerUser, signInCookies } from "./helpers";

// Regression (found in Phase 6): forms that submit through JavaScript used to
// submit natively as GET when clicked before hydration (slow connection, JS
// still loading), putting the phone number and PASSWORD in the URL, the
// browser history and the server access log. Now every such form is
// method=post and its submit button stays disabled until hydration.

const PUBLIC = [
  "/ar/login",
  "/ar/register",
  "/ar/reset-password",
  "/en/login",
  "/ar/p/pubg-uc",
];

test("without JavaScript: no form can submit values in a URL", async ({
  browser,
}) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  const owner = await ownerUser();
  const customer = await createUser();
  const adminCtx = await browser.newContext({ javaScriptEnabled: false });
  await signInCookies(adminCtx, owner.phone, owner.password);
  const adminPage = await adminCtx.newPage();
  const customerCtx = await browser.newContext({ javaScriptEnabled: false });
  await signInCookies(customerCtx, customer.phone, customer.password);
  const customerPage = await customerCtx.newPage();

  const check = async (p: typeof page, path: string) => {
    await p.goto(path);
    const forms = await p.locator("form:not([role=search])").evaluateAll((fs) =>
      fs.map((f) => ({
        method: (f.getAttribute("method") ?? "get").toLowerCase(),
        // A Server Action form (progressive enhancement, e.g. sign out) is a
        // real POST that works without JavaScript; it may stay enabled.
        serverAction: !!f.querySelector("input[name^='$ACTION']"),
        submits: [
          ...f.querySelectorAll("button[type=submit], button:not([type])"),
        ].map(
          (b) =>
            (b as HTMLButtonElement).disabled ||
            !!b.closest("fieldset[disabled]"),
        ),
      })),
    );
    const guarded = forms.filter((f) => !f.serverAction);
    console.log(
      `[demo] ${path}: ${forms.length} form(s); methods: ${[...new Set(forms.map((f) => f.method))].join("/")}; ` +
        `JS forms with submit disabled before hydration: ${guarded.filter((f) => f.submits.every(Boolean)).length}/${guarded.length}` +
        (forms.length - guarded.length
          ? `; server-action forms (work without JS): ${forms.length - guarded.length}`
          : ""),
    );
    for (const f of forms) {
      expect(f.method, path).toBe("post");
      if (!f.serverAction) expect(f.submits.every(Boolean), path).toBe(true);
    }
    return forms.length;
  };
  let total = 0;
  for (const path of PUBLIC) total += await check(page, path);
  for (const path of ["/ar/account", "/ar/account/kyc"])
    total += await check(customerPage, path);
  for (const path of [
    "/ar/admin/settings",
    "/ar/admin/faqs",
    "/ar/admin/admins",
  ])
    total += await check(adminPage, path);
  expect(total).toBeGreaterThan(10);

  // And the concrete case: typing a password and pressing Enter does nothing.
  const before = readFileSync(".e2e/dev.log", "utf8").split(
    "Hydration-Secret-9",
  ).length;
  await page.goto("/ar/login");
  await page.fill("input[name=phone]", "0912345678");
  await page.fill("input[name=password]", "Hydration-Secret-9");
  await page.press("input[name=password]", "Enter");
  await page.waitForTimeout(500);
  expect(page.url()).not.toContain("password");
  expect(
    readFileSync(".e2e/dev.log", "utf8").split("Hydration-Secret-9").length,
  ).toBe(before);
});
