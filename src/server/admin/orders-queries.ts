import "server-only";

import {
  fieldDefinitionsSchema,
  type FieldDefinition,
} from "@/lib/fulfillment";
import { createClient } from "@/lib/supabase/server";
import type { OrderStatus } from "@/server/orders/queries";

// Reads for the orders area. They run with the admin's session: RLS returns
// rows only to admins with the `orders` permission (pages also check first).

export const RECEIPT_URL_TTL_SECONDS = 60;
const PAGE_SIZE = 25;

export type OrderFilters = {
  status?: OrderStatus;
  from?: string;
  to?: string;
  q?: string;
  min?: number;
  max?: number;
  review?: boolean;
  page?: number;
};

export type AdminOrderRow = {
  id: string;
  reference: string;
  status: OrderStatus;
  created_at: string;
  total_sdg: number;
  quantity: number;
  product_name_ar: string | null;
  product_name_en: string | null;
  variant_name_ar: string | null;
  variant_name_en: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  pending_receipt: boolean;
  total_count: number;
};

export async function listOrders(filters: OrderFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_orders", {
    p_status: filters.status ?? null,
    p_from: filters.from ?? null,
    p_to: filters.to ?? null,
    p_q: filters.q ?? null,
    p_min_sdg: filters.min ?? null,
    p_max_sdg: filters.max ?? null,
    p_payment_review: filters.review ?? false,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  });
  if (error) throw new Error(`admin_orders failed: ${error.message}`);
  const rows = (data ?? []) as AdminOrderRow[];
  const total = rows[0] ? Number(rows[0].total_count) : 0;
  return {
    rows: rows.map((r) => ({ ...r, total_sdg: Number(r.total_sdg) })),
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    total,
  };
}

export type AdminOrder = {
  id: string;
  reference: string;
  user_id: string;
  status: OrderStatus;
  product_name_ar: string | null;
  product_name_en: string | null;
  variant_name_ar: string | null;
  variant_name_en: string | null;
  quantity: number;
  unit_price_usd: number;
  total_usd: number;
  usd_sdg_rate: number;
  total_sdg: number;
  kyc_required: boolean;
  fulfillment_fields: FieldDefinition[];
  fulfillment_data: Record<string, string>;
  created_at: string;
};

type Person = {
  id: string;
  full_name: string | null;
  phone_e164: string | null;
};

export async function getAdminOrder(reference: string) {
  if (!/^FD-[0-9]{7}$/.test(reference)) return null;
  const supabase = await createClient();
  const { data: order } = await supabase
    .from("orders")
    .select("*")
    .eq("reference", reference)
    .maybeSingle();
  if (!order) return null;
  const id = order.id as string;

  const [customer, receipts, history, notes, transitions] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, phone_e164, kyc_status, is_blocked")
      .eq("id", order.user_id)
      .maybeSingle(),
    supabase
      .from("payment_receipts")
      .select(
        "id, transaction_ref, status, rejection_reason, storage_path, file_sha256, created_at, reviewed_at, reviewed_by, bank:bank_accounts(bank_name_ar, bank_name_en, account_number)",
      )
      .eq("order_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("order_status_history")
      .select("from_status, to_status, customer_note, changed_by, created_at")
      .eq("order_id", id)
      .order("created_at"),
    supabase
      .from("order_internal_notes")
      .select("id, body, author_id, created_at")
      .eq("order_id", id)
      .order("created_at"),
    supabase
      .from("order_status_transitions")
      .select("to_status")
      .eq("from_status", order.status),
  ]);

  // Names for everyone who acted on the order.
  const ids = new Set<string>();
  for (const r of receipts.data ?? [])
    if (r.reviewed_by) ids.add(r.reviewed_by);
  for (const h of history.data ?? []) if (h.changed_by) ids.add(h.changed_by);
  for (const n of notes.data ?? []) ids.add(n.author_id);
  const { data: people } = ids.size
    ? await supabase
        .from("profiles")
        .select("id, full_name, phone_e164")
        .in("id", [...ids])
    : { data: [] as Person[] };
  const names = new Map(
    (people ?? []).map((p: Person) => [
      p.id,
      p.full_name ?? p.phone_e164 ?? "—",
    ]),
  );

  // Short-lived signed URLs, created with the admin's session (storage
  // policy: `orders` permission). Plain <img>, never cached server-side.
  const receiptRows = await Promise.all(
    (receipts.data ?? []).map(async (r) => {
      const signed = await supabase.storage
        .from("payment-receipts")
        .createSignedUrl(r.storage_path, RECEIPT_URL_TTL_SECONDS);
      return {
        ...r,
        bank: r.bank as unknown as {
          bank_name_ar: string;
          bank_name_en: string;
          account_number: string;
        } | null,
        imageUrl: signed.data?.signedUrl ?? null,
        reviewer: r.reviewed_by ? (names.get(r.reviewed_by) ?? null) : null,
      };
    }),
  );

  const fieldDefs = fieldDefinitionsSchema.safeParse(order.fulfillment_fields);
  const typed: AdminOrder = {
    id,
    reference: order.reference,
    user_id: order.user_id,
    status: order.status as OrderStatus,
    product_name_ar: order.product_name_ar,
    product_name_en: order.product_name_en,
    variant_name_ar: order.variant_name_ar,
    variant_name_en: order.variant_name_en,
    quantity: order.quantity,
    unit_price_usd: Number(order.unit_price_usd),
    total_usd: Number(order.total_usd),
    usd_sdg_rate: Number(order.usd_sdg_rate),
    total_sdg: Number(order.total_sdg),
    kyc_required: order.kyc_required,
    fulfillment_fields: fieldDefs.success ? fieldDefs.data : [],
    fulfillment_data: order.fulfillment_data as Record<string, string>,
    created_at: order.created_at,
  };
  return {
    order: typed,
    customer: customer.data,
    receipts: receiptRows,
    history: (history.data ?? []).map((h) => ({
      ...h,
      actor: h.changed_by ? (names.get(h.changed_by) ?? null) : null,
    })),
    notes: (notes.data ?? []).map((n) => ({
      ...n,
      author: names.get(n.author_id) ?? "—",
    })),
    nextStatuses: (transitions.data ?? []).map(
      (t) => t.to_status as OrderStatus,
    ),
  };
}

/** Counters for the dashboard home; each only if the admin may see it. */
export async function dashboardCounts(permissions: Set<string>) {
  const supabase = await createClient();
  const count = async (
    query: PromiseLike<{ count: number | null }>,
  ): Promise<number> => (await query).count ?? 0;
  const head = { count: "exact" as const, head: true };
  return {
    paymentsToReview: permissions.has("orders")
      ? await count(
          supabase
            .from("payment_receipts")
            .select("id", head)
            .eq("status", "pending"),
        )
      : null,
    awaitingPayment: permissions.has("orders")
      ? await count(
          supabase.from("orders").select("id", head).eq("status", "new"),
        )
      : null,
    processing: permissions.has("orders")
      ? await count(
          supabase.from("orders").select("id", head).eq("status", "processing"),
        )
      : null,
    pendingKyc: permissions.has("kyc")
      ? await count(
          supabase
            .from("kyc_submissions")
            .select("id", head)
            .eq("status", "pending"),
        )
      : null,
    messagesAttention: permissions.has("orders")
      ? await count(
          supabase
            .from("message_logs")
            .select("id", head)
            .eq("needs_attention", true),
        )
      : null,
    hiddenComments: permissions.has("comments")
      ? await count(
          supabase.from("comments").select("id", head).eq("status", "hidden"),
        )
      : null,
  };
}
