import { randomBytes, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  anon,
  CHEAP_FIELDS,
  createUser,
  service,
  sql,
  type TestUser,
  VARIANT_CHEAP,
} from "./helpers";

// Phase 5 demonstrations. Everything a customer does here goes through their
// own JWT and the public API (PostgREST/Storage), exactly like the browser or
// an attacker with curl would. Seed: rate 2600 SDG/USD, KYC threshold 100 USD.

const VARIANT_5_20 = "00000000-0000-4000-c000-000000000003"; // 5.20 USD, max 5, player_id
const VARIANT_STARLINK = "00000000-0000-4000-c000-000000000002"; // 120 USD, max 1
const STARLINK_FIELDS = { account_email: "buyer@example.com" };

type CreateResult = {
  status: "created" | "price_changed" | "error";
  id?: string;
  reference?: string;
  total_sdg?: number;
  reason?: string;
};

async function createOrder(
  client: SupabaseClient,
  args: {
    variant?: string;
    quantity?: number;
    fields?: Record<string, string>;
    expected: number | string | null;
    key?: string;
  },
): Promise<CreateResult> {
  const { data, error } = await client.rpc("create_order", {
    p_variant_id: args.variant ?? VARIANT_CHEAP,
    p_quantity: args.quantity ?? 1,
    p_fulfillment: args.fields ?? CHEAP_FIELDS,
    p_idempotency_key: args.key ?? randomUUID(),
    p_expected_total_sdg: args.expected,
  });
  if (error) throw new Error(`create_order: ${error.message}`);
  return data as CreateResult;
}

/** What the product page renders: the database's totals per quantity. */
async function pageTotals(variant: string): Promise<number[]> {
  const { data, error } = await anon()
    .from("product_variants")
    .select("price_sdg_totals")
    .eq("id", variant)
    .single();
  if (error) throw new Error(error.message);
  return (data.price_sdg_totals as string[]).map(Number);
}

const orderCount = (userId: string) =>
  Number(sql(`select count(*) from public.orders where user_id = '${userId}'`));

const settings = () =>
  sql(
    "select usd_sdg_rate || ',' || kyc_threshold_usd from public.app_settings",
  );
let savedSettings: string;
beforeAll(() => {
  savedSettings = settings();
});
afterEach(() => {
  const [rate, threshold] = savedSettings.split(",");
  sql(
    `update public.app_settings set usd_sdg_rate = ${rate}, kyc_threshold_usd = ${threshold}`,
  );
  sql(
    `update public.product_variants set price_usd = 1.10 where id = '${VARIANT_CHEAP}'`,
  );
});

