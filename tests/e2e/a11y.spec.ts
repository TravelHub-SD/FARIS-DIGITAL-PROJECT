import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { buildSite, roleContext, type Role, type Site } from "./site-pages";

// Automated accessibility scan (axe-core, WCAG 2.2 A/AA + best practices) of
// the main customer and admin pages, Arabic and English, light and dark.
// Serious and critical findings fail the test; moderate and minor ones are
// printed so they are visible, not hidden.

let site: Site;
let incompleteCookies: Awaited<ReturnType<Site["incompleteReady"]>>;
test.beforeAll(async ({ browser }) => {
  site = await buildSite();
  incompleteCookies = await site.incompleteReady(browser);
});

for (const theme of ["light", "dark"] as const) {
  test(`axe: no serious or critical issues on main pages, ar + en, ${theme}`, async ({
    browser,
  }) => {
    test.setTimeout(900_000);
    const blocking: string[] = [];
    const other = new Map<string, number>();
    let scanned = 0;
    const main = site.pages.filter((p) => p.main);
    for (const role of [...new Set(main.map((p) => p.role))] as Role[]) {
      const ctx = await roleContext(
        browser,
        site,
        role,
        theme,
        incompleteCookies,
      );
      const page = await ctx.newPage();
      for (const { path } of main.filter((p) => p.role === role)) {
        for (const locale of ["ar", "en"]) {
          await page.goto(`/${locale}${path}`, { waitUntil: "networkidle" });
          const { violations } = await new AxeBuilder({ page })
            .withTags([
              "wcag2a",
              "wcag2aa",
              "wcag21a",
              "wcag21aa",
              "wcag22aa",
              "best-practice",
            ])
            .exclude("nextjs-portal") // Next's dev-only overlay
            .analyze();
          for (const v of violations) {
            const where = v.nodes
              .slice(0, 3)
              .map((n) => n.target.join(" "))
              .join(" ; ");
            if (v.impact === "serious" || v.impact === "critical")
              blocking.push(`/${locale}${path} ${v.impact} ${v.id}: ${where}`);
            else
              other.set(
                `${v.impact} ${v.id} (/${locale}${path})`,
                v.nodes.length,
              );
          }
          scanned++;
        }
      }
      await ctx.close();
    }
    console.log(
      `[demo] axe ${theme}: ${scanned} page views, serious/critical: ${blocking.length}; other: ${
        [...other].map(([k, n]) => `${k} ×${n}`).join(", ") || "none"
      }`,
    );
    expect(blocking).toEqual([]);
  });
}
