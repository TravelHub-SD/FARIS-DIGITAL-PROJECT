import { describe, expect, it } from "vitest";

import { formatPhone, normalizeSudanPhone } from "@/lib/phone";

describe("normalizeSudanPhone", () => {
  it.each([
    ["0912345678", "+249912345678"],
    ["912345678", "+249912345678"],
    ["+249 91 234 5678", "+249912345678"],
    ["00249912345678", "+249912345678"],
    ["249-123-456-789", "+249123456789"],
    ["٠٩١٢٣٤٥٦٧٨", "+249912345678"], // Arabic-Indic digits
    ["۰۹۱۲۳۴۵۶۷۸", "+249912345678"], // Extended Arabic-Indic digits
  ])("%s → %s", (input, expected) => {
    expect(normalizeSudanPhone(input)).toBe(expected);
  });

  it.each([
    "",
    "0812345678",
    "091234567",
    "09123456789",
    "+20912345678",
    "+966512345678",
    "abc",
  ])("rejects %s", (input) => {
    expect(normalizeSudanPhone(input)).toBeNull();
  });

  it("formats for display", () => {
    expect(formatPhone("+249912345678")).toBe("+249 91 234 5678");
  });
});