describe("server-side pricing: an order is only ever created at the database's price", () => {
  let buyer: TestUser;
  beforeAll(async () => {
    buyer = await createUser();
  });

  it("control: the page total is accepted and snapshotted", async () => {
    const [one, , three] = await pageTotals(VARIANT_CHEAP);
    expect(one).toBe(2860); // ceil(1.10 * 2600)
    expect(three).toBe(8580); // ceil(1.10 * 3 * 2600); 1.1*3*2600 in JS floats is 8580.000000000001
    const res = await createOrder(buyer.client, {
      quantity: 3,
      expected: three,
    });
    expect(res.status).toBe("created");
    expect(res.reference).toMatch(/^FD-\d{7}$/);
    const { data: order } = await buyer.client
      .from("orders")
      .select("unit_price_usd, total_usd, usd_sdg_rate, total_sdg, quantity")
      .eq("id", res.id!)
      .single();
    expect(order).toEqual({
      unit_price_usd: 1.1,
      total_usd: 3.3,
      usd_sdg_rate: 2600,
      total_sdg: 8580,
      quantity: 3,
    });
  });

  it("forged price: a lower total is refused with the real one, and no order exists", async () => {
    const before = orderCount(buyer.id);
    for (const forged of [1, 0, -2860, 2859, 2861, "2860.5", null]) {
      const res = await createOrder(buyer.client, { expected: forged });
      expect(res).toEqual({ status: "price_changed", total_sdg: 2860 });
    }
    expect(orderCount(buyer.id)).toBe(before);
  });

  it("forged price: writing the order row directly is not possible for a customer", async () => {
    const { error } = await buyer.client.from("orders").insert({
      user_id: buyer.id,
      variant_id: VARIANT_CHEAP,
      quantity: 1,
      unit_price_usd: 0.01,
      total_usd: 0.01,
      usd_sdg_rate: 1,
      total_sdg: 1,
      kyc_required: false,
      idempotency_key: randomUUID(),
      fulfillment_data: CHEAP_FIELDS,
    });
    expect(error?.message).toMatch(/permission denied/);
  });

  it("stale price from a cached page: the rate changed after the page was rendered", async () => {
    const cached = (await pageTotals(VARIANT_CHEAP))[0]; // 2860
    sql("update public.app_settings set usd_sdg_rate = 2700");
    const before = orderCount(buyer.id);

    const stale = await createOrder(buyer.client, { expected: cached });
    expect(stale).toEqual({ status: "price_changed", total_sdg: 2970 });
    expect(orderCount(buyer.id)).toBe(before);

    // The customer confirms the new total: created at the new rate.
    const confirmed = await createOrder(buyer.client, { expected: 2970 });
    expect(confirmed.status).toBe("created");
    expect(
      sql(
        `select usd_sdg_rate::int || '/' || total_sdg::int from public.orders where id = '${confirmed.id}'`,
      ),
    ).toBe("2700/2970");
  });

  it("stale price from a cached page: the USD price changed after the page was rendered", async () => {
    const cached = (await pageTotals(VARIANT_CHEAP))[1]; // qty 2: 5720
    sql(
      `update public.product_variants set price_usd = 1.25 where id = '${VARIANT_CHEAP}'`,
    );
    const res = await createOrder(buyer.client, {
      quantity: 2,
      expected: cached,
    });
    expect(res).toEqual({ status: "price_changed", total_sdg: 6500 }); // ceil(1.25*2*2600)
  });

  it("stale price: a rate change between the check and the insert is caught by the snapshot comparison", async () => {
    // Planted race: a trigger that fires before the pricing trigger and moves
    // the rate, i.e. the owner saving a new rate at the worst possible moment.
    sql(`
      create function public.test_bump_rate() returns trigger language plpgsql as $$
      begin update public.app_settings set usd_sdg_rate = 2800 where id; return new; end $$;
      create trigger aaa_test_bump_rate before insert on public.orders
        for each row execute function public.test_bump_rate();`);
    try {
      const before = orderCount(buyer.id);
      const res = await createOrder(buyer.client, { expected: 2860 });
      // Refused and rolled back. The planted rate change ran inside the same
      // transaction, so it is rolled back too and the reported total is the
      // original one; a real owner update is its own transaction and stays.
      expect(res.status).toBe("price_changed");
      expect(orderCount(buyer.id)).toBe(before);
    } finally {
      sql(`drop trigger aaa_test_bump_rate on public.orders;
           drop function public.test_bump_rate();`);
    }
  });

  it("variant swapped after the form was rendered: the total shown for one variant never buys another", async () => {
    const cheap = (await pageTotals(VARIANT_CHEAP))[0]; // 2860
    const dear = (await pageTotals(VARIANT_5_20))[0]; // 13520
    const before = orderCount(buyer.id);

    // Expensive variant at the cheap variant's price: refused.
    expect(
      await createOrder(buyer.client, {
        variant: VARIANT_5_20,
        expected: cheap,
      }),
    ).toEqual({ status: "price_changed", total_sdg: 13520 });
    // And the reverse: never overcharged either.
    expect(
      await createOrder(buyer.client, {
        variant: VARIANT_CHEAP,
        expected: dear,
      }),
    ).toEqual({ status: "price_changed", total_sdg: 2860 });
    expect(orderCount(buyer.id)).toBe(before);
  });

  it("quantity tampering: out-of-range quantities are refused before pricing", async () => {
    for (const quantity of [0, -1, 11, 32768, 100000]) {
      const res = await createOrder(buyer.client, {
        quantity,
        expected: 2860 * quantity,
      });
      expect(res).toEqual({ status: "error", reason: "invalid_quantity" });
    }
    // Starlink allows 1: a quantity of 2 at the matching total is refused by the trigger.
    await setKyc(buyer.id, "verified");
    const res = await createOrder(buyer.client, {
      variant: VARIANT_STARLINK,
      quantity: 2,
      fields: STARLINK_FIELDS,
      expected: 624000,
    });
    expect(res).toEqual({ status: "error", reason: "invalid_quantity" });
    await setKyc(buyer.id, "none");
  });

  it("idempotency: the same submission twice returns the same order", async () => {
    const key = randomUUID();
    const before = orderCount(buyer.id);
    const [a, b] = await Promise.all([
      createOrder(buyer.client, { expected: 2860, key }),
      createOrder(buyer.client, { expected: 2860, key }),
    ]);
    const c = await createOrder(buyer.client, { expected: 1, key });
    expect(a.status).toBe("created");
    expect(b.id).toBe(a.id);
    expect(c.id).toBe(a.id);
    expect(orderCount(buyer.id)).toBe(before + 1);
  });

  it("the price arguments cannot be smuggled in: the RPC has no such parameters", async () => {
    const { error } = await buyer.client.rpc("create_order", {
      p_variant_id: VARIANT_CHEAP,
      p_quantity: 1,
      p_fulfillment: CHEAP_FIELDS,
      p_idempotency_key: randomUUID(),
      p_expected_total_sdg: 1,
      p_total_sdg: 1,
    });
    expect(error?.code).toBe("PGRST202"); // no function with that signature
  });

  it("rate limit: at most 10 orders per customer per hour", async () => {
    const spammer = await createUser();
    for (let i = 0; i < 10; i++) {
      expect(
        (await createOrder(spammer.client, { expected: 2860 })).status,
      ).toBe("created");
    }
    expect(await createOrder(spammer.client, { expected: 2860 })).toEqual({
      status: "error",
      reason: "rate_limited",
    });
  });

  it("anon cannot create orders", async () => {
    const { error } = await anon().rpc("create_order", {
      p_variant_id: VARIANT_CHEAP,
      p_quantity: 1,
      p_fulfillment: CHEAP_FIELDS,
      p_idempotency_key: randomUUID(),
      p_expected_total_sdg: 2860,
    });
    expect(error?.message).toMatch(/permission denied/);
  });
});

