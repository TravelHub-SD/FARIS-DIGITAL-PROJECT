"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { actionAdmin } from "@/server/auth/session";

import { type ActionResult, dbError, INVALID, NOT_ALLOWED } from "./common";

const idSchema = z.guid();

/**
 * Deletes a reviewed identity document whose deletion failed right after the
 * verdict. Runs with the reviewer's own session: the storage policy only lets
 * `kyc` staff delete documents that are no longer pending, and
 * kyc_mark_file_deleted() refuses while the object still exists (audited).
 */
export async function deleteReviewedKycFile(
  formData: FormData,
): Promise<ActionResult> {
  if (!(await actionAdmin("kyc"))) return NOT_ALLOWED;
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return INVALID;
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("kyc_submissions")
    .select("id, status, storage_path")
    .eq("id", id.data)
    .maybeSingle();
  if (error) return dbError(error);
  if (!row || row.status === "pending" || !row.storage_path) {
    return { ok: false, error: "not_found" };
  }
  const removed = await supabase.storage
    .from("kyc-documents")
    .remove([row.storage_path]);
  // Storage answers "ok" with an empty list when a policy blocked the delete.
  if (removed.error || removed.data?.length !== 1) {
    return { ok: false, error: "delete_failed" };
  }
  const marked = await supabase.rpc("kyc_mark_file_deleted", {
    p_submission_id: id.data,
  });
  if (marked.error) return dbError(marked.error);
  revalidatePath("/[locale]/admin", "layout");
  return { ok: true };
}
