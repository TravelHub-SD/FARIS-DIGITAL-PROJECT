import { writeFileSync } from "node:fs";

import { type Browser, expect, type Page, test } from "@playwright/test";

import {
  anon,
  createPaidOrder,
  randomPhoneDigits,
  VARIANT_CHEAP,
  createUser,
  service,
  signInCookies,
  sql,
  type TestUser,
} from "./helpers";

// Phase 8 in the browser: invoices issued by completing an order, rendered
// only from their snapshot, visible only to their owner (and invoices staff)
// by every route, printed without the site around them, and saved as PDF by
// the browser's own print engine (decisions.md 2026-09-29).

const BASE = "http://localhost:3100";

async function as(browser: Browser, user: TestUser | null) {
  const ctx = await browser.newContext({ baseURL: BASE });
  if (user) await signInCookies(ctx, user.phone, user.password);
  return { ctx, page: await ctx.newPage() };
}

let owner: TestUser; // customer A
let other: TestUser; // customer B
let billing: TestUser; // invoices staff
let ordersStaff: TestUser; // orders only
let orderId: string;
let reference: string;
let number: string;
let total: string; // SDG total of the order, as printed (e.g. 2,860)

test.beforeAll(async () => {
  owner = await createUser({ name: "أحمد عثمان محمد" });
  other = await createUser({ name: "Sara Ali" });
  billing = await createUser({
    admin: { permissions: ["invoices", "orders"] },
    name: "Billing",
  });
  ordersStaff = await createUser({
    admin: { permissions: ["orders"] },
    name: "Orders only",
  });
  sql(
    `update app_settings set contact_phone = '+249912345678', contact_email = 'sales@faris.example', address_ar = 'الخرطوم، شارع المك نمر', address_en = 'Khartoum, Al-Mek Nimir St.' where id`,
  );
  const order = await createPaidOrder(owner.id);
  orderId = order.id;
  reference = order.reference;
  // Staff complete the order: the invoice is issued in the same transaction.
  const done = await ordersStaff.client.rpc("change_order_status", {
    p_order_id: orderId,
    p_to_status: "completed",
  });
  expect(done.error).toBeNull();
  number = sql(
    `select invoice_number from invoices where order_id = '${orderId}' and status = 'issued'`,
  );
  expect(number).toMatch(/^INV-\d{4}-\d{5}$/);
  total = sql(
    `select to_char(total_sdg, 'FM999,999,990') from orders where id = '${orderId}'`,
  );
});

const doc = (page: Page) => page.getByTestId("invoice-document");

test("customer finds the invoice from the order, the list and search", async ({
  browser,
}) => {
  const { ctx, page } = await as(browser, owner);
  await page.goto(`/ar/account/orders/${reference}`);
  await page.getByTestId("order-invoice-link").click();
  await page.waitForURL(`**/ar/account/invoices/${number}`);
  await expect(doc(page)).toHaveAttribute("data-invoice-number", number);
  await expect(page.getByTestId("invoice-customer")).toHaveText(
    "أحمد عثمان محمد",
  );
  await expect(page.getByTestId("invoice-total")).toContainText(total);
  expect(await page.title()).toBe(number); // default PDF file name
  await page.screenshot({
    path: ".e2e/invoice-screen-ar-mobile.png",
    fullPage: true,
  });

  await page.goto("/en/account/invoices");
  await expect(page.locator(`[data-invoice-number="${number}"]`)).toBeVisible();
  await page.goto(`/en/account/invoices?q=${reference}`);
  await expect(page.getByTestId("invoices-list").locator("li")).toHaveCount(1);
  await page.goto("/en/account/invoices?q=INV-1999-00001");
  await expect(page.getByText("No invoices match.")).toBeVisible();
  await ctx.close();
});