async function setKyc(userId: string, status: "none" | "verified") {
  sql(
    `update public.profiles set kyc_status = '${status}' where id = '${userId}'`,
  );
}

describe("KYC threshold is enforced by the database at order time", () => {
  let unverified: TestUser;
  let verified: TestUser;
  beforeAll(async () => {
    unverified = await createUser();
    verified = await createUser();
    await setKyc(verified.id, "verified");
  });

  it("an unverified customer cannot order above the threshold through the RPC", async () => {
    const [total] = await pageTotals(VARIANT_STARLINK); // 120 USD → 312000
    const res = await createOrder(unverified.client, {
      variant: VARIANT_STARLINK,
      fields: STARLINK_FIELDS,
      expected: total,
    });
    expect(res).toEqual({ status: "error", reason: "kyc_required" });
    expect(orderCount(unverified.id)).toBe(0);
  });

  it("…nor through a direct insert, even with the service role", async () => {
    const direct = await unverified.client.from("orders").insert({
      user_id: unverified.id,
      variant_id: VARIANT_STARLINK,
      quantity: 1,
      idempotency_key: randomUUID(),
      fulfillment_data: STARLINK_FIELDS,
      kyc_required: false,
    });
    expect(direct.error?.message).toMatch(/permission denied/);

    const svc = await service().from("orders").insert({
      user_id: unverified.id,
      variant_id: VARIANT_STARLINK,
      quantity: 1,
      idempotency_key: randomUUID(),
      fulfillment_data: STARLINK_FIELDS,
      kyc_required: false,
    });
    expect(svc.error?.message).toBe("KYC_REQUIRED");
    expect(orderCount(unverified.id)).toBe(0);
  });

  it("…nor by crossing the threshold with quantity", async () => {
    sql("update public.app_settings set kyc_threshold_usd = 20");
    const totals = await pageTotals(VARIANT_5_20);
    // 3 × 5.20 = 15.60 USD: allowed. 4 × 5.20 = 20.80 USD: needs KYC.
    expect(
      (
        await createOrder(unverified.client, {
          variant: VARIANT_5_20,
          quantity: 3,
          expected: totals[2],
        })
      ).status,
    ).toBe("created");
    expect(
      await createOrder(unverified.client, {
        variant: VARIANT_5_20,
        quantity: 4,
        expected: totals[3],
      }),
    ).toEqual({ status: "error", reason: "kyc_required" });
  });

  it("the threshold is read from settings at order time, not from the page", async () => {
    // The page was rendered while 1.10 USD was far below the threshold…
    const [total] = await pageTotals(VARIANT_CHEAP);
    // …then the owner lowered the threshold.
    sql("update public.app_settings set kyc_threshold_usd = 1.00");
    expect(await createOrder(unverified.client, { expected: total })).toEqual({
      status: "error",
      reason: "kyc_required",
    });
    // Raised again: the same request goes through. Nothing in the request changed.
    sql("update public.app_settings set kyc_threshold_usd = 100");
    expect(
      (await createOrder(unverified.client, { expected: total })).status,
    ).toBe("created");
  });

  it("control: a verified customer can order above the threshold; the snapshot records it", async () => {
    const [total] = await pageTotals(VARIANT_STARLINK);
    const res = await createOrder(verified.client, {
      variant: VARIANT_STARLINK,
      fields: STARLINK_FIELDS,
      expected: total,
    });
    expect(res.status).toBe("created");
    expect(
      sql(`select kyc_required from public.orders where id = '${res.id}'`),
    ).toBe("t");
  });
});

