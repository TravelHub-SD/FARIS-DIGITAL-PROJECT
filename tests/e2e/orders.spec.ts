import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import sharp from "sharp";

import {
  createUser,
  service,
  signInCookies,
  sql,
  type TestUser,
} from "./helpers";

// Phase 5 in the browser: product page → order → bank details → receipt.
// Receipts are reviewed through the database RPC here (staff session): the
// admin orders screen is Phase 6.

const BASE = "http://localhost:3100";

async function asCustomer(
  browser: import("@playwright/test").Browser,
  user: TestUser,
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext();
  await signInCookies(ctx, user.phone, user.password);
  return { ctx, page: await ctx.newPage() };
}

/** A banking-app style screenshot (PNG, unique pixels per call). */
async function receiptScreenshot(name: string) {
  const png = await sharp({
    create: {
      width: 720,
      height: 1280,
      channels: 3,
      background: `#${randomBytes(3).toString("hex")}`,
    },
  })
    .png()
    .toBuffer();
  const path = `.e2e/${name}.png`;
  writeFileSync(path, png);
  return path;
}

async function orderPubg(page: Page, quantity: string) {
  await page.goto(`${BASE}/en/p/pubg-uc`);
  await page.selectOption("#quantity", quantity);
  await page.fill("#f-player_id", "5123456789");
  await page.getByRole("button", { name: "Place order" }).click();
  await page.waitForURL(/\/en\/account\/orders\/FD-\d{7}$/);
  return page.url().split("/").pop()!;
}

async function uploadReceipt(
  page: Page,
  opts: { ref: string; file: string; bank?: string },
) {
  if (opts.bank) await page.selectOption("#bankAccountId", opts.bank);
  await page.fill("#transactionRef", opts.ref);
  await page.setInputFiles("#file", opts.file);
  await page.getByRole("button", { name: "Send receipt" }).click();
}

test("full order: product page → order at the DB price → bank details → receipt → accepted → processing", async ({
  browser,
}) => {
  const customer = await createUser();
  const staff = await createUser({ admin: { permissions: ["orders"] } });
  const { page } = await asCustomer(browser, customer);

  await page.goto(`${BASE}/en/p/pubg-uc`);
  await page.selectOption("#quantity", "3");
  // ceil(1.10 × 3 × 2600) from the database (a float product would say 8,581).
  await expect(page.getByTestId("order-total")).toHaveText("Total: SDG 8,580");
  await page.fill("#f-player_id", "5123456789");
  await page.getByRole("button", { name: "Place order" }).click();
  await page.waitForURL(/\/en\/account\/orders\/FD-\d{7}$/);
  const reference = page.url().split("/").pop()!;
  console.log(`[demo] order created: ${reference}`);

  await expect(page.getByTestId("order-reference")).toHaveText(reference);
  await expect(page.getByTestId("order-status")).toHaveText("Awaiting payment");
  await expect(page.getByTestId("order-total")).toHaveText("SDG 8,580");
  const instructions = page.getByTestId("payment-instructions");
  await expect(instructions).toContainText("Transfer exactly SDG 8,580");
  await expect(instructions).toContainText(reference);
  for (const account of ["3121407", "51575057", "27098"]) {
    await expect(instructions).toContainText(account);
  }
  await page.screenshot({
    path: ".e2e/order-awaiting-payment.png",
    fullPage: true,
  });

  await uploadReceipt(page, {
    ref: `BK-${randomBytes(4).toString("hex")}`,
    file: await receiptScreenshot("receipt-1"),
  });
  await expect(page.getByTestId("order-status")).toHaveText(
    "Payment under review",
  );
  await expect(page.getByTestId("receipt-pending")).toBeVisible();
  await expect(page.getByTestId("payment-instructions")).toHaveCount(0);
  await expect(page.locator("[data-receipt-status=pending]")).toHaveText(
    "Under review",
  );

  // The stored file is a re-encoded JPEG whose hash the server recorded.
  const row = JSON.parse(
    sql(
      `select json_build_object('path', r.storage_path, 'sha', r.file_sha256, 'meta', o.user_metadata)
         from public.payment_receipts r
         join storage.objects o on o.bucket_id = 'payment-receipts' and o.name = r.storage_path
         join public.orders ord on ord.id = r.order_id
        where ord.reference = '${reference}'`,
    ),
  );
  expect(row.meta).toEqual({ sha256: row.sha });
  const stored = await service()
    .storage.from("payment-receipts")
    .download(row.path);
  expect(
    (await sharp(Buffer.from(await stored.data!.arrayBuffer())).metadata())
      .format,
  ).toBe("jpeg");

  // Staff accepts the payment → the order moves to processing.
  const receiptId = sql(
    `select r.id from public.payment_receipts r join public.orders o on o.id = r.order_id where o.reference = '${reference}'`,
  );
  const accepted = await staff.client.rpc("review_receipt", {
    p_receipt_id: receiptId,
    p_accept: true,
  });
  expect(accepted.error).toBeNull();
  await page.reload();
  await expect(page.getByTestId("order-status")).toHaveText("Processing");
  await expect(page.getByTestId("status-history")).toContainText(
    "Awaiting payment",
  );
  await expect(page.getByTestId("status-history")).toContainText("Processing");
  await expect(page.locator("[data-receipt-status=accepted]")).toHaveText(
    "Accepted",
  );

  await page.goto(`${BASE}/en/account/orders`);
  await expect(page.getByTestId("orders-list")).toContainText(reference);
  await page.screenshot({ path: ".e2e/orders-list.png", fullPage: true });
});

