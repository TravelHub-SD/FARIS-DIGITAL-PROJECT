"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { routing } from "@/i18n/routing";
import {
  type FieldDefinition,
  type FieldErrorCode,
  fieldDefinitionsSchema,
} from "@/lib/fulfillment";
import { compareDecimal, parseAmount } from "@/lib/custom-amount";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, isComplete } from "@/server/auth/session";
import {
  getVisibleCustomAmount,
  getVisibleVariant,
} from "@/server/catalog/queries";
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
  | "server_error"
  // Custom-amount lines (the database's AMOUNT_* / CURRENCY_* checks).
  | "currency_unavailable"
  | "amount_invalid"
  | "amount_decimals"
  | "amount_below_min"
  | "amount_above_max";

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
  ["PRODUCT_UNAVAILABLE", "variant_unavailable"],
  ["PRICING_NOT_CONFIGURED", "variant_unavailable"],
  ["CURRENCY_UNAVAILABLE", "currency_unavailable"],
  ["AMOUNT_DECIMALS", "amount_decimals"],
  ["AMOUNT_BELOW_MIN", "amount_below_min"],
  ["AMOUNT_ABOVE_MAX", "amount_above_max"],
  ["AMOUNT_INVALID", "amount_invalid"],
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

/**
 * Adds a custom-amount line: product, currency, the amount as typed (Arabic
 * digits and separators accepted) and the details. Never a price: the cart
 * trigger re-reads the rate, limits and fee (private.custom_amount_quote) and
 * the cart and checkout price the line from them. Checked here first only to
 * answer with a precise message; the database decides.
 */
export async function addCustomAmountToCart(
  formData: FormData,
): Promise<CartResult> {
  const productId = formData.get("productId");
  const currency = formData.get("currency");
  const rawAmount = formData.get("amount");
  if (
    typeof productId !== "string" ||
    !UUID.test(productId) ||
    typeof currency !== "string" ||
    !/^[A-Z]{3}$/.test(currency) ||
    typeof rawAmount !== "string" ||
    rawAmount.length > 40
  )
    return { ok: false, error: "invalid_input" };

  const user = await getSessionUser();
  if (!user) return { ok: false, error: "sign_in" };

  // Read as anon: a hidden product or a disabled currency does not exist here.
  const settings = await getVisibleCustomAmount(productId);
  if (!settings) return { ok: false, error: "variant_unavailable" };
  const allowed = settings.currencies.find((c) => c.code === currency);
  if (!allowed) return { ok: false, error: "currency_unavailable" };
  const amount = parseAmount(rawAmount, settings.decimals);
  if (!amount.ok)
    return {
      ok: false,
      error: amount.error === "decimals" ? "amount_decimals" : "amount_invalid",
    };
  if (compareDecimal(amount.value, allowed.min) < 0)
    return { ok: false, error: "amount_below_min" };
  if (compareDecimal(amount.value, allowed.max) > 0)
    return { ok: false, error: "amount_above_max" };
  const fields = readFulfillmentForm(formData, settings.fields);
  if (!fields.ok)
    return { ok: false, error: "fulfillment_invalid", errors: fields.errors };

  const supabase = await createClient();
  const { error } = await supabase.from("cart_items").insert({
    product_id: productId,
    currency_code: currency,
    // A decimal string: never a float on the way to the numeric column.
    amount: amount.value,
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
    .select("id, variant_id, product_id")
    .eq("id", lineId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!line) return { ok: false, error: "not_found" };
  // A custom-amount line is always one (the amount is the quantity).
  if (!line.variant_id && quantity !== 1)
    return { ok: false, error: "invalid_quantity" };

  const patch: { quantity: number; fulfillment_data?: Record<string, string> } =
    { quantity };
  if ([...formData.keys()].some((k) => k.startsWith("f."))) {
    let defs: FieldDefinition[] | null = null;
    if (line.variant_id) {
      const variant = await getVisibleVariant(line.variant_id);
      const parsed = variant
        ? fieldDefinitionsSchema.safeParse(variant.required_fields)
        : null;
      defs = parsed?.success ? parsed.data : null;
    } else {
      defs = (await getVisibleCustomAmount(line.product_id))?.fields ?? null;
    }
    if (!defs) return { ok: false, error: "variant_unavailable" };
    const fields = readFulfillmentForm(formData, defs);
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
  | "currency_unavailable"
  | "amount_invalid"
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
  redirect(`/${locale}/account/orders/${result.reference}?placed=1`);
}