test("the invoice does not change when prices, the rate, the seller or the customer change", async ({
  browser,
}) => {
  const { ctx, page } = await as(browser, owner);
  await page.goto(`/en/account/invoices/${number}`);
  const before = await doc(page).innerText();
  const rowBefore = sql(
    `select row_to_json(i)::text from invoices i where invoice_number = '${number}'`,
  );
  const V = `'${VARIANT_CHEAP}'`;
  const original = sql(
    `select pv.name_en || '|' || p.name_en || '|' || pv.price_usd from product_variants pv join products p on p.id = pv.product_id where pv.id = ${V}`,
  ).split("|");
  const newPhone = randomPhoneDigits();
  try {
    // Everything the invoice was built from changes afterwards.
    sql(
      `update product_variants set price_usd = 9.99, name_en = 'Renamed variant' where id = ${V}`,
    );
    sql(
      `update products set name_en = 'Renamed product' where id = (select product_id from product_variants where id = ${V})`,
    );
    sql(
      `update app_settings set usd_sdg_rate = 4100, business_name_en = 'New Brand Ltd', contact_phone = '+249999999999' where id`,
    );
    const renamed = await owner.client
      .from("profiles")
      .update({ full_name: "Changed Name" })
      .eq("id", owner.id);
    expect(renamed.error).toBeNull();
    const phone = await service().auth.admin.updateUserById(owner.id, {
      phone: newPhone,
    });
    expect(phone.error).toBeNull();
    expect(
      sql(`select phone_e164 from profiles where id = '${owner.id}'`),
    ).toBe(`+${newPhone}`);

    await page.reload();
    const after = await doc(page).innerText();
    const rowAfter = sql(
      `select row_to_json(i)::text from invoices i where invoice_number = '${number}'`,
    );
    console.log(
      `[demo] after price 9.99, rate 4100, new brand/phone, renamed customer and new phone: invoice text identical: ${before === after}; DB row identical: ${rowBefore === rowAfter}`,
    );
    expect(after).toBe(before);
    expect(rowAfter).toBe(rowBefore);
    expect(after).toMatch(new RegExp(`SDG\\s${total}`));
    expect(after).toContain("1 USD = 2,600 SDG");
    for (const changed of [
      "Renamed",
      "New Brand",
      "Changed Name",
      "4,100",
      "9.99",
      newPhone.slice(-4),
    ]) {
      expect(after, changed).not.toContain(changed);
    }
  } finally {
    sql(
      `update product_variants set name_en = '${original[0]}', price_usd = ${original[2]} where id = ${V}`,
    );
    sql(
      `update products set name_en = '${original[1]}' where id = (select product_id from product_variants where id = ${V})`,
    );
    sql(
      `update app_settings set usd_sdg_rate = 2600, business_name_en = 'Faris Digital', contact_phone = '+249912345678' where id`,
    );
    sql(
      `update profiles set full_name = 'أحمد عثمان محمد' where id = '${owner.id}'`,
    );
    // The owner signs in by phone in later tests.
    await service().auth.admin.updateUserById(owner.id, {
      phone: owner.phone.slice(1),
    });
    await ctx.close();
  }
});

test("a customer can only view their own invoices, by any route", async ({
  browser,
}) => {
  // Customer B, anonymous visitors and orders-only staff.
  const b = await as(browser, other);
  for (const path of [
    `/en/account/invoices/${number}`,
    `/ar/account/invoices/${number}`,
    `/en/admin/invoices/${number}`,
    `/en/admin/invoices`,
  ]) {
    const res = await b.page.goto(path);
    expect(res?.status(), path).toBe(404);
    await expect(b.page.getByText(number)).toHaveCount(0);
  }
  await b.page.goto(`/en/account/invoices?q=${number}`);
  await expect(b.page.getByText("No invoices match.")).toBeVisible();
  const restB = await other.client
    .from("invoices")
    .select("*")
    .eq("invoice_number", number);
  expect(restB.data).toEqual([]);
  const rpcB = await other.client.rpc("search_invoices", { p_query: number });
  expect(rpcB.data).toEqual([]);
  const rpcBAll = await other.client.rpc("search_invoices", {});
  expect(rpcBAll.data).toEqual([]);
  await b.ctx.close();

  const v = await as(browser, null);
  const res = await v.page.goto(`/en/account/invoices/${number}`);
  expect(v.page.url()).toContain("/en/login");
  expect(res?.status()).toBe(200);
  await expect(v.page.getByText(number)).toHaveCount(0);
  const restAnon = await anon()
    .from("invoices")
    .select("*")
    .eq("invoice_number", number);
  expect(restAnon.data ?? []).toEqual([]);
  await v.ctx.close();

  const s = await as(browser, ordersStaff);
  expect((await s.page.goto(`/en/admin/invoices/${number}`))?.status()).toBe(
    404,
  );
  expect((await s.page.goto(`/en/account/invoices/${number}`))?.status()).toBe(
    404,
  );
  const restStaff = await ordersStaff.client.from("invoices").select("*");
  expect(restStaff.data).toEqual([]);
  await s.page.goto(`/en/admin/orders/${reference}`);
  await expect(s.page.getByTestId("admin-order-invoice")).toHaveCount(0);
  await s.ctx.close();

  // Invoices staff may read every invoice (RLS), but the CUSTOMER pages are
  // for their own purchases only: someone else's invoice is a 404 there.
  const st = await as(browser, billing);
  expect((await st.page.goto(`/en/account/invoices/${number}`))?.status()).toBe(
    404,
  );
  await st.page.goto("/en/account/invoices");
  await expect(
    st.page.locator(`[data-invoice-number="${number}"]`),
  ).toHaveCount(0);
  expect((await st.page.goto(`/en/admin/invoices/${number}`))?.status()).toBe(
    200,
  );
  await st.ctx.close();

  // The owner through the API: exactly their own.
  const restA = await owner.client.from("invoices").select("invoice_number");
  expect(restA.data).toEqual([{ invoice_number: number }]);
  console.log(
    `[demo] other customer: 4 URLs → 404, list/search/REST/RPC → 0 rows; anonymous → login, REST 0 rows; orders-only staff → 404, REST 0 rows; owner REST → [${number}]`,
  );
});