// ---------------------------------------------------------------- receipts

const RUN = randomBytes(3).toString("hex").toUpperCase(); // unique transaction numbers per run

const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9,
]);

/** What submitReceipt() does on the server: service-role upload with the hash in metadata. */
async function serverUpload(
  userId: string,
  orderId: string,
  sha256: string | null = randomBytes(32).toString("hex"),
) {
  const path = `${userId}/${orderId}/${randomUUID()}.jpg`;
  const { error } = await service()
    .storage.from("payment-receipts")
    .upload(path, JPEG, {
      contentType: "image/jpeg",
      ...(sha256 ? { metadata: { sha256 } } : {}),
    });
  if (error) throw new Error(`upload: ${error.message}`);
  return { path, sha256 };
}

async function banks() {
  const { data } = await anon()
    .from("bank_accounts")
    .select("id")
    .order("sort_order");
  return data!.map((b) => b.id as string);
}

async function submit(
  client: SupabaseClient,
  args: { order: string; bank: string; ref: string; path: string },
) {
  return client.rpc("submit_receipt", {
    p_order_id: args.order,
    p_bank_account_id: args.bank,
    p_transaction_ref: args.ref,
    p_storage_path: args.path,
  });
}

async function newOrder(user: TestUser) {
  const res = await createOrder(user.client, { expected: 2860 });
  if (res.status !== "created") throw new Error(JSON.stringify(res));
  return res.id!;
}

