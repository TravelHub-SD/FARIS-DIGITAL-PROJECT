import "server-only";

import { notFound } from "next/navigation";
import { cache } from "react";

import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";

export type AppPermission =
  | "orders"
  | "products"
  | "kyc"
  | "customers"
  | "invoices"
  | "comments"
  | "settings";

export type SessionUser = {
  id: string;
  providers: string[];
  profile: {
    full_name: string | null;
    phone_e164: string | null;
    phone_verified_at: string | null;
    locale: Locale;
    kyc_status: "none" | "pending" | "verified" | "rejected";
    kyc_rejection_reason: string | null;
    is_blocked: boolean;
  };
};

// getUser() asks the Auth server, so revoked sessions (password reset) and
// deleted users are rejected, not just expired tokens.
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const { data: profile, error } = await supabase
    .from("profiles")
    .select(
      "full_name, phone_e164, phone_verified_at, locale, kyc_status, kyc_rejection_reason, is_blocked",
    )
    .eq("id", data.user.id)
    .single();
  if (error || !profile) return null;
  return {
    id: data.user.id,
    providers:
      (data.user.app_metadata?.providers as string[] | undefined) ?? [],
    profile: profile as SessionUser["profile"],
  };
});

/** An account is complete only once its phone is verified by OTP. */
export function isComplete(user: SessionUser): boolean {
  return user.profile.phone_verified_at !== null;
}

export async function requireUser(locale: Locale): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect({ href: "/login", locale });
  return user!;
}

/** Every authenticated route except /complete-account goes through this. */
export async function requireCompleteUser(
  locale: Locale,
): Promise<SessionUser> {
  const user = await requireUser(locale);
  if (!isComplete(user)) redirect({ href: "/complete-account", locale });
  return user;
}

export const getAdminPermissions = cache(
  async (userId: string): Promise<Set<AppPermission> | null> => {
    const supabase = await createClient();
    const { data: admin } = await supabase
      .from("admins")
      .select("is_owner, is_active")
      .eq("user_id", userId)
      .maybeSingle();
    if (!admin?.is_active) return null;
    if (admin.is_owner) {
      return new Set<AppPermission>([
        "orders",
        "products",
        "kyc",
        "customers",
        "invoices",
        "comments",
        "settings",
      ]);
    }
    const { data: rows } = await supabase
      .from("admin_permissions")
      .select("permission")
      .eq("admin_id", userId);
    return new Set((rows ?? []).map((r) => r.permission as AppPermission));
  },
);

/** Non-admins get a 404: the admin area does not reveal that it exists. */
export async function requireAdmin(locale: Locale, permission?: AppPermission) {
  const user = await requireCompleteUser(locale);
  const permissions = await getAdminPermissions(user.id);
  if (!permissions || (permission && !permissions.has(permission))) notFound();
  return { user, permissions };
}

// Variants for Server Actions: return null instead of redirecting, so the
// action can answer with an error code.
export async function actionCompleteUser(): Promise<SessionUser | null> {
  const user = await getSessionUser();
  return user && isComplete(user) ? user : null;
}

export async function actionAdmin(
  permission: AppPermission,
): Promise<SessionUser | null> {
  const user = await actionCompleteUser();
  if (!user) return null;
  const permissions = await getAdminPermissions(user.id);
  return permissions?.has(permission) ? user : null;
}

/** Only same-site paths under the current locale; blocks open redirects. */
export function safeNext(next: string | undefined, locale: Locale): string {
  if (!next) return "/account";
  const prefix = `/${locale}/`;
  if (!next.startsWith(prefix) || next.startsWith("//") || next.includes("\\"))
    return "/account";
  return next.slice(locale.length + 1);
}
