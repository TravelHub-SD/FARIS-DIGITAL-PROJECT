"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { routing } from "@/i18n/routing";
import { type FieldErrorCode, fieldDefinitionsSchema } from "@/lib/fulfillment";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, isComplete } from "@/server/auth/session";
import { getVisibleVariant } from "@/server/catalog/queries";
import { readFulfillmentForm } from "@/server/orders/fulfillment-form";
import { dispatchSoon } from "@/server/whatsapp";

// Cart mutations run with the customer's own session: RLS limits them to the
// caller's lines and the cart trigger re-checks the variant, quantity and
// fulfillment data. No price is ever sent to or stored in the cart.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type CartError =
  | "sign_in"
  | "incomplete_account"
  | "variant_unavailable"
  | "invalid_quantity"
  | "fulfillment_invalid"
  | "cart_full"
  | "customer_blocked"
  | "not_found"
  | "invalid_input"
  | "server_error";

export type CartResult =
  | { ok: true }
  | {
      ok: false;
      error: CartError;
      errors?: Record<string, FieldErrorCode>;
    };

const CART_DB_ERRORS: [string, CartError][] = [
  ["CART_FULL", "cart_full"],
  ["VARIANT_UNAVAILABLE", "variant_unavailable"],
  ["INVALID_QUANTITY", "invalid_quantity"],
  ["FULFILLMENT_INVALID", "fulfillment_invalid"],
  ["CUSTOMER_BLOCKED", "customer_blocked"],
  ["quantity_check", "invalid_quantity"],
];

function mapCartError(message: string | undefined): CartError {
  return (
    CART_DB_ERRORS.find(([k]) => message?.includes(k))?.[1] ?? "server_error"
  );
}

function readQuantity(formData: FormData): number | null {
  const raw = formData.get("quantity");
  const q = Number(typeof raw === "string" ? raw : "1");
  return Number.isInteger(q) && q >= 1 && q <= 10 ? q : null;
}

function refresh() {
  // Pages render per request; this drops the client router cache so the
  // cart badge and cart page show the change.
  revalidatePath("/", "layout");
}

/**
 * Adds a variant with its fulfillment data. The same variant with the same
 * data again raises the quantity of the existing line (up to the variant's
 * maximum) instead of adding a second line.
 */
export async function addToCart(formData: FormData): Promise<CartResult> {
  const variantId = formData.get("variantId");
  const quantity = readQuantity(formData);
  if (typeof variantId !== "string" || !UUID.test(variantId) || !quantity)
    return { ok: false, error: "invalid_input" };

  const user = await getSessionUser();
  if (!user) return { ok: false, error: "sign_in" };

  // Read as anon: a hidden variant does not exist here, even if forged.
  const variant = await getVisibleVariant(variantId);
  const defs = variant
    ? fieldDefinitionsSchema.safeParse(variant.required_fields)
    : null;
  if (!variant || !defs?.success)
    return { ok: false, error: "variant_unavailable" };
  const fields = readFulfillmentForm(formData, defs.data);
  if (!fields.ok)
    return { ok: false, error: "fulfillment_invalid", errors: fields.errors };

  const supabase = await createClient();
  const { data: same } = await supabase
    .from("cart_items")
    .select("id, quantity")
    .eq("user_id", user.id)
    .eq("variant_id", variantId)
    .eq("fulfillment_data", JSON.stringify(fields.data))
    .limit(1)
    .maybeSingle();

  const { error } = same
    ? await supabase
        .from("cart_items")
        .update({ quantity: same.quantity + quantity })
        .eq("id", same.id)
    : await supabase.from("cart_items").insert({
        variant_id: variantId,
        quantity,
        fulfillment_data: fields.data,
      });
  if (error) return { ok: false, error: mapCartError(error.message) };
  refresh();
  return { ok: true };
}