describe("transfer receipts: the same transaction number or receipt file cannot be used twice", () => {
  let alice: TestUser;
  let bob: TestUser;
  let staff: TestUser;
  let bankA: string;
  let bankB: string;
  beforeAll(async () => {
    alice = await createUser();
    bob = await createUser();
    staff = await createUser({ admin: { permissions: ["orders"] } });
    [bankA, bankB] = await banks();
  });

  it("control: a receipt is registered with the hash the server stored, not one the caller sends", async () => {
    const order = await newOrder(alice);
    const file = await serverUpload(alice.id, order);
    const { data, error } = await submit(alice.client, {
      order,
      bank: bankA,
      ref: ` 1234-5678-${RUN} `,
      path: file.path,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({
      status: "pending",
      user_id: alice.id,
      file_sha256: file.sha256,
      transaction_ref: `1234-5678-${RUN}`,
      transaction_ref_norm: `12345678${RUN}`,
    });
  });

  it("the same transaction number on another order (another customer) is refused, however it is written", async () => {
    const orderA = await newOrder(alice);
    const first = await submit(alice.client, {
      order: orderA,
      bank: bankA,
      ref: `TX-900100-${RUN}`,
      path: (await serverUpload(alice.id, orderA)).path,
    });
    expect(first.error).toBeNull();

    for (const ref of [
      `TX-900100-${RUN}`,
      `tx900100${RUN.toLowerCase()}`,
      ` tx 900 100 ${RUN} `,
      `Tx-900-100-${RUN}`,
    ]) {
      const orderB = await newOrder(bob);
      const dup = await submit(bob.client, {
        order: orderB,
        bank: bankA,
        ref,
        path: (await serverUpload(bob.id, orderB)).path,
      });
      expect(dup.error?.message).toBe("DUPLICATE_TRANSACTION");
    }
  });

  it("the same receipt file on another order is refused", async () => {
    const sha = randomBytes(32).toString("hex");
    const orderA = await newOrder(alice);
    expect(
      (
        await submit(alice.client, {
          order: orderA,
          bank: bankA,
          ref: `A${Date.now()}`,
          path: (await serverUpload(alice.id, orderA, sha)).path,
        })
      ).error,
    ).toBeNull();

    const orderB = await newOrder(bob);
    const dup = await submit(bob.client, {
      order: orderB,
      bank: bankA,
      ref: `B${Date.now()}`,
      path: (await serverUpload(bob.id, orderB, sha)).path,
    });
    expect(dup.error?.message).toBe("DUPLICATE_RECEIPT_FILE");
  });

  it("concurrent submissions of one transaction number: exactly one wins (unique index)", async () => {
    const ref = `RACE${Date.now()}`;
    const orders = await Promise.all([newOrder(alice), newOrder(bob)]);
    const files = await Promise.all([
      serverUpload(alice.id, orders[0]),
      serverUpload(bob.id, orders[1]),
    ]);
    const results = await Promise.all([
      submit(alice.client, {
        order: orders[0],
        bank: bankA,
        ref,
        path: files[0].path,
      }),
      submit(bob.client, {
        order: orders[1],
        bank: bankA,
        ref,
        path: files[1].path,
      }),
    ]);
    const ok = results.filter((r) => !r.error);
    const failed = results.filter((r) => r.error);
    expect(ok).toHaveLength(1);
    expect(failed.map((r) => r.error!.message)).toEqual([
      "DUPLICATE_TRANSACTION",
    ]);
  });

  it("the same number at a different bank is a different transaction (decisions.md)", async () => {
    const ref = `XB${Date.now()}`;
    const o1 = await newOrder(alice);
    const o2 = await newOrder(bob);
    expect(
      (
        await submit(alice.client, {
          order: o1,
          bank: bankA,
          ref,
          path: (await serverUpload(alice.id, o1)).path,
        })
      ).error,
    ).toBeNull();
    expect(
      (
        await submit(bob.client, {
          order: o2,
          bank: bankB,
          ref,
          path: (await serverUpload(bob.id, o2)).path,
        })
      ).error,
    ).toBeNull();
  });

  it("after a rejection the customer can resubmit the corrected receipt; a second live one is refused", async () => {
    const order = await newOrder(alice);
    const ref = `RJ${Date.now()}`;
    const first = await submit(alice.client, {
      order,
      bank: bankA,
      ref,
      path: (await serverUpload(alice.id, order)).path,
    });
    const second = await submit(alice.client, {
      order,
      bank: bankA,
      ref: `${ref}9`,
      path: (await serverUpload(alice.id, order)).path,
    });
    expect(second.error?.message).toBe("RECEIPT_ALREADY_PENDING");

    const rejected = await staff.client.rpc("review_receipt", {
      p_receipt_id: first.data.id,
      p_accept: false,
      p_reason: "Amount does not match",
    });
    expect(rejected.error).toBeNull();
    const again = await submit(alice.client, {
      order,
      bank: bankA,
      ref,
      path: (await serverUpload(alice.id, order)).path,
    });
    expect(again.error).toBeNull();
  });

  it("files the server did not store cannot be registered", async () => {
    const order = await newOrder(alice);
    const base = { order, bank: bankA, ref: `F${Date.now()}` };

    // No hash in the object's metadata (not uploaded by the ingest pipeline).
    const noHash = await serverUpload(alice.id, order, null);
    expect(
      (await submit(alice.client, { ...base, path: noHash.path })).error
        ?.message,
    ).toBe("RECEIPT_FILE_INVALID");
    // A path that does not exist.
    expect(
      (
        await submit(alice.client, {
          ...base,
          path: `${alice.id}/${order}/${randomUUID()}.jpg`,
        })
      ).error?.message,
    ).toBe("RECEIPT_FILE_NOT_FOUND");
    // Someone else's file / folder.
    const bobOrder = await newOrder(bob);
    const bobFile = await serverUpload(bob.id, bobOrder);
    expect(
      (await submit(alice.client, { ...base, path: bobFile.path })).error
        ?.message,
    ).toBe("RECEIPT_INVALID_PATH");
    // Customers cannot write to the bucket themselves.
    const direct = await alice.client.storage
      .from("payment-receipts")
      .upload(`${alice.id}/${order}/${randomUUID()}.jpg`, JPEG, {
        contentType: "image/jpeg",
        metadata: { sha256: "0".repeat(64) },
      });
    expect(direct.error).not.toBeNull();
    // Nor insert receipt rows directly.
    const row = await alice.client.from("payment_receipts").insert({
      order_id: order,
      bank_account_id: bankA,
      transaction_ref: "DIRECT1",
      storage_path: noHash.path,
      file_sha256: "0".repeat(64),
    });
    expect(row.error?.message).toMatch(/permission denied/);
  });

  it("transaction numbers are validated; inactive bank accounts are refused", async () => {
    const order = await newOrder(alice);
    for (const ref of ["", "ab", "!!!!", "x".repeat(41), "1234;drop"]) {
      const res = await submit(alice.client, {
        order,
        bank: bankA,
        ref,
        path: (await serverUpload(alice.id, order)).path,
      });
      expect(res.error?.message).toBe("TRANSACTION_REF_INVALID");
    }
    const res = await submit(alice.client, {
      order,
      bank: randomUUID(),
      ref: "VALID123",
      path: (await serverUpload(alice.id, order)).path,
    });
    expect(res.error?.message).toBe("BANK_ACCOUNT_INVALID");
  });
});

// ------------------------------------------------------ transitions + audit

type AuditRow = {
  actor_id: string | null;
  action: string;
  entity_id: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
};

function audit(entityId: string): AuditRow[] {
  const out = sql(
    `select coalesce(json_agg(a order by a.id), '[]') from (select actor_id, action, entity_id, old_data, new_data, id from public.audit_logs where entity_id = '${entityId}') a`,
  );
  return JSON.parse(out) as AuditRow[];
}

describe("order status transitions: only valid ones, each audited with its actor", () => {
  let customer: TestUser;
  let staff: TestUser;
  let kycOnly: TestUser;
  let bank: string;
  beforeAll(async () => {
    customer = await createUser();
    staff = await createUser({ admin: { permissions: ["orders"] } });
    kycOnly = await createUser({ admin: { permissions: ["kyc"] } });
    [bank] = await banks();
  });

  const change = (who: TestUser, order: string, to: string) =>
    who.client.rpc("change_order_status", {
      p_order_id: order,
      p_to_status: to,
    });

  // A fresh customer per paid order keeps each under the 10-orders/hour limit.
  async function paidOrder() {
    const buyer = await createUser();
    const order = await newOrder(buyer);
    const file = await serverUpload(buyer.id, order);
    const receipt = await submit(buyer.client, {
      order,
      bank,
      ref: `P${randomBytes(8).toString("hex")}`,
      path: file.path,
    });
    if (receipt.error) throw new Error(receipt.error.message);
    return { order, receipt: receipt.data.id as string, buyer };
  }

  it("creation is audited with the customer as the actor", async () => {
    const order = await newOrder(customer);
    const rows = audit(order);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "orders.insert",
      actor_id: customer.id,
      new_data: { status: "new", total_sdg: 2860 },
    });
    expect(rows[0].new_data).not.toHaveProperty("fulfillment_data");
  });

  it("full matrix: every (from → to) pair is tried; only the four allowed ones succeed", async () => {
    const statuses = ["new", "processing", "completed", "cancelled"];
    const allowed = new Set([
      "new>processing",
      "new>cancelled",
      "processing>completed",
      "processing>cancelled",
    ]);
    // Reach each starting status through valid steps, then try every target.
    const reach = async (from: string) => {
      const { order, receipt } = await paidOrder();
      if (from === "new") return order;
      const acc = await staff.client.rpc("review_receipt", {
        p_receipt_id: receipt,
        p_accept: true,
      });
      if (acc.error) throw new Error(acc.error.message); // → processing
      if (from === "completed" || from === "cancelled") {
        const r = await change(staff, order, from);
        if (r.error) throw new Error(r.error.message);
      }
      return order;
    };
    const results: string[] = [];
    for (const from of statuses) {
      for (const to of statuses) {
        if (from === to) continue;
        const order = await reach(from);
        if (from === "new" && to === "processing") {
          // Allowed, but only with an accepted payment (the receipt is still pending).
          const noPay = await change(staff, order, "processing");
          expect(noPay.error?.message).toBe("PAYMENT_NOT_ACCEPTED");
          // Accept it without review_receipt (which would move the order itself).
          sql(
            `update public.payment_receipts set status = 'accepted', reviewed_at = now() where order_id = '${order}'`,
          );
        }
        const res = await change(staff, order, to);
        const ok = !res.error;
        results.push(`${from}>${to}: ${ok ? "ok" : res.error!.message}`);
        expect(ok).toBe(allowed.has(`${from}>${to}`));
        if (!ok)
          expect(res.error!.message).toBe(
            `INVALID_STATUS_TRANSITION: ${from} -> ${to}`,
          );
        if (ok) {
          const last = audit(order)
            .filter((a) => a.action === "orders.update")
            .at(-1)!;
          expect(last.actor_id).toBe(staff.id);
          expect(last.old_data).toMatchObject({ status: from });
          expect(last.new_data).toMatchObject({ status: to });
          expect(
            sql(
              `select changed_by from public.order_status_history where order_id = '${order}' and to_status = '${to}'`,
            ),
          ).toBe(staff.id);
        }
      }
    }
    console.log(results.join("\n"));
  }, 120_000);

  it("accepting a receipt moves the order to processing; both are audited with the reviewer", async () => {
    const { order, receipt, buyer } = await paidOrder();
    const res = await staff.client.rpc("review_receipt", {
      p_receipt_id: receipt,
      p_accept: true,
    });
    expect(res.error).toBeNull();
    expect(sql(`select status from public.orders where id = '${order}'`)).toBe(
      "processing",
    );
    const receiptAudit = audit(receipt);
    expect(receiptAudit.map((a) => [a.action, a.actor_id])).toEqual([
      ["payment_receipts.insert", buyer.id],
      ["payment_receipts.update", staff.id],
    ]);
    const orderAudit = audit(order);
    expect(
      orderAudit.map((a) => [a.action, a.actor_id, a.new_data?.status]),
    ).toEqual([
      ["orders.insert", buyer.id, "new"],
      ["orders.update", staff.id, "processing"],
    ]);
  });

  it("customers and staff without the orders permission cannot change status or review receipts", async () => {
    const { order, receipt, buyer } = await paidOrder();
    for (const who of [buyer, customer, kycOnly]) {
      expect((await change(who, order, "cancelled")).error?.message).toBe(
        "FORBIDDEN",
      );
      expect(
        (
          await who.client.rpc("review_receipt", {
            p_receipt_id: receipt,
            p_accept: true,
          })
        ).error?.message,
      ).toBe("FORBIDDEN");
      const direct = await who.client
        .from("orders")
        .update({ status: "cancelled" })
        .eq("id", order);
      expect(direct.error?.message).toMatch(/permission denied/);
    }
    expect(sql(`select status from public.orders where id = '${order}'`)).toBe(
      "new",
    );
  });

  it("staff cannot accept the payment on their own order", async () => {
    const order = await newOrder(staff);
    const file = await serverUpload(staff.id, order);
    const receipt = await submit(staff.client, {
      order,
      bank,
      ref: `OWN${Date.now()}`,
      path: file.path,
    });
    expect(receipt.error).toBeNull();
    const res = await staff.client.rpc("review_receipt", {
      p_receipt_id: receipt.data.id,
      p_accept: true,
    });
    expect(res.error?.message).toBe("RECEIPT_CANNOT_REVIEW_OWN");
  });

  it("a receipt cannot be submitted once the order is no longer waiting for payment", async () => {
    const order = await newOrder(customer);
    expect((await change(staff, order, "cancelled")).error).toBeNull();
    const file = await serverUpload(customer.id, order);
    const res = await submit(customer.client, {
      order,
      bank,
      ref: `CX${Date.now()}`,
      path: file.path,
    });
    expect(res.error?.message).toBe("ORDER_NOT_AWAITING_PAYMENT");
  });
});

