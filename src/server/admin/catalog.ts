"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { fieldDefinitionsSchema } from "@/lib/fulfillment";
import { createClient } from "@/lib/supabase/server";
import { actionAdmin } from "@/server/auth/session";
import { PUBLIC_IMAGE_PROFILES } from "@/server/files/image";

import {
  type ActionResult,
  affected,
  dbError,
  fields,
  formLocale,
  INVALID,
  NOT_ALLOWED,
  revalidatePublic,
} from "./common";
import { removePublicImage, uploadPublicImage } from "./public-images";

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);
const checkbox = z
  .string()
  .optional()
  .transform((v) => v === "on");
const sortOrder = z.coerce.number().int().min(-100000).max(100000).default(0);

const categorySchema = z
  .object({
    id: z.guid().optional(),
    slug,
    name_ar: optionalText(120),
    name_en: optionalText(120),
    description_ar: optionalText(2000),
    description_en: optionalText(2000),
    sort_order: sortOrder,
    is_active: checkbox,
  })
  .refine((c) => c.name_ar || c.name_en);

export async function saveCategory(formData: FormData): Promise<ActionResult> {
  if (!(await actionAdmin("products"))) return NOT_ALLOWED;
  const input = categorySchema.safeParse(fields(formData));
  if (!input.success) return INVALID;
  const { id, ...row } = input.data;

  const supabase = await createClient();
  if (id) {
    const res = await supabase
      .from("categories")
      .update(row)
      .eq("id", id)
      .select("id");
    const result = affected(res);
    if (result.ok) revalidatePublic();
    return result;
  }
  const { error } = await supabase.from("categories").insert(row);
  if (error) return dbError(error);
  revalidatePublic();
  redirect(`/${formLocale(formData)}/admin/catalog`);
}

const archiveSchema = z.object({
  id: z.guid(),
  archived: z.enum(["true", "false"]),
});

async function setArchived(
  table: "categories" | "products" | "product_variants",
  formData: FormData,
): Promise<ActionResult> {
  const input = archiveSchema.safeParse(fields(formData));
  if (!input.success) return INVALID;
  const supabase = await createClient();
  const res = await supabase
    .from(table)
    .update({
      archived_at:
        input.data.archived === "true" ? new Date().toISOString() : null,
    })
    .eq("id", input.data.id)
    .select("id");
  const result = affected(res);
  if (result.ok) revalidatePublic();
  return result;
}

export async function setCategoryArchived(
  formData: FormData,
): Promise<ActionResult> {
  if (!(await actionAdmin("products"))) return NOT_ALLOWED;
  return setArchived("categories", formData);
}

const productSchema = z
  .object({
    id: z.guid().optional(),
    category_id: z.guid(),
    slug,
    name_ar: optionalText(160),
    name_en: optionalText(160),
    description_ar: optionalText(8000),
    description_en: optionalText(8000),
    sort_order: sortOrder,
    is_active: checkbox,
  })
  .refine((p) => p.name_ar || p.name_en);

export async function saveProduct(formData: FormData): Promise<ActionResult> {
  if (!(await actionAdmin("products"))) return NOT_ALLOWED;
  const input = productSchema.safeParse(fields(formData));
  if (!input.success) return INVALID;
  const { id, ...row } = input.data;

  const supabase = await createClient();
  if (id) {
    const res = await supabase
      .from("products")
      .update(row)
      .eq("id", id)
      .select("id");
    const result = affected(res);
    if (result.ok) revalidatePublic();
    return result;
  }
  const { data, error } = await supabase
    .from("products")
    .insert(row)
    .select("id")
    .single();
  if (error || !data) return dbError(error);
  revalidatePublic();
  redirect(`/${formLocale(formData)}/admin/catalog/products/${data.id}`);
}

export async function setProductArchived(
  formData: FormData,
): Promise<ActionResult> {
  if (!(await actionAdmin("products"))) return NOT_ALLOWED;
  return setArchived("products", formData);
}

