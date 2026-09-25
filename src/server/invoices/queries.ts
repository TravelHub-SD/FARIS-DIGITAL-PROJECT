import "server-only";

import { createClient } from "@/lib/supabase/server";

// Invoice reads run with the caller's session: RLS lets a customer read the
// issued invoices of their own orders and `invoices` staff read all of them.
// Customer pages additionally restrict to the caller's own (`mine`), because
// staff are customers too.

export const INVOICE_NUMBER = /^INV-[0-9]{4}-[0-9]{5,}$/;

export type InvoiceStatus = "issued" | "void";

export type InvoiceSnapshot = {
  order: {
    reference: string;
    created_at: string;
    completed_at: string | null;
    product_name_ar: string | null;
    product_name_en: string | null;
    variant_name_ar: string | null;
    variant_name_en: string | null;
    quantity: number;
    unit_price_usd: number;
    total_usd: number;
    usd_sdg_rate: number;
    total_sdg: number;
  };
  customer: { full_name: string | null; phone: string | null };
  seller: {
    name_ar: string;
    name_en: string;
    contact_phone: string | null;
    contact_email: string | null;
    address_ar: string | null;
    address_en: string | null;
  } | null;
  payment: {
    bank_name_ar: string;
    bank_name_en: string;
    transaction_ref: string;
    accepted_at: string | null;
  } | null;
};

export type Invoice = {
  id: string;
  invoice_number: string;
  order_id: string;
  status: InvoiceStatus;
  issued_at: string;
  total_sdg: number;
  void_reason: string | null;
  voided_at: string | null;
  snapshot: InvoiceSnapshot;
};

export type InvoiceListRow = {
  id: string;
  invoice_number: string;
  order_id: string;
  order_reference: string;
  status: InvoiceStatus;
  issued_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  product_name_ar: string | null;
  product_name_en: string | null;
  total_sdg: number;
};

const PAGE = 25;

export async function searchInvoices(filter: {
  q?: string;
  status?: InvoiceStatus;
  from?: string;
  to?: string;
  page?: number;
  mine?: boolean;
}) {
  const page = Math.max(1, filter.page ?? 1);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_invoices", {
    p_query: filter.q?.slice(0, 100) || null,
    p_status: filter.status ?? null,
    p_from: filter.from ?? null,
    p_to: filter.to ?? null,
    p_limit: PAGE,
    p_offset: (page - 1) * PAGE,
    p_mine: filter.mine ?? false,
  });
  if (error) throw new Error(`invoice search failed: ${error.message}`);
  const rows = (data ?? []) as (InvoiceListRow & { total_count: number })[];
  const total = Number(rows[0]?.total_count ?? 0);
  return {
    rows: rows.map((r) => ({ ...r, total_sdg: Number(r.total_sdg) })),
    page,
    pages: Math.max(1, Math.ceil(total / PAGE)),
    total,
  };
}

const COLUMNS =
  "id, invoice_number, order_id, status, issued_at, total_sdg, void_reason, voided_at, snapshot";

/** Null for an unknown number or one the caller may not read. */
export async function getInvoice(
  number: string,
  opts: { ownerId?: string } = {},
): Promise<Invoice | null> {
  if (!INVOICE_NUMBER.test(number)) return null;
  const supabase = await createClient();
  let q = supabase
    .from("invoices")
    .select(opts.ownerId ? `${COLUMNS}, order:orders!inner(user_id)` : COLUMNS)
    .eq("invoice_number", number);
  if (opts.ownerId) {
    q = q.eq("status", "issued").eq("order.user_id", opts.ownerId);
  }
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`invoice query failed: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as Invoice;
  return { ...row, total_sdg: Number(row.total_sdg) };
}

/** Invoices of one order, newest first (the issued one, then voided ones). */
export async function invoicesForOrder(
  orderId: string,
  opts: { ownerId?: string } = {},
) {
  const supabase = await createClient();
  let q = supabase
    .from("invoices")
    .select("invoice_number, status, issued_at")
    .eq("order_id", orderId)
    .order("issued_at", { ascending: false });
  if (opts.ownerId) q = q.eq("status", "issued");
  const { data } = await q;
  return (data ?? []) as {
    invoice_number: string;
    status: InvoiceStatus;
    issued_at: string;
  }[];
}
