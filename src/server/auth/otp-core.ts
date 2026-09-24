import { createHmac, randomInt } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Locale } from "@/i18n/routing";
import type { WhatsAppMessage } from "@/server/whatsapp/types";

// OTP logic with injected dependencies (no server-only import) so tests drive
// the real code. Plaintext codes exist only in memory: the database receives
// an HMAC, message_logs gets no payload, and nothing here logs the code.

export type OtpPurpose =
  "register" | "reset_password" | "link_phone" | "change_phone";

export type OtpFailure =
  | "invalid_phone"
  | "country_not_allowed"
  | "cooldown"
  | "phone_hourly_limit"
  | "phone_daily_limit"
  | "ip_hourly_limit"
  | "budget_exhausted"
  | "delivery_failed"
  | "invalid_or_expired"
  | "invalid_code"
  | "too_many_attempts"
  | "ip_verify_limit";

export type OtpDeps = {
  db: SupabaseClient; // service role
  pepper: string;
  send: (
    message: WhatsAppMessage,
    context: { userId?: string | null },
  ) => Promise<{ ok: boolean }>;
};

export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashOtp(
  pepper: string,
  phone: string,
  purpose: OtpPurpose,
  code: string,
): string {
  return createHmac("sha256", pepper)
    .update(`${phone}|${purpose}|${code}`)
    .digest("hex");
}

type RpcResult = {
  ok: boolean;
  reason?: OtpFailure;
  retry_after?: number;
  attempts_left?: number;
};

export async function issueOtp(
  input: {
    phone: string;
    purpose: OtpPurpose;
    ip: string | null;
    locale: Locale;
    userId?: string | null;
  },
  deps: OtpDeps,
): Promise<
  { ok: true } | { ok: false; reason: OtpFailure; retryAfter?: number }
> {
  const code = generateOtpCode();
  const { data, error } = await deps.db.rpc("otp_issue", {
    p_phone: input.phone,
    p_purpose: input.purpose,
    p_code_hash: hashOtp(deps.pepper, input.phone, input.purpose, code),
    p_ip: input.ip,
  });
  if (error)
    throw new Error(`otp_issue failed: ${error.code ?? ""} ${error.message}`);
  const result = data as RpcResult;
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason ?? "invalid_phone",
      retryAfter: result.retry_after,
    };
  }
  const sent = await deps.send(
    { type: "otp", to: input.phone, code, locale: input.locale },
    { userId: input.userId ?? null },
  );
  return sent.ok ? { ok: true } : { ok: false, reason: "delivery_failed" };
}

export async function verifyOtp(
  input: {
    phone: string;
    purpose: OtpPurpose;
    code: string;
    ip: string | null;
  },
  deps: OtpDeps,
): Promise<
  { ok: true } | { ok: false; reason: OtpFailure; attemptsLeft?: number }
> {
  const { data, error } = await deps.db.rpc("otp_verify", {
    p_phone: input.phone,
    p_purpose: input.purpose,
    p_code_hash: hashOtp(deps.pepper, input.phone, input.purpose, input.code),
    p_ip: input.ip,
  });
  if (error)
    throw new Error(`otp_verify failed: ${error.code ?? ""} ${error.message}`);
  const result = data as RpcResult;
  return result.ok
    ? { ok: true }
    : {
        ok: false,
        reason: result.reason ?? "invalid_code",
        attemptsLeft: result.attempts_left,
      };
}
