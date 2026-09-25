import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  type Browser,
  type BrowserContext,
  expect,
  test,
} from "@playwright/test";

import { E2E_WHATSAPP } from "../../playwright.config";
import {
  createKycSubmission,
  createOrder,
  createUser,
  FAKE_META,
  fakeControl,
  fakeInbox,
  localNumber,
  ownerUser,
  signInCookies,
  sql,
  toE164,
  type TestUser,
} from "./helpers";

// Phase 7: the app's REAL Meta driver and webhook against the fake Graph API
// (tests/fakes/meta-graph.mjs). Retries are driven through the real dispatch
// endpoint (what pg_cron calls every minute), with the clock moved forward in
// the database instead of waiting 36 minutes.

const BASE = "http://localhost:3100";
const WEBHOOK = `${BASE}/api/whatsapp/webhook`;
const DISPATCH = `${BASE}/api/whatsapp/dispatch`;
const SECRETS = {
  token: E2E_WHATSAPP.WHATSAPP_ACCESS_TOKEN,
  appSecret: E2E_WHATSAPP.WHATSAPP_APP_SECRET,
  verify: E2E_WHATSAPP.WHATSAPP_VERIFY_TOKEN,
  dispatch: E2E_WHATSAPP.WHATSAPP_DISPATCH_SECRET,
};

type Row = {
  id: string;
  status: string;
  attempts: number;
  max_attempts: number;
  error_code: string | null;
  needs_attention: boolean;
  provider_message_id: string | null;
  cost_usd: number | null;
  cost_source: string | null;
  billable: boolean | null;
  pricing_category: string | null;
  handled_by: string | null;
  backoff_s: number | null;
  [k: string]: unknown;
};

const digits = (e164: string) => e164.replace(/^\+/, "");

function row(where: string): Row | null {
  const out = sql(
    `select row_to_json(x) from (select m.*, extract(epoch from m.next_retry_at - m.updated_at)::int as backoff_s
       from message_logs m where ${where} order by m.created_at desc limit 1) x`,
  );
  return out ? (JSON.parse(out) as Row) : null;
}
const notification = (orderId: string) =>
  row(`m.order_id = '${orderId}' and m.message_type = 'order_status'`);

async function waitFor<T>(
  fn: () => T | null | undefined | false,
  what: string,
): Promise<T> {
  for (let i = 0; i < 80; i++) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function dispatch() {
  const r = await fetch(DISPATCH, {
    method: "POST",
    headers: { Authorization: `Bearer ${SECRETS.dispatch}` },
  });
  expect(r.status).toBe(200);
  return (await r.json()) as {
    claimed: number;
    sent: number;
    retrying: number;
    failed: number;
  };
}

/** Move a queued retry's due time to now (instead of waiting 1/5/30 min). */
const timeTravel = (id: string) =>
  sql(
    `update message_logs set next_retry_at = now() where id = '${id}' and status = 'queued'`,
  );

const sign = (raw: string, secret = SECRETS.appSecret) =>
  "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");

async function postWebhook(raw: string, signature?: string | null) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (signature) headers["X-Hub-Signature-256"] = signature;
  const r = await fetch(WEBHOOK, { method: "POST", headers, body: raw });
  return { status: r.status, body: await r.text() };
}

