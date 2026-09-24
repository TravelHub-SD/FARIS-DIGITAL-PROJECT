import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

// Writes to private buckets happen only here, after sanitizeImage(). Customers
// have no storage insert policy on private buckets.
// `metadata` lands in storage.objects.user_metadata, which only this
// service-role upload can set: the database reads the receipt hash from there
// instead of trusting a value sent with the registration call.
export async function uploadPrivateJpeg(
  bucket: "kyc-documents" | "payment-receipts",
  path: string,
  jpeg: Buffer,
  metadata?: Record<string, string>,
) {
  const { error } = await createAdminClient()
    .storage.from(bucket)
    .upload(path, jpeg, { contentType: "image/jpeg", upsert: false, metadata });
  return { ok: !error };
}

/** Cleanup of a file the server just uploaded but could not register. */
export async function removeUploadedFile(
  bucket: "kyc-documents" | "payment-receipts",
  path: string,
) {
  await createAdminClient().storage.from(bucket).remove([path]);
}