/**
 * Is substring `a` drawn to the LEFT of substring `b` inside the element?
 * Measures the laid-out glyph boxes, so it checks what the reader sees.
 */
async function leftOf(page: Page, testId: string, a: string, b: string) {
  return page.getByTestId(testId).evaluate(
    (el, [a, b]) => {
      const rectOf = (needle: string) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const i = n.textContent!.indexOf(needle);
          if (i >= 0) {
            const r = document.createRange();
            r.setStart(n, i);
            r.setEnd(n, i + needle.length);
            return r.getBoundingClientRect();
          }
        }
        throw new Error(`"${needle}" not found`);
      };
      return rectOf(a).right <= rectOf(b).left + 0.5;
    },
    [a, b],
  );
}

test("Arabic invoice: numbers stay whole and in reading order (measured on screen)", async ({
  browser,
}) => {
  const { ctx, page } = await as(browser, owner);
  await page.goto(`/ar/account/invoices/${number}`);
  const checks = {
    // "2,860 ج.س." read right to left: the currency sits LEFT of the amount.
    currencyLeftOfAmount: await leftOf(page, "invoice-total", "ج", total),
    // "1 دولار = 2,600 جنيه": "1" is the rightmost, "جنيه" left of 2,600.
    dollarLeftOfOne: await leftOf(page, "invoice-rate", "دولار", "1"),
    poundLeftOfRate: await leftOf(page, "invoice-rate", "جنيه", "2,600"),
    // Day/month/year: the day (first) is RIGHT of the year.
    yearLeftOfDay: await leftOf(
      page,
      "invoice-issued-at",
      String(new Date().getFullYear()),
      (await page.getByTestId("invoice-issued-at").innerText()).match(
        /\d{1,2}/,
      )![0],
    ),
    // Latin tokens keep their own left-to-right order.
    invoiceNumberLtr: await leftOf(
      page,
      "invoice-number",
      "INV",
      number.slice(-5),
    ),
  };
  console.log(`[demo] Arabic visual order: ${JSON.stringify(checks)}`);
  expect(Object.values(checks).every(Boolean)).toBe(true);
  await ctx.close();
});

async function printAndSave(page: Page, name: string) {
  await page.emulateMedia({ media: "print" });
  // Site chrome is gone in print; the invoice is all that is left.
  for (const sel of [
    "[data-testid=site-header]",
    "[data-testid=site-footer]",
    "nav",
    "[data-testid=print-invoice]",
  ]) {
    const all = page.locator(sel);
    for (let i = 0; i < (await all.count()); i++) {
      await expect(all.nth(i), `${sel} #${i} hidden in print`).toBeHidden();
    }
  }
  await expect(doc(page)).toBeVisible();
  await page.screenshot({ path: `.e2e/${name}-print.png`, fullPage: true });
  const pdf = await page.pdf({ format: "A4", printBackground: true });
  writeFileSync(`.e2e/${name}.pdf`, pdf);
  const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? [])
    .length;
  await page.emulateMedia({ media: "screen" });
  return pages;
}

test("printing gives a clean one-page invoice without site navigation (ar and en, customer and admin)", async ({
  browser,
}) => {
  const a = await as(browser, owner);
  await a.page.setViewportSize({ width: 1280, height: 900 });
  await a.page.goto(`/ar/account/invoices/${number}`);
  await expect(a.page.locator("header").first()).toBeVisible(); // on screen it is there
  const arPages = await printAndSave(a.page, "invoice-ar");
  await a.page.goto(`/en/account/invoices/${number}`);
  const enPages = await printAndSave(a.page, "invoice-en");
  await a.ctx.close();

  const s = await as(browser, billing);
  await s.page.setViewportSize({ width: 1280, height: 900 });
  await s.page.goto(`/ar/admin/invoices/${number}`);
  await expect(s.page.getByTestId("void-invoice")).toBeVisible();
  const adminPages = await printAndSave(s.page, "invoice-admin-ar");
  await s.ctx.close();
  console.log(
    `[demo] PDF pages: ar ${arPages}, en ${enPages}, admin-ar ${adminPages}`,
  );
  expect([arPages, enPages, adminPages]).toEqual([1, 1, 1]);
});

