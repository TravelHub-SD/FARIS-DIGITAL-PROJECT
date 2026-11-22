import {
  displayDecimals,
  formatAmount,
  formatDecimal,
} from "@/lib/custom-amount";

// "56.00 EUR × 3,050 + 200 fee = 171,000 SDG": one custom-amount line, from
// stored values only (the order snapshot, an invoice snapshot, or the cart's
// live quote). A formula reads left to right in both languages, so it is an
// LTR isolate; the localized fee word is isolated again inside it, or the
// bidi algorithm would pull the numbers after it into an RTL run.
export function CustomAmountFormula({
  amount,
  currency,
  rate,
  feeSdg,
  totalSdg,
  feeWord,
  testId,
  className,
}: {
  amount: string;
  currency: string;
  rate: string;
  feeSdg: string | null;
  totalSdg: number | string;
  feeWord: string;
  testId?: string;
  className?: string;
}) {
  const fee = Number(feeSdg ?? 0) > 0;
  return (
    <bdi
      dir="ltr"
      className={`tabular-nums ${className ?? ""}`}
      data-testid={testId}
    >
      {formatAmount(amount, displayDecimals(amount))} {currency} ×{" "}
      {formatDecimal(rate)}
      {fee && (
        <>
          {" "}
          + {formatDecimal(feeSdg!)} <bdi>{feeWord}</bdi>
        </>
      )}{" "}
      = {formatAmount(String(totalSdg).split(".")[0], 0)} SDG
    </bdi>
  );
}

/** "56.00 EUR": the amount the customer asked for. */
export function amountText(amount: string, currency: string): string {
  return `${formatAmount(amount, displayDecimals(amount))} ${currency}`;
}
