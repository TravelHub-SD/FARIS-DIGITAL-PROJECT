import "server-only";

import {
  type FieldDefinition,
  fieldDefinitionsSchema,
} from "@/lib/fulfillment";
import { createClient } from "@/lib/supabase/server";

// Dashboard reads for currencies and custom-amount settings, with the
// admin's own session: settings staff see disabled currencies too (RLS);
// product staff without the settings permission see what customers see.

export type AdminCurrency = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  symbol: string;
  sdg_rate: string;
  rate_updated_at: string;
  is_active: boolean;
  sort_order: number;
};

export async function listAdminCurrencies(): Promise<AdminCurrency[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("currencies")
    .select(
      "id, code, name_ar, name_en, symbol, sdg_rate, rate_updated_at, is_active, sort_order",
    )
    .order("sort_order")
    .order("code");
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({ ...c, sdg_rate: String(c.sdg_rate) }));
}

export type AmountLimit = {
  id: string;
  currency_code: string;
  min_amount: string;
  max_amount: string;
  sort_order: number;
};

export type CustomAmountSettings = {
  amount_decimals: number;
  fee_percent: string;
  fee_fixed_sdg: string;
  required_fields: FieldDefinition[];
  limits: AmountLimit[];
};

export async function getCustomAmountSettings(
  productId: string,
): Promise<CustomAmountSettings | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("custom_amount_products")
    .select(
      "amount_decimals, fee_percent, fee_fixed_sdg, required_fields, limits:custom_amount_currencies(id, currency_code, min_amount, max_amount, sort_order)",
    )
    .eq("product_id", productId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const defs = fieldDefinitionsSchema.safeParse(data.required_fields);
  return {
    amount_decimals: data.amount_decimals,
    fee_percent: String(data.fee_percent),
    fee_fixed_sdg: String(data.fee_fixed_sdg),
    required_fields: defs.success ? defs.data : [],
    limits: (data.limits ?? [])
      .map((l) => ({
        ...l,
        min_amount: String(l.min_amount),
        max_amount: String(l.max_amount),
      }))
      .sort(
        (a, b) =>
          a.sort_order - b.sort_order ||
          a.currency_code.localeCompare(b.currency_code),
      ),
  };
}
