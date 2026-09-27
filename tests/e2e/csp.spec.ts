import { randomUUID } from "node:crypto";

import { expect, type Page, test } from "@playwright/test";

import { createFixtures } from "../integration/catalog-fixtures";
import { sql } from "./helpers";
import { buildSite, roleContext, type Role, type Site } from "./site-pages";

// Content-Security-Policy (src/lib/csp.ts, set per request by src/proxy.ts).
// 1. Every page of the site, as its real role: the header is there with a
//    fresh nonce, React hydrates, and the browser reports zero violations.
// 2. An XSS that got past escaping (a <script> and an onerror handler spliced
//    into the served HTML) does not run on public, customer or admin pages.
//    Control: the very same HTML without the header runs it, so the test
//    proves the header is what blocks it.

let site: Site;
let incompleteCookies: Awaited<ReturnType<Site["incompleteReady"]>>;
test.beforeAll(async ({ browser }) => {
  site = await buildSite();
  incompleteCookies = await site.incompleteReady(browser);
});

/** Collect CSP violations reported by the page (set before any script runs). */
async function watchViolations(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      w.__csp.push(`${e.effectiveDirective} ${e.blockedURI || "inline"}`),
    );
  });
}
const violations = (page: Page) =>
  page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
const hydrated = (page: Page) =>
  page.evaluate(() =>
    Object.keys(document.body).some((k) => k.startsWith("__reactFiber")),
  );

test("every page: CSP header with a fresh nonce, hydrates, zero violations", async ({
  browser,
}) => {
  test.setTimeout(600_000);
  const problems: string[] = [];
  const nonces = new Set<string>();
  let checked = 0;
  for (const role of [...new Set(site.pages.map((p) => p.role))] as Role[]) {
    const ctx = await roleContext(
      browser,
      site,
      role,
      "light",
      incompleteCookies,
    );
    const page = await ctx.newPage();
    await watchViolations(page);
    for (const { path } of site.pages.filter((p) => p.role === role)) {
      for (const locale of ["ar", "en"]) {
        const url = `/${locale}${path}`;
        const res = await page.goto(url, { waitUntil: "networkidle" });
        const csp = res!.headers()["content-security-policy"] ?? "";
        const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
        if (!nonce) problems.push(`${url}: no nonce in CSP header`);
        else nonces.add(nonce);
        if (/script-src[^;]*'unsafe-inline'/.test(csp))
          problems.push(`${url}: script-src allows unsafe-inline`);
        if (!(await hydrated(page))) problems.push(`${url}: not hydrated`);
        const v = await violations(page);
        if (v.length) problems.push(`${url} [${role}]: ${v.join(", ")}`);
        checked++;
      }
    }
    await ctx.close();
  }
  console.log(
    `[demo] CSP: ${checked} page views, ${nonces.size} distinct nonces, problems: ${problems.length}`,
  );
  expect(problems).toEqual([]);
  expect(nonces.size, "a new nonce on every response").toBe(checked);
});

const PAYLOAD =
  `<script>window.__xss = "script ran"</script>` +
  `<img src="/x.png" alt="" onerror="window.__xssAttr = 'handler ran'">`;

for (const [role, path] of [
  ["guest", "/ar"],
  ["guest", "/ar/p/pubg-uc"],
  ["guest", "/en/login"],
  ["customer", "/ar/account/orders"],
  ["owner", "/en/admin/orders"],
] as const) {
  test(`injected inline script is blocked: ${path} (${role})`, async ({
    browser,
  }) => {
    for (const stripHeader of [false, true]) {
      const ctx = await roleContext(
        browser,
        site,
        role,
        "light",
        incompleteCookies,
      );
      const page = await ctx.newPage();
      await watchViolations(page);
      await page.route(`**${path}`, async (route) => {
        const res = await route.fetch();
        const headers = { ...res.headers() };
        if (stripHeader) delete headers["content-security-policy"];
        const html = (await res.text()).replace(
          /<body([^>]*)>/,
          `<body$1>${PAYLOAD}`,
        );
        await route.fulfill({ response: res, headers, body: html });
      });
      await page.goto(path, { waitUntil: "networkidle" });
      const ran = await page.evaluate(() => {
        const w = window as unknown as Record<string, string | undefined>;
        return [w.__xss ?? null, w.__xssAttr ?? null];
      });
      const v = await violations(page);
      if (stripHeader) {
        // Control: without the header the same injection executes.
        expect(ran).toEqual(["script ran", "handler ran"]);
      } else {
        expect(ran, "injected code must not run").toEqual([null, null]);
        expect(v).toContain("script-src-elem inline");
        expect(v).toContain("script-src-attr inline");
        // Only the injected code was refused; the app itself still works.
        expect(v).toHaveLength(2);
        expect(await hydrated(page)).toBe(true);
      }
      console.log(
        `[demo] ${path} ${stripHeader ? "WITHOUT header (control)" : "with CSP"}: ran=${JSON.stringify(ran)} violations=${JSON.stringify(v)}`,
      );
      await ctx.close();
    }
  });
}

test("stored input with markup is shown as text, never executed", async ({
  browser,
}) => {
  // A product nobody has viewed yet, so no cached page data hides the comment.
  const fx = await createFixtures(`csp${randomUUID().slice(0, 6)}`);
  const body = `<img src=x onerror="window.__stored=1"><script>window.__stored=2</script>`;
  sql(`insert into comments (product_id, user_id, body)
         select id, '${site.users.customer.id}', $$${body}$$
         from products where slug = '${fx.slugs.ok}'`);
  const ctx = await roleContext(browser, site, "guest", "light", []);
  const page = await ctx.newPage();
  await watchViolations(page);
  await page.goto(`/ar/p/${fx.slugs.ok}`, { waitUntil: "networkidle" });
  await expect(page.getByText(body)).toBeVisible();
  expect(await page.evaluate(() => "__stored" in window)).toBe(false);
  // Escaped by React: not even an attempt the CSP had to block.
  expect(await violations(page)).toEqual([]);
  await ctx.close();
});
