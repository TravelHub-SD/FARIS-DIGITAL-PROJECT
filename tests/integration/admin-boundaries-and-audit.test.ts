// Admin permission boundaries and the append-only audit log, via PostgREST.
import { beforeAll, describe, expect, it } from "vitest";

import {
  createKycSubmission,
  createOrder,
  createUser,
  ownerUser,
  service,
  type TestUser,
  VARIANT_CHEAP,
} from "./helpers";

type Row = Record<string, unknown>;

let owner: TestUser;
let ordersAdmin: TestUser;
let customer: TestUser;
let order: Row;

beforeAll(async () => {
  // Needs a fresh database (the owner is unique and cannot be deleted):
  // `npm run test:integration` runs `supabase db reset` first.
  owner = await ownerUser();
  ordersAdmin = await createUser({ admin: { permissions: ["orders"] } });
  customer = await createUser();
  order = await createOrder(customer.id);
  await createKycSubmission(customer.id);
});

describe("Admin permission boundaries", () => {
  it("orders admin CAN read every customer's orders", async () => {
    const res = await ordersAdmin.client
      .from("orders")
      .select("id")
      .eq("id", order.id as string);
    expect(res.data).toHaveLength(1);
  });

  it("orders admin cannot read KYC submissions", async () => {
    const res = await ordersAdmin.client
      .from("kyc_submissions")
      .select("*")
      .eq("user_id", customer.id);
    expect(res.data ?? []).toEqual([]);
  });

  it("orders admin cannot change a price", async () => {
    const before = (
      await service()
        .from("product_variants")
        .select("price_usd")
        .eq("id", VARIANT_CHEAP)
        .single()
    ).data!;
    await ordersAdmin.client
      .from("product_variants")
      .update({ price_usd: 0.5 })
      .eq("id", VARIANT_CHEAP);
    const after = (
      await service()
        .from("product_variants")
        .select("price_usd")
        .eq("id", VARIANT_CHEAP)
        .single()
    ).data!;
    expect(after.price_usd).toBe(before.price_usd);
  });

  it("orders admin cannot grant itself another permission or create admins", async () => {
    const grant = await ordersAdmin.client
      .from("admin_permissions")
      .insert({ admin_id: ordersAdmin.id, permission: "kyc" });
    expect(grant.error).not.toBeNull();
    const makeAdmin = await ordersAdmin.client
      .from("admins")
      .insert({ user_id: customer.id });
    expect(makeAdmin.error).not.toBeNull();
    const perms = await service()
      .from("admin_permissions")
      .select("permission")
      .eq("admin_id", ordersAdmin.id);
    expect(perms.data?.map((p) => p.permission)).toEqual(["orders"]);
  });

  it("orders admin cannot read security settings or the audit log", async () => {
    expect(
      (await ordersAdmin.client.from("security_settings").select("*")).data ??
        [],
    ).toEqual([]);
    expect(
      (await ordersAdmin.client.from("audit_logs").select("*")).data ?? [],
    ).toEqual([]);
  });

  it("orders admin CAN cancel an order via the RPC, and it is audited with the admin as actor", async () => {
    const res = await ordersAdmin.client.rpc("change_order_status", {
      p_order_id: order.id,
      p_to_status: "cancelled",
      p_customer_note: "Out of stock",
    });
    expect(res.error, JSON.stringify(res.error)).toBeNull();
    const audit = await service()
      .from("audit_logs")
      .select("actor_id, action, old_data, new_data")
      .eq("entity_id", order.id as string)
      .eq("action", "orders.update");
    expect(audit.data?.[0]).toMatchObject({
      actor_id: ordersAdmin.id,
      old_data: { status: "new" },
      new_data: { status: "cancelled" },
    });
  });

  it("an invalid transition is refused even for an orders admin", async () => {
    const other = await createOrder(customer.id);
    const res = await ordersAdmin.client.rpc("change_order_status", {
      p_order_id: other.id,
      p_to_status: "completed",
    });
    expect(res.error?.message).toMatch(/INVALID_STATUS_TRANSITION/);
  });

  it("new → processing is refused without an accepted payment receipt", async () => {
    const other = await createOrder(customer.id);
    const res = await ordersAdmin.client.rpc("change_order_status", {
      p_order_id: other.id,
      p_to_status: "processing",
    });
    expect(res.error?.message).toMatch(/PAYMENT_NOT_ACCEPTED/);
  });
});

describe("Audit log is append-only at the database level", () => {
  let auditRow: Row;

  beforeAll(async () => {
    const res = await service()
      .from("audit_logs")
      .select("*")
      .order("id", { ascending: false })
      .limit(1)
      .single();
    if (res.error) throw new Error(res.error.message);
    auditRow = res.data;
  });

  async function unchanged() {
    const res = await service()
      .from("audit_logs")
      .select("*")
      .eq("id", auditRow.id as number)
      .single();
    expect(res.data).toEqual(auditRow);
  }

  it("control: the owner can read the audit log", async () => {
    const res = await owner.client
      .from("audit_logs")
      .select("id")
      .eq("id", auditRow.id as number);
    expect(res.data).toHaveLength(1);
  });

  for (const who of ["owner", "orders admin"] as const) {
    it(`${who} cannot UPDATE an audit row`, async () => {
      const client = who === "orders admin" ? ordersAdmin.client : owner.client;
      const res = await client
        .from("audit_logs")
        .update({ action: "tampered", actor_id: null })
        .eq("id", auditRow.id as number);
      expect(res.error?.code).toBe("42501");
      await unchanged();
    });

    it(`${who} cannot DELETE an audit row`, async () => {
      const client = who === "orders admin" ? ordersAdmin.client : owner.client;
      const res = await client
        .from("audit_logs")
        .delete()
        .eq("id", auditRow.id as number);
      expect(res.error?.code).toBe("42501");
      await unchanged();
    });

    it(`${who} cannot INSERT a forged audit row`, async () => {
      const client = who === "orders admin" ? ordersAdmin.client : owner.client;
      const res = await client
        .from("audit_logs")
        .insert({ action: "forged", entity_type: "orders" });
      expect(res.error?.code).toBe("42501");
    });
  }

  it("even the service role cannot UPDATE or DELETE an audit row", async () => {
    const upd = await service()
      .from("audit_logs")
      .update({ action: "tampered" })
      .eq("id", auditRow.id as number);
    expect(upd.error?.code).toBe("42501");
    const del = await service()
      .from("audit_logs")
      .delete()
      .eq("id", auditRow.id as number);
    expect(del.error?.code).toBe("42501");
    await unchanged();
  });
});