// ------------------------------------------------------------- isolation

describe("customer isolation: orders, receipts and references cannot be reached by guessing", () => {
  let alice: TestUser;
  let mallory: TestUser;
  let aliceOrder: { id: string; reference: string };
  let aliceFile: string;
  beforeAll(async () => {
    alice = await createUser();
    mallory = await createUser();
    const res = await createOrder(alice.client, { expected: 2860 });
    aliceOrder = { id: res.id!, reference: res.reference! };
    aliceFile = (await serverUpload(alice.id, aliceOrder.id)).path;
    const [bank] = await banks();
    const r = await submit(alice.client, {
      order: aliceOrder.id,
      bank,
      ref: `ISO${Date.now()}`,
      path: aliceFile,
    });
    if (r.error) throw new Error(r.error.message);
  });

  it("by id and by reference: nothing comes back", async () => {
    const c = mallory.client;
    expect(
      (await c.from("orders").select("id").eq("id", aliceOrder.id)).data,
    ).toEqual([]);
    expect(
      (
        await c
          .from("orders")
          .select("id")
          .eq("reference", aliceOrder.reference)
      ).data,
    ).toEqual([]);
    expect(
      (await c.from("orders").select("reference").like("reference", "FD-%"))
        .data,
    ).toEqual([]);
    expect(
      (
        await c
          .from("payment_receipts")
          .select("id")
          .eq("order_id", aliceOrder.id)
      ).data,
    ).toEqual([]);
    expect(
      (
        await c
          .from("order_status_history")
          .select("id")
          .eq("order_id", aliceOrder.id)
      ).data,
    ).toEqual([]);
    expect(
      (
        await anon()
          .from("orders")
          .select("id")
          .eq("reference", aliceOrder.reference)
      ).data ?? [],
    ).toEqual([]);
  });

  it("the receipt file cannot be downloaded or signed", async () => {
    const bucket = mallory.client.storage.from("payment-receipts");
    expect((await bucket.download(aliceFile)).error).not.toBeNull();
    expect((await bucket.createSignedUrl(aliceFile, 60)).error).not.toBeNull();
    expect((await bucket.list(alice.id)).data ?? []).toEqual([]);
    // Control: the owner can.
    expect(
      (await alice.client.storage.from("payment-receipts").download(aliceFile))
        .error,
    ).toBeNull();
  });

  it("RPCs do not reveal that someone else's order exists", async () => {
    const [bank] = await banks();
    const other = await submit(mallory.client, {
      order: aliceOrder.id,
      bank,
      ref: "GUESS1234",
      path: `${mallory.id}/${aliceOrder.id}/${randomUUID()}.jpg`,
    });
    const missing = await submit(mallory.client, {
      order: randomUUID(),
      bank,
      ref: "GUESS1234",
      path: `${mallory.id}/${randomUUID()}/${randomUUID()}.jpg`,
    });
    expect(other.error?.message).toBe("ORDER_NOT_FOUND");
    expect(missing.error?.message).toBe(other.error?.message);
  });
});

