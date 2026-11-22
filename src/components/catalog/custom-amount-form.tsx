"use client";

import { startTransition, useState } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import {
  alertClasses,
  inputClasses,
  labelClasses,
  selectClasses,
} from "@/components/ui/styles";
import {
  compareDecimal,
  formatAmount,
  formatDecimal,
  parseAmount,
  quote,
} from "@/lib/custom-amount";
import type { FieldErrorCode } from "@/lib/fulfillment";
import { formatSdg } from "@/lib/format";
import type { Locale } from "@/i18n/routing";
import { useHydrated } from "@/lib/use-hydrated";
import { addCustomAmountToCart, type CartResult } from "@/server/cart/actions";

import { type FormField, FulfillmentFields } from "./fulfillment-fields";

// The product page of a custom-amount product ("Pay a bill with Visa"): an
// amount, a currency, a live calculator and the details. The calculator is
// DISPLAY ONLY: the form sends the product, the currency, the amount as
// typed and the details, never a price; the database re-reads the rate,
// limits and fee and prices the line itself (private.custom_amount_quote).

export type FormCurrency = {
  code: string;
  name: string;
  symbol: string;
  rate: string;
  min: string;
  max: string;
  /** Formatted on the server ("21 Nov 2026, 14:05"). */
  updated: string;
};

type Strings = {
  amount: string;
  currency: string;
  limits: string;
  rate: string;
  rateUpdated: string;
  subtotal: string;
  fee: string;
  feeRule: string;
  total: string;
  roundingNote: string;
  details: string;
  addToCart: string;
  added: string;
  viewCart: string;
  signInAction: string;
  required: string;
  optional: string;
  select: string;
  enterAmount: string;
  amountErrors: Record<string, string>;
  errors: Record<string, string>;
  reasons: Record<string, string>;
};

/** "{min}" "{max}" "{code}" "{rate}" … in a server-resolved string. */
const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? "");

