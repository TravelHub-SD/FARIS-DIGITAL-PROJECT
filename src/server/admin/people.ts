"use server";

import { z } from "zod";

import { normalizeSudanPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import { actionAdmin, actionOwner } from "@/server/auth/session";

import {
  type ActionResult,
  affected,
  dbError,
  fields,
  INVALID,
  NOT_ALLOWED,
  revalidatePublic,
} from "./common";

// Customers (block), comments (moderation) and admins (owner only).

const blockSchema = z.object({
  userId: z.guid(),
  blocked: z.enum(["true", "false"]),
});

/** The database refuses self, the owner, and (for non-owners) other admins. */
export async function setCustomerBlocked(
  formData: FormData,
): Promise<ActionResult> {
  if (!(await actionAdmin("customers"))) return NOT_ALLOWED;
  const input = blockSchema.safeParse(fields(formData));
  if (!input.success) return INVALID;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_customer_blocked", {
    p_user_id: input.data.userId,
    p_blocked: input.data.blocked === "true",
  });
  return error ? dbError(error) : { ok: true };
}

const moderateSchema = z.object({
  id: z.guid(),
  action: z.enum(["hide", "show", "delete"]),
  reason: z.string().trim().max(300).optional(),
});

export async function moderateComment(
  formData: FormData,
): Promise<ActionResult> {
  if (!(await actionAdmin("comments"))) return NOT_ALLOWED;
  const input = moderateSchema.safeParse(fields(formData));
  if (!input.success) return INVALID;
  const supabase = await createClient();
  const { id, action, reason } = input.data;
  const res =
    action === "delete"
      ? await supabase.from("comments").delete().eq("id", id).select("id")
      : await supabase
          .from("comments")
          .update(
            action === "hide"
              ? { status: "hidden", hidden_reason: reason || null }
              : { status: "visible" },
          )
          .eq("id", id)
          .select("id");
  const result = affected(res);
  // Comments are rendered into the static product pages.
  if (result.ok) revalidatePublic();
  return result;
}

const PERMISSIONS = [
  "orders",
  "products",
  "kyc",
  "customers",
  "invoices",
  "comments",
  "settings",
] as const;

/** Owner: make an existing, phone-verified account an admin (no permissions yet). */
export async function addAdmin(formData: FormData): Promise<ActionResult> {
  if (!(await actionOwner())) return NOT_ALLOWED;
  const phone = normalizeSudanPhone(String(formData.get("phone") ?? ""));
  if (!phone) return INVALID;
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("phone_e164", phone)
    .maybeSingle();
  if (!profile) return { ok: false, error: "no_such_account" };
  const { error } = await supabase
    .from("admins")
    .insert({ user_id: profile.id });
  return error ? dbError(error) : { ok: true };
}

const permissionSchema = z.object({
  adminId: z.guid(),
  permission: z.enum(PERMISSIONS),
  granted: z.enum(["true", "false"]),
});

/** Owner: grant or revoke one permission. RLS: only the owner may. */
export async function setAdminPermission(
  formData: FormData,
): Promise<ActionResult> {
  if (!(await actionOwner())) return NOT_ALLOWED;
  const input = permissionSchema.safeParse(fields(formData));
  if (!input.success) return INVALID;
  const supabase = await createClient();
  const { adminId, permission, granted } = input.data;
  if (granted === "true") {
    const { error } = await supabase
      .from("admin_permissions")
      .upsert(
        { admin_id: adminId, permission },
        { onConflict: "admin_id,permission", ignoreDuplicates: true },
      );
    return error ? dbError(error) : { ok: true };
  }
  const res = await supabase
    .from("admin_permissions")
    .delete()
    .eq("admin_id", adminId)
    .eq("permission", permission)
    .select("admin_id");
  return affected(res);
}

const activeSchema = z.object({
  adminId: z.guid(),
  active: z.enum(["true", "false"]),
});

/** Owner: deactivate / reactivate an admin (the owner row is protected). */
export async function setAdminActive(
  formData: FormData,
): Promise<ActionResult> {
  if (!(await actionOwner())) return NOT_ALLOWED;
  const input = activeSchema.safeParse(fields(formData));
  if (!input.success) return INVALID;
  const supabase = await createClient();
  const res = await supabase
    .from("admins")
    .update({ is_active: input.data.active === "true" })
    .eq("user_id", input.data.adminId)
    .select("user_id");
  return affected(res);
}
