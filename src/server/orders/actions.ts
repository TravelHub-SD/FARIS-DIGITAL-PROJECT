"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { routing } from "@/i18n/routing";
import {
  type FieldErrorCode,
  fieldDefinitionsSchema,
  validateFulfillment,
} from "@/lib/fulfillment";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, isComplete } from "@/server/auth/session";
import { getVisibleVariant } from "@/server/catalog/queries";
import { type ImageRejection, sanitizeImage } from "@/server/files/image";
import { removeUploadedFile, uploadPrivateJpeg } from "@/server/files/storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type PlaceOrderError =
  | "sign_in"
  | "incomplete_account"
  | "kyc_required"
  | "phone_not_verified"
  | "customer_blocked"
  | "variant_unavailable"
  | "invalid_quantity"
  | "fulfillment_invalid"
  | "rate_limited"
  | "invalid_input"
  | "server_error";

export type PlaceOrderState =
  | { status: "idle" }
  | {
      status: "invalid";
      errors: Record<string, FieldErrorCode | "unavailable">;
    }
  | {
      status: "price_changed";
      variantId: string;
      quantity: number;
      totalSdg: number;
    }
  | { status: "error"; reason: PlaceOrderError };

type CreateOrderResult =
  | { status: "created"; id: string; reference: string }
  | { status: "price_changed"; total_sdg: number }
  | { status: "error"; reason: PlaceOrderError };

/**
 * Validates the fulfillment fields, then asks the database to create the
 * order. The browser sends variant, quantity, fields and the total it showed
 * the customer; the database computes the real total and refuses (with the
 * current price) if they differ. Nothing price-related is taken from here.
 */
export async function placeOrder(
  _prev: PlaceOrderState,
  formData: FormData,
): Promise<PlaceOrderState> {
  const variantId = formData.get("variantId");
  const locale = formData.get("locale");
  const quantity = Number(formData.get("quantity") ?? "1");
  const expected = formData.get("expectedTotalSdg");
  const idempotencyKey = formData.get("idempotencyKey");
  if (typeof variantId !== "string" || !UUID.test(variantId)) {
    return { status: "invalid", errors: { _form: "unavailable" } };
  }
  if (
    !routing.locales.includes(locale as never) ||
    !Number.isInteger(quantity) ||
    typeof expected !== "string" ||
    !/^\d{1,15}$/.test(expected) ||
    typeof idempotencyKey !== "string" ||
    !UUID.test(idempotencyKey)
  ) {
    return { status: "error", reason: "invalid_input" };
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
  const fields = validateFulfillment(defs.data, input);
  if (!fields.ok || duplicated.size) {
    const errors: Record<string, FieldErrorCode> = fields.ok
      ? {}
      : { ...fields.errors };
    for (const key of duplicated) errors[key] = "type";
    return { status: "invalid", errors };
  }

  const user = await getSessionUser();
  if (!user) return { status: "error", reason: "sign_in" };
  if (!isComplete(user))
    return { status: "error", reason: "incomplete_account" };

  // The customer's own session: auth.uid() is the buyer and the audit actor.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_order", {
    p_variant_id: variantId,
    p_quantity: quantity,
    p_fulfillment: fields.data,
    p_idempotency_key: idempotencyKey,
    p_expected_total_sdg: expected,
  });
  if (error || !data) return { status: "error", reason: "server_error" };
  const result = data as CreateOrderResult;

  if (result.status === "price_changed") {
    return {
      status: "price_changed",
      variantId,
      quantity,
      totalSdg: Number(result.total_sdg),
    };
  }
  if (result.status === "error") return result;

  revalidatePath(`/${locale}/account/orders`);
  redirect(`/${locale}/account/orders/${result.reference}`);
}

export type ReceiptError =
  | ImageRejection
  | "not_allowed"
  | "invalid_input"
  | "not_found"
  | "not_awaiting_payment"
  | "already_pending"
  | "already_accepted"
  | "too_many_receipts"
  | "bank_invalid"
  | "reference_invalid"
  | "duplicate_transaction"
  | "duplicate_file"
  | "upload_failed"
  | "server_error";

export type ReceiptResult = { ok: true } | { ok: false; error: ReceiptError };

const RECEIPT_DB_ERRORS: Record<string, ReceiptError> = {
  ORDER_NOT_FOUND: "not_found",
  ORDER_NOT_AWAITING_PAYMENT: "not_awaiting_payment",
  RECEIPT_ALREADY_PENDING: "already_pending",
  PAYMENT_ALREADY_ACCEPTED: "already_accepted",
  RECEIPT_LIMIT: "too_many_receipts",
  BANK_ACCOUNT_INVALID: "bank_invalid",
  TRANSACTION_REF_INVALID: "reference_invalid",
  DUPLICATE_TRANSACTION: "duplicate_transaction",
  DUPLICATE_RECEIPT_FILE: "duplicate_file",
};

function mapReceiptError(message: string | undefined): ReceiptError {
  const key = Object.keys(RECEIPT_DB_ERRORS).find((k) => message?.includes(k));
  return key ? RECEIPT_DB_ERRORS[key] : "server_error";
}

/**
 * Receipt upload: validate + re-encode the image (EXIF stripped), store it in
 * the private bucket with its hash in the object's metadata, then register it
 * with the customer's own session. The database checks ownership, order state,
 * bank account, transaction number format and duplicates.
 */
export async function submitReceipt(
  formData: FormData,
): Promise<ReceiptResult> {
  const user = await getSessionUser();
  if (!user || !isComplete(user)) return { ok: false, error: "not_allowed" };

  const orderId = formData.get("orderId");
  const bankAccountId = formData.get("bankAccountId");
  const transactionRef = formData.get("transactionRef");
  const file = formData.get("file");
  if (
    typeof orderId !== "string" ||
    !UUID.test(orderId) ||
    typeof bankAccountId !== "string" ||
    !UUID.test(bankAccountId) ||
    typeof transactionRef !== "string" ||
    transactionRef.length > 64
  ) {
    return { ok: false, error: "invalid_input" };
  }
  if (!(file instanceof File)) return { ok: false, error: "empty" };

  // Cheap pre-check before any upload. RLS plus the explicit user filter:
  // staff with the orders permission cannot attach receipts to others' orders.
  const supabase = await createClient();
  const { data: order } = await supabase
    .from("orders")
    .select("id, status")
    .eq("id", orderId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!order) return { ok: false, error: "not_found" };
  if (order.status !== "new")
    return { ok: false, error: "not_awaiting_payment" };

  const image = await sanitizeImage({
    name: file.name,
    type: file.type,
    bytes: Buffer.from(await file.arrayBuffer()),
  });
  if (!image.ok) return { ok: false, error: image.error };

  const path = `${user.id}/${orderId}/${randomUUID()}.jpg`;
  const uploaded = await uploadPrivateJpeg(
    "payment-receipts",
    path,
    image.jpeg,
    {
      sha256: image.sha256,
    },
  );
  if (!uploaded.ok) return { ok: false, error: "upload_failed" };

  const { error } = await supabase.rpc("submit_receipt", {
    p_order_id: orderId,
    p_bank_account_id: bankAccountId,
    p_transaction_ref: transactionRef,
    p_storage_path: path,
  });
  if (error) {
    await removeUploadedFile("payment-receipts", path);
    return { ok: false, error: mapReceiptError(error.message) };
  }
  revalidatePath("/[locale]/account/orders", "layout");
  return { ok: true };
}
