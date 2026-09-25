"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { actionAdmin } from "@/server/auth/session";

import { type ActionResult, dbError, INVALID, NOT_ALLOWED } from "./common";

const voidSchema = z.object({
  id: z.guid(),
  reason: z.string().trim().min(1).max(500),
});

/** issued → void, with a reason (database: invoices permission, audited). */
export async function voidInvoice(formData: FormData): Promise<ActionResult> {
  if (!(await actionAdmin("invoices"))) return NOT_ALLOWED;
  const input = voidSchema.safeParse({
    id: formData.get("id"),
    reason: formData.get("reason"),
  });
  if (!input.success) {
    return String(formData.get("reason") ?? "").trim()
      ? INVALID
      : { ok: false, error: "reason_required" };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("void_invoice", {
    p_invoice_id: input.data.id,
    p_reason: input.data.reason,
  });
  if (error) return dbError(error);
  revalidatePath("/[locale]/admin/invoices", "layout");
  return { ok: true };
}

/** A new invoice (next number) for a completed order whose invoice was voided. */
export async function reissueInvoice(
  formData: FormData,
): Promise<ActionResult> {
  if (!(await actionAdmin("invoices"))) return NOT_ALLOWED;
  const orderId = z.guid().safeParse(formData.get("orderId"));
  if (!orderId.success) return INVALID;
  const supabase = await createClient();
  const { error } = await supabase.rpc("reissue_invoice", {
    p_order_id: orderId.data,
  });
  if (error) return dbError(error);
  revalidatePath("/[locale]/admin/invoices", "layout");
  return { ok: true };
}
