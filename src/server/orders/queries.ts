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

export type OrderSummary = {
  id: string;
  reference: string;
  status: OrderStatus;
  product_name_ar: string | null;
  product_name_en: string | null;
  variant_name_ar: string | null;
  variant_name_en: string | null;
  quantity: number;
  total_sdg: number;
  created_at: string;
};

export type OrderDetail = OrderSummary & {
  unit_price_usd: number;
  total_usd: number;
  usd_sdg_rate: number;
  fulfillment_fields: FieldDefinition[];
  fulfillment_data: Record<string, string>;
  completed_at: string | null;
  cancelled_at: string | null;
};

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
  "id, reference, status, product_name_ar, product_name_en, variant_name_ar, variant_name_en, quantity, total_sdg, created_at";

export async function listMyOrders(userId: string): Promise<OrderSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select(SUMMARY)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`orders query failed: ${error.message}`);
  return (data ?? []).map((o) => ({ ...o, total_sdg: Number(o.total_sdg) }));
}

/** Null for a reference that does not exist or belongs to someone else. */
export async function getMyOrder(userId: string, reference: string) {
  if (!/^FD-[0-9]{7}$/.test(reference)) return null;
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("orders")
    .select(
      `${SUMMARY}, unit_price_usd, total_usd, usd_sdg_rate, fulfillment_fields, fulfillment_data, completed_at, cancelled_at`,
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

  const fields = fieldDefinitionsSchema.safeParse(row.fulfillment_fields);
  const order: OrderDetail = {
    ...row,
    total_sdg: Number(row.total_sdg),
    unit_price_usd: Number(row.unit_price_usd),
    total_usd: Number(row.total_usd),
    usd_sdg_rate: Number(row.usd_sdg_rate),
    fulfillment_fields: fields.success ? fields.data : [],
    fulfillment_data: row.fulfillment_data as Record<string, string>,
  };
  return {
    order,
    // Untyped client: the many-to-one embed is an object at runtime.
    receipts: (receipts.data ?? []) as unknown as ReceiptRow[],
    history: (history.data ?? []) as StatusChange[],
    banks: (banks.data ?? []) as BankAccount[],
  };
}
