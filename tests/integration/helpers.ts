import { execFileSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const url = () => process.env.TEST_SUPABASE_URL!;
export const anonKey = () => process.env.TEST_ANON_KEY!;

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

/** Service-role client: test setup and ground-truth reads only. */
export function service(): SupabaseClient {
  return createClient(url(), process.env.TEST_SERVICE_ROLE_KEY!, noSession);
}

/** What any visitor has: the public anon key and nothing else. */
export function anon(): SupabaseClient {
  return createClient(url(), anonKey(), noSession);
}

/** A client that sends an arbitrary bearer token with the anon key. */
export function withToken(token: string): SupabaseClient {
  return createClient(url(), anonKey(), {
    ...noSession,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export function randomPhoneDigits() {
  // Sudanese mobile format without '+': 249 9X XXX XXXX
  return "2499" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
}

export type TestUser = {
  id: string;
  phone: string; // E.164
  password: string;
  client: SupabaseClient;
  accessToken: string;
};

type AdminSpec = { owner?: boolean; permissions?: string[] };

/**
 * Creates a user the way the server does after OTP verification
 * (service role + `signup_verified: 'otp'` marker), then signs in as them
 * with phone + password and the public anon key (email login is disabled).
 */
export async function createUser(
  opts: { admin?: AdminSpec; name?: string } = {},
): Promise<TestUser> {
  const sb = service();
  const phoneDigits = randomPhoneDigits();
  const password = randomBytes(12).toString("hex");
  const { data, error } = await sb.auth.admin.createUser({
    password,
    phone: phoneDigits,
    phone_confirm: true,
    app_metadata: { signup_verified: "otp" },
    user_metadata: { full_name: opts.name ?? "Test Customer" },
  });
  if (error) throw new Error(`createUser: ${error.message}`);
  const id = data.user.id;

  if (opts.admin) {
    const ins = await sb
      .from("admins")
      .insert({ user_id: id, is_owner: !!opts.admin.owner });
    if (ins.error) throw new Error(`admins insert: ${ins.error.message}`);
    for (const permission of opts.admin.permissions ?? []) {
      const p = await sb
        .from("admin_permissions")
        .insert({ admin_id: id, permission });
      if (p.error)
        throw new Error(`admin_permissions insert: ${p.error.message}`);
    }
  }

  const client = createClient(url(), anonKey(), noSession);
  const signIn = await client.auth.signInWithPassword({
    phone: `+${phoneDigits}`,
    password,
  });
  if (signIn.error) throw new Error(`signIn: ${signIn.error.message}`);
  return {
    id,
    phone: `+${phoneDigits}`,
    password,
    client,
    accessToken: signIn.data.session!.access_token,
  };
}

/**
 * The single owner (unique index: one owner per database). Reused across test
 * files: if it already exists, its password is reset with the admin API and
 * a fresh session is opened.
 */
export async function ownerUser(): Promise<TestUser> {
  const sb = service();
  const { data: existing } = await sb
    .from("admins")
    .select("user_id")
    .eq("is_owner", true)
    .maybeSingle();
  if (!existing)
    return createUser({ admin: { owner: true }, name: "Test Owner" });

  const password = randomBytes(12).toString("hex");
  const { data, error } = await sb.auth.admin.updateUserById(existing.user_id, {
    password,
  });
  if (error) throw new Error(`owner password: ${error.message}`);
  const phone = `+${data.user.phone}`;
  const client = createClient(url(), anonKey(), noSession);
  const signIn = await client.auth.signInWithPassword({ phone, password });
  if (signIn.error) throw new Error(`owner signIn: ${signIn.error.message}`);
  return {
    id: existing.user_id,
    phone,
    password,
    client,
    accessToken: signIn.data.session!.access_token,
  };
}

export const VARIANT_CHEAP = "00000000-0000-4000-c000-000000000001"; // 1.10 USD (seed)
/** Valid fulfillment data for VARIANT_CHEAP (seed: required digits player_id, 5–20). */
export const CHEAP_FIELDS = { player_id: "123456" };

/** Inserts an order through the service role (stand-in for create_order, Phase 5). */
export async function createOrder(userId: string, variantId = VARIANT_CHEAP) {
  const { data, error } = await service()
    .from("orders")
    .insert({
      user_id: userId,
      variant_id: variantId,
      quantity: 1,
      idempotency_key: randomUUID(),
      fulfillment_data: variantId === VARIANT_CHEAP ? CHEAP_FIELDS : {},
    })
    .select()
    .single();
  if (error) throw new Error(`createOrder: ${error.message}`);
  return data;
}

export async function firstBankAccountId() {
  const { data, error } = await service()
    .from("bank_accounts")
    .select("id")
    .order("sort_order")
    .limit(1)
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9,
]);

export async function uploadPrivate(bucket: string, path: string) {
  const { error } = await service().storage.from(bucket).upload(path, JPEG, {
    contentType: "image/jpeg",
    upsert: true,
  });
  if (error) throw new Error(`upload ${bucket}/${path}: ${error.message}`);
}

export const sha256Hex = () => randomBytes(32).toString("hex");

/** An order with an accepted receipt, in `processing`: ready to complete. */
export async function createPaidOrder(userId: string) {
  const order = await createOrder(userId);
  const receipt = await createReceipt(order);
  const sb = service();
  const acc = await sb
    .from("payment_receipts")
    .update({ status: "accepted", reviewed_at: new Date().toISOString() })
    .eq("id", receipt.id);
  if (acc.error) throw new Error(`accept receipt: ${acc.error.message}`);
  const r = await sb
    .from("orders")
    .update({ status: "processing" })
    .eq("id", order.id);
  if (r.error) throw new Error(`processing: ${r.error.message}`);
  return order as { id: string; user_id: string; reference: string };
}

/** Receipt row + file for an order (as the server ingest will do in Phase 5). */
export async function createReceipt(
  order: { id: string; user_id: string },
  txnRef = `TX${Date.now()}${Math.random()}`,
) {
  const path = `${order.user_id}/${order.id}/${randomUUID()}.jpg`;
  await uploadPrivate("payment-receipts", path);
  const { data, error } = await service()
    .from("payment_receipts")
    .insert({
      order_id: order.id,
      bank_account_id: await firstBankAccountId(),
      transaction_ref: txnRef.slice(0, 60),
      storage_path: path,
      file_sha256: sha256Hex(),
    })
    .select()
    .single();
  if (error) throw new Error(`createReceipt: ${error.message}`);
  return data;
}

/** Drives an order to completed through the real transition rules and issues an invoice. */
export async function completeOrderWithInvoice(order: {
  id: string;
  user_id: string;
}) {
  const sb = service();
  const receipt = await createReceipt(order);
  const acc = await sb
    .from("payment_receipts")
    .update({ status: "accepted", reviewed_at: new Date().toISOString() })
    .eq("id", receipt.id);
  if (acc.error) throw new Error(`accept receipt: ${acc.error.message}`);
  for (const status of ["processing", "completed"]) {
    const r = await sb.from("orders").update({ status }).eq("id", order.id);
    if (r.error) throw new Error(`status ${status}: ${r.error.message}`);
  }
  // Completion issues the invoice in the same transaction (Phase 8).
  const inv = await sb
    .from("invoices")
    .select()
    .eq("order_id", order.id)
    .eq("status", "issued")
    .single();
  if (inv.error) throw new Error(`invoice: ${inv.error.message}`);
  return { receipt, invoice: inv.data };
}

export async function createKycSubmission(userId: string) {
  const id = randomUUID();
  const path = `${userId}/${id}.jpg`;
  await uploadPrivate("kyc-documents", path);
  const { data, error } = await service()
    .from("kyc_submissions")
    .insert({
      id,
      user_id: userId,
      doc_type: "national_id",
      storage_path: path,
      file_sha256: sha256Hex(),
      mime: "image/jpeg",
      size_bytes: 13,
    })
    .select()
    .single();
  if (error) throw new Error(`kyc: ${error.message}`);
  return data;
}

/** HS256 JWT signed with a given secret (to build expired/forged tokens). */
export function signJwt(payload: Record<string, unknown>, secret: string) {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64(payload);
  const sig = createHmac("sha256", secret)
    .update(`${head}.${body}`)
    .digest("base64url");
  return `${head}.${body}.${sig}`;
}

export function customerClaims(userId: string, expOffsetSeconds: number) {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: userId,
    role: "authenticated",
    aud: "authenticated",
    iat: now - 60,
    exp: now + expOffsetSeconds,
  };
}

/** Runs SQL as postgres on the LOCAL test database (time travel, fixtures). */
export function sql(query: string): string {
  try {
    return execFileSync(
      "psql",
      [process.env.TEST_DB_URL!, "-v", "ON_ERROR_STOP=1", "-Atqc", query],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? "";
    throw new Error(stderr.trim() || String(error));
  }
}
