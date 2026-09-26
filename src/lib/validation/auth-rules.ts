import { normalizeSudanPhone, toLatinDigits } from "@/lib/phone";

// The auth field rules, written once. The Server Actions wrap them in Zod
// (./auth.ts) and always re-check; the browser forms call them directly for
// instant feedback, so auth pages ship no Zod or form library (Phase 9:
// login page JavaScript). Error values are keys of Auth.errors.

export type Rule<T = string> = (
  input: string,
) => { ok: true; value: T } | { ok: false; error: string };

export const phoneRule: Rule = (input) => {
  const value = input.trim();
  const e164 = value.length <= 32 ? normalizeSudanPhone(value) : null;
  return e164
    ? { ok: true, value: e164 }
    : { ok: false, error: "invalid_phone" };
};

// bcrypt (GoTrue) ignores bytes beyond 72, so longer passwords are refused
// rather than silently truncated.
export const newPasswordRule: Rule = (input) => {
  if (input.length < 10) return { ok: false, error: "password_too_short" };
  if (new TextEncoder().encode(input).length > 72)
    return { ok: false, error: "password_too_long" };
  return { ok: true, value: input };
};

export const loginPasswordRule: Rule = (input) => {
  if (input.length < 1) return { ok: false, error: "password_required" };
  if (input.length > 200) return { ok: false, error: "password_too_long" };
  return { ok: true, value: input };
};

export const fullNameRule: Rule = (input) => {
  const value = input.trim();
  if (value.length < 2) return { ok: false, error: "name_too_short" };
  if (value.length > 100) return { ok: false, error: "name_too_long" };
  return { ok: true, value };
};

export const otpCodeRule: Rule = (input) => {
  const value = toLatinDigits(input).replace(/\s/g, "");
  return /^\d{6}$/.test(value)
    ? { ok: true, value }
    : { ok: false, error: "invalid_code_format" };
};

export const localeRule: Rule<"ar" | "en"> = (input) =>
  input === "ar" || input === "en"
    ? { ok: true, value: input }
    : { ok: false, error: "invalid_input" };
