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

/** Identity documents may not linger: anything waiting over 24 h is an alert. */
export const KYC_DELETION_ALERT_HOURS = 24;

export type PendingDeletion = {
  id: string;
  status: "accepted" | "rejected";
  reviewed_at: string;
  doc_type: string;
  overdue: boolean;
};

/**
 * Reviewed documents whose file is still in storage: the deletion right after
 * the verdict failed (docs/decisions.md). Reviewers delete them from the KYC
 * page with their own session.
 */
export async function listPendingDeletion(): Promise<PendingDeletion[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kyc_submissions")
    .select("id, status, reviewed_at, doc_type")
    .neq("status", "pending")
    .not("storage_path", "is", null)
    .order("reviewed_at", { ascending: true })
    .limit(100);
  if (error) throw new Error(`pending deletion query failed: ${error.message}`);
  const before = Date.now() - KYC_DELETION_ALERT_HOURS * 3600 * 1000;
  return (data ?? []).map((r) => ({
    ...(r as Omit<PendingDeletion, "overdue">),
    overdue: new Date(r.reviewed_at as string).getTime() < before,
  }));
}

export async function kycDeletionOverdue(): Promise<{
  count: number;
  oldest: string | null;
}> {
  const supabase = await createClient();
  const before = new Date(
    Date.now() - KYC_DELETION_ALERT_HOURS * 3600 * 1000,
  ).toISOString();
  const { data, count } = await supabase
    .from("kyc_submissions")
    .select("reviewed_at", { count: "exact" })
    .neq("status", "pending")
    .not("storage_path", "is", null)
    .lt("reviewed_at", before)
    .order("reviewed_at", { ascending: true })
    .limit(1);
  return { count: count ?? 0, oldest: data?.[0]?.reviewed_at ?? null };
}
