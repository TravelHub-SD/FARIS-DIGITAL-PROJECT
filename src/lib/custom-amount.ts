import { toLatinDigits } from "@/lib/phone";

// Custom-amount products (decisions.md 2026-11-21): reading what the customer
// typed, and the price formula for DISPLAY. Shared by the product page's
// calculator (browser) and the add-to-cart action (friendly errors). The
// database is the authority: private.custom_amount_quote() re-reads the rate,
// limits and fee and computes the price that is charged; this file mirrors it
// exactly (integer arithmetic, no floating point) so the calculator shows the
// same number. tests/integration/custom-amount.test.ts compares the two.

export type AmountError = "malformed" | "zero" | "negative" | "decimals";

export type ParsedAmount =
  | { ok: true; value: string; decimals: number }
  | { ok: false; error: AmountError };

const MAX_INTEGER_DIGITS = 12;

/**
 * Arabic-Indic and Persian digits become Latin; the Arabic decimal separator
 * "٫", a comma or a point is the decimal separator; spaces and the Arabic
 * thousands separator "٬" are ignored. More than one separator, a sign other
 * than a leading minus, or anything else is malformed.
 */
export function normalizeAmount(raw: string): string {
  return toLatinDigits(raw)
    .replace(/[\s٬‎‏]/g, "")
    .replace(/[٫,]/g, ".")
    .replace(/^[−–]/, "-");
}

/** Canonical decimal string ("056.50" → "56.5") or why it is not one. */
export function parseAmount(raw: string, maxDecimals: number): ParsedAmount {
  const text = normalizeAmount(raw);
  if (text.startsWith("-")) {
    return /^-(\d+(\.\d*)?|\.\d+)$/.test(text)
      ? { ok: false, error: "negative" }
      : { ok: false, error: "malformed" };
  }
  const m = /^(\d*)(?:\.(\d*))?$/.exec(text);
  if (!m || (m[1] === "" && !m[2])) return { ok: false, error: "malformed" };
  const integer = m[1].replace(/^0+(?=\d)/, "") || "0";
  const fraction = (m[2] ?? "").replace(/0+$/, "");
  if (integer.length > MAX_INTEGER_DIGITS)
    return { ok: false, error: "malformed" };
  if (/^0*$/.test(integer + fraction)) return { ok: false, error: "zero" };
  if (fraction.length > maxDecimals) return { ok: false, error: "decimals" };
  return {
    ok: true,
    value: fraction ? `${integer}.${fraction}` : integer,
    decimals: fraction.length,
  };
}

const TEN = BigInt(10);
const ZERO = BigInt(0);
const pow10 = (n: number) => TEN ** BigInt(n);

/** "56.5" at scale 2 → 5650n. Input must be a plain non-negative decimal. */
export function toUnits(value: string, scale: number): bigint {
  const [i, f = ""] = String(value).split(".");
  if (f.length > scale) throw new Error(`more than ${scale} decimals`);
  return (
    BigInt(i || "0") * pow10(scale) +
    BigInt((f + "0".repeat(scale)).slice(0, scale) || "0")
  );
}

function fromUnits(units: bigint, scale: number): string {
  const s = units.toString().padStart(scale + 1, "0");
  return scale ? `${s.slice(0, -scale)}.${s.slice(-scale)}` : s;
}

const ceilDiv = (a: bigint, b: bigint) =>
  a % b === ZERO ? a / b : a / b + BigInt(1);
/** Half away from zero (Postgres round()), for a, b > 0. */
const roundDiv = (a: bigint, b: bigint) =>
  (a * BigInt(2) + b) / (b * BigInt(2));

export type Quote = {
  /** amount × rate, unrounded, as a decimal string. */
  base: string;
  /** Fee in SDG, two decimals. */
  feeSdg: string;
  /** What the line costs: whole pounds, rounded up. */
  totalSdg: number;
};

/**
 * Same formula as private.custom_amount_quote():
 *   fee = round(amount × rate × fee% / 100, 2) + fixed fee
 *   total = ceil(amount × rate + fee)
 * `amount` is a canonical decimal (parseAmount), rate has ≤ 4 decimals,
 * fee% and the fixed fee ≤ 2.
 */
export function quote(input: {
  amount: string;
  rate: string;
  feePercent: string;
  feeFixedSdg: string;
}): Quote {
  const a = (input.amount.split(".")[1] ?? "").length;
  const amount = toUnits(input.amount, a); // scale a
  const rate = toUnits(input.rate, 4); // scale 4
  const pct = toUnits(input.feePercent, 2); // scale 2
  const fixed = toUnits(input.feeFixedSdg, 2); // scale 2 (cents)
  const base = amount * rate; // scale a + 4
  // base × pct / 100 at scale a+6+2; to cents (scale 2): ÷ 10^(a+6).
  const feeCents = roundDiv(base * pct, pow10(a + 6)) + fixed;
  // total = ceil(base + fee) with both at scale a + 4.
  const total = ceilDiv(base + feeCents * pow10(a + 2), pow10(a + 4));
  return {
    base: fromUnits(base, a + 4).replace(/\.?0+$/, ""),
    feeSdg: fromUnits(feeCents, 2),
    totalSdg: Number(total),
  };
}

/** Compares two non-negative decimal strings: -1, 0 or 1. */
export function compareDecimal(x: string, y: string): number {
  const scale = Math.max(
    (x.split(".")[1] ?? "").length,
    (y.split(".")[1] ?? "").length,
  );
  const a = toUnits(x, scale);
  const b = toUnits(y, scale);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** "56.5" with 2 decimals → "56.50" (Latin digits, grouped). */
export function formatAmount(value: string | number, decimals: number): string {
  const [i, f = ""] = String(value).split(".");
  const grouped = BigInt(i || "0").toLocaleString("en-US");
  return decimals > 0
    ? `${grouped}.${(f + "0".repeat(decimals)).slice(0, decimals)}`
    : grouped;
}

/** A rate or fee as stored, without trailing zeros, grouped: "3,050.5". */
export function formatDecimal(value: string | number): string {
  const [i, f = ""] = String(value).split(".");
  const fraction = f.replace(/0+$/, "");
  const grouped = BigInt(i || "0").toLocaleString("en-US");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

/** Decimals to show an amount with: at least 2 ("56" → "56.00"), more if typed. */
export function displayDecimals(amount: string): number {
  return Math.max(2, (amount.split(".")[1] ?? "").length);
}
