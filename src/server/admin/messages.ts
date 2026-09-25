"use server";

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { actionAdmin } from "@/server/auth/session";
import { dispatchSoon } from "@/server/whatsapp";

import { type ActionResult, dbError, INVALID, NOT_ALLOWED } from "./common";

const idSchema = z.guid();

/** Staff contacted the customer another way: close the alert (audited). */
export async function markMessageHandled(
  formData: FormData,
): Promise<ActionResult> {
  if (!(await actionAdmin("orders"))) return NOT_ALLOWED;
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return INVALID;
  const supabase = await createClient();
  const { error } = await supabase.rpc("whatsapp_mark_handled", {
    p_id: id.data,
  });
  return error ? dbError(error) : { ok: true };
}

/** One more attempt for a failed notification (audited), sent right away. */
export async function retryMessage(formData: FormData): Promise<ActionResult> {
  if (!(await actionAdmin("orders"))) return NOT_ALLOWED;
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return INVALID;
  const supabase = await createClient();
  const { error } = await supabase.rpc("whatsapp_retry", { p_id: id.data });
  if (error) return dbError(error);
  dispatchSoon();
  return { ok: true };
}
