import "server-only";

import { createClient } from "@/lib/supabase/server";

import { KYC_SIGNED_URL_TTL_SECONDS } from "./constants";

export type KycQueueItem = {
  id: string;
  doc_type: string;
  created_at: string;
  user_id: string;
  customer: { full_name: string | null; phone_e164: string | null } | null;
};

/** RLS limits this to reviewers with the `kyc` permission. */
export async function listPendingKyc(): Promise<KycQueueItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("kyc_submissions")
    .select("id, doc_type, created_at, user_id")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(100);
  const rows = data ?? [];
  if (rows.length === 0) return [];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, phone_e164")
    .in(
      "id",
      rows.map((r) => r.user_id),
    );
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
  return rows.map((r) => ({ ...r, customer: byId.get(r.user_id) ?? null }));
}

export async function getKycForReview(submissionId: string) {
  const supabase = await createClient();
  const { data: submission } = await supabase
    .from("kyc_submissions")
    .select(
      "id, user_id, doc_type, status, created_at, storage_path, rejection_reason",
    )
    .eq("id", submissionId)
    .maybeSingle();
  if (!submission) return null;
  const { data: customer } = await supabase
    .from("profiles")
    .select("full_name, phone_e164, kyc_status")
    .eq("id", submission.user_id)
    .maybeSingle();

  let imageUrl: string | null = null;
  if (submission.storage_path) {
    // Logs the view in the audit trail, then signs with the reviewer's own
    // session (storage policy: `kyc` permission). Nothing is cached.
    const { data: path } = await supabase.rpc("kyc_open_document", {
      p_submission_id: submissionId,
    });
    if (typeof path === "string") {
      const signed = await supabase.storage
        .from("kyc-documents")
        .createSignedUrl(path, KYC_SIGNED_URL_TTL_SECONDS);
      imageUrl = signed.data?.signedUrl ?? null;
    }
  }
  return { submission, customer, imageUrl };
}
