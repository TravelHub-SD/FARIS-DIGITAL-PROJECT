"use server";

import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { toAuthPhone } from "@/lib/phone";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  linkPhoneSchema,
  loginSchema,
  registerSchema,
  requestOtpSchema,
  resetPasswordSchema,
} from "@/lib/validation/auth";

import { otp, type OtpFailure } from "./otp";
import { getClientIp } from "./request";
import { getSessionUser, isComplete, safeNext } from "./session";

export type AuthError =
  | OtpFailure
  | "invalid_input"
  | "phone_taken"
  | "invalid_credentials"
  | "rate_limited"
  | "already_complete"
  | "not_signed_in"
  | "login_otp_unavailable"
  | "server_error";

export type AuthResult =
  | { ok: true }
  | { ok: false; error: AuthError; retryAfter?: number; attemptsLeft?: number };

const fail = (
  error: AuthError,
  retryAfter?: number,
  attemptsLeft?: number,
): AuthResult => ({
  ok: false,
  error,
  retryAfter,
  attemptsLeft,
});

// Per-IP cap on "does this phone exist / send me a code" calls, so account
// existence cannot be probed at scale (30 per hour per IP).
async function lookupAllowed(ip: string | null): Promise<boolean> {
  if (!ip) return true;
  const db = createAdminClient();
  const { data: exceeded } = await db.rpc("rate_limit_exceeded", {
    p_bucket: "phone_lookup_ip",
    p_key: ip,
    p_max: 30,
    p_window_seconds: 3600,
  });
  if (exceeded) return false;
  await db.rpc("rate_limit_record", { p_bucket: "phone_lookup_ip", p_key: ip });
  return true;
}

async function userIdByPhone(phone: string): Promise<string | null> {
  const { data } = await createAdminClient().rpc("auth_user_id_by_phone", {
    p_phone: phone,
  });
  return (data as string | null) ?? null;
}

async function signIn(phone: string, password: string) {
  const supabase = await createClient();
  return supabase.auth.signInWithPassword({ phone, password });
}

// ---------------------------------------------------------------- register

export async function requestRegistrationOtp(
  input: unknown,
): Promise<AuthResult> {
  const parsed = requestOtpSchema.safeParse(input);
  if (!parsed.success) return fail("invalid_input");
  const { phone, locale } = parsed.data;
  const ip = await getClientIp();
  if (!(await lookupAllowed(ip))) return fail("rate_limited");
  if (await userIdByPhone(phone)) return fail("phone_taken");

  const res = await otp.issue({ phone, purpose: "register", ip, locale });
  return res.ok ? { ok: true } : fail(res.reason, res.retryAfter);
}

/**
 * The account is created only here, and only after the OTP verifies. There is
 * no half-registered phone account: before this succeeds, no user exists.
 */
export async function completeRegistration(
  input: unknown,
): Promise<AuthResult> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return fail("invalid_input");
  const { phone, code, fullName, password, locale } = parsed.data;
  const ip = await getClientIp();

  const verified = await otp.verify({ phone, purpose: "register", code, ip });
  if (!verified.ok)
    return fail(verified.reason, undefined, verified.attemptsLeft);
  if (await userIdByPhone(phone)) return fail("phone_taken");

  const { error } = await createAdminClient().auth.admin.createUser({
    phone: toAuthPhone(phone),
    password,
    phone_confirm: true,
    // Server-only marker checked by the database guard on auth.users.
    app_metadata: { signup_verified: "otp" },
    user_metadata: { full_name: fullName, locale },
  });
  if (error) {
    console.error("registration: createUser failed", error.status, error.code);
    return fail("server_error");
  }

  const session = await signIn(phone, password);
  if (session.error) return fail("server_error");
  redirect({ href: "/account", locale });
  return { ok: true };
}

// ------------------------------------------------------------------- login

export async function login(input: unknown): Promise<AuthResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return fail("invalid_credentials");
  const { phone, password, locale, next } = parsed.data;
  const ip = await getClientIp();
  const db = createAdminClient();

  // Failed-login throttles: 10 per phone and 30 per IP per 15 minutes, on top
  // of GoTrue's own per-IP rate limit.
  const checks = [
    {
      p_bucket: "login_fail_phone",
      p_key: phone,
      p_max: 10,
      p_window_seconds: 900,
    },
    ...(ip
      ? [
          {
            p_bucket: "login_fail_ip",
            p_key: ip,
            p_max: 30,
            p_window_seconds: 900,
          },
        ]
      : []),
  ];
  for (const c of checks) {
    const { data: exceeded } = await db.rpc("rate_limit_exceeded", c);
    if (exceeded) return fail("rate_limited");
  }

  // Login OTP policy seam (decisions.md): 'never' is the approved default.
  // 'always' must be implemented as a real second factor; until then it
  // fails closed rather than silently skipping the requirement.
  const { data: policy } = await db
    .from("security_settings")
    .select("otp_login_policy")
    .eq("id", true)
    .single();
  if (policy?.otp_login_policy !== "never")
    return fail("login_otp_unavailable");

  const { error } = await signIn(phone, password);
  if (error) {
    await db.rpc("rate_limit_record", {
      p_bucket: "login_fail_phone",
      p_key: phone,
    });
    if (ip)
      await db.rpc("rate_limit_record", {
        p_bucket: "login_fail_ip",
        p_key: ip,
      });
    return fail("invalid_credentials");
  }
  await db.rpc("rate_limit_clear", {
    p_bucket: "login_fail_phone",
    p_key: phone,
  });
  redirect({ href: safeNext(next, locale), locale });
  return { ok: true };
}

