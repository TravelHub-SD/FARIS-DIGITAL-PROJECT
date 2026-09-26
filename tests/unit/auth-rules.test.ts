import { describe, expect, it } from "vitest";

import {
  fullNameRule,
  loginPasswordRule,
  newPasswordRule,
  otpCodeRule,
  phoneRule,
} from "@/lib/validation/auth-rules";
import {
  loginSchema,
  otpCodeSchema,
  passwordSchema,
  phoneSchema,
} from "@/lib/validation/auth";

// The browser forms call these rules directly; the Server Actions parse with
// Zod schemas built from the same rules. Both must agree on every input.
describe("auth rules (shared by browser forms and Server Actions)", () => {
  const phones = [
    " 0912345678 ",
    "٠٩١٢٣٤٥٦٧٨",
    "0812345678",
    "",
    "0".repeat(40),
  ];
  it.each(phones)("phone %j: rule and server schema agree", (input) => {
    const rule = phoneRule(input);
    const server = phoneSchema.safeParse(input);
    expect(server.success).toBe(rule.ok);
    if (rule.ok && server.success) expect(server.data).toBe(rule.value);
    if (!rule.ok && !server.success)
      expect(server.error.issues[0].message).toBe(rule.error);
  });

  it("new password: 10 characters minimum, 72 bytes maximum", () => {
    expect(newPasswordRule("123456789")).toEqual({
      ok: false,
      error: "password_too_short",
    });
    expect(newPasswordRule("1234567890").ok).toBe(true);
    // 36 Arabic letters = 72 bytes (accepted); 37 = 74 bytes (refused).
    expect(newPasswordRule("ب".repeat(36)).ok).toBe(true);
    expect(newPasswordRule("ب".repeat(37))).toEqual({
      ok: false,
      error: "password_too_long",
    });
    expect(passwordSchema.safeParse("ب".repeat(37)).success).toBe(false);
  });

  it("OTP code: Arabic-Indic digits and spaces are normalised", () => {
    expect(otpCodeRule("١٢٣ ٤٥٦")).toEqual({ ok: true, value: "123456" });
    expect(otpCodeRule("12345")).toEqual({
      ok: false,
      error: "invalid_code_format",
    });
    expect(otpCodeSchema.parse("١٢٣ ٤٥٦")).toBe("123456");
  });

  it("full name is trimmed; login password must be present", () => {
    expect(fullNameRule("  سارة  ")).toEqual({ ok: true, value: "سارة" });
    expect(fullNameRule(" س ")).toEqual({ ok: false, error: "name_too_short" });
    expect(loginPasswordRule("")).toEqual({
      ok: false,
      error: "password_required",
    });
    expect(
      loginSchema.safeParse({ phone: "0912345678", password: "", locale: "ar" })
        .success,
    ).toBe(false);
  });
});
