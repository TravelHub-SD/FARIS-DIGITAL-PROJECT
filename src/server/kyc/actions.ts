"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { actionAdmin, actionCompleteUser } from "@/server/auth/session";
import { type ImageRejection, sanitizeImage } from "@/server/files/image";
import { removeUploadedFile, uploadPrivateJpeg } from "@/server/files/storage";
import { dispatchSoon } from "@/server/whatsapp";

import { KYC_DOC_TYPES } from "./constants";

export type KycError =
  | ImageRejection
  | "not_allowed"
  | "invalid_input"
  | "already_pending"
  | "already_verified"
  | "rate_limited"
  | "upload_failed"
  | "reason_required"
  | "not_pending"
  | "cannot_review_own"
  | "server_error";

export type KycResult = { ok: true } | { ok: false; error: KycError };

const DB_ERRORS: Record<string, KycError> = {
  KYC_ALREADY_PENDING: "already_pending",
  KYC_ALREADY_VERIFIED: "already_verified",
  KYC_RATE_LIMIT: "rate_limited",
  KYC_REASON_REQUIRED: "reason_required",
  KYC_NOT_PENDING: "not_pending",
  KYC_CANNOT_REVIEW_OWN: "cannot_review_own",
  FORBIDDEN: "not_allowed",
  PHONE_NOT_VERIFIED: "not_allowed",
  CUSTOMER_BLOCKED: "not_allowed",
};

function mapDbError(message: string | undefined): KycError {
  const key = Object.keys(DB_ERRORS).find((k) => message?.includes(k));
  return key ? DB_ERRORS[key] : "server_error";
}

export async function submitKyc(formData: FormData): Promise<KycResult> {
  const user = await actionCompleteUser();
  if (!user) return { ok: false, error: "not_allowed" };
  if (user.profile.kyc_status === "verified")
    return { ok: false, error: "already_verified" };
  if (user.profile.kyc_status === "pending")
    return { ok: false, error: "already_pending" };

  const docType = z.enum(KYC_DOC_TYPES).safeParse(formData.get("docType"));
  const file = formData.get("file");
  if (!docType.success || !(file instanceof File))
    return { ok: false, error: "invalid_input" };

  const image = await sanitizeImage({
    name: file.name,
    type: file.type,
    bytes: Buffer.from(await file.arrayBuffer()),
  });
  if (!image.ok) return { ok: false, error: image.error };

  const path = `${user.id}/${randomUUID()}.jpg`;
  const uploaded = await uploadPrivateJpeg("kyc-documents", path, image.jpeg);
  if (!uploaded.ok) return { ok: false, error: "upload_failed" };

  // Registered with the customer's own session: the DB re-checks ownership of
  // the path, phone verification, pending/rate limits.
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_kyc", {
    p_doc_type: docType.data,
    p_storage_path: path,
    p_file_sha256: image.sha256,
  });
  if (error) {
    await removeUploadedFile("kyc-documents", path);
    return { ok: false, error: mapDbError(error.message) };
  }
  revalidatePath("/[locale]/account", "layout");
  return { ok: true };
}

const reviewSchema = z.object({
  submissionId: z.uuid(),
  approve: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Approve/reject with the reviewer's own session (audit records the actor),
 * then delete the file (decisions.md). The customer notification is queued
 * by the database and sent after the response.
 */
export async function reviewKyc(input: unknown): Promise<KycResult> {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const reviewer = await actionAdmin("kyc");
  if (!reviewer) return { ok: false, error: "not_allowed" };

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .rpc("review_kyc", {
      p_submission_id: parsed.data.submissionId,
      p_approve: parsed.data.approve,
      p_reason: parsed.data.reason ?? null,
    })
    .single<{ user_id: string; storage_path: string | null }>();
  if (error || !row) return { ok: false, error: mapDbError(error?.message) };

  // Delete the document. If this fails the row keeps storage_path set and the
  // file shows up as "pending deletion"; the verdict itself is already final.
  if (row.storage_path) {
    const removed = await supabase.storage
      .from("kyc-documents")
      .remove([row.storage_path]);
    if (!removed.error) {
      await supabase.rpc("kyc_mark_file_deleted", {
        p_submission_id: parsed.data.submissionId,
      });
    }
  }

  // The decision queued the WhatsApp result in the same transaction (outbox);
  // it is sent after this response, and retried if Meta is unavailable.
  dispatchSoon();
  revalidatePath("/[locale]/admin/kyc", "layout");
  return { ok: true };
}