export function CustomAmountForm({
  productId,
  currencies,
  decimals,
  feePercent,
  feeFixedSdg,
  fields,
  locale,
  strings,
  loginHref,
  cartHref,
}: {
  productId: string;
  currencies: FormCurrency[];
  decimals: number;
  feePercent: string;
  feeFixedSdg: string;
  fields: FormField[];
  locale: Locale;
  strings: Strings;
  loginHref: string;
  cartHref: string;
}) {
  const [code, setCode] = useState(currencies[0].code);
  const [raw, setRaw] = useState("");
  const [result, setResult] = useState<CartResult | null>(null);
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();
  const currency = currencies.find((c) => c.code === code) ?? currencies[0];

  // What the calculator can say about the amount typed so far.
  const parsed = raw.trim() ? parseAmount(raw, decimals) : null;
  let problem: string | null = null;
  if (parsed && !parsed.ok) problem = parsed.error;
  else if (parsed?.ok && compareDecimal(parsed.value, currency.min) < 0)
    problem = "below_min";
  else if (parsed?.ok && compareDecimal(parsed.value, currency.max) > 0)
    problem = "above_max";
  const q =
    parsed?.ok && !problem
      ? quote({
          amount: parsed.value,
          rate: currency.rate,
          feePercent,
          feeFixedSdg,
        })
      : null;
  const hasFee = Number(feePercent) > 0 || Number(feeFixedSdg) > 0;
  const values = {
    min: formatAmount(currency.min, decimals),
    max: formatAmount(currency.max, decimals),
    code: currency.code,
    rate: formatDecimal(currency.rate),
    percent: formatDecimal(feePercent),
    fixed: formatDecimal(feeFixedSdg),
    decimals: String(decimals),
    date: currency.updated,
  };

  const errors: Record<string, FieldErrorCode> =
    result && !result.ok ? (result.errors ?? {}) : {};
  const reason = result && !result.ok && !result.errors ? result.error : null;
  const stray = Object.entries(errors).find(
    ([key]) => !fields.some((f) => f.key === key),
  );

  return (
    <form
      method="post"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setPending(true);
        startTransition(async () => {
          const res = await addCustomAmountToCart(formData);
          setResult(res);
          setPending(false);
        });
      }}
      className="grid gap-5"
      data-testid="custom-amount-form"
    >
      <input type="hidden" name="productId" value={productId} />
      <fieldset disabled={!hydrated} className="contents">
        <div className="grid gap-4 rounded-2xl border bg-card p-4">
          <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] gap-3">
            <div className="grid gap-1.5">
              <label htmlFor="ca-amount" className={labelClasses}>
                {strings.amount}
              </label>
              <input
                id="ca-amount"
                name="amount"
                value={raw}
                onChange={(e) => {
                  setRaw(e.target.value);
                  setResult(null);
                }}
                inputMode="decimal"
                autoComplete="off"
                dir="ltr"
                maxLength={40}
                placeholder={formatAmount("0", decimals)}
                aria-invalid={!!problem}
                aria-describedby="ca-amount-help"
                className={`${inputClasses} h-12 text-lg font-bold tabular-nums`}
                data-testid="amount-input"
              />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="ca-currency" className={labelClasses}>
                {strings.currency}
              </label>
              <select
                id="ca-currency"
                name="currency"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setResult(null);
                }}
                className={`${selectClasses} h-12`}
                data-testid="currency-select"
              >
                {currencies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p
            id="ca-amount-help"
            className={`text-sm ${problem ? "text-destructive" : "text-muted-foreground"}`}
            data-testid="amount-help"
            data-problem={problem ?? undefined}
          >
            {problem
              ? fill(
                  strings.amountErrors[problem] ??
                    strings.amountErrors.malformed,
                  values,
                )
              : fill(strings.limits, values)}
          </p>

          <div className="grid gap-1.5 rounded-xl bg-muted/60 p-3 text-sm">
            <dl
              className="grid gap-1.5"
              aria-live="polite"
              data-testid="calculator"
            >
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{strings.rate}</dt>
                <dd className="text-end">
                  <bdi
                    dir="ltr"
                    className="tabular-nums"
                    data-testid="calc-rate"
                  >
                    1 {currency.code} = {values.rate} SDG
                  </bdi>
                  <span className="block text-xs text-muted-foreground">
                    {fill(strings.rateUpdated, values)}
                  </span>
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{strings.subtotal}</dt>
                <dd>
                  <bdi
                    dir="ltr"
                    className="tabular-nums"
                    data-testid="calc-subtotal"
                  >
                    {q && parsed?.ok
                      ? `${formatAmount(parsed.value, decimals)} ${currency.code} × ${values.rate}`
                      : "—"}
                  </bdi>
                </dd>
              </div>
              {hasFee && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">
                    {strings.fee}{" "}
                    <bdi dir="ltr" className="text-xs tabular-nums">
                      ({fill(strings.feeRule, values)})
                    </bdi>
                  </dt>
                  <dd>
                    <bdi
                      dir="ltr"
                      className="tabular-nums"
                      data-testid="calc-fee"
                    >
                      {q ? `${formatDecimal(q.feeSdg)} SDG` : "—"}
                    </bdi>
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-3 border-t pt-1.5 font-bold">
                <dt>{strings.total}</dt>
                <dd dir="auto" data-testid="calc-total">
                  {q ? formatSdg(q.totalSdg, locale) : "—"}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              {strings.roundingNote}
            </p>
          </div>
        </div>

        {fields.length > 0 && (
          <fieldset className="grid gap-4 rounded-2xl border bg-card p-4">
            <legend className="mb-1 text-base font-bold">
              {strings.details}
            </legend>
            <FulfillmentFields
              fields={fields}
              errors={errors}
              strings={strings}
            />
          </fieldset>
        )}

        {result?.ok && (
          <div
            role="status"
            className={`${alertClasses.base} ${alertClasses.success} flex flex-wrap items-center justify-between gap-2`}
            data-testid="added-to-cart"
          >
            <span>{strings.added}</span>
            <a href={cartHref} className="font-bold underline">
              {strings.viewCart}
            </a>
          </div>
        )}
        {stray && (
          <div
            role="alert"
            className={`${alertClasses.base} ${alertClasses.error}`}
            data-testid="cart-error"
            data-reason="fulfillment_invalid"
          >
            {strings.errors[stray[1]] ?? strings.errors.type}
          </div>
        )}
        {reason && (
          <div
            role="alert"
            className={`${alertClasses.base} ${alertClasses.error}`}
            data-testid="cart-error"
            data-reason={reason}
          >
            {fill(
              strings.reasons[reason] ?? strings.reasons.server_error,
              values,
            )}{" "}
            {reason === "sign_in" && (
              <a href={loginHref} className="font-bold underline">
                {strings.signInAction}
              </a>
            )}
          </div>
        )}

        {/* Sticky action bar: above the bottom navigation on phones. */}
        <div
          data-dock
          className="fixed inset-x-0 bottom-16 z-30 flex items-center gap-3 border-t bg-card px-4 py-2.5 shadow-[0_-6px_20px_-12px_rgb(0_0_0/0.25)] md:static md:rounded-2xl md:border md:shadow-none"
        >
          <div className="shrink-0">
            <p className="text-xs text-muted-foreground">{strings.total}</p>
            <p
              className="text-lg leading-6 font-bold"
              dir="auto"
              data-testid="order-total"
            >
              {q ? formatSdg(q.totalSdg, locale) : strings.enterAmount}
            </p>
          </div>
          <button
            type="submit"
            disabled={pending || !hydrated || !q}
            className={`${buttonVariants({ size: "xl" })} flex-1`}
          >
            {strings.addToCart}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
