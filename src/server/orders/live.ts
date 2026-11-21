import "server-only";

import { createHash } from "node:crypto";

import { createClient } from "@/lib/supabase/server";

// Live order status (decisions.md 2026-11-21): the customer's order pages
// poll /api/orders/status while the tab is visible and refresh when this
// fingerprint changes. It covers what staff change on those pages: the
// order's status and its receipts' review. Read with the customer's own
// session (RLS) AND filtered to their own orders, like the pages; it reveals
// nothing by itself (a hash).

const REFERENCE = /^FD-[0-9]{7}$/;

/** One order's fingerprint, or null if it is not the customer's. */
export async function orderSignature(
  userId: string,
  reference: string,
): Promise<string | null> {
  if (!REFERENCE.test(reference)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select(
      "reference, status, updated_at, receipts:payment_receipts(status, updated_at)",
    )
    .eq("user_id", userId)
    .eq("reference", reference)
    .maybeSingle();
  if (error) throw new Error(`order signature failed: ${error.message}`);
  return data ? hash([row(data)]) : null;
}

/** Fingerprint of the customer's order list (the same 100 the page shows). */
export async function ordersSignature(userId: string): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select(
      "reference, status, updated_at, receipts:payment_receipts(status, updated_at)",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`orders signature failed: ${error.message}`);
  return hash((data ?? []).map(row));
}

type Row = {
  reference: string;
  status: string;
  updated_at: string;
  receipts: { status: string; updated_at: string }[] | null;
};

function row(o: Row) {
  return [
    o.reference,
    o.status,
    o.updated_at,
    (o.receipts ?? []).map((r) => `${r.status}@${r.updated_at}`).sort(),
  ];
}

function hash(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("base64url")
    .slice(0, 22);
}