// ------------------------------------------------------ sensitive purge

describe("sensitive fulfillment fields are purged when the order closes", () => {
  let customer: TestUser;
  let staff: TestUser;
  let variantId: string;
  beforeAll(async () => {
    customer = await createUser();
    staff = await createUser({ admin: { permissions: ["orders"] } });
    const t = randomBytes(4).toString("hex");
    const db = service();
    const cat = await db
      .from("categories")
      .insert({ slug: `sens-${t}`, name_en: "Sensitive" })
      .select("id")
      .single();
    const prod = await db
      .from("products")
      .insert({
        slug: `sens-${t}`,
        category_id: cat.data!.id,
        name_en: "Account top-up",
      })
      .select("id")
      .single();
    const variant = await db
      .from("product_variants")
      .insert({
        product_id: prod.data!.id,
        name_en: "Basic",
        price_usd: 1,
        required_fields: [
          { key: "email", type: "email", label_en: "Email", required: true },
          {
            key: "password",
            type: "text",
            label_en: "Password",
            required: true,
            sensitive: true,
          },
        ],
      })
      .select("id")
      .single();
    if (variant.error) throw new Error(variant.error.message);
    variantId = variant.data.id;
  });

  it("the password is removed on cancellation; the email stays; the audit never held either", async () => {
    const res = await createOrder(customer.client, {
      variant: variantId,
      fields: { email: "a@example.com", password: "hunter22" },
      expected: 2600,
    });
    expect(res.status).toBe("created");
    const read = () =>
      sql(
        `select fulfillment_data::text from public.orders where id = '${res.id}'`,
      );
    expect(JSON.parse(read())).toEqual({
      email: "a@example.com",
      password: "hunter22",
    });

    expect(
      (
        await staff.client.rpc("change_order_status", {
          p_order_id: res.id,
          p_to_status: "cancelled",
        })
      ).error,
    ).toBeNull();
    expect(JSON.parse(read())).toEqual({ email: "a@example.com" });
    expect(JSON.stringify(audit(res.id!))).not.toContain("hunter22");
  });
});

afterAll(() => {
  const [rate, threshold] = savedSettings.split(",");
  sql(
    `update public.app_settings set usd_sdg_rate = ${rate}, kyc_threshold_usd = ${threshold}`,
  );
});
