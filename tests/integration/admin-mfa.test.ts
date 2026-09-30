// Admin two-factor authentication, proven against the real stack (GoTrue +
// PostgREST + Postgres): a staff password alone opens nothing; the same
// session confirmed with an authenticator code (aal2) does. Plus the TOTP
// label, the owner's reset and what a reset does to open sessions.
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  anon,
  anonKey,
  createOrder,
  createUser,
  ownerUser,
  sql,
  url,
} from "./helpers";
import { enrolTotp, totp } from "./totp";

const aalOf = (token: string) =>
  JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).aal;

describe("a password-only staff session is refused by the database", () => {
  it("direct PostgREST calls: nothing at aal1, everything their permission allows at aal2", async () => {
    const customer = await createUser();
    const order = await createOrder(customer.id);
    const staff = await createUser({
      admin: { permissions: ["orders", "kyc", "settings"] },
      mfa: false,
    });
    expect(aalOf(staff.accessToken)).toBe("aal1");

    const probe = async () => ({
      orders: (
        await staff.client.from("orders").select("id").eq("id", order.id)
      ).data?.length,
      adminOrders:
        (await staff.client.rpc("admin_orders", {})).error?.message ?? "ok",
      settings: (await staff.client.from("security_settings").select("id")).data
        ?.length,
      audit: (await staff.client.from("audit_logs").select("id").limit(1)).data
        ?.length,
      customers: (
        await staff.client.from("profiles").select("id").eq("id", customer.id)
      ).data?.length,
    });

    const before = await probe();
    const e = await enrolTotp(staff.client); // the same session, now with a code
    expect(aalOf(e.accessToken)).toBe("aal2");
    const after = await probe();
    console.log(
      `[demo] staff (orders, kyc, settings) via PostgREST\n  password only (aal1): ${JSON.stringify(before)}\n  + authenticator (aal2): ${JSON.stringify(after)}`,
    );
    expect(before).toEqual({
      orders: 0,
      adminOrders: "FORBIDDEN",
      settings: 0,
      audit: 0,
      customers: 0,
    });
    expect(after).toMatchObject({
      orders: 1,
      adminOrders: "ok",
      settings: 1,
      customers: 1,
    });
  });

  it("an aal1 staff session cannot change order state or open identity documents", async () => {
    const staff = await createUser({
      admin: { permissions: ["orders", "kyc"] },
      mfa: false,
    });
    const customer = await createUser();
    const order = await createOrder(customer.id);
    const change = await staff.client.rpc("change_order_status", {
      p_order_id: order.id,
      p_to_status: "cancelled",
      p_customer_note: null,
    });
    expect(change.error?.message).toMatch(/FORBIDDEN|not found|NOT_FOUND/i);
    expect(sql(`select status from orders where id = '${order.id}'`)).toBe(
      "new",
    );
    const doc = await staff.client.rpc("kyc_open_document", {
      p_submission_id: "00000000-0000-4000-8000-000000000000",
    });
    expect(doc.error?.message).toMatch(/FORBIDDEN/);
  });
});

describe("TOTP label for phone-only staff", () => {
  it("is a reserved .invalid address, only for staff, and never a way to sign in", async () => {
    const staff = await createUser({
      admin: { permissions: ["orders"] },
      mfa: false,
    });
    const label = await staff.client.rpc("staff_totp_label");
    expect(label.data).toBe(`${staff.phone.slice(1)}@staff.invalid`);
    const byEmail = await anon().auth.signInWithPassword({
      email: label.data as string,
      password: staff.password,
    });
    expect(byEmail.error?.message).toMatch(/Email logins are disabled/);

    const customer = await createUser();
    const c = await customer.client.rpc("staff_totp_label");
    expect(c.error?.message).toMatch(/FORBIDDEN/);
    expect(
      sql(
        `select coalesce(email, 'none') from auth.users where id = '${customer.id}'`,
      ),
    ).toBe("none");
  });
});

describe("recovery: owner reset", () => {
  it("removes the staff member's authenticators and ends their sessions; staff cannot reset each other", async () => {
    const owner = await ownerUser();
    const staff = await createUser({ admin: { permissions: ["orders"] } });
    const other = await createUser({ admin: { permissions: ["orders"] } });
    expect(
      Number(
        sql(
          `select count(*) from auth.mfa_factors where user_id = '${staff.id}'`,
        ),
      ),
    ).toBe(1);

    const denied = await other.client.rpc("admin_reset_mfa", {
      p_user_id: staff.id,
    });
    expect(denied.error?.message).toMatch(/FORBIDDEN/);

    const self = await owner.client.rpc("admin_reset_mfa", {
      p_user_id: owner.id,
    });
    expect(self.error?.message).toMatch(/CANNOT_RESET_SELF/);

    const ok = await owner.client.rpc("admin_reset_mfa", {
      p_user_id: staff.id,
    });
    expect(ok.error).toBeNull();
    expect(
      Number(
        sql(
          `select count(*) from auth.mfa_factors where user_id = '${staff.id}'`,
        ),
      ),
    ).toBe(0);
    // The signed-in browser is out: the Auth server no longer knows the session.
    const who = await staff.client.auth.getUser();
    expect(who.error).not.toBeNull();
    const refresh = await staff.client.auth.refreshSession();
    expect(refresh.error).not.toBeNull();
    expect(
      sql(
        `select action from audit_logs where entity_id = '${staff.id}' order by id desc limit 1`,
      ),
    ).toBe("admins.mfa_reset");

    // Next sign-in: password → aal1 → must enrol a new authenticator.
    const again = createClient(url(), anonKey(), {
      auth: { persistSession: false },
    });
    await again.auth.signInWithPassword({
      phone: staff.phone,
      password: staff.password,
    });
    const { data: factors } = await again.auth.mfa.listFactors();
    expect(factors?.totp).toEqual([]);
    const e = await enrolTotp(again);
    expect(aalOf(e.accessToken)).toBe("aal2");
    expect(totp(e.secret)).toMatch(/^\d{6}$/);
  });
});
