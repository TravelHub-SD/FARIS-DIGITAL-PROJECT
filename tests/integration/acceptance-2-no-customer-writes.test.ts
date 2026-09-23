// ACCEPTANCE TEST 2 — a customer cannot modify kyc_status, any price column,
// or any order state through direct PostgREST calls with the anon key + their
// own JWT. Every case checks the database AFTER the attempt (service-role read),
// so a silently ignored write and an error are both judged by the real outcome.
import { randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import {
  anon,
  completeOrderWithInvoice,
  createKycSubmission,
  createOrder,
  createReceipt,
  createUser,
  firstBankAccountId,
  service,
  type TestUser,
  VARIANT_CHEAP,
} from "./helpers";

type Row = Record<string, unknown>;

async function read(table: string, id: string, key = "id"): Promise<Row> {
  const { data, error } = await service()
    .from(table)
    .select("*")
    .eq(key, id)
    .single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data;
}

let customer: TestUser;
// Profile attacks run on a separate account so a (pre-fix) successful attack
// cannot change the preconditions of the order/receipt tests.
let profileVictim: TestUser;
let order: Row;
let receipt: Row;
let kyc: Row;
let invoiceOrder: Row;
let invoice: Row;

beforeAll(async () => {
  customer = await createUser();
  profileVictim = await createUser();
  order = await createOrder(customer.id);
  receipt = await createReceipt(order as { id: string; user_id: string });
  kyc = await createKycSubmission(customer.id);
  invoiceOrder = await createOrder(customer.id);
  ({ invoice } = await completeOrderWithInvoice(
    invoiceOrder as { id: string; user_id: string },
  ));
});

describe("Acceptance 2: customer cannot modify protected state via PostgREST", () => {
  it("cannot set own kyc_status", async () => {
    const before = await read("profiles", profileVictim.id);
    const res = await profileVictim.client
      .from("profiles")
      .update({ kyc_status: "verified" })
      .eq("id", profileVictim.id)
      .select();
    expect(res.error?.code, JSON.stringify(res.error)).toBe("42501");
    expect((await read("profiles", profileVictim.id)).kyc_status).toBe(
      before.kyc_status,
    );
  });

  it("cannot unblock self or change own verified phone", async () => {
    const before = await read("profiles", profileVictim.id);
    const res = await profileVictim.client
      .from("profiles")
      .update({
        is_blocked: true,
        phone_e164: "+249900000000",
        phone_verified_at: null,
      })
      .eq("id", profileVictim.id);
    expect(res.error?.code).toBe("42501");
    const after = await read("profiles", profileVictim.id);
    for (const col of ["is_blocked", "phone_e164", "phone_verified_at"]) {
      expect(after[col], col).toEqual(before[col]);
    }
  });

  it("control: CAN update own full_name (the only customer-writable fields work)", async () => {
    const res = await profileVictim.client
      .from("profiles")
      .update({ full_name: "Renamed Customer" })
      .eq("id", profileVictim.id)
      .select();
    expect(res.error).toBeNull();
    expect((await read("profiles", profileVictim.id)).full_name).toBe(
      "Renamed Customer",
    );
  });

  it("cannot change a variant price", async () => {
    const before = await read("product_variants", VARIANT_CHEAP);
    await customer.client
      .from("product_variants")
      .update({ price_usd: 0.01 })
      .eq("id", VARIANT_CHEAP);
    expect((await read("product_variants", VARIANT_CHEAP)).price_usd).toBe(
      before.price_usd,
    );
  });

  it("cannot change the exchange rate or the KYC threshold", async () => {
    const before = await read("app_settings", "true");
    await customer.client
      .from("app_settings")
      .update({
        usd_sdg_rate: Number(before.usd_sdg_rate) + 7,
        kyc_threshold_usd: Number(before.kyc_threshold_usd) + 1000,
      })
      .eq("id", true);
    const after = await read("app_settings", "true");
    expect(after.usd_sdg_rate).toBe(before.usd_sdg_rate);
    expect(after.kyc_threshold_usd).toBe(before.kyc_threshold_usd);
  });

  it("anon (no login) cannot change the exchange rate either", async () => {
    const before = await read("app_settings", "true");
    await anon()
      .from("app_settings")
      .update({ usd_sdg_rate: Number(before.usd_sdg_rate) + 11 })
      .eq("id", true);
    expect((await read("app_settings", "true")).usd_sdg_rate).toBe(
      before.usd_sdg_rate,
    );
  });

  it("cannot insert an order with a chosen price", async () => {
    const key = randomUUID();
    const res = await customer.client.from("orders").insert({
      user_id: customer.id,
      variant_id: VARIANT_CHEAP,
      quantity: 1,
      idempotency_key: key,
      unit_price_usd: 0.01,
      total_usd: 0.01,
      usd_sdg_rate: 1,
      total_sdg: 1,
    });
    expect(res.error).not.toBeNull();
    const check = await service()
      .from("orders")
      .select("id")
      .eq("idempotency_key", key);
    expect(check.data).toEqual([]);
  });

  it("cannot change own order status, price or totals", async () => {
    const before = await read("orders", order.id as string);
    for (const patch of [
      { status: "cancelled" }, // a VALID transition: only the missing grant stops it
      { status: "completed" },
      { status: "processing" },
      { total_sdg: 1 },
      { unit_price_usd: 0.01, total_usd: 0.01 },
      { usd_sdg_rate: 1 },
    ]) {
      await customer.client.from("orders").update(patch).eq("id", order.id);
    }
    const after = await read("orders", order.id as string);
    for (const col of [
      "status",
      "total_sdg",
      "unit_price_usd",
      "total_usd",
      "usd_sdg_rate",
    ]) {
      expect(after[col], col).toEqual(before[col]);
    }
  });

  it("cannot delete own order", async () => {
    await customer.client.from("orders").delete().eq("id", order.id);
    expect((await read("orders", order.id as string)).id).toBe(order.id);
  });

  it("cannot change order state through the status RPC", async () => {
    const res = await customer.client.rpc("change_order_status", {
      p_order_id: order.id,
      p_to_status: "cancelled",
    });
    expect(res.error?.code).toBe("42501");
    expect((await read("orders", order.id as string)).status).toBe("new");
  });

  it("cannot forge status history", async () => {
    const res = await customer.client.from("order_status_history").insert({
      order_id: order.id,
      from_status: "new",
      to_status: "completed",
    });
    expect(res.error).not.toBeNull();
    const hist = await service()
      .from("order_status_history")
      .select("to_status")
      .eq("order_id", order.id);
    expect(hist.data?.map((h) => h.to_status)).toEqual(["new"]);
  });

  it("cannot accept own payment receipt or insert a pre-accepted one", async () => {
    await customer.client
      .from("payment_receipts")
      .update({ status: "accepted", reviewed_at: new Date().toISOString() })
      .eq("id", receipt.id);
    expect((await read("payment_receipts", receipt.id as string)).status).toBe(
      "pending",
    );

    const res = await customer.client.from("payment_receipts").insert({
      order_id: order.id,
      bank_account_id: await firstBankAccountId(),
      transaction_ref: "FAKE123",
      storage_path: "x.jpg",
      file_sha256: "0".repeat(64),
      status: "accepted",
    });
    expect(res.error).not.toBeNull();
  });

  it("cannot approve own KYC submission", async () => {
    await customer.client
      .from("kyc_submissions")
      .update({ status: "accepted", reviewed_at: new Date().toISOString() })
      .eq("id", kyc.id);
    expect((await read("kyc_submissions", kyc.id as string)).status).toBe(
      "pending",
    );
    expect((await read("profiles", customer.id)).kyc_status).toBe("none");
  });

  it("cannot change own invoice totals or void it", async () => {
    const before = await read("invoices", invoice.id as string);
    await customer.client
      .from("invoices")
      .update({ total_sdg: 1, total_usd: 0.01 })
      .eq("id", invoice.id);
    await customer.client
      .from("invoices")
      .update({ status: "void", void_reason: "x" })
      .eq("id", invoice.id);
    const after = await read("invoices", invoice.id as string);
    expect(after.total_sdg).toBe(before.total_sdg);
    expect(after.status).toBe("issued");
  });
});
