"use server";

import {
  type FieldErrorCode,
  fieldDefinitionsSchema,
  validateFulfillment,
} from "@/lib/fulfillment";

import { getVisibleVariant } from "./queries";

export type OrderDetailsState =
  | { status: "idle" }
  | {
      status: "invalid";
      errors: Record<string, FieldErrorCode | "unavailable">;
    }
  | { status: "valid"; variantId: string; values: Record<string, string> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Server-side validation of a variant's fulfillment fields. The browser's
 * HTML validation is a convenience only; this runs on every submission and
 * the order trigger re-checks the same rules in the database (Phase 5 turns
 * a valid result into an order).
 */
export async function checkOrderDetails(
  _prev: OrderDetailsState,
  formData: FormData,
): Promise<OrderDetailsState> {
  const variantId = formData.get("variantId");
  if (typeof variantId !== "string" || !UUID.test(variantId)) {
    return { status: "invalid", errors: { _form: "unavailable" } };
  }
  // Read as anon: a hidden/inactive/archived variant (or one whose product or
  // category is hidden) does not exist here, even if its id is forged.
  const variant = await getVisibleVariant(variantId);
  const defs = variant
    ? fieldDefinitionsSchema.safeParse(variant.required_fields)
    : null;
  if (!variant || !defs?.success)
    return { status: "invalid", errors: { _form: "unavailable" } };

  const input: Record<string, unknown> = {};
  const duplicated = new Set<string>();
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith("f.")) continue; // fields live under "f."; nothing else is data
    const key = name.slice(2);
    if (key in input) duplicated.add(key);
    input[key] = value; // a File is not a string → "type"
  }

  const result = validateFulfillment(defs.data, input);
  if (!result.ok || duplicated.size) {
    const errors: Record<string, FieldErrorCode> = result.ok
      ? {}
      : { ...result.errors };
    for (const key of duplicated) errors[key] = "type";
    return { status: "invalid", errors };
  }
  return { status: "valid", variantId, values: result.data };
}
