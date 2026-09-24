import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

// Writes to private buckets happen only here, after sanitizeImage(). Customers
// have no storage insert policy on private buckets.
export async function uploadPrivateJpeg(
  bucket: "kyc-documents" | "payment-receipts",
  path: string,
  jpeg: Buffer,
) {
  const { error } = await createAdminClient()
    .storage.from(bucket)
    .upload(path, jpeg, { contentType: "image/jpeg", upsert: false });
  return { ok: !error };
}

/** Cleanup of a file the server just uploaded but could not register. */
export async function removeUploadedFile(
  bucket: "kyc-documents" | "payment-receipts",
  path: string,
) {
  await createAdminClient().storage.from(bucket).remove([path]);
}
