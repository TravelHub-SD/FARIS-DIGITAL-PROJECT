import { describe, expect, it } from "vitest";

import {
  compareDecimal,
  formatAmount,
  formatDecimal,
  parseAmount,
  quote,
} from "@/lib/custom-amount";

// The amount a customer types on a custom-amount product page, and the
// display formula. The database recomputes (private.custom_amount_quote);
// tests/integration/custom-amount.test.ts checks both give the same number.

describe("parseAmount: what customers type", () => {
  it.each([
    ["56", "56"],
    ["56.5", "56.5"],
    ["56.50", "56.5"],
    ["056.00", "56"],
    [" 56.25 ", "56.25"],
    [".5", "0.5"],
    ["5.", "5"],
    ["٥٦", "56"], // Arabic-Indic digits
    ["٥٦٫٥٠", "56.5"], // with the Arabic decimal separator
    ["۵۶٫۲۵", "56.25"], // Persian (Extended Arabic-Indic) digits
    ["56,5", "56.5"], // comma as decimal separator
    ["١٬٢٣٤٫٥", "1234.5"], // Arabic thousands separator is ignored
    ["1 234.5", "1234.5"],
  ])("%j → %s", (raw, value) => {
    expect(parseAmount(raw, 2)).toEqual({
      ok: true,
      value,
      decimals: (value.split(".")[1] ?? "").length,
    });
  });

  it.each([
    ["", "malformed"],
    [".", "malformed"],
    ["abc", "malformed"],
    ["1e3", "malformed"],
    ["5.5.5", "malformed"],
    ["1,000.50", "malformed"], // two separators: ambiguous, refused
    ["0x10", "malformed"],
    ["+5", "malformed"],
    ["Infinity", "malformed"],
    ["NaN", "malformed"],
    ["1234567890123", "malformed"], // more than 12 integer digits
    ["0", "zero"],
    ["0.00", "zero"],
    ["٠٫٠", "zero"],
    ["-5", "negative"],
    ["−5", "negative"], // U+2212 minus sign
    ["-0.5", "negative"],
    ["56.123", "decimals"],
    ["٥٦٫١٢٣", "decimals"],
  ])("%j → %s", (raw, error) => {
    expect(parseAmount(raw, 2)).toEqual({ ok: false, error });
  });

  it("honours the product's decimals setting", () => {
    expect(parseAmount("56.5", 0)).toEqual({ ok: false, error: "decimals" });
    expect(parseAmount("56.0", 0)).toEqual({
      ok: true,
      value: "56",
      decimals: 0,
    });
    expect(parseAmount("56.125", 3)).toEqual({
      ok: true,
      value: "56.125",
      decimals: 3,
    });
  });
});

describe("quote: the same formula as the database", () => {
  it("56 EUR × 3,050 + 200 fixed fee = 171,000", () => {
    expect(
      quote({
        amount: "56",
        rate: "3050",
        feePercent: "0",
        feeFixedSdg: "200",
      }),
    ).toEqual({ base: "170800", feeSdg: "200.00", totalSdg: 171000 });
  });

  it("percent fee rounded to the piastre, total rounded up per line", () => {
    // 56 × 2,800 = 156,800; 1.5% = 2,352 + 200 = 2,552 → 159,352
    expect(
      quote({
        amount: "56",
        rate: "2800",
        feePercent: "1.5",
        feeFixedSdg: "200",
      }),
    ).toEqual({ base: "156800", feeSdg: "2552.00", totalSdg: 159352 });
    // 56.37 × 3,050.5 = 171,956.685 → 171,957 (no fee)
    expect(
      quote({
        amount: "56.37",
        rate: "3050.5",
        feePercent: "0",
        feeFixedSdg: "0",
      }),
    ).toEqual({ base: "171956.685", feeSdg: "0.00", totalSdg: 171957 });
    // 0.01 × 0.0001 × 2.5% = 0.000000025 → fee 0.00; total ceil(0.000001) = 1
    expect(
      quote({
        amount: "0.01",
        rate: "0.0001",
        feePercent: "2.5",
        feeFixedSdg: "0",
      }),
    ).toEqual({ base: "0.000001", feeSdg: "0.00", totalSdg: 1 });
    // Half a piastre rounds away from zero (Postgres round()):
    // 1 × 1 × 0.5% = 0.005 → 0.01
    expect(
      quote({ amount: "1", rate: "1", feePercent: "0.5", feeFixedSdg: "0" })
        .feeSdg,
    ).toBe("0.01");
  });

  it("no floating-point error: 1.1 × 3,000 is exactly 3,300", () => {
    expect(1.1 * 3000).not.toBe(3300); // what a float calculator would show
    expect(
      quote({ amount: "1.1", rate: "3000", feePercent: "0", feeFixedSdg: "0" })
        .totalSdg,
    ).toBe(3300);
  });

  it("large amounts stay exact", () => {
    // Expected values computed by Postgres (numeric), the formula's authority:
    // select 9999999.999 * 3050.5555, round(… * 2.25 / 100, 2) + 1000.5, ceil(…)
    const q = quote({
      amount: "9999999.999",
      rate: "3050.5555",
      feePercent: "2.25",
      feeFixedSdg: "1000.5",
    });
    expect(q.base).toBe("30505554996.9494445");
    expect(q.feeSdg).toBe("686375987.93");
    expect(q.totalSdg).toBe(31191930985);
  });
});

describe("compare and format", () => {
  it("compares decimals exactly", () => {
    expect(compareDecimal("500", "500.000")).toBe(0);
    expect(compareDecimal("500.001", "500")).toBe(1);
    expect(compareDecimal("0.5", "1")).toBe(-1);
  });
  it("formats with Latin digits", () => {
    expect(formatAmount("56.5", 2)).toBe("56.50");
    expect(formatAmount("1234567", 0)).toBe("1,234,567");
    expect(formatDecimal("3050.5000")).toBe("3,050.5");
    expect(formatDecimal("2552.00")).toBe("2,552");
  });
});