test("stale price: the rate changes after the page loaded → the customer is shown the new total and must confirm", async ({
  browser,
}) => {
  const customer = await createUser();
  const { page } = await asCustomer(browser, customer);
  const rate = sql("select usd_sdg_rate from public.app_settings");
  try {
    await page.goto(`${BASE}/en/p/pubg-uc`);
    await expect(page.getByTestId("order-total")).toHaveText(
      "Total: SDG 2,860",
    );
    await page.fill("#f-player_id", "5123456789");

    sql("update public.app_settings set usd_sdg_rate = 2700"); // owner updates the rate
    await page.getByRole("button", { name: "Place order" }).click();
    await expect(page.getByTestId("price-changed")).toContainText("SDG 2,970");
    // What the customer typed is still there (React would reset a form action).
    await expect(page.locator("#f-player_id")).toHaveValue("5123456789");
    await expect(page.getByTestId("order-total")).toHaveText(
      "Total: SDG 2,970",
    );
    expect(
      sql(
        `select count(*) from public.orders where user_id = '${customer.id}'`,
      ),
    ).toBe("0");
    await page.screenshot({ path: ".e2e/price-changed.png", fullPage: true });

    await page.getByRole("button", { name: "Place order" }).click();
    await page.waitForURL(/\/account\/orders\/FD-\d{7}$/);
    await expect(page.getByTestId("order-total")).toHaveText("SDG 2,970");
  } finally {
    sql(`update public.app_settings set usd_sdg_rate = ${rate}`);
  }
});

test("KYC: an unverified customer is stopped above the threshold and pointed to verification", async ({
  browser,
}) => {
  const customer = await createUser();
  const { page } = await asCustomer(browser, customer);
  await page.goto(`${BASE}/en/p/starlink-subscription`);
  await page.fill("#f-account_email", "dish@example.com");
  await page.getByRole("button", { name: "Place order" }).click();
  const error = page.getByTestId("order-error");
  await expect(error).toHaveAttribute("data-reason", "kyc_required");
  await expect(error).toContainText(
    "Orders of this amount need a verified identity.",
  );
  await expect(
    error.getByRole("link", { name: "Verify your identity" }),
  ).toHaveAttribute("href", "/en/account/kyc");
  expect(
    sql(`select count(*) from public.orders where user_id = '${customer.id}'`),
  ).toBe("0");
});

test("duplicates: another customer cannot reuse a transaction number or the same receipt file", async ({
  browser,
}) => {
  const first = await createUser();
  const second = await createUser();
  const ref = `DUP-${randomBytes(4).toString("hex")}`;
  const file = await receiptScreenshot("receipt-dup");

  const a = await asCustomer(browser, first);
  await orderPubg(a.page, "1");
  await uploadReceipt(a.page, { ref, file });
  await expect(a.page.getByTestId("order-status")).toHaveText(
    "Payment under review",
  );

  const b = await asCustomer(browser, second);
  await orderPubg(b.page, "1");
  // Same number, written differently.
  await uploadReceipt(b.page, {
    ref: ` ${ref.toLowerCase().replace("-", " ")} `,
    file: await receiptScreenshot("receipt-other"),
  });
  await expect(b.page.locator("[data-error=duplicate_transaction]")).toHaveText(
    "This transaction number has already been used for another payment.",
  );
  // Same screenshot, new number.
  await uploadReceipt(b.page, {
    ref: `NEW-${randomBytes(4).toString("hex")}`,
    file,
  });
  await expect(b.page.locator("[data-error=duplicate_file]")).toHaveText(
    "This receipt image has already been used for another payment.",
  );
  await b.page.screenshot({
    path: ".e2e/duplicate-receipt.png",
    fullPage: true,
  });
  expect(
    sql(
      `select count(*) from public.payment_receipts where user_id = '${second.id}'`,
    ),
  ).toBe("0");
  // Rejected uploads were removed from the bucket again.
  expect(
    sql(
      `select count(*) from storage.objects where bucket_id = 'payment-receipts' and name like '${second.id}/%'`,
    ),
  ).toBe("0");
});

test("another customer's order page is a 404, by reference and not listed", async ({
  browser,
}) => {
  const owner = await createUser();
  const other = await createUser();
  const o = await asCustomer(browser, owner);
  const reference = await orderPubg(o.page, "1");

  const x = await asCustomer(browser, other);
  for (const locale of ["en", "ar"]) {
    const res = await x.page.goto(
      `${BASE}/${locale}/account/orders/${reference}`,
    );
    console.log(
      `[demo] other customer GET /${locale}/account/orders/${reference} -> ${res!.status()}`,
    );
    expect(res!.status()).toBe(404);
  }
  // A reference that does not exist looks exactly the same.
  expect(
    (await x.page.goto(`${BASE}/en/account/orders/FD-0000000`))!.status(),
  ).toBe(404);
  await x.page.goto(`${BASE}/en/account/orders`);
  await expect(x.page.getByText("You have no orders yet.")).toBeVisible();
  await expect(x.page.getByText(reference)).toHaveCount(0);
  // Signed out: the order page sends you to login, not to the order.
  const anonCtx = await browser.newContext();
  const anonPage = await anonCtx.newPage();
  await anonPage.goto(`${BASE}/en/account/orders/${reference}`);
  await expect(anonPage).toHaveURL(/\/en\/login/);
});

test("signed out: a valid order form asks to sign in and creates nothing", async ({
  page,
}) => {
  await page.goto(`${BASE}/ar/p/pubg-uc`);
  await page.fill("#f-player_id", "5123456789");
  await page.getByRole("button", { name: "إرسال الطلب" }).click();
  const error = page.getByTestId("order-error");
  await expect(error).toHaveAttribute("data-reason", "sign_in");
  await expect(
    error.getByRole("link", { name: "تسجيل الدخول" }),
  ).toHaveAttribute(
    "href",
    `/ar/login?next=${encodeURIComponent("/ar/p/pubg-uc")}`,
  );
});
