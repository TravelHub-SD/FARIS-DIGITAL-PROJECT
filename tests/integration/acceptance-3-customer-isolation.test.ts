// ACCEPTANCE TEST 3 — a customer cannot read another customer's orders,
// receipts, invoices or KYC records (rows AND files) through direct PostgREST /
// Storage calls with the anon key. Also covers the session-refresh concern:
// an expired, forged or tampered token reaches no protected data.
import { beforeAll, describe, expect, it } from "vitest";

import {
  anon,
  completeOrderWithInvoice,
  createKycSubmission,
  createOrder,
  createUser,
  customerClaims,
  service,
  signJwt,
  type TestUser,
  withToken,
} from "./helpers";

type Row = Record<string, unknown>;

let alice: TestUser;
let bob: TestUser;
let aliceOrder: Row;
let aliceReceipt: Row;
let aliceInvoice: Row;
let aliceKyc: Row;

beforeAll(async () => {
  alice = await createUser({ name: "Alice Customer" });
  bob = await createUser({ name: "Bob Customer" });
  aliceOrder = await createOrder(alice.id);
  const done = await completeOrderWithInvoice(
    aliceOrder as { id: string; user_id: string },
  );
  aliceReceipt = done.receipt;
  aliceInvoice = done.invoice;
  aliceKyc = await createKycSubmission(alice.id);

  // Admin-side data about Alice that must never leak to other customers.
  const sb = service();
  const note = await sb.from("order_internal_notes").insert({
    order_id: aliceOrder.id,
    author_id: alice.id, // any existing profile; service role bypasses the policy
    body: "internal: customer called twice",
  });
  if (note.error) throw new Error(note.error.message);
  const msg = await sb.from("message_logs").insert({
    phone_e164: "+249911111111",
    user_id: alice.id,
    message_type: "order_status",
    template_name: "order_status_update",
    order_id: aliceOrder.id,
  });
  if (msg.error) throw new Error(msg.error.message);
});

describe("Acceptance 3: customer data isolation via PostgREST", () => {
  const tables = [
    ["orders", "id", () => aliceOrder.id],
    ["payment_receipts", "id", () => aliceReceipt.id],
    ["invoices", "id", () => aliceInvoice.id],
    ["kyc_submissions", "id", () => aliceKyc.id],
    ["order_status_history", "order_id", () => aliceOrder.id],
    ["order_internal_notes", "order_id", () => aliceOrder.id],
    ["message_logs", "order_id", () => aliceOrder.id],
    ["profiles", "id", () => alice.id],
  ] as const;

  for (const [table, key, value] of tables) {
    it(`Bob cannot read Alice's ${table} (by id)`, async () => {
      const res = await bob.client
        .from(table)
        .select("*")
        .eq(key, value() as string);
      expect(res.data ?? [], JSON.stringify(res.error)).toEqual([]);
    });
  }

  it("Bob's unfiltered selects contain none of Alice's rows", async () => {
    for (const [table] of tables) {
      const res = await bob.client.from(table).select("*");
      const leaked = JSON.stringify(res.data ?? []).includes(alice.id);
      expect(leaked, `${table} leaked Alice's data`).toBe(false);
    }
  });

  it("anonymous visitor reads nothing from any customer table", async () => {
    for (const [table] of tables) {
      const res = await anon().from(table).select("*");
      expect(res.data ?? [], table).toEqual([]);
    }
  });

  it("control: Alice CAN read her own order, receipt, invoice and KYC record", async () => {
    for (const [table, id] of [
      ["orders", aliceOrder.id],
      ["payment_receipts", aliceReceipt.id],
      ["invoices", aliceInvoice.id],
      ["kyc_submissions", aliceKyc.id],
    ] as const) {
      const res = await alice.client
        .from(table)
        .select("id")
        .eq("id", id as string);
      expect(res.data, `${table}: ${JSON.stringify(res.error)}`).toHaveLength(
        1,
      );
    }
  });

  it("Alice cannot read internal notes about her own order", async () => {
    const res = await alice.client
      .from("order_internal_notes")
      .select("*")
      .eq("order_id", aliceOrder.id as string);
    expect(res.data ?? []).toEqual([]);
  });
});

