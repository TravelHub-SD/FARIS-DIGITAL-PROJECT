import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import {
  type FieldDefinition,
  fieldDefinitionsSchema,
} from "@/lib/fulfillment";
import { createClient } from "@/lib/supabase/server";

// The signed-in customer's cart (server table, RLS: own lines only). Prices
// are never stored in the cart: my_cart() prices every line at the live rate
// with the same per-line formula checkout charges.

export type CartLine = {
  id: string;
  variant_id: string;
  product_id: string;
  product_slug: string;
  image_path: string | null;
  product_name_ar: string | null;
  product_name_en: string | null;
  variant_name_ar: string | null;
  variant_name_en: string | null;
  quantity: number;
  max_quantity: number;
  fulfillment_data: Record<string, string>;
  required_fields: FieldDefinition[];
  /** False when the product was hidden since: not in the total, blocks checkout. */
  available: boolean;
  line_total_sdg: number | null;
};

export type Cart = {
  lines: CartLine[];
  total_sdg: number;
  unavailable: number;
  /** The total (plus recent orders) needs identity verification first. */
  kyc_needed: boolean;
};

const EMPTY: Cart = {
  lines: [],
  total_sdg: 0,
  unavailable: 0,
  kyc_needed: false,
};

export async function getMyCart(): Promise<Cart> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_cart");
  if (error) throw new Error(`my_cart failed: ${error.message}`);
  if (!data) return EMPTY;
  const raw = data as Omit<Cart, "lines"> & {
    lines: (Omit<CartLine, "required_fields" | "line_total_sdg"> & {
      required_fields: unknown;
      line_total_sdg: number | string | null;
    })[];
  };
  return {
    lines: raw.lines.map((l) => {
      const defs = fieldDefinitionsSchema.safeParse(l.required_fields);
      return {
        ...l,
        required_fields: defs.success ? defs.data : [],
        line_total_sdg:
          l.line_total_sdg === null ? null : Number(l.line_total_sdg),
      };
    }),
    total_sdg: Number(raw.total_sdg),
    unavailable: Number(raw.unavailable),
    kyc_needed: Boolean(raw.kyc_needed),
  };
}

/**
 * Number of lines, for the cart badge on every page. No session cookie: 0,
 * without any request. Otherwise one count under RLS (the caller's own
 * lines); an expired or invalid session simply counts 0.
 */
export const cartCount = cache(async (): Promise<number> => {
  const jar = await cookies();
  if (!jar.getAll().some((c) => c.name.includes("-auth-token"))) return 0;
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("cart_items")
    .select("id", { count: "exact", head: true });
  return error ? 0 : (count ?? 0);
});
