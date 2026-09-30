"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getSessionUser, isComplete } from "@/server/auth/session";
import { type ImageRejection, sanitizeImage } from "@/server/files/image";
import { removeUploadedFile, uploadPrivateJpeg } from "@/server/files/storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
