import "server-only";

import {
  fieldDefinitionsSchema,
  type FieldDefinition,
} from "@/lib/fulfillment";
import { createClient } from "@/lib/supabase/server";

// Customer order reads. They run with the customer's session (RLS), and also
// filter on user_id explicitly: RLS lets staff with the orders permission see
// every order, but "my orders" must only ever list the caller's own.

export type OrderStatus = "new" | "processing" | "completed" | "cancelled";

/** One line of an order: its own product, package, quantity, price and details. */
export type OrderLine = {
  line_no: number;
  product_name_ar: string | null;
  product_name_en: string | null;
  variant_name_ar: string | null;
  variant_name_en: string | null;
  quantity: number;
  unit_price_usd: number;
  line_total_usd: number;
  line_total_sdg: number;
  fulfillment_fields: FieldDefinition[];
  fulfillment_data: Record<string, string>;
};

export type OrderSummary = {
  id: string;
  reference: string;
  status: OrderStatus;
  /** Lines in order (names and quantities only in lists). */
  items: Pick<
    OrderLine,
    | "line_no"
    | "product_name_ar"
    | "product_name_en"
    | "variant_name_ar"
    | "variant_name_en"
    | "quantity"
  >[];
  total_sdg: number;
  created_at: string;
};

export type OrderDetail = Omit<OrderSummary, "items"> & {
  items: OrderLine[];
  total_usd: number;
  usd_sdg_rate: number;
  completed_at: string | null;
  cancelled_at: string | null;
};

export const LINE_COLUMNS =
  "line_no, product_name_ar, product_name_en, variant_name_ar, variant_name_en, quantity, unit_price_usd, line_total_usd, line_total_sdg, fulfillment_fields, fulfillment_data";

type RawLine = Omit<
  OrderLine,
  | "unit_price_usd"
  | "line_total_usd"
  | "line_total_sdg"
  | "fulfillment_fields"
  | "fulfillment_data"
> & {
  unit_price_usd: number | string;
  line_total_usd: number | string;
  line_total_sdg: number | string;
  fulfillment_fields: unknown;
  fulfillment_data: unknown;
};

/** Lines as stored, sorted, with numbers and field definitions parsed. */
export function parseLines(rows: RawLine[] | null | undefined): OrderLine[] {
  return [...(rows ?? [])]
    .sort((a, b) => a.line_no - b.line_no)
    .map((l) => {
      const fields = fieldDefinitionsSchema.safeParse(l.fulfillment_fields);
      return {
        ...l,
        unit_price_usd: Number(l.unit_price_usd),
        line_total_usd: Number(l.line_total_usd),
        line_total_sdg: Number(l.line_total_sdg),
        fulfillment_fields: fields.success ? fields.data : [],
        fulfillment_data: (l.fulfillment_data ?? {}) as Record<string, string>,
      };
    });
}

export type ReceiptRow = {
  id: string;
  transaction_ref: string;
  status: "pending" | "accepted" | "rejected";
  rejection_reason: string | null;
  created_at: string;
  bank: { bank_name_ar: string; bank_name_en: string } | null;
};

export type StatusChange = {
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  customer_note: string | null;
  created_at: string;
};

export type BankAccount = {
  id: string;
  bank_name_ar: string;
  bank_name_en: string;
  account_number: string;
  account_holder: string;
  branch_ar: string | null;
  branch_en: string | null;
};

const SUMMARY =
  "id, reference, status, total_sdg, created_at, items:order_items(line_no, product_name_ar, product_name_en, variant_name_ar, variant_name_en, quantity)";

export async function listMyOrders(userId: string): Promise<OrderSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select(SUMMARY)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`orders query failed: ${error.message}`);
  return (data ?? []).map((o) => ({
    ...o,
    items: [...(o.items ?? [])].sort((a, b) => a.line_no - b.line_no),
    total_sdg: Number(o.total_sdg),
  })) as OrderSummary[];
}

/** Null for a reference that does not exist or belongs to someone else. */
export async function getMyOrder(userId: string, reference: string) {
  if (!/^FD-[0-9]{7}$/.test(reference)) return null;
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("orders")
    .select(
      `id, reference, status, total_sdg, created_at, total_usd, usd_sdg_rate, completed_at, cancelled_at, items:order_items(${LINE_COLUMNS})`,
    )
    .eq("reference", reference)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`order query failed: ${error.message}`);
  if (!row) return null;

  const [receipts, history, banks] = await Promise.all([
    supabase
      .from("payment_receipts")
      .select(
        "id, transaction_ref, status, rejection_reason, created_at, bank:bank_accounts(bank_name_ar, bank_name_en)",
      )
      .eq("order_id", row.id)
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("order_status_history")
      .select("from_status, to_status, customer_note, created_at")
      .eq("order_id", row.id)
      .order("created_at"),
    supabase
      .from("bank_accounts")
      .select(
        "id, bank_name_ar, bank_name_en, account_number, account_holder, branch_ar, branch_en",
      )
      .eq("is_active", true)
      .order("sort_order"),
  ]);
  for (const r of [receipts, history, banks]) {
    if (r.error) throw new Error(`order query failed: ${r.error.message}`);
  }

  const order: OrderDetail = {
    ...row,
    status: row.status as OrderStatus,
    items: parseLines(row.items as RawLine[]),
    total_sdg: Number(row.total_sdg),
    total_usd: Number(row.total_usd),
    usd_sdg_rate: Number(row.usd_sdg_rate),
  };
  return {
    order,
    // Untyped client: the many-to-one embed is an object at runtime.
    receipts: (receipts.data ?? []) as unknown as ReceiptRow[],
    history: (history.data ?? []) as StatusChange[],
    banks: (banks.data ?? []) as BankAccount[],
  };
}