// ---------------------------------------------------------- password reset

/** Same answer whether or not the phone is registered (no enumeration). */
export async function requestPasswordResetOtp(
  input: unknown,
): Promise<AuthResult> {
  const parsed = requestOtpSchema.safeParse(input);
  if (!parsed.success) return fail("invalid_input");
  const { phone, locale } = parsed.data;
  const ip = await getClientIp();
  if (!(await lookupAllowed(ip))) return fail("rate_limited");

  const userId = await userIdByPhone(phone);
  if (!userId) return { ok: true };
  const res = await otp.issue({
    phone,
    purpose: "reset_password",
    ip,
    locale,
    userId,
  });
  return res.ok ? { ok: true } : fail(res.reason, res.retryAfter);
}

export async function completePasswordReset(
  input: unknown,
): Promise<AuthResult> {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) return fail("invalid_input");
  const { phone, code, password, locale } = parsed.data;
  const ip = await getClientIp();

  const verified = await otp.verify({
    phone,
    purpose: "reset_password",
    code,
    ip,
  });
  if (!verified.ok)
    return fail(verified.reason, undefined, verified.attemptsLeft);
  const userId = await userIdByPhone(phone);
  if (!userId) return fail("invalid_or_expired");

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) return fail("server_error");
  // Every existing session (possibly an attacker's) ends with the old password.
  await admin.rpc("auth_revoke_sessions", { p_user_id: userId });

  const session = await signIn(phone, password);
  if (session.error) return fail("server_error");
  redirect({ href: "/account", locale });
  return { ok: true };
}

// ------------------------------------ complete a Google account with phone

async function incompleteUser() {
  const user = await getSessionUser();
  if (!user) return { error: "not_signed_in" as const };
  if (isComplete(user)) return { error: "already_complete" as const };
  return { user };
}

export async function requestPhoneLinkOtp(input: unknown): Promise<AuthResult> {
  const parsed = requestOtpSchema.safeParse(input);
  if (!parsed.success) return fail("invalid_input");
  const current = await incompleteUser();
  if ("error" in current) return fail(current.error!);
  const { phone, locale } = parsed.data;
  const ip = await getClientIp();
  if (!(await lookupAllowed(ip))) return fail("rate_limited");

  const owner = await userIdByPhone(phone);
  if (owner && owner !== current.user.id) return fail("phone_taken");
  const res = await otp.issue({
    phone,
    purpose: "link_phone",
    ip,
    locale,
    userId: current.user.id,
  });
  return res.ok ? { ok: true } : fail(res.reason, res.retryAfter);
}

export async function completePhoneLink(input: unknown): Promise<AuthResult> {
  const parsed = linkPhoneSchema.safeParse(input);
  if (!parsed.success) return fail("invalid_input");
  const current = await incompleteUser();
  if ("error" in current) return fail(current.error!);
  const { phone, code, locale } = parsed.data;
  const ip = await getClientIp();

  const verified = await otp.verify({ phone, purpose: "link_phone", code, ip });
  if (!verified.ok)
    return fail(verified.reason, undefined, verified.attemptsLeft);
  const owner = await userIdByPhone(phone);
  if (owner && owner !== current.user.id) return fail("phone_taken");

  // Setting a confirmed phone fires the auth.users trigger that fills
  // profiles.phone_e164 / phone_verified_at: the account becomes complete.
  const { error } = await createAdminClient().auth.admin.updateUserById(
    current.user.id,
    {
      phone: toAuthPhone(phone),
      phone_confirm: true,
      app_metadata: { signup_verified: "otp" },
    },
  );
  if (error)
    return fail(
      error.message.toLowerCase().includes("phone")
        ? "phone_taken"
        : "server_error",
    );
  redirect({ href: "/account", locale });
  return { ok: true };
}

// ---------------------------------------------------------------- sign out

export async function signOut(locale: Locale): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect({ href: "/login", locale: locale === "en" ? "en" : "ar" });
}
