"use server";

import { z } from "zod";

import { fieldDefinitionsSchema } from "@/lib/fulfillment";
import { createClient } from "@/lib/supabase/server";
import { actionAdmin } from "@/server/auth/session";

import {
  type ActionResult,
  affected,
  dbError,
  fields,
  INVALID,
  NOT_ALLOWED,
  revalidatePublic,
} from "./common";

// Currencies and the per-product settings of custom-amount products
// (decisions.md 2026-11-21). Settings permission: these decide what a
// customer pays. Written with the admin's own session (RLS checks the
// permission again; every change is audited by trigger). Each save expires
// the shared catalog cache so product pages show the new rate at once.

const decimal = (integerDigits: number, scale: number) =>
  z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{1,${integerDigits}}(\\.\\d{1,${scale}})?$`));
const checkbox = z
  .string()
  .optional()
  .transform((v) => v === "on");
const sortOrder = z.coerce.number().int().min(-100000).max(100000).default(0);
const name = z.string().trim().min(1).max(40);

const currencySchema = z.object({
  id: z.guid().optional(),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  name_ar: name,
  name_en: name,
  symbol: z.string().trim().min(1).max(8),
  // SDG per 1 unit. Ignored for USD (the store's USD rate, Settings).
  sdg_rate: decimal(10, 4)
    .optional()
    .refine((v) => v === undefined || Number(v) > 0),
  sort_order: sortOrder,
  is_active: checkbox,
});

/** Add a currency, or edit/disable one (the code never changes). */
export async function saveCurrency(formData: FormData): Promise<ActionResult> {
  if (!(await actionAdmin("settings"))) return NOT_ALLOWED;
  const input = currencySchema.safeParse(fields(formData));
  if (!input.success) return INVALID;
  const { id, code, sdg_rate, ...rest } = input.data;
  const supabase = await createClient();
  let result: ActionResult;
  if (id) {
    result = affected(
      await supabase
        .from("currencies")
        .update(sdg_rate ? { ...rest, sdg_rate } : rest)
        .eq("id", id)
        .select("id"),
    );
  } else {
    if (!code || (code !== "USD" && !sdg_rate)) return INVALID;
    const { error } = await supabase
      .from("currencies")
      // USD: the trigger takes the store's USD rate whatever is sent.
      .insert({ ...rest, code, sdg_rate: sdg_rate ?? "1" });
    result = error ? currencyError(error) : { ok: true };
  }
  if (result.ok) revalidatePublic();
  return result;
}

function currencyError(error: { message?: string }): ActionResult {
  if (/currencies_code_key/.test(error.message ?? ""))
    return { ok: false, error: "currency_taken" };
  if (/USD_RATE_NOT_SET/.test(error.message ?? ""))
    return { ok: false, error: "usd_rate_not_set" };
  return dbError(error);
}

const settingsSchema = z.object({
  product_id: z.guid(),
  amount_decimals: z.coerce.number().int().min(0).max(3),
  fee_percent: decimal(3, 2).refine((v) => Number(v) <= 100),
  fee_fixed_sdg: decimal(9, 2),
  required_fields: z.string().max(20000),
});

/** Decimals, service fee and the fulfillment fields of one product. */
export async function saveCustomAmountSettings(
  formData: FormData,
): Promise<ActionResult> {
  if (!(await actionAdmin("settings"))) return NOT_ALLOWED;
  const input = settingsSchema.safeParse(fields(formData));
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
  const { product_id, required_fields: _raw, ...rest } = input.data;
  void _raw;
  const supabase = await createClient();
  const result = affected(
    await supabase
      .from("custom_amount_products")
      .update({ ...rest, required_fields: defs.data })
      .eq("product_id", product_id)
      .select("id"),
  );
  if (result.ok) revalidatePublic();
  return result;
}

const limitSchema = z
  .object({
    product_id: z.guid(),
    currency_code: z.string().regex(/^[A-Z]{3}$/),
    min_amount: decimal(11, 3).refine((v) => Number(v) > 0),
    max_amount: decimal(11, 3),
    sort_order: sortOrder,
  })
  .refine((l) => Number(l.max_amount) >= Number(l.min_amount));

/** Allow a currency for a product, or change its limits. */
export async function saveAmountCurrency(
  formData: FormData,
): Promise<ActionResult> {
  if (!(await actionAdmin("settings"))) return NOT_ALLOWED;
  const input = limitSchema.safeParse(fields(formData));
  if (!input.success) return INVALID;
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("custom_amount_currencies")
    .select("id")
    .eq("product_id", input.data.product_id)
    .eq("currency_code", input.data.currency_code)
    .maybeSingle();
  const { product_id, currency_code, ...limits } = input.data;
  const result = existing
    ? affected(
        await supabase
          .from("custom_amount_currencies")
          .update(limits)
          .eq("id", existing.id)
          .select("id"),
      )
    : await supabase
        .from("custom_amount_currencies")
        .insert({ product_id, currency_code, ...limits })
        .then(({ error }) =>
          error ? dbError(error) : ({ ok: true } as const),
        );
  if (result.ok) revalidatePublic();
  return result;
}

/** Stop offering a currency for a product (its limits are forgotten). */
export async function removeAmountCurrency(
  formData: FormData,
): Promise<ActionResult> {
  if (!(await actionAdmin("settings"))) return NOT_ALLOWED;
  const id = z.guid().safeParse(formData.get("id"));
  if (!id.success) return INVALID;
  const supabase = await createClient();
  const result = affected(
    await supabase
      .from("custom_amount_currencies")
      .delete()
      .eq("id", id.data)
      .select("id"),
  );
  if (result.ok) revalidatePublic();
  return result;
}
