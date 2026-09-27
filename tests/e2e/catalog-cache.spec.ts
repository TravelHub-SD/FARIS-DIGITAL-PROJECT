import { randomBytes } from "node:crypto";

import { expect, test } from "@playwright/test";

import { ownerUser, signInCookies, sql } from "./helpers";

// The shared catalog cache (catalogCache in src/server/catalog/queries.ts)
// on the production build: pages render per request for the CSP nonce, but
// their catalog data is shared between visitors. A change made behind the
// app's back (SQL) is not seen while the entry is fresh; a dashboard save
// expires it at once (updateTag), for everyone.
// Only `next start` has this cache; E2E_SERVER=prod starts a second server
// on :3101 with it on (the main one runs with CATALOG_CACHE=off).

const BASE = "http://localhost:3101";
const PRODUCT = "00000000-0000-4000-b000-000000000001"; // seed: pubg-uc
const VARIANT = "00000000-0000-4000-c000-000000000001";

test.skip(
  process.env.E2E_SERVER !== "prod",
  "the catalog cache only exists on `next start` (E2E_SERVER=prod)",
);

test("catalog cache: shared by visitors, blind to direct DB writes, expired by a dashboard save", async ({
  browser,
}) => {
  const original = sql(`select name_en from products where id = '${PRODUCT}'`);
  const probe = `Cache probe ${randomBytes(3).toString("hex")}`;
  const owner = await ownerUser();
  const title = async (fresh = false) => {
    const ctx = await browser.newContext({ baseURL: BASE });
    const page = await ctx.newPage();
    await page.goto(`/en/p/pubg-uc${fresh ? `?v=${Date.now()}` : ""}`);
    const text = await page.locator("h1").innerText();
    await ctx.close();
    return text;
  };
  // Saving an option unchanged: the dashboard expires the catalog cache.
  const dashboardSave = async () => {
    const admin = await browser.newContext({ baseURL: BASE });
    await signInCookies(admin, owner.phone, owner.password);
    const page = await admin.newPage();
    await page.goto(`/en/admin/catalog/variants/${VARIANT}`);
    await page
      .getByTestId("variant-form")
      .getByRole("button", { name: "Save" })
      .click();
    await expect(
      page.getByTestId("variant-form").locator('[data-result="ok"]'),
    ).toBeVisible();
    await admin.close();
  };
  try {
    // The cache lives on disk across runs: start from a known state, so no
    // stale entry is being refreshed in the background during the test.
    await dashboardSave();
    const before = await title(); // fills the entry from the database
    expect(before).toContain(original);

    sql(`update products set name_en = '${probe}' where id = '${PRODUCT}'`);
    // Other visitors, even on a new URL: the cached data is served.
    expect(await title()).toBe(before);
    expect(await title(true)).toBe(before);

    // Any dashboard save of the catalog expires it for everyone.
    await dashboardSave();
    expect(await title()).toContain(probe);
    console.log(
      `[demo] catalog cache: after a direct SQL write new visitors still get "${before}"; after a dashboard save "${probe}"`,
    );
  } finally {
    sql(`update products set name_en = '${original}' where id = '${PRODUCT}'`);
    await dashboardSave();
  }
});
