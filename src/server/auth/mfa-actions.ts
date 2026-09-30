"use server";

import { z } from "zod";

import { redirect } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { otpCodeRule } from "@/lib/validation/auth-rules";

import {
  currentAal,
  MFA_FAIL_LIMIT,
  MFA_FAIL_WINDOW_SECONDS,
  verifiedTotpFactors,
} from "./mfa";
import { actionCompleteUser, getAdminPermissions } from "./session";

// Staff two-factor screens. Only active staff may enrol; customers never see
// these. The authenticator secret goes to the staff member's own browser (it
// is what the QR code carries) and is never stored or logged by the app.

export type MfaError =
  | "not_allowed"
  | "totp_invalid"
  | "rate_limited"
  | "last_factor"
  | "server_error";
export type MfaResult = { ok: true } | { ok: false; error: MfaError };
export type EnrolResult =
  | { ok: true; factorId: string; qr: string; secret: string }
  | { ok: false; error: MfaError };

const ISSUER = "Faris Digital";
const failBucket = "mfa_fail_user";

async function staffUser() {
  const user = await actionCompleteUser();
  if (!user) return null;
  return (await getAdminPermissions(user.id)) ? user : null;
}

const localeOf = (v: unknown): Locale =>
  routing.locales.includes(v as Locale) ? (v as Locale) : routing.defaultLocale;

/**
 * Starts a new authenticator. First one: allowed with a password session.
 * An extra (backup) one: only once this session is confirmed (aal2); GoTrue
 * enforces the same.
 */
export async function startTotpEnrolment(): Promise<EnrolResult> {
  const user = await staffUser();
  if (!user) return { ok: false, error: "not_allowed" };
  const existing = await verifiedTotpFactors();
  if (existing.length > 0 && (await currentAal()) !== "aal2")
    return { ok: false, error: "not_allowed" };

  const supabase = await createClient();
  // Drop abandoned attempts (scanned but never confirmed).
  const { data: all } = await supabase.auth.mfa.listFactors();
  for (const f of all?.all ?? [])
    if (f.status !== "verified")
      await supabase.auth.mfa.unenroll({ factorId: f.id });

  const label = await supabase.rpc("staff_totp_label");
  if (label.error) return { ok: false, error: "server_error" };
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    issuer: ISSUER,
    friendlyName: `${ISSUER} ${new Date().toISOString().slice(0, 19)}`,
  });
  if (error || !data) return { ok: false, error: "server_error" };
  return {
    ok: true,
    factorId: data.id,
    qr: data.totp.qr_code,
    secret: data.totp.secret,
  };
}

const confirmSchema = z.object({
  factorId: z.guid(),
  code: z.string().max(20),
  locale: z.string(),
});

/** Checks a code against the given (new) factor and upgrades the session. */
export async function confirmTotpEnrolment(input: unknown): Promise<MfaResult> {
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "totp_invalid" };
  const result = await checkCode([parsed.data.factorId], parsed.data.code);
  if (!result.ok) return result;
  redirect({ href: "/admin/security", locale: localeOf(parsed.data.locale) });
  return result;
}

const verifySchema = z.object({ code: z.string().max(20), locale: z.string() });

/** The sign-in step: a code from any of the staff member's authenticators. */
export async function verifyTotp(input: unknown): Promise<MfaResult> {
  const parsed = verifySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "totp_invalid" };
  const factors = await verifiedTotpFactors();
  if (factors.length === 0) return { ok: false, error: "not_allowed" };
  const result = await checkCode(
    factors.map((f) => f.id),
    parsed.data.code,
  );
  if (!result.ok) return result;
  redirect({ href: "/admin", locale: localeOf(parsed.data.locale) });
  return result;
}

async function checkCode(
  factorIds: string[],
  rawCode: string,
): Promise<MfaResult> {
  const user = await staffUser();
  if (!user) return { ok: false, error: "not_allowed" };
  const code = otpCodeRule(rawCode); // accepts Arabic-Indic digits
  if (!code.ok) return { ok: false, error: "totp_invalid" };

  const db = createAdminClient();
  const { data: exceeded } = await db.rpc("rate_limit_exceeded", {
    p_bucket: failBucket,
    p_key: user.id,
    p_max: MFA_FAIL_LIMIT,
    p_window_seconds: MFA_FAIL_WINDOW_SECONDS,
  });
  if (exceeded) return { ok: false, error: "rate_limited" };

  const supabase = await createClient();
  for (const factorId of factorIds) {
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code: code.value,
    });
    if (!error) {
      await db.rpc("rate_limit_clear", {
        p_bucket: failBucket,
        p_key: user.id,
      });
      return { ok: true };
    }
  }
  await db.rpc("rate_limit_record", { p_bucket: failBucket, p_key: user.id });
  return { ok: false, error: "totp_invalid" };
}

/** Removes one of the staff member's own authenticators (never the last). */
export async function removeTotpFactor(input: unknown): Promise<MfaResult> {
  const parsed = z.object({ factorId: z.guid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "not_allowed" };
  const user = await staffUser();
  if (!user || (await currentAal()) !== "aal2")
    return { ok: false, error: "not_allowed" };
  const factors = await verifiedTotpFactors();
  if (!factors.some((f) => f.id === parsed.data.factorId))
    return { ok: false, error: "not_allowed" };
  if (factors.length < 2) return { ok: false, error: "last_factor" };
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.unenroll({
    factorId: parsed.data.factorId,
  });
  return error ? { ok: false, error: "server_error" } : { ok: true };
}
