import { z } from "zod";

import { normalizeSudanPhone, toLatinDigits } from "@/lib/phone";

// Fulfillment fields declared per variant (product_variants.required_fields).
// This file mirrors the database: private.valid_field_definitions() checks the
// same definition shape and private.fulfillment_errors() re-validates the
// normalised data inside the order trigger. Shared by client and server; the
// server's result is the one that counts, the database is the final gate.

export const FIELD_TYPES = [
  "text",
  "digits",
  "phone",
  "email",
  "select",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

const label = z.string().min(1).max(80);

const optionSchema = z
  .object({
    value: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
    label_ar: label.optional(),
    label_en: label.optional(),
  })
  .strict()
  .refine((o) => o.label_ar || o.label_en, "label_required");

export const fieldDefinitionSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    type: z.enum(FIELD_TYPES),
    label_ar: label.optional(),
    label_en: label.optional(),
    required: z.boolean(),
    min_length: z.number().int().min(1).max(200).optional(),
    max_length: z.number().int().min(1).max(200).optional(),
    options: z.array(optionSchema).min(1).max(50).optional(),
    sensitive: z.boolean().optional(),
  })
  .strict()
  .superRefine((f, ctx) => {
    if (!f.label_ar && !f.label_en)
      ctx.addIssue({ code: "custom", message: "label_required" });
    const hasLengths = f.min_length !== undefined || f.max_length !== undefined;
    if (hasLengths && f.type !== "text" && f.type !== "digits") {
      ctx.addIssue({
        code: "custom",
        message: "lengths_only_for_text_or_digits",
      });
    }
    if ((f.min_length ?? 1) > (f.max_length ?? 100))
      ctx.addIssue({ code: "custom", message: "min_gt_max" });
    if ((f.type === "select") !== (f.options !== undefined)) {
      ctx.addIssue({ code: "custom", message: "options_iff_select" });
    }
    const values = f.options?.map((o) => o.value) ?? [];
    if (new Set(values).size !== values.length)
      ctx.addIssue({ code: "custom", message: "duplicate_option" });
  });

export const fieldDefinitionsSchema = z
  .array(fieldDefinitionSchema)
  .max(10)
  .superRefine((defs, ctx) => {
    const keys = defs.map((d) => d.key);
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({ code: "custom", message: "duplicate_key" });
  });

export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>;
export type FieldErrorCode =
  "missing" | "unknown" | "type" | "length" | "format" | "option";
export type FulfillmentResult =
  | { ok: true; data: Record<string, string> }
  | { ok: false; errors: Record<string, FieldErrorCode> };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

function limits(def: FieldDefinition) {
  return {
    min: def.min_length ?? 1,
    max: def.max_length ?? (def.type === "email" ? 254 : 100),
  };
}

/**
 * Validates and normalises submitted values against a variant's definitions.
 * Unknown keys, missing required values, non-string values, bad formats and
 * values outside a select's options are all rejected. Empty optional fields
 * are omitted from the result.
 */
export function validateFulfillment(
  defs: FieldDefinition[],
  input: Record<string, unknown>,
): FulfillmentResult {
  const errors: Record<string, FieldErrorCode> = {};
  const data: Record<string, string> = {};
  const known = new Set(defs.map((d) => d.key));

  for (const key of Object.keys(input)) {
    if (!known.has(key)) errors[key] = "unknown";
  }

  for (const def of defs) {
    const raw = input[def.key];
    if (
      raw === undefined ||
      raw === null ||
      (typeof raw === "string" && raw.trim() === "")
    ) {
      if (def.required) errors[def.key] = "missing";
      continue;
    }
    if (typeof raw !== "string") {
      errors[def.key] = "type";
      continue;
    }
    let value = raw.trim();
    if (CONTROL.test(value)) {
      errors[def.key] = "format";
      continue;
    }

    if (def.type === "digits") value = toLatinDigits(value).replace(/\s+/g, "");
    if (def.type === "phone") {
      const e164 = normalizeSudanPhone(value);
      if (!e164) {
        errors[def.key] = "format";
        continue;
      }
      value = e164;
    }

    const { min, max } = limits(def);
    const length = [...value].length; // code points, like SQL char_length
    if (length < min || length > max) errors[def.key] = "length";
    else if (def.type === "digits" && !/^[0-9]+$/.test(value))
      errors[def.key] = "format";
    else if (def.type === "email" && !EMAIL.test(value))
      errors[def.key] = "format";
    else if (
      def.type === "select" &&
      !def.options?.some((o) => o.value === value)
    )
      errors[def.key] = "option";
    else data[def.key] = value;
  }

  return Object.keys(errors).length
    ? { ok: false, errors }
    : { ok: true, data };
}
