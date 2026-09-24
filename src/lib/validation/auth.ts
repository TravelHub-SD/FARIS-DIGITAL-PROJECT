import { z } from "zod";

import { normalizeSudanPhone, toLatinDigits } from "@/lib/phone";

// Shared by client forms (React Hook Form) and Server Actions. The server
// always re-parses; client validation is only for faster feedback.

export const localeSchema = z.enum(["ar", "en"]);

export const phoneSchema = z
  .string()
  .trim()
  .max(32)
  .transform((value, ctx) => {
    const e164 = normalizeSudanPhone(value);
    if (!e164) {
      ctx.addIssue({ code: "custom", message: "invalid_phone" });
      return z.NEVER;
    }
    return e164;
  });

// bcrypt (GoTrue) ignores bytes beyond 72, so longer passwords are refused
// rather than silently truncated.
export const passwordSchema = z
  .string()
  .min(10, "password_too_short")
  .refine((v) => new TextEncoder().encode(v).length <= 72, "password_too_long");

export const fullNameSchema = z
  .string()
  .trim()
  .min(2, "name_too_short")
  .max(100, "name_too_long");

export const otpCodeSchema = z
  .string()
  .transform((v) => toLatinDigits(v).replace(/\s/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "invalid_code_format"));

export const requestOtpSchema = z.object({
  phone: phoneSchema,
  locale: localeSchema,
});

export const registerSchema = z.object({
  phone: phoneSchema,
  code: otpCodeSchema,
  fullName: fullNameSchema,
  password: passwordSchema,
  locale: localeSchema,
});

export const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1, "password_required").max(200),
  locale: localeSchema,
  next: z.string().max(300).optional(),
});

export const resetPasswordSchema = z.object({
  phone: phoneSchema,
  code: otpCodeSchema,
  password: passwordSchema,
  locale: localeSchema,
});

export const linkPhoneSchema = z.object({
  phone: phoneSchema,
  code: otpCodeSchema,
  locale: localeSchema,
});

export const profileSchema = z.object({
  fullName: fullNameSchema,
  locale: localeSchema,
});
