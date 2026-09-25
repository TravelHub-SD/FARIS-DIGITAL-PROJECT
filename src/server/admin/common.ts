import "server-only";

import { revalidatePath } from "next/cache";

import { routing, type Locale } from "@/i18n/routing";

// Shared by every admin Server Action. Each action:
//   1. checks the permission first (actionAdmin/actionOwner) — a static test
//      fails the build if one does not;
//   2. validates input on the server (Zod);
//   3. writes with the admin's OWN session, so RLS and the definer functions
//      check the permission again and the audit log names the admin.

export type ActionResult = { ok: true } | { ok: false; error: AdminErrorKey };

export type AdminErrorKey =
  | "not_allowed"
  | "invalid_input"
  | "not_found"
  | "slug_taken"
  | "in_use"
  | "server_error"
  | "reason_required"
  | "not_pending"
  | "cannot_review_own"
  | "not_awaiting_payment"
  | "invalid_transition"
  | "payment_not_accepted"
  | "note_too_long"
  | "cannot_block_self"
  | "owner_protected"
  | "admin_protected"
  | "admin_target_invalid"
  | "already_admin"
  | "no_such_account"
  | "fields_invalid"
  | "upload_failed"
  | "empty"
  | "too_large"
  | "bad_extension"
  | "bad_mime"
  | "type_mismatch"
  | "not_an_image"
  | "too_small"
  | "too_many_pixels"
  | "bad_dimensions"
  | "too_big_dimensions"
  | "not_retryable"
  | "delete_failed"
  | "already_issued";

export const NOT_ALLOWED: ActionResult = { ok: false, error: "not_allowed" };
export const INVALID: ActionResult = { ok: false, error: "invalid_input" };

const DB_ERRORS: [RegExp, AdminErrorKey][] = [
  [/FORBIDDEN|permission denied|row-level security/i, "not_allowed"],
  [/RECEIPT_REASON_REQUIRED/, "reason_required"],
  [/RECEIPT_NOT_PENDING/, "not_pending"],
  [/RECEIPT_CANNOT_REVIEW_OWN/, "cannot_review_own"],
  [/ORDER_NOT_AWAITING_PAYMENT/, "not_awaiting_payment"],
  [/INVALID_STATUS_TRANSITION/, "invalid_transition"],
  [/PAYMENT_NOT_ACCEPTED/, "payment_not_accepted"],
  [/NOTE_TOO_LONG/, "note_too_long"],
  [/CANNOT_BLOCK_SELF/, "cannot_block_self"],
  [/OWNER_PROTECTED/, "owner_protected"],
  [/ADMIN_PROTECTED/, "admin_protected"],
  [/ADMIN_TARGET_INVALID/, "admin_target_invalid"],
  [/admins_pkey/, "already_admin"],
  [/_slug_key/, "slug_taken"],
  [/foreign key/i, "in_use"],
  [/check constraint|invalid input/i, "invalid_input"],
  [/MESSAGE_NOT_RETRYABLE/, "not_retryable"],
  [/KYC_FILE_STILL_PRESENT/, "delete_failed"],
  [/VOID_REASON_REQUIRED/, "reason_required"],
  [/INVOICE_ALREADY_ISSUED/, "already_issued"],
  [/_NOT_FOUND/, "not_found"],
];

export function dbError(
  error: { message?: string } | null | undefined,
): ActionResult {
  const message = error?.message ?? "";
  const hit = DB_ERRORS.find(([re]) => re.test(message));
  if (!hit) console.error("admin action: unexpected database error", message);
  return { ok: false, error: hit ? hit[1] : "server_error" };
}

/**
 * An UPDATE/DELETE that RLS filters out affects 0 rows without an error.
 * Callers select the ids back and treat "nothing changed" as refused.
 */
export function affected(res: {
  data: unknown[] | null;
  error: { message?: string } | null;
}): ActionResult {
  if (res.error) return dbError(res.error);
  return res.data && res.data.length > 0 ? { ok: true } : NOT_ALLOWED;
}

/** FormData → plain object for Zod (checkboxes: "on" / absent). */
export function fields(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

export function formLocale(formData: FormData): Locale {
  const value = formData.get("locale");
  return routing.locales.includes(value as Locale)
    ? (value as Locale)
    : routing.defaultLocale;
}

/**
 * Catalog, prices, banner, FAQs and contacts appear on the static (ISR)
 * public pages. Edits are rare, so every public page is revalidated at once
 * instead of tracking which pages show what.
 */
export function revalidatePublic() {
  revalidatePath("/", "layout");
}