test("staff search, void with a reason, re-issue; the customer only ever sees the valid one", async ({
  browser,
}) => {
  const s = await as(browser, billing);
  const local = "0" + other.phone.slice(4);
  const otherOrder = await createPaidOrder(other.id);
  await billing.client.rpc("change_order_status", {
    p_order_id: otherOrder.id,
    p_to_status: "completed",
  });
  const otherNumber = sql(
    `select invoice_number from invoices where order_id = '${otherOrder.id}'`,
  );
  for (const [q, expected] of [
    [number, number],
    [reference, number],
    ["sara", otherNumber],
    [local, otherNumber],
  ]) {
    await s.page.goto(`/en/admin/invoices?q=${encodeURIComponent(q)}`);
    await expect(
      s.page.getByTestId("admin-invoices").locator("tr"),
      q,
    ).toHaveCount(1);
    await expect(
      s.page.locator(`tr[data-invoice-number="${expected}"]`),
      q,
    ).toBeVisible();
  }

  // Void (reason required), then issue a new one.
  await s.page.goto(`/en/admin/invoices/${number}`);
  s.page.on("dialog", (d) => d.accept());
  await s.page.getByRole("button", { name: "Void invoice" }).click();
  await expect(s.page.locator("#void-reason:invalid")).toHaveCount(1);
  await s.page.fill("#void-reason", "Customer name misspelled");
  await s.page.getByRole("button", { name: "Void invoice" }).click();
  await expect(s.page.getByText("Invoice voided.")).toBeVisible();
  await s.page.reload();
  await expect(s.page.getByTestId("void-stamp")).toBeVisible();
  await expect(s.page.getByTestId("void-notice")).toContainText(
    "Customer name misspelled",
  );
  // The cause is fixed (the customer's name), then a new invoice is issued.
  sql(
    `update profiles set full_name = 'أحمد عثمان محمد الحسن' where id = '${owner.id}'`,
  );
  await s.page.getByRole("button", { name: "Issue new invoice" }).click();
  await expect(s.page.getByText("New invoice issued.")).toBeVisible();
  const reissued = sql(
    `select invoice_number from invoices where order_id = '${orderId}' and status = 'issued'`,
  );
  expect(Number(reissued.slice(-5))).toBe(
    Number(sql(`select max(right(invoice_number, 5)::int) from invoices`)),
  );
  await s.page.reload();
  await expect(s.page.getByTestId("invoice-history").locator("li")).toHaveCount(
    2,
  );
  expect(
    sql(
      `select string_agg(action, ',' order by id) from audit_logs where entity_type = 'invoices' and entity_id in (select id::text from invoices where order_id = '${orderId}') and actor_id = '${billing.id}'`,
    ),
  ).toBe("invoices.update,invoices.insert");
  await s.page.goto(`/ar/admin/invoices`);
  await s.page.screenshot({
    path: ".e2e/admin-invoices-ar-mobile.png",
    fullPage: true,
  });
  await s.page.goto(`/en/admin/invoices?status=void`);
  await expect(
    s.page.locator(`tr[data-invoice-number="${number}"]`),
  ).toBeVisible();
  await s.ctx.close();

  // The customer: old number gone (404), new one listed and shown with the
  // name as it is now.
  const a = await as(browser, owner);
  expect((await a.page.goto(`/en/account/invoices/${number}`))?.status()).toBe(
    404,
  );
  await a.page.goto("/en/account/invoices");
  await expect(a.page.getByTestId("invoices-list").locator("li")).toHaveCount(
    1,
  );
  await expect(
    a.page.locator(`[data-invoice-number="${reissued}"]`),
  ).toBeVisible();
  await a.page.goto(`/en/account/invoices/${reissued}`);
  await expect(a.page.getByTestId("invoice-customer")).toHaveText(
    "أحمد عثمان محمد الحسن",
  );
  console.log(
    `[demo] voided ${number} ("Customer name misspelled"), re-issued as ${reissued}; customer sees only ${reissued}`,
  );
  await a.ctx.close();
});
