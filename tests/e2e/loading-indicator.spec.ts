import { readdirSync } from "node:fs";
import { join } from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { localNumber } from "./helpers";

// A thin bar under the top edge while a client navigation or a Server Action
// is pending (src/instrumentation-client.ts). The server is held for 1.5 s on
// page and action requests so "pending" is visible; prefetches go through.
// No loading boundary was added above guarded pages (they must keep 404).

async function holdServer(page: Page) {
  await page.route("**/*", async (route) => {
    const h = route.request().headers();
    const pageRequest =
      h["rsc"] === "1" &&
      !h["next-router-prefetch"] &&
      !h["next-router-segment-prefetch"];
    if (pageRequest || h["next-action"])
      await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
}

const busy = (page: Page) => page.locator("html[data-busy]");
const barOpacity = (page: Page) =>
  page
    .getByTestId("nav-progress")
    .evaluate((el) => getComputedStyle(el).opacity);

test("busy bar: during a client navigation and a Server Action, gone afterwards", async ({
  page,
}) => {
  await page.goto("/ar");
  await page.waitForLoadState("networkidle");
  await expect(busy(page)).toHaveCount(0);
  expect(await barOpacity(page)).toBe("0");
  await holdServer(page);

  // Client navigation (a bottom-bar tab).
  await page.getByTestId("bottom-nav").locator("[data-tab=categories]").click();
  await expect(busy(page)).toHaveCount(1);
  await expect.poll(() => barOpacity(page)).toBe("1");
  await expect(page).toHaveURL(/\/ar\/categories$/);
  await expect(busy(page)).toHaveCount(0);
  await expect.poll(() => barOpacity(page)).toBe("0");

  // Server Action (sign in with a wrong password).
  await page.goto("/en/login");
  await page.waitForLoadState("networkidle");
  await expect(busy(page)).toHaveCount(0);
  await page.fill("#phone", localNumber());
  await page.fill("#password", "not-the-password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(busy(page)).toHaveCount(1);
  await expect.poll(() => barOpacity(page)).toBe("1");
  await expect(page.locator("[data-tone=error]")).toBeVisible();
  await expect(busy(page)).toHaveCount(0);
  console.log(
    "[demo] busy bar: shown while the held navigation and the held Server Action were pending, removed after",
  );
});

test("busy bar: no loading boundary above guarded pages; they still answer 404", async ({
  request,
}) => {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/^loading\.(tsx?|jsx?)$/.test(entry.name)) found.push(path);
    }
  };
  walk("src/app");
  expect(found).toEqual([join("src/app/[locale]/search/loading.tsx")]);
  for (const path of ["/en/admin/orders", "/ar/account/orders/FD-0000000"])
    expect(
      (await request.get(path, { maxRedirects: 0 })).status(),
      path,
    ).not.toBe(200);
});
