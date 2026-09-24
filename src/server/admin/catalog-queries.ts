import "server-only";

import {
  fieldDefinitionsSchema,
  type FieldDefinition,
} from "@/lib/fulfillment";
import { createClient } from "@/lib/supabase/server";

// Catalog reads for staff with the `products` permission: RLS shows them
// hidden and archived rows too (customers never see those).

export type AdminCategory = {
  id: string;
  slug: string;
  name_ar: string | null;
  name_en: string | null;
  description_ar: string | null;
  description_en: string | null;
  sort_order: number;
  is_active: boolean;
  archived_at: string | null;
  product_count: number;
};

export async function listAdminCategories(): Promise<AdminCategory[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select(
      "id, slug, name_ar, name_en, description_ar, description_en, sort_order, is_active, archived_at, products(count)",
    )
    .order("sort_order")
    .order("slug");
  if (error) throw new Error(error.message);
  return (data ?? []).map(({ products, ...c }) => ({
    ...c,
    product_count:
      (products as unknown as { count: number }[] | null)?.[0]?.count ?? 0,
  }));
}

export async function getAdminCategory(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("categories")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data as Omit<AdminCategory, "product_count"> | null;
}

export type AdminProductRow = {
  id: string;
  slug: string;
  name_ar: string | null;
  name_en: string | null;
  image_path: string | null;
  is_active: boolean;
  archived_at: string | null;
  completed_orders_count: number;
  category: { name_ar: string | null; name_en: string | null } | null;
  variants: {
    price_usd: number;
    is_active: boolean;
    archived_at: string | null;
  }[];
};

export async function listAdminProducts(filters: {
  q?: string;
  category?: string;
  state?: "active" | "hidden" | "archived";
}): Promise<AdminProductRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("products")
    .select(
      "id, slug, name_ar, name_en, image_path, is_active, archived_at, completed_orders_count, category:categories(name_ar, name_en), variants:product_variants(price_usd, is_active, archived_at)",
    )
    .order("sort_order")
    .order("slug")
    .limit(200);
  if (filters.category) query = query.eq("category_id", filters.category);
  if (filters.state === "archived")
    query = query.not("archived_at", "is", null);
  else if (filters.state === "hidden")
    query = query.is("archived_at", null).eq("is_active", false);
  else if (filters.state === "active")
    query = query.is("archived_at", null).eq("is_active", true);
  if (filters.q) {
    // Letters, digits, spaces and hyphens only: the term is embedded in a
    // PostgREST or() filter, so its syntax characters must never get through.
    const term = filters.q.replace(/[^\p{L}\p{N}\s-]/gu, " ").trim();
    if (term)
      query = query.or(
        `slug.ilike.*${term}*,name_ar.ilike.*${term}*,name_en.ilike.*${term}*`,
      );
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as AdminProductRow[];
}

export type AdminVariant = {
  id: string;
  product_id: string;
  name_ar: string | null;
  name_en: string | null;
  price_usd: number;
  max_quantity: number;
  sort_order: number;
  is_active: boolean;
  archived_at: string | null;
  required_fields: FieldDefinition[];
};

export async function getAdminProduct(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select(
      "id, category_id, slug, name_ar, name_en, description_ar, description_en, image_path, sort_order, is_active, archived_at, completed_orders_count, variants:product_variants(id, product_id, name_ar, name_en, price_usd, max_quantity, sort_order, is_active, archived_at, required_fields)",
    )
    .eq("id", id)
    .order("sort_order", { referencedTable: "variants" })
    .maybeSingle();
  if (!data) return null;
  const variants = (data.variants as unknown as AdminVariant[]).map((v) => {
    const defs = fieldDefinitionsSchema.safeParse(v.required_fields);
    return {
      ...v,
      price_usd: Number(v.price_usd),
      required_fields: defs.success ? defs.data : [],
    };
  });
  return { ...data, variants };
}

export async function getAdminVariant(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("product_variants")
    .select(
      "id, product_id, name_ar, name_en, price_usd, max_quantity, sort_order, is_active, archived_at, required_fields, product:products(id, slug, name_ar, name_en)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const defs = fieldDefinitionsSchema.safeParse(data.required_fields);
  return {
    ...data,
    price_usd: Number(data.price_usd),
    required_fields: defs.success ? defs.data : [],
    product: data.product as unknown as {
      id: string;
      slug: string;
      name_ar: string | null;
      name_en: string | null;
    },
  };
}

export async function getRate(): Promise<number | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("app_settings")
    .select("usd_sdg_rate")
    .maybeSingle();
  return data?.usd_sdg_rate ? Number(data.usd_sdg_rate) : null;
}
