"use server";

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { actionAdmin } from "@/server/auth/session";

import {
  type ActionResult,
  dbError,
  fields,
  INVALID,
  NOT_ALLOWED,
} from "./common";

const reviewSchema = z.object({
  receiptId: z.guid(),
  decision: z.enum(["accept", "reject"]),
  reason: z.string().trim().max(500).optional(),
});

/** Accept (→ order moves to processing) or reject with a reason. */
export async function reviewReceipt(formData: FormData): Promise<ActionResult> {
  if (!(await actionAdmin("orders"))) return NOT_ALLOWED;
  const input = reviewSchema.safeParse(fields(formData));
  if (!input.success) return INVALID;
  const accept = input.data.decision === "accept";
  if (!accept && !input.data.reason)
    return { ok: false, error: "reason_required" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_receipt", {
    p_receipt_id: input.data.receiptId,
    p_accept: accept,
    p_reason: accept ? null : input.data.reason,
  });
  return error ? dbError(error) : { ok: true };
}

const statusSchema = z.object({
  orderId: z.guid(),
  to: z.enum(["new", "processing", "completed", "cancelled"]),
  customerNote: z.string().trim().max(500).optional(),
});

/** Transition rules live in the database; this only forwards the request. */
export async function changeOrderStatus(
  formData: FormData,
): Promise<ActionResult> {
  if (!(await actionAdmin("orders"))) return NOT_ALLOWED;
  const input = statusSchema.safeParse(fields(formData));
  if (!input.success) return INVALID;

  const supabase = await createClient();
  const { error } = await supabase.rpc("change_order_status", {
    p_order_id: input.data.orderId,
    p_to_status: input.data.to,
    p_customer_note: input.data.customerNote || null,
  });
  return error ? dbError(error) : { ok: true };
}

const noteSchema = z.object({
  orderId: z.guid(),
  body: z.string().trim().min(1).max(2000),
});

/** Internal notes: staff only, never shown to customers, append-only. */
export async function addInternalNote(
  formData: FormData,
): Promise<ActionResult> {
  if (!(await actionAdmin("orders"))) return NOT_ALLOWED;
  const input = noteSchema.safeParse(fields(formData));
  if (!input.success) return INVALID;

  const supabase = await createClient();
  const { error } = await supabase
    .from("order_internal_notes")
    .insert({ order_id: input.data.orderId, body: input.data.body });
  return error ? dbError(error) : { ok: true };
}