type FakeWebhook = {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  to: string;
  category?: string;
  billable?: boolean;
  errorCode?: number;
  extra?: Record<string, string>;
  url?: string;
};
/** Meta-shaped, correctly signed status webhook built by the fake. */
async function fakeWebhook(body: FakeWebhook) {
  const r = await fetch(`${FAKE_META}/__webhook`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return (await r.json()) as {
    appStatus: number;
    appBody: string;
    raw: string;
    signature: string;
  };
}

async function fakeRequests(to: string, since: number) {
  const r = await fetch(`${FAKE_META}/__requests?to=${to}&since=${since}`);
  return (await r.json()) as { result: string; template?: string }[];
}

async function staffContext(browser: Browser, user: TestUser) {
  const ctx = await browser.newContext({ baseURL: BASE });
  await signInCookies(ctx, user.phone, user.password);
  return ctx;
}

const eventsFor = (wamid: string) =>
  Number(
    sql(
      `select count(*) from private.message_events where provider_message_id = '${wamid}'`,
    ),
  );

let staff: TestUser;
let owner: TestUser;
const canaries: string[] = [];

test.beforeAll(async () => {
  staff = await createUser({
    admin: { permissions: ["orders", "kyc"] },
    name: "Staff WhatsApp",
  });
  owner = await ownerUser();
});
test.afterEach(async () => {
  await fakeControl({ reset: true });
});

test("webhook: handshake, forged or unsigned payloads refused, a replay changes nothing", async () => {
  // Subscription handshake (Meta's GET with the verify token).
  const hs = await fetch(
    `${WEBHOOK}?hub.mode=subscribe&hub.verify_token=${SECRETS.verify}&hub.challenge=1158201444`,
  );
  expect(hs.status).toBe(200);
  expect(await hs.text()).toBe("1158201444");
  for (const q of [
    "hub.mode=subscribe&hub.verify_token=not-the-verify-token-000&hub.challenge=1",
    "hub.mode=subscribe&hub.challenge=1",
    `hub.mode=unsubscribe&hub.verify_token=${SECRETS.verify}&hub.challenge=1`,
  ]) {
    expect((await fetch(`${WEBHOOK}?${q}`)).status).toBe(403);
  }

  const customer = await createUser();
  const order = await createOrder(customer.id);
  await dispatch();
  const sent = await waitFor(() => {
    const r = notification(order.id);
    return r?.status === "sent" ? r : null;
  }, "notification sent");
  const wamid = sent.provider_message_id!;
  const to = digits(customer.phone);

  // A genuine, Meta-shaped and correctly signed "delivered" payload, captured
  // without delivering it (sent to the fake's own health endpoint).
  const captured = await fakeWebhook({
    id: wamid,
    status: "delivered",
    to,
    category: "utility",
    billable: true,
    url: `${FAKE_META}/__health`,
  });
  const { raw, signature } = captured;

  // Forged / unsigned / tampered: refused before anything is parsed.
  const tampered = raw.replace('"status":"delivered"', '"status":"read"');
  expect(tampered).not.toBe(raw);
  const forged: [string, string, string | null][] = [
    ["no signature header", raw, null],
    [
      "signed with another secret",
      raw,
      sign(raw, "attacker-guess-0123456789abcdef"),
    ],
    ["body changed after signing", tampered, signature],
    [
      "sha1 header instead of sha256",
      raw,
      signature.replace("sha256=", "sha1="),
    ],
    ["truncated signature", raw, signature.slice(0, 40)],
    ["empty signature", raw, "sha256="],
  ];
  for (const [label, body, sig] of forged) {
    const res = await postWebhook(body, sig);
    expect(res.status, label).toBe(401);
  }
  // Valid signature over invalid JSON: 400, still nothing applied.
  expect((await postWebhook("{not json", sign("{not json"))).status).toBe(400);
  // Oversized payload (> 1 MB): refused.
  const huge = JSON.stringify({ pad: "x".repeat(1_100_000) });
  expect((await postWebhook(huge, sign(huge))).status).toBe(413);

  const untouched = notification(order.id)!;
  expect(untouched.status).toBe("sent");
  expect(untouched.updated_at).toBe(sent.updated_at);
  expect(eventsFor(wamid)).toBe(0);

  // The genuine payload is applied once...
  const first = await postWebhook(raw, signature);
  expect(first.status).toBe(200);
  expect(JSON.parse(first.body)).toEqual({
    applied: 1,
    duplicate: 0,
    unknown_message: 0,
  });
  const delivered = notification(order.id)!;
  expect(delivered.status).toBe("delivered");
  expect(delivered.billable).toBe(true);
  expect(delivered.cost_source).toBe("webhook");

  // ...and replaying the captured request changes nothing, however often.
  for (let i = 0; i < 3; i++) {
    const replay = await postWebhook(raw, signature);
    expect(replay.status).toBe(200);
    expect(JSON.parse(replay.body)).toEqual({
      applied: 0,
      duplicate: 1,
      unknown_message: 0,
    });
  }
  const afterReplay = notification(order.id)!;
  expect(afterReplay).toEqual(delivered);
  expect(eventsFor(wamid)).toBe(1);

  // Out of order: "read" arrives, then the old "delivered" is replayed.
  const read = await fakeWebhook({ id: wamid, status: "read", to });
  expect(read.appStatus).toBe(200);
  expect(JSON.parse(read.appBody).applied).toBe(1);
  expect(JSON.parse((await postWebhook(raw, signature)).body).duplicate).toBe(
    1,
  );
  expect(notification(order.id)!.status).toBe("read");

  // Another business's phone number id, or a message we never sent: ignored.
  const other = await fakeWebhook({
    id: wamid,
    status: "failed",
    to,
    errorCode: 131026,
    extra: { phoneNumberId: "999999999999999" },
  });
  expect(JSON.parse(other.appBody)).toEqual({
    applied: 0,
    duplicate: 0,
    unknown_message: 0,
  });
  const unknown = await fakeWebhook({
    id: "wamid.NOT-OURS-123",
    status: "delivered",
    to,
  });
  expect(JSON.parse(unknown.appBody)).toEqual({
    applied: 0,
    duplicate: 0,
    unknown_message: 1,
  });
  expect(notification(order.id)!.status).toBe("read");
  expect(eventsFor(wamid)).toBe(2);
  console.log(
    `[demo] webhook: ${forged.length} forged variants → 401; genuine → applied; 3 replays → duplicate; events for ${wamid.slice(0, 14)}…: ${eventsFor(wamid)}`,
  );
});

test("dispatch endpoint needs the bearer secret; parallel dispatches never double-send", async () => {
  expect((await fetch(DISPATCH, { method: "POST" })).status).toBe(401);
  expect(
    (
      await fetch(DISPATCH, {
        method: "POST",
        headers: { Authorization: "Bearer wrong" },
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await fetch(DISPATCH, {
        method: "POST",
        headers: { Authorization: `Bearer ${SECRETS.dispatch}x` },
      })
    ).status,
  ).toBe(401);

  const customers = await Promise.all([1, 2, 3, 4, 5].map(() => createUser()));
  const since = Date.now();
  // Slow Meta (600 ms per message) widens the window for a double send.
  await fakeControl({
    script: customers.map((c) => ({
      kind: "delay",
      ms: 600,
      to: digits(c.phone),
    })),
  });
  const orders = [];
  for (const c of customers) orders.push(await createOrder(c.id));
  const results = await Promise.all([
    dispatch(),
    dispatch(),
    dispatch(),
    dispatch(),
  ]);
  console.log(`[demo] 4 parallel dispatches: ${JSON.stringify(results)}`);
  for (const [i, c] of customers.entries()) {
    const reqs = await fakeRequests(digits(c.phone), since);
    expect(reqs.filter((r) => r.result === "accepted")).toHaveLength(1);
    expect(notification(orders[i].id)!.status).toBe("sent");
  }
});

test("a failing send is retried 1 / 5 / 30 min, then recorded and surfaced to staff, never dropped", async ({
  browser,
}) => {
  const customer = await createUser();
  const to = digits(customer.phone);
  const since = Date.now();
  await fakeControl({
    script: [
      { kind: "error", code: 131000, http: 500, to },
      { kind: "timeout", ms: 4000, to },
      { kind: "html", http: 502, to },
      { kind: "error", code: 131000, http: 500, to },
    ],
  });
  const order = await createOrder(customer.id);
  const id = notification(order.id)!.id;

  const expected: [string, number][] = [
    ["meta:131000", 60],
    ["network:timeout", 300],
    ["http:502", 1800],
  ];
  for (const [i, [code, backoff]] of expected.entries()) {
    await dispatch();
    const r = notification(order.id)!;
    expect(r).toMatchObject({
      status: "queued",
      attempts: i + 1,
      error_code: code,
      backoff_s: backoff,
    });
    // Not due before the backoff: another dispatch leaves it alone.
    await dispatch();
    expect(notification(order.id)!.attempts).toBe(i + 1);
    console.log(
      `[demo] attempt ${i + 1}: ${code} → retry in ${backoff / 60} min`,
    );
    timeTravel(id);
  }
  await dispatch();
  const failed = notification(order.id)!;
  expect(failed).toMatchObject({
    status: "failed",
    attempts: 4,
    error_code: "meta:131000",
    needs_attention: true,
  });
  console.log(
    `[demo] attempt 4: meta:131000 → failed, needs_attention=${failed.needs_attention}`,
  );
  timeTravel(id);
  await dispatch();
  expect(notification(order.id)!.attempts).toBe(4);
  const reqs = await fakeRequests(to, since);
  expect(reqs.map((r) => r.result)).toEqual([
    "meta:131000",
    "timeout",
    "html",
    "meta:131000",
  ]);

  // Staff see it: dashboard card, messages page, the order page.
  const ctx = await staffContext(browser, staff);
  const page = await ctx.newPage();
  await page.goto("/en/admin");
  const card = page.locator(
    'a[data-testid="dashboard-card"][href="/en/admin/messages"]',
  );
  await expect(card).toBeVisible();
  expect(
    Number(await card.locator("span").first().textContent()),
  ).toBeGreaterThanOrEqual(1);
  await expect(
    page.getByRole("navigation").getByRole("link", { name: /WhatsApp/ }),
  ).toBeVisible();

  await page.goto("/en/admin/messages");
  const item = page.locator(`li[data-message-id="${id}"]`);
  await expect(item).toHaveAttribute("data-attention", "true");
  await expect(item).toContainText("Attempt 4 of 4");
  await expect(item.locator("[data-error-code]")).toHaveText(
    "Meta internal error (meta:131000)",
  );

  const reference = sql(
    `select reference from orders where id = '${order.id}'`,
  );
  await page.goto(`/en/admin/orders/${reference}`);
  await expect(
    page.getByTestId("order-messages").locator(`li[data-message-id="${id}"]`),
  ).toHaveAttribute("data-message-status", "failed");

  // Arabic side shows the same, translated.
  await page.goto("/ar/admin/messages");
  await expect(
    page.locator(`li[data-message-id="${id}"] [data-error-code]`),
  ).toHaveText("خطأ داخلي لدى Meta (meta:131000)");

  // Meta is fine again: "Try again" from the dashboard delivers it.
  await page.goto("/en/admin/messages");
  await page
    .locator(`li[data-message-id="${id}"]`)
    .getByRole("button", { name: "Try again" })
    .click();
  await expect(page.getByText("Queued again.")).toBeVisible();
  const resent = await waitFor(() => {
    const r = notification(order.id);
    return r?.status === "sent" ? r : null;
  }, "retried notification sent");
  expect(resent.attempts).toBe(5);
  expect((await fakeInbox(to, since)).map((m) => m.template)).toEqual([
    "order_status_update",
  ]);
  expect(
    sql(
      `select actor_id from audit_logs where action = 'message_logs.retry' and entity_id = '${id}'`,
    ),
  ).toBe(staff.id);

  // A permanent error (number not on WhatsApp) is not retried at all.
  const other = await createUser();
  const otherTo = digits(other.phone);
  await fakeControl({ undeliverable: [otherTo] });
  const order2 = await createOrder(other.id);
  await dispatch();
  const permanent = notification(order2.id)!;
  expect(permanent).toMatchObject({
    status: "failed",
    attempts: 1,
    error_code: "meta:131026",
    needs_attention: true,
  });
  expect(await fakeRequests(otherTo, since)).toHaveLength(1);

  await page.reload();
  const item2 = page.locator(`li[data-message-id="${permanent.id}"]`);
  await expect(
    item2.getByRole("link", { name: "Contact on WhatsApp" }),
  ).toHaveAttribute("href", `https://wa.me/${otherTo}`);
  await item2.getByRole("button", { name: "Mark as handled" }).click();
  await expect(page.getByText("Marked as handled.")).toBeVisible();
  const handled = notification(order2.id)!;
  expect(handled).toMatchObject({
    needs_attention: false,
    handled_by: staff.id,
    status: "failed",
  });
  expect(
    sql(
      `select count(*) from audit_logs where action = 'message_logs.handled' and entity_id = '${permanent.id}'`,
    ),
  ).toBe("1");
  await page.reload();
  await expect(
    page.locator(`li[data-message-id="${permanent.id}"]`),
  ).toHaveCount(0);
  await ctx.close();
});

test("Meta unreachable: the order is still created, and the failure shows in the dashboard", async ({
  browser,
}) => {
  const customer = await createUser();
  const to = digits(customer.phone);
  await fakeControl({ offline: true });

  const ctx: BrowserContext = await browser.newContext({ baseURL: BASE });
  await signInCookies(ctx, customer.phone, customer.password);
  const page = await ctx.newPage();
  await page.goto("/en/p/pubg-uc");
  await page.selectOption("#quantity", "1");
  await page.fill("#f-player_id", "5123456789");
  const started = Date.now();
  await page.getByRole("button", { name: "Place order" }).click();
  await page.waitForURL(/\/en\/account\/orders\/FD-\d{7}$/);
  const tookMs = Date.now() - started;
  const reference = page.url().split("/").pop()!;
  await expect(page.getByText(reference).first()).toBeVisible();
  const orderId = sql(`select id from orders where reference = '${reference}'`);
  expect(sql(`select status from orders where id = '${orderId}'`)).toBe("new");

  // The after-response dispatch tried Meta and failed; the row waits for a retry.
  const failing = await waitFor(() => {
    const r = notification(orderId);
    return r && r.attempts >= 1 && r.status === "queued" ? r : null;
  }, "first failed attempt");
  expect(failing.error_code).toMatch(/^network:/);
  console.log(
    `[demo] Meta offline: order ${reference} created, page shown after ${tookMs} ms; notification ${failing.status}, attempt ${failing.attempts}, ${failing.error_code}`,
  );

  // OTP while Meta is down: a clear error for the user, no crash, logged without a code.
  const otpPhones = [localNumber(), localNumber()];
  const visitor = await browser.newContext({ baseURL: BASE });
  for (const local of otpPhones) {
    const p = await visitor.newPage();
    await p.goto("/en/register");
    await p.fill("#phone", local);
    await p.getByRole("button", { name: "Send code" }).click();
    await expect(
      p.getByText("We could not send the WhatsApp message. Try again shortly."),
    ).toBeVisible();
    await p.close();
    const otp = row(
      `m.phone_e164 = '${toE164(local)}' and m.message_type = 'otp'`,
    )!;
    expect(otp).toMatchObject({ status: "failed", needs_attention: false });
    expect(otp.error_code).toMatch(/^network:/);
  }

  // Staff: outage banner right away, then the flagged notification.
  const staffCtx = await staffContext(browser, staff);
  const admin = await staffCtx.newPage();
  await admin.goto(`/en/admin/orders/${reference}`);
  await expect(admin.getByTestId("messaging-outage")).toContainText(
    "WhatsApp sends are failing right now",
  );
  const inOrder = admin
    .getByTestId("order-messages")
    .locator(`li[data-message-id="${failing.id}"]`);
  await expect(inOrder).toHaveAttribute("data-message-status", "queued");
  await expect(inOrder.locator("[data-error-code]")).toContainText("network:");
  await expect(inOrder).toContainText("Next try");

  for (let i = 0; i < 3; i++) {
    timeTravel(failing.id);
    await dispatch();
  }
  const gaveUp = notification(orderId)!;
  expect(gaveUp).toMatchObject({
    status: "failed",
    attempts: 4,
    needs_attention: true,
  });
  await admin.goto("/en/admin/messages");
  await expect(
    admin.locator(`li[data-message-id="${failing.id}"]`),
  ).toHaveAttribute("data-attention", "true");
  await admin.screenshot({
    path: ".e2e/whatsapp-outage-admin.png",
    fullPage: true,
  });

  // Meta is back: one click delivers it, and the outage banner goes away.
  await fakeControl({ offline: false });
  await admin
    .locator(`li[data-message-id="${failing.id}"]`)
    .getByRole("button", { name: "Try again" })
    .click();
  await waitFor(
    () => notification(orderId)?.status === "sent",
    "delivery after recovery",
  );
  expect((await fakeInbox(to)).map((m) => m.template)).toContain(
    "order_status_update",
  );
  await admin.reload();
  await expect(admin.getByTestId("messaging-outage")).toHaveCount(0);
  await staffCtx.close();
  await ctx.close();
});

test("cost is recorded per message (estimate at send, Meta's billing from the webhook) and the owner sees spend", async ({
  browser,
}) => {
  const ctx = await staffContext(browser, owner);
  const page = await ctx.newPage();
  await page.goto("/en/admin/messages");
  const rates = page.getByTestId("whatsapp-rates");
  await rates.locator("#rate-utility").fill("0.0034");
  await rates.locator("#rate-authentication").fill("0.025");
  await rates.getByRole("button").click();
  await expect(rates.getByRole("status")).toBeVisible();
  expect(
    sql(
      `select usd_per_message from whatsapp_rates where category = 'utility'`,
    ),
  ).toBe("0.00340");
  expect(
    sql(
      `select count(*) from audit_logs where action = 'whatsapp_rates.update'`,
    ),
  ).not.toBe("0");

  const a = await createUser();
  const b = await createUser();
  const orderA = await createOrder(a.id);
  const orderB = await createOrder(b.id);
  await dispatch();
  const sentA = notification(orderA.id)!;
  const sentB = notification(orderB.id)!;
  for (const r of [sentA, sentB]) {
    expect(r).toMatchObject({
      status: "sent",
      cost_usd: 0.0034,
      cost_source: "estimate",
      pricing_category: "utility",
    });
  }

  // Meta's report: A billable, B free (e.g. inside a free entry-point window).
  const wa = await fakeWebhook({
    id: sentA.provider_message_id!,
    status: "delivered",
    to: digits(a.phone),
    category: "utility",
    billable: true,
  });
  const wb = await fakeWebhook({
    id: sentB.provider_message_id!,
    status: "delivered",
    to: digits(b.phone),
    category: "utility",
    billable: false,
  });
  expect([wa.appStatus, wb.appStatus]).toEqual([200, 200]);
  expect(notification(orderA.id)).toMatchObject({
    cost_usd: 0.0034,
    cost_source: "webhook",
    billable: true,
  });
  expect(notification(orderB.id)).toMatchObject({
    cost_usd: 0,
    cost_source: "webhook",
    billable: false,
  });
  // Replays and later statuses do not charge twice.
  await postWebhook(wa.raw, wa.signature);
  await fakeWebhook({
    id: sentA.provider_message_id!,
    status: "read",
    to: digits(a.phone),
    category: "utility",
    billable: true,
  });
  expect(notification(orderA.id)!.cost_usd).toBe(0.0034);
  // Meta's billing decision is fixed by the first report: a later status for
  // the free message B that carries different pricing does not change it,
  // and a replay of B's report is a no-op.
  await fakeWebhook({
    id: sentB.provider_message_id!,
    status: "read",
    to: digits(b.phone),
    category: "utility",
    billable: true,
  });
  expect(notification(orderB.id)).toMatchObject({
    cost_usd: 0,
    billable: false,
  });
  expect(
    JSON.parse((await postWebhook(wb.raw, wb.signature)).body),
  ).toMatchObject({ duplicate: 1 });

  // OTP cost: authentication rate.
  const local = localNumber();
  const visitor = await browser.newContext({ baseURL: BASE });
  const otpPage = await visitor.newPage();
  await otpPage.goto("/en/register");
  await otpPage.fill("#phone", local);
  await otpPage.getByRole("button", { name: "Send code" }).click();
  await expect(otpPage.locator("#code")).toBeVisible();
  const otp = row(
    `m.phone_e164 = '${toE164(local)}' and m.message_type = 'otp'`,
  )!;
  expect(otp).toMatchObject({
    status: "sent",
    cost_usd: 0.025,
    pricing_category: "authentication",
  });

  // Spend page = the database, per type and category.
  const expected = sql(
    `select to_char(coalesce(sum(cost_usd), 0), 'FM9999990.0000') from message_logs
      where status <> 'queued'
        and created_at >= date_trunc('month', now() at time zone 'Africa/Khartoum') at time zone 'Africa/Khartoum'`,
  );
  await page.reload();
  await expect(page.getByTestId("spend-total")).toHaveText(`$${expected}`);
  await expect(page.getByTestId("spend-rows")).toContainText("Order updates");
  console.log(`[demo] spend total this month: $${expected}`);

  // Orders-only staff do not see spend or rates; settings RPC refuses them.
  const staffCtx = await staffContext(browser, staff);
  const sp = await staffCtx.newPage();
  await sp.goto("/en/admin/messages");
  await expect(sp.getByTestId("messaging-health")).toBeVisible();
  await expect(sp.getByTestId("whatsapp-spend")).toHaveCount(0);
  const { error } = await staff.client.rpc("whatsapp_spend", {
    p_from: "2026-01-01",
    p_to: "2026-12-31",
  });
  expect(error?.message).toBe("FORBIDDEN");
  await staffCtx.close();
  await ctx.close();
});

test("no message content, OTP code or token in message_logs, events, audit or any log", async ({
  browser,
}) => {
  const tag = String(Date.now()).slice(-6);
  const note = `NOTE-CANARY-${tag} your code is in the box`;
  const reason = `REASON-CANARY-${tag} photo unreadable`;
  const incoming = `INCOMING-CANARY-${tag} hello`;
  const errorDetails = `DETAILS-CANARY-${tag} recipient +249`;
  const since = Date.now();

  // 1. OTP through the UI (real driver → fake Meta); we read the code from the fake.
  const local = localNumber();
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto("/en/register");
  await page.fill("#phone", local);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.locator("#code")).toBeVisible();
  const otpMsg = (await fakeInbox(toE164(local), since)).find(
    (m) => m.template === "otp_code",
  )!;
  const code = otpMsg.params[0];
  expect(code).toMatch(/^\d{6}$/);
  expect(otpMsg.buttonParam).toBe(code);

  // 2. Order status with a customer note; 3. KYC rejection with a reason.
  const customer = await createUser();
  const order = await createOrder(customer.id);
  const cancel = await staff.client.rpc("change_order_status", {
    p_order_id: order.id,
    p_to_status: "cancelled",
    p_customer_note: note,
  });
  expect(cancel.error).toBeNull();
  const kyc = await createKycSubmission(customer.id);
  const review = await staff.client.rpc("review_kyc", {
    p_submission_id: kyc.id,
    p_approve: false,
    p_reason: reason,
  });
  expect(review.error).toBeNull();
  await dispatch();
  const inbox = await fakeInbox(customer.phone, since);
  // Rendered at send time: the text reached "WhatsApp"...
  expect(
    inbox.find(
      (m) => m.template === "order_status_update" && m.params.includes(note),
    ),
  ).toBeTruthy();
  expect(
    inbox.find(
      (m) => m.template === "kyc_rejected" && m.params.includes(reason),
    ),
  ).toBeTruthy();

  // 4. Webhook with an incoming customer text and Meta error details.
  const noteMsg = inbox.find((m) => m.params.includes(note))!;
  const hook = await fakeWebhook({
    id: noteMsg.id,
    status: "failed",
    to: digits(customer.phone),
    errorCode: 131026,
    extra: { incomingText: incoming, errorDetails },
  });
  expect(hook.appStatus).toBe(200);

  // ...but none of it is stored or logged anywhere by the messaging system.
  const secrets = {
    otp: code,
    note,
    reason,
    incoming,
    errorDetails,
    accessToken: SECRETS.token,
    appSecret: SECRETS.appSecret,
    dispatchSecret: SECRETS.dispatch,
    verifyToken: SECRETS.verify,
  };
  canaries.push(...Object.values(secrets));
  // Meta's protocol puts the verify token in the handshake URL, and the
  // framework's request log prints URLs. That is the only place it may
  // appear (docs/decisions.md: unset the token after subscribing).
  const appLog = readFileSync(".e2e/dev.log", "utf8");
  const HANDSHAKE_LINE = /^\s*GET \/api\/whatsapp\/webhook\?hub\.[^\n]*$/gm;
  const handshakeLines = appLog.match(HANDSHAKE_LINE) ?? [];
  console.log(
    `[demo] verify token appears in ${handshakeLines.filter((l) => l.includes(SECRETS.verify)).length} framework request line(s), all of them Meta's GET handshake URL`,
  );
  const stores: Record<string, string> = {
    message_logs: sql(
      `select coalesce(string_agg(row_to_json(m)::text, E'\\n'), '') from message_logs m`,
    ),
    message_events: sql(
      `select coalesce(string_agg(row_to_json(e)::text, E'\\n'), '') from private.message_events e`,
    ),
    audit_logs: sql(
      `select coalesce(string_agg(row_to_json(a)::text, E'\\n'), '') from audit_logs a`,
    ),
    whatsapp_rates: sql(
      `select coalesce(string_agg(row_to_json(r)::text, E'\\n'), '') from whatsapp_rates r`,
    ),
    "app log (.e2e/dev.log) minus Meta's GET handshake request lines":
      appLog.replace(HANDSHAKE_LINE, ""),
  };
  const found: string[] = [];
  for (const [store, text] of Object.entries(stores)) {
    for (const [name, value] of Object.entries(secrets)) {
      // The KYC reason lives in its own record and that record's audit trail
      // (the decision itself, Phase 3); it must not be copied by messaging.
      if (store === "audit_logs" && name === "reason") continue;
      if (text.includes(value)) found.push(`${name} in ${store}`);
    }
  }
  console.log(
    `[demo] searched ${Object.keys(stores).length} stores (${Object.values(stores).reduce((s, t) => s + t.length, 0)} bytes) for ${Object.keys(secrets).length} canaries: ${found.length ? found.join(", ") : "none found"}`,
  );
  expect(found).toEqual([]);
  // The audit trail of messaging actions never carries data.
  expect(
    sql(
      `select count(*) from audit_logs where action like 'message_logs.%' and new_data is not null`,
    ),
  ).toBe("0");
  // The failed-status webhook stored only the code.
  expect(row(`m.provider_message_id = '${noteMsg.id}'`)).toMatchObject({
    status: "failed",
    error_code: "meta:131026",
  });
  await ctx.close();
});
