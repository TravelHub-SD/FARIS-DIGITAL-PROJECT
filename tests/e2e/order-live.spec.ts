import { expect, type Page, test } from "@playwright/test";

import { createOrder, createUser, signInCookies, sql } from "./helpers";

// Live order status (client feedback round 1): the customer's order page and
// order list follow staff changes without a manual refresh, by polling
// /api/orders/status every 15 s while the tab is visible (OrderLive). The
// page clock is fake, so a poll is one runFor(15.5 s) away.
// Isolation: a customer's pages never react to another customer's order, the
// poll answers carry only a fingerprint, and another customer's reference is
// the same 404 as one that does not exist.

const BASE = "http://localhost:3100";

type Poll = { page: string; url: string; status: number; body: string };

function watch(page: Page, name: string, polls: Poll[], refreshes: string[]) {
  page.on("response", async (res) => {
    if (res.url().includes("/api/orders/status"))
      polls.push({
        page: name,
        url: res.url(),
        status: res.status(),
        body: await res.text().catch(() => ""),
      });
  });
  page.on("request", (req) => {
    const h = req.headers();
    if (
      h["rsc"] === "1" &&
      !h["next-router-prefetch"] &&
      !h["next-router-segment-prefetch"]
    )
      refreshes.push(name);
  });
}

const statusOf = (page: Page, reference: string) =>
  page
    .getByRole("listitem")
    .filter({ hasText: reference })
    .locator("[data-status]");

test("live order status: follows staff changes; never another customer's", async ({
  browser,
}) => {
  const alice = await createUser({ name: "Alice Live" });
  const bob = await createUser({ name: "Bob Live" });
  const aliceOrder = await createOrder(alice.id);
  const bobOrder = await createOrder(bob.id);
  const refA = sql(
    `select reference from orders where id = '${aliceOrder.id}'`,
  );
  const refB = sql(`select reference from orders where id = '${bobOrder.id}'`);

  const polls: Poll[] = [];
  const refreshes: string[] = [];
  const a = await browser.newContext({ baseURL: BASE });
  await signInCookies(a, alice.phone, alice.password);
  const b = await browser.newContext({ baseURL: BASE });
  await signInCookies(b, bob.phone, bob.password);
  const pages = {
    aliceDetail: await a.newPage(),
    aliceList: await a.newPage(),
    bobDetail: await b.newPage(),
  };
  for (const [name, page] of Object.entries(pages)) {
    watch(page, name, polls, refreshes);
    await page.clock.install();
  }
  await pages.aliceDetail.goto(`/en/account/orders/${refA}`);
  await pages.aliceList.goto("/en/account/orders");
  await pages.bobDetail.goto(`/en/account/orders/${refB}`);
  for (const page of Object.values(pages)) {
    await page.waitForLoadState("networkidle");
    await page.evaluate(
      () => ((window as unknown as { __doc: number }).__doc = 1),
    );
  }
  const pollAll = async () => {
    for (const page of Object.values(pages)) await page.clock.runFor(15_500);
  };
  await expect(pages.aliceDetail.getByTestId("order-status")).toHaveAttribute(
    "data-status",
    "new",
  );

  // 1. Bob's order changes: Alice's pages poll and stay as they are.
  sql(`update orders set status = 'cancelled' where id = '${bobOrder.id}'`);
  const before = polls.length;
  await pollAll();
  await expect
    .poll(() => polls.filter((p) => p.page.startsWith("alice")).length)
    .toBeGreaterThanOrEqual(2);
  await expect
    .poll(() => refreshes.filter((r) => r === "bobDetail").length)
    .toBe(1);
  await pages.bobDetail.waitForLoadState("networkidle");
  await expect(pages.bobDetail.getByTestId("order-status")).toHaveAttribute(
    "data-status",
    "cancelled",
  );
  expect(
    refreshes.filter((r) => r.startsWith("alice")),
    "Alice's pages did not refresh",
  ).toEqual([]);
  await expect(pages.aliceDetail.getByTestId("order-status")).toHaveAttribute(
    "data-status",
    "new",
  );
  await expect(statusOf(pages.aliceList, refA)).toHaveAttribute(
    "data-status",
    "new",
  );
  await expect(pages.aliceList.getByText(refB)).toHaveCount(0);

  // Every answer Alice got: 200 with a fingerprint only (nothing of Bob's).
  const alicePolls = polls
    .slice(before)
    .filter((p) => p.page.startsWith("alice"));
  for (const p of alicePolls) {
    expect(p.status).toBe(200);
    expect(Object.keys(JSON.parse(p.body))).toEqual(["sig"]);
    expect(p.body).not.toContain(refB);
  }

  // 2. Asking for Bob's order directly: the same 404 as one that does not exist.
  for (const ref of [refB, "FD-0000000"]) {
    const res = await a.request.get(`/api/orders/status?ref=${ref}`);
    expect(res.status(), ref).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  }
  const guest = await browser.newContext({ baseURL: BASE });
  expect(
    (await guest.request.get(`/api/orders/status?ref=${refA}`)).status(),
  ).toBe(401);
  await guest.close();

  // 3. Alice's own order changes: both her pages update, no reload; Bob's does not refresh.
  const bobRefreshes = refreshes.filter((r) => r === "bobDetail").length;
  sql(`update orders set status = 'cancelled' where id = '${aliceOrder.id}'`);
  await pollAll();
  await expect(pages.aliceDetail.getByTestId("order-status")).toHaveAttribute(
    "data-status",
    "cancelled",
  );
  await expect(statusOf(pages.aliceList, refA)).toHaveAttribute(
    "data-status",
    "cancelled",
  );
  expect(
    refreshes.filter((r) => r === "bobDetail").length,
    "Bob's page did not refresh",
  ).toBe(bobRefreshes);
  for (const page of Object.values(pages))
    expect(
      await page.evaluate(
        () => (window as unknown as { __doc?: number }).__doc,
      ),
      "no reload",
    ).toBe(1);

  await a.close();
  await b.close();
  console.log(
    `[demo] live status: Bob's change → Bob's page refreshed, Alice's ${alicePolls.length} polls unchanged and no refresh; Bob's reference → 404 for Alice; Alice's change → her order page and list updated without reload`,
  );
});

test("live order status: polls only while the tab is visible", async ({
  browser,
}) => {
  const customer = await createUser();
  const order = await createOrder(customer.id);
  const ref = sql(`select reference from orders where id = '${order.id}'`);
  const ctx = await browser.newContext({ baseURL: BASE });
  await signInCookies(ctx, customer.phone, customer.password);
  const page = await ctx.newPage();
  const polls: Poll[] = [];
  watch(page, "page", polls, []);
  await page.clock.install();
  await page.goto(`/en/account/orders/${ref}`);
  await page.waitForLoadState("networkidle");
  await page.clock.runFor(15_500);
  await expect.poll(() => polls.length).toBe(1);

  const setVisibility = (state: "hidden" | "visible") =>
    page.evaluate((s) => {
      Object.defineProperty(document, "visibilityState", {
        value: s,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    }, state);
  await setVisibility("hidden");
  await page.clock.runFor(120_000);
  await page.waitForTimeout(500);
  expect(polls.length, "no polls while hidden").toBe(1);
  await setVisibility("visible");
  await expect.poll(() => polls.length, "checks at once when shown").toBe(2);
  await ctx.close();
});
