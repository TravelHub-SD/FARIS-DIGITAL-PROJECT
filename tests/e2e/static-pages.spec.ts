import { type Browser, expect, test } from "@playwright/test";

import { createUser, signInCookies, sql, type TestUser } from "./helpers";

// About / Terms / Privacy, edited in the dashboard (settings permission, as
// FAQs) and shown on the site: published pages in the footer, the sitemap
// and at their address, in both languages with fallback; drafts are 404s;
// pasted markup is shown as text.

const BASE = "http://localhost:3100";

async function staffPage(browser: Browser, user: TestUser, path: string) {
  const ctx = await browser.newContext({ baseURL: BASE });
  await signInCookies(ctx, user.phone, user.password);
  const page = await ctx.newPage();
  const res = await page.goto(path);
  return { ctx, page, status: res!.status() };
}

test.beforeEach(() => {
  sql(`update site_pages set title_ar = null, title_en = null, body_ar = null,
         body_en = null, is_published = false where slug = 'terms'`);
});

test("settings staff write and publish Terms; visitors read it in Arabic and English", async ({
  browser,
  page,
}) => {
  const settings = await createUser({ admin: { permissions: ["settings"] } });
  expect((await page.goto("/ar/terms"))!.status()).toBe(404);

  const s = await staffPage(browser, settings, "/en/admin/pages");
  const form = s.page.getByTestId("page-form-terms");
  await form.locator("#t-ar-terms").fill("شروط الاستخدام");
  await form
    .locator("#b-ar-terms")
    .fill(
      "البند الأول: الأسعار بالجنيه.\nسطر ثانٍ في نفس الفقرة.\n\nالبند الثاني: <b>لا</b> استرداد بعد التنفيذ. <script>alert(1)</script>",
    );
  // Publishing without any text in either language is refused.
  await form.locator("#pub-terms").check();
  await form.locator("#b-ar-terms").fill("");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.locator('[data-result="page_incomplete"]')).toBeVisible();
  await form
    .locator("#b-ar-terms")
    .fill(
      "البند الأول: الأسعار بالجنيه.\nسطر ثانٍ في نفس الفقرة.\n\nالبند الثاني: <b>لا</b> استرداد بعد التنفيذ. <script>alert(1)</script>",
    );
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.locator('[data-result="ok"]')).toBeVisible();

  // Arabic visitor.
  await page.goto("/ar/terms");
  await expect(page.locator("h1")).toHaveText("شروط الاستخدام");
  const paras = page.getByTestId("site-page-terms").locator("p");
  await expect(paras).toHaveCount(2);
  await expect(paras.first()).toContainText("سطر ثانٍ في نفس الفقرة");
  await expect(paras.nth(1)).toContainText("<b>لا</b>");
  await expect(paras.nth(1)).toContainText("<script>alert(1)</script>");
  await expect(page.locator("article b, article script")).toHaveCount(0);
  const footer = page.getByTestId("footer-pages");
  await expect(
    footer.getByRole("link", { name: "شروط الاستخدام" }),
  ).toHaveAttribute("href", "/ar/terms");

  // English visitor: no English text yet, so the Arabic is shown and marked.
  await page.goto("/en/terms");
  const h1 = page.locator("h1");
  await expect(h1).toHaveText("شروط الاستخدام");
  await expect(h1).toHaveAttribute("lang", "ar");
  await expect(h1).toHaveAttribute("dir", "rtl");

  // In the sitemap, with its alternates.
  const xml = await (await page.request.get("/sitemap.xml")).text();
  expect(xml).toContain("/ar/terms</loc>");
  expect(xml).toContain('hreflang="en" href="http://localhost:3000/en/terms"');

  // Unpublish: gone from the address, the footer and the sitemap.
  await s.page.reload();
  await s.page.getByTestId("page-form-terms").locator("#pub-terms").uncheck();
  await s.page
    .getByTestId("page-form-terms")
    .getByRole("button", { name: "Save" })
    .click();
  await expect(
    s.page.getByTestId("page-form-terms").locator('[data-result="ok"]'),
  ).toBeVisible();
  expect((await page.goto("/ar/terms"))!.status()).toBe(404);
  await page.goto("/ar");
  await expect(
    page
      .getByTestId("site-footer")
      .getByRole("link", { name: "شروط الاستخدام" }),
  ).toHaveCount(0);
  expect(await (await page.request.get("/sitemap.xml")).text()).not.toContain(
    "/terms<",
  );
  expect(
    sql(`select count(*) from audit_logs where entity_type = 'site_pages'
           and entity_id = 'terms' and actor_id = '${settings.id}'`),
  ).toBe("2");
  await s.ctx.close();
});

test("only settings staff open the Pages screen", async ({ browser }) => {
  const orders = await createUser({ admin: { permissions: ["orders"] } });
  const o = await staffPage(browser, orders, "/en/admin/pages");
  expect(o.status).toBe(404);
  await expect(
    o.page.locator("aside nav").getByRole("link", { name: "Pages" }),
  ).toHaveCount(0);
  await o.ctx.close();
});
