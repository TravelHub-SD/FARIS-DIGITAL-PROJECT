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
const optionalId = z
  .string()
  .optional()
  .transform((v) => v || null)
  .pipe(z.guid().nullable());

const sectionSchema = z
  .object({
    id: z.guid().optional(),
    name_ar: optionalText(80),
    name_en: optionalText(80),
    sort_order: sortOrder,
    is_active: checkbox,
  })
  .refine((s) => s.name_ar || s.name_en);

/** Home page sections ("Game top-ups", "Subscriptions", …). */
export async function saveSection(formData: FormData): Promise<ActionResult> {
  if (!(await actionAdmin("products"))) return NOT_ALLOWED;
  const input = sectionSchema.safeParse(fields(formData));
  if (!input.success) return INVALID;
  const { id, ...row } = input.data;
  const supabase = await createClient();
  const result = id
    ? affected(
        await supabase
          .from("category_sections")
          .update(row)
          .eq("id", id)
          .select("id"),
      )
    : await supabase
        .from("category_sections")
        .insert(row)
        .then(({ error }) =>
          error ? dbError(error) : ({ ok: true } as const),
        );
  if (result.ok) revalidatePublic();
  return result;
}

/** Its categories stay, unassigned (listed under "More categories"). */
export async function deleteSection(formData: FormData): Promise<ActionResult> {
  if (!(await actionAdmin("products"))) return NOT_ALLOWED;
  const id = z.guid().safeParse(formData.get("id"));
  if (!id.success) return INVALID;
  const supabase = await createClient();
  const result = affected(
    await supabase
      .from("category_sections")
      .delete()
      .eq("id", id.data)
      .select("id"),
  );
  if (result.ok) revalidatePublic();
  return result;
}

const categorySchema = z
  .object({
    id: z.guid().optional(),
    slug,
    name_ar: optionalText(120),
    name_en: optionalText(120),
    description_ar: optionalText(2000),
    description_en: optionalText(2000),
    section_id: optionalId,
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
    is_new: checkbox,
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

type ImageTarget = {
  table: "products" | "categories";
  idField: "productId" | "categoryId";
  profile: keyof typeof PUBLIC_IMAGE_PROFILES;
};
const PRODUCT_IMAGE: ImageTarget = {
  table: "products",
  idField: "productId",
  profile: "product",
};
const CATEGORY_ICON: ImageTarget = {
  table: "categories",
  idField: "categoryId",
  profile: "icon",
};

/** Validate + re-encode (WebP, full size + thumbnail), then swap. */
async function uploadImage(
  target: ImageTarget,
  formData: FormData,
): Promise<ActionResult> {
  const rowId = z.guid().safeParse(formData.get(target.idField));
  const file = formData.get("file");
  if (!rowId.success) return INVALID;
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, error: "empty" };

  const supabase = await createClient();
  const { data: row } = await supabase
    .from(target.table)
    .select("id, image_path")
    .eq("id", rowId.data)
    .maybeSingle();
  if (!row) return { ok: false, error: "not_found" };

  const uploaded = await uploadPublicImage(
    file,
    PUBLIC_IMAGE_PROFILES[target.profile],
    `${target.table}/${row.id}`,
  );
  if (!uploaded.ok) return { ok: false, error: uploaded.error };

  const res = await supabase
    .from(target.table)
    .update({ image_path: uploaded.path })
    .eq("id", row.id)
    .select("id");
  const result = affected(res);
  if (!result.ok) {
    await removePublicImage(uploaded.path);
    return result;
  }
  await removePublicImage(row.image_path);
  revalidatePublic();
  return { ok: true };
}

async function removeImage(
  target: ImageTarget,
  formData: FormData,
): Promise<ActionResult> {
  const rowId = z.guid().safeParse(formData.get(target.idField));
  if (!rowId.success) return INVALID;
  const supabase = await createClient();
  const { data: row } = await supabase
    .from(target.table)
    .select("id, image_path")
    .eq("id", rowId.data)
    .maybeSingle();
  if (!row) return { ok: false, error: "not_found" };
  const res = await supabase
    .from(target.table)
    .update({ image_path: null })
    .eq("id", row.id)
    .select("id");
  const result = affected(res);
  if (result.ok) {
    await removePublicImage(row.image_path);
    revalidatePublic();
  }
  return result;
}

export async function uploadProductImage(
  formData: FormData,
): Promise<ActionResult> {
  if (!(await actionAdmin("products"))) return NOT_ALLOWED;
  return uploadImage(PRODUCT_IMAGE, formData);
}

export async function removeProductImage(
  formData: FormData,
): Promise<ActionResult> {
  if (!(await actionAdmin("products"))) return NOT_ALLOWED;
  return removeImage(PRODUCT_IMAGE, formData);
}

/** The square icon shown on the home page tiles. */
export async function uploadCategoryImage(
  formData: FormData,
): Promise<ActionResult> {
  if (!(await actionAdmin("products"))) return NOT_ALLOWED;
  return uploadImage(CATEGORY_ICON, formData);
}

export async function removeCategoryImage(
  formData: FormData,
): Promise<ActionResult> {
  if (!(await actionAdmin("products"))) return NOT_ALLOWED;
  return removeImage(CATEGORY_ICON, formData);
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
    // The struck-through "was" price. Display only: never charged, and shown
    // only while it is above the price (public.compare_at_sdg).
    compare_at_price_usd: z
      .string()
      .trim()
      .regex(/^(\d{1,8}(\.\d{1,2})?)?$/)
      .transform((v) => (v ? Number(v) : null))
      .refine((n) => n === null || n > 0),
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