/** Changes a line's quantity and, when "f." fields are sent, its details. */
export async function updateCartLine(formData: FormData): Promise<CartResult> {
  const lineId = formData.get("lineId");
  const quantity = readQuantity(formData);
  if (typeof lineId !== "string" || !UUID.test(lineId) || !quantity)
    return { ok: false, error: "invalid_input" };
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "sign_in" };

  const supabase = await createClient();
  const { data: line } = await supabase
    .from("cart_items")
    .select("id, variant_id")
    .eq("id", lineId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!line) return { ok: false, error: "not_found" };

  const patch: { quantity: number; fulfillment_data?: Record<string, string> } =
    { quantity };
  if ([...formData.keys()].some((k) => k.startsWith("f."))) {
    const variant = await getVisibleVariant(line.variant_id);
    const defs = variant
      ? fieldDefinitionsSchema.safeParse(variant.required_fields)
      : null;
    if (!variant || !defs?.success)
      return { ok: false, error: "variant_unavailable" };
    const fields = readFulfillmentForm(formData, defs.data);
    if (!fields.ok)
      return { ok: false, error: "fulfillment_invalid", errors: fields.errors };
    patch.fulfillment_data = fields.data;
  }

  const { error } = await supabase
    .from("cart_items")
    .update(patch)
    .eq("id", lineId);
  if (error) return { ok: false, error: mapCartError(error.message) };
  refresh();
  return { ok: true };
}

export async function removeCartLine(formData: FormData): Promise<CartResult> {
  const lineId = formData.get("lineId");
  if (typeof lineId !== "string" || !UUID.test(lineId))
    return { ok: false, error: "invalid_input" };
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "sign_in" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("cart_items")
    .delete()
    .eq("id", lineId)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: "server_error" };
  refresh();
  return { ok: true };
}

export type CheckoutError =
  | "sign_in"
  | "incomplete_account"
  | "cart_empty"
  | "kyc_required"
  | "phone_not_verified"
  | "customer_blocked"
  | "variant_unavailable"
  | "invalid_quantity"
  | "fulfillment_invalid"
  | "rate_limited"
  | "invalid_input"
  | "server_error";

export type CheckoutState =
  | { status: "idle" }
  | { status: "price_changed"; totalSdg: number }
  | { status: "error"; reason: CheckoutError; lines?: string[] };

type CheckoutResult =
  | { status: "created"; id: string; reference: string }
  | { status: "price_changed"; total_sdg: number }
  | { status: "error"; reason: CheckoutError; lines?: string[] };

/**
 * The whole cart becomes one order. The page sends only the total it showed
 * (consent) and an idempotency key; the database re-reads, re-prices and
 * re-validates every line and refuses with the current total if it differs.
 */
export async function checkoutCart(
  _prev: CheckoutState,
  formData: FormData,
): Promise<CheckoutState> {
  const locale = formData.get("locale");
  const expected = formData.get("expectedTotalSdg");
  const idempotencyKey = formData.get("idempotencyKey");
  if (
    !routing.locales.includes(locale as never) ||
    typeof expected !== "string" ||
    !/^\d{1,15}$/.test(expected) ||
    typeof idempotencyKey !== "string" ||
    !UUID.test(idempotencyKey)
  ) {
    return { status: "error", reason: "invalid_input" };
  }

  const user = await getSessionUser();
  if (!user) return { status: "error", reason: "sign_in" };
  if (!isComplete(user))
    return { status: "error", reason: "incomplete_account" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("checkout_cart", {
    p_idempotency_key: idempotencyKey,
    p_expected_total_sdg: expected,
  });
  if (error || !data) return { status: "error", reason: "server_error" };
  const result = data as CheckoutResult;
  if (result.status === "price_changed")
    return { status: "price_changed", totalSdg: Number(result.total_sdg) };
  if (result.status === "error") return result;

  // "Order received" was queued with the order (outbox).
  dispatchSoon();
  refresh();
  redirect(`/${locale}/account/orders/${result.reference}`);
}