describe("Acceptance 3: files in private buckets", () => {
  it("Bob cannot download Alice's receipt file", async () => {
    const res = await bob.client.storage
      .from("payment-receipts")
      .download(aliceReceipt.storage_path as string);
    expect(res.error).not.toBeNull();
    expect(res.data).toBeNull();
  });

  it("Bob cannot create a signed URL for Alice's receipt", async () => {
    const res = await bob.client.storage
      .from("payment-receipts")
      .createSignedUrl(aliceReceipt.storage_path as string, 60);
    expect(res.error).not.toBeNull();
  });

  it("Bob cannot list Alice's receipt folder", async () => {
    const res = await bob.client.storage
      .from("payment-receipts")
      .list(alice.id);
    expect(res.data ?? []).toEqual([]);
  });

  it("no customer (not even the owner of the document) can read KYC files", async () => {
    for (const who of [bob, alice]) {
      const res = await who.client.storage
        .from("kyc-documents")
        .download(aliceKyc.storage_path as string);
      expect(res.error).not.toBeNull();
      const signed = await who.client.storage
        .from("kyc-documents")
        .createSignedUrl(aliceKyc.storage_path as string, 60);
      expect(signed.error).not.toBeNull();
    }
  });

  it("customers cannot upload into private buckets", async () => {
    const body = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    for (const bucket of ["kyc-documents", "payment-receipts"]) {
      const res = await bob.client.storage
        .from(bucket)
        .upload(`${bob.id}/x.jpg`, body, { contentType: "image/jpeg" });
      expect(res.error, bucket).not.toBeNull();
    }
  });

  it("control: Alice CAN download her own receipt", async () => {
    const res = await alice.client.storage
      .from("payment-receipts")
      .download(aliceReceipt.storage_path as string);
    expect(res.error).toBeNull();
  });
});

describe("Acceptance 3: failed / forged sessions reach no protected data", () => {
  const secret = () => process.env.TEST_JWT_SECRET!;

  it("control: a correctly signed, unexpired token for Alice reads her order", async () => {
    const token = signJwt(customerClaims(alice.id, 300), secret());
    const res = await withToken(token)
      .from("orders")
      .select("id")
      .eq("id", aliceOrder.id as string);
    expect(res.data, JSON.stringify(res.error)).toHaveLength(1);
  });

  it("an EXPIRED token for Alice (what a failed refresh leaves behind) is rejected", async () => {
    const token = signJwt(customerClaims(alice.id, -60), secret());
    const res = await withToken(token).from("orders").select("id");
    expect(res.status).toBe(401);
    expect(res.data).toBeNull();
  });

  it("a token signed with the wrong secret is rejected", async () => {
    const token = signJwt(
      customerClaims(alice.id, 300),
      "not-the-real-secret-not-the-real-secret",
    );
    const res = await withToken(token).from("orders").select("id");
    expect(res.status).toBe(401);
    expect(res.data).toBeNull();
  });

  it("Bob's real token with its payload edited to Alice's id is rejected", async () => {
    const [head, , sig] = bob.accessToken.split(".");
    const payload = JSON.parse(
      Buffer.from(bob.accessToken.split(".")[1], "base64url").toString(),
    );
    payload.sub = alice.id;
    const tampered = `${head}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${sig}`;
    const res = await withToken(tampered).from("orders").select("id");
    expect(res.status).toBe(401);
    expect(res.data).toBeNull();
  });

  it("a garbage bearer token is rejected", async () => {
    const res = await withToken("garbage.token.value")
      .from("orders")
      .select("id");
    expect(res.status).toBe(401);
  });
});
