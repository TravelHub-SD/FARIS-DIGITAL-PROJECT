import { expect, test } from "@playwright/test";

import { buildSite, roleContext, type Role, type Site } from "./site-pages";

// Every page at 360 px (the narrowest common Android width), in Arabic and
// English, light and dark: the document must never scroll sideways. Wide
// content (tables) may scroll inside its own container, never the page.
// Screenshots go to .e2e/responsive/ for manual RTL/dark review (not the repo).

let site: Site;
let incompleteCookies: Awaited<ReturnType<Site["incompleteReady"]>>;
test.beforeAll(async ({ browser }) => {
  site = await buildSite();
  incompleteCookies = await site.incompleteReady(browser);
});

for (const theme of ["light", "dark"] as const) {
  test(`no horizontal overflow at 360 px on every page, ar + en, ${theme}`, async ({
    browser,
  }) => {
    test.setTimeout(900_000);
    const failures: string[] = [];
    let checked = 0;
    const roles = [...new Set(site.pages.map((p) => p.role))] as Role[];
    for (const role of roles) {
      const ctx = await roleContext(
        browser,
        site,
        role,
        theme,
        incompleteCookies,
      );
      const page = await ctx.newPage();
      for (const { path } of site.pages.filter((p) => p.role === role)) {
        for (const locale of ["ar", "en"]) {
          const url = `/${locale}${path}`;
          await page.goto(url, { waitUntil: "networkidle" });
          const r = await page.evaluate(() => {
            const vw = document.documentElement.clientWidth;
            const sw = document.documentElement.scrollWidth;
            const offenders: string[] = [];
            if (sw > vw) {
              for (const el of document.querySelectorAll("body *")) {
                const b = el.getBoundingClientRect();
                if (b.width > 0 && (b.right > vw + 1 || b.left < -1)) {
                  offenders.push(
                    `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} [${Math.round(b.left)}..${Math.round(b.right)}]`,
                  );
                }
                if (offenders.length >= 4) break;
              }
            }
            return {
              vw,
              sw,
              offenders,
              dark: document.documentElement.classList.contains("dark"),
              dir: document.documentElement.dir,
              path: location.pathname,
            };
          });
          expect(r.dark, `${url} theme`).toBe(theme === "dark");
          expect(r.dir, `${url} dir`).toBe(locale === "ar" ? "rtl" : "ltr");
          expect(r.path, `${url} was redirected`).toBe(url.split("?")[0]);
          if (r.sw > r.vw)
            failures.push(
              `${url} [${role}] scrollWidth ${r.sw} > ${r.vw}: ${r.offenders.join(" | ")}`,
            );
          await page.screenshot({
            path: `.e2e/responsive/${theme}/${role}-${locale}${path.replace(/[/?=&]/g, "_") || "_home"}.png`,
            fullPage: true,
          });
          checked++;
        }
      }
      await ctx.close();
    }
    console.log(
      `[demo] 360px ${theme}: ${checked} page views (${site.pages.length} pages × ar/en), overflow: ${failures.length}`,
    );
    expect(failures).toEqual([]);
  });
}

test("admin section bar on a phone: the current section is fully visible, ar + en", async ({
  browser,
}) => {
  const ctx = await roleContext(
    browser,
    site,
    "owner",
    "light",
    incompleteCookies,
  );
  const page = await ctx.newPage();
  for (const locale of ["ar", "en"]) {
    for (const section of ["", "/kyc", "/invoices", "/settings", "/audit"]) {
      await page.goto(`/${locale}/admin${section}`, {
        waitUntil: "networkidle",
      });
      const nav = page.locator("aside nav");
      const current = nav.locator('[aria-current="page"]');
      await expect(current).toHaveCount(1);
      await expect
        .poll(
          async () => {
            const n = (await nav.boundingBox())!;
            const c = (await current.boundingBox())!;
            return c.x >= n.x - 1 && c.x + c.width <= n.x + n.width + 1;
          },
          { message: `${locale}${section}` },
        )
        .toBe(true);
    }
  }
  await ctx.close();
});

test("slow connection: the tapped admin section shows it is loading; guarded pages still answer 404", async ({
  browser,
}) => {
  const ctx = await roleContext(
    browser,
    site,
    "owner",
    "light",
    incompleteCookies,
  );
  const page = await ctx.newPage();
  await page.goto("/en/admin", { waitUntil: "networkidle" });
  // Hold back the server's answer for the orders page by 3 s.
  await page.route("**/en/admin/orders**", async (route) => {
    if (route.request().headers()["rsc"])
      await new Promise((r) => setTimeout(r, 3000));
    await route.continue();
  });
  const link = page.locator("aside nav").getByRole("link", { name: "Orders" });
  await link.click();
  await expect(link.locator("[data-pending]")).toHaveCount(1, {
    timeout: 1500,
  });
  await expect(
    page.getByRole("heading", { level: 1, name: "Orders" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("aside nav [data-pending]")).toHaveCount(0);
  await ctx.close();

  // No loading boundary above guarded pages: a missing permission is a real 404.
  const staff = await roleContext(
    browser,
    site,
    "fresh",
    "light",
    incompleteCookies,
  );
  const res = await (await staff.newPage()).goto("/en/admin/orders");
  expect(res!.status()).toBe(404);
  await staff.close();
});
