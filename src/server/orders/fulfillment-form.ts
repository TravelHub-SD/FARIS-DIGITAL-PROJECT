import "server-only";

import {
  type FieldDefinition,
  type FieldErrorCode,
  validateFulfillment,
} from "@/lib/fulfillment";

/**
 * The fulfillment fields of a form, validated against the variant's
 * definitions. Fields live under "f."; nothing else in the form is data. A
 * field sent twice, or a file, is a type error.
 */
export function readFulfillmentForm(
  formData: FormData,
  defs: FieldDefinition[],
):
  | { ok: true; data: Record<string, string> }
  | { ok: false; errors: Record<string, FieldErrorCode> } {
  const input: Record<string, unknown> = {};
  const duplicated = new Set<string>();
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith("f.")) continue;
    const key = name.slice(2);
    if (key in input) duplicated.add(key);
    input[key] = value; // a File is not a string → "type"
  }
  const fields = validateFulfillment(defs, input);
  if (fields.ok && duplicated.size === 0) return fields;
  const errors: Record<string, FieldErrorCode> = fields.ok
    ? {}
    : { ...fields.errors };
  for (const key of duplicated) errors[key] = "type";
  return { ok: false, errors };
}
