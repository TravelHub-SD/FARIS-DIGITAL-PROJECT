import { z } from "zod";

import {
  fullNameRule,
  loginPasswordRule,
  newPasswordRule,
  otpCodeRule,
  phoneRule,
  type Rule,
} from "./auth-rules";

// Server Actions parse with these; the rules themselves live in
// ./auth-rules.ts, which the browser forms call directly (no Zod shipped).

export const localeSchema = z.enum(["ar", "en"]);

function fromRule(rule: Rule) {
  return z.string().transform((input, ctx) => {
    const result = rule(input);
    if (!result.ok) {
      ctx.addIssue({ code: "custom", message: result.error });
      return z.NEVER;
    }
    return result.value;
  });
}

export const phoneSchema = fromRule(phoneRule);
export const passwordSchema = fromRule(newPasswordRule);
export const fullNameSchema = fromRule(fullNameRule);
export const otpCodeSchema = fromRule(otpCodeRule);

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
  password: fromRule(loginPasswordRule),
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