/** Validate + re-encode (WebP, 1000 px + 400 px thumbnail), then swap. */
export async function uploadProductImage(
  formData: FormData,
): Promise<ActionResult> {
  if (!(await actionAdmin("products"))) return NOT_ALLOWED;
  const productId = z.guid().safeParse(formData.get("productId"));
  const file = formData.get("file");
  if (!productId.success) return INVALID;
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, error: "empty" };

  const supabase = await createClient();
  const { data: product } = await supabase
    .from("products")
    .select("id, image_path")
    .eq("id", productId.data)
    .maybeSingle();
  if (!product) return { ok: false, error: "not_found" };

  const uploaded = await uploadPublicImage(
    file,
    PUBLIC_IMAGE_PROFILES.product,
    `products/${product.id}`,
  );
  if (!uploaded.ok) return { ok: false, error: uploaded.error };

  const res = await supabase
    .from("products")
    .update({ image_path: uploaded.path })
    .eq("id", product.id)
    .select("id");
  const result = affected(res);
  if (!result.ok) {
    await removePublicImage(uploaded.path);
    return result;
  }
  await removePublicImage(product.image_path);
  revalidatePublic();
  return { ok: true };
}

export async function removeProductImage(
  formData: FormData,
): Promise<ActionResult> {
  if (!(await actionAdmin("products"))) return NOT_ALLOWED;
  const productId = z.guid().safeParse(formData.get("productId"));
  if (!productId.success) return INVALID;
  const supabase = await createClient();
  const { data: product } = await supabase
    .from("products")
    .select("id, image_path")
    .eq("id", productId.data)
    .maybeSingle();
  if (!product) return { ok: false, error: "not_found" };
  const res = await supabase
    .from("products")
    .update({ image_path: null })
    .eq("id", product.id)
    .select("id");
  const result = affected(res);
  if (result.ok) {
    await removePublicImage(product.image_path);
    revalidatePublic();
  }
  return result;
}

const variantSchema = z
  .object({
    id: z.guid().optional(),
    product_id: z.guid(),
    name_ar: optionalText(120),
    name_en: optionalText(120),
    // Two decimals, the column is numeric(12,2).
    price_usd: z
      .string()
      .trim()
      .regex(/^\d{1,8}(\.\d{1,2})?$/)
      .transform(Number)
      .refine((n) => n > 0),
    max_quantity: z.coerce.number().int().min(1).max(10),
    sort_order: sortOrder,
    is_active: checkbox,
    required_fields: z.string().max(20000),
  })
  .refine((v) => v.name_ar || v.name_en);

export async function saveVariant(formData: FormData): Promise<ActionResult> {
  if (!(await actionAdmin("products"))) return NOT_ALLOWED;
  const input = variantSchema.safeParse(fields(formData));
  if (!input.success) return INVALID;
  let parsedFields: unknown;
  try {
    parsedFields = JSON.parse(input.data.required_fields || "[]");
  } catch {
    return { ok: false, error: "fields_invalid" };
  }
  // Same rules as the database CHECK (private.valid_field_definitions).
  const defs = fieldDefinitionsSchema.safeParse(parsedFields);
  if (!defs.success) return { ok: false, error: "fields_invalid" };
  const { id, required_fields: _raw, ...rest } = input.data;
  void _raw;
  const row = { ...rest, required_fields: defs.data };

  const supabase = await createClient();
  if (id) {
    const { product_id: _p, ...update } = row;
    void _p;
    const res = await supabase
      .from("product_variants")
      .update(update)
      .eq("id", id)
      .select("id");
    const result = affected(res);
    if (result.ok) revalidatePublic();
    return result;
  }
  const { error } = await supabase.from("product_variants").insert(row);
  if (error) return dbError(error);
  revalidatePublic();
  redirect(`/${formLocale(formData)}/admin/catalog/products/${row.product_id}`);
}

export async function setVariantArchived(
  formData: FormData,
): Promise<ActionResult> {
  if (!(await actionAdmin("products"))) return NOT_ALLOWED;
  return setArchived("product_variants", formData);
}
