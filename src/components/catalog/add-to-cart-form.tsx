"use client";

import { startTransition, useState } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { alertClasses, labelClasses } from "@/components/ui/styles";
import type { FieldErrorCode } from "@/lib/fulfillment";
import type { LocalizedText } from "@/lib/localized";
import { useHydrated } from "@/lib/use-hydrated";
import { addToCart, type CartResult } from "@/server/cart/actions";

import { type FormField, FulfillmentFields, Text } from "./fulfillment-fields";

export type { FormField };

// The only client component on the product page besides the comment form.
// Everything it shows is resolved on the server (labels, fallbacks, formatted
// prices) and passed in as props, so no translation or formatting library
// ships to the browser. The cart stores the package, quantity and details,
// never a price: the database prices the cart when it is shown and again at
// checkout (decisions.md 2026-09-30).

export type FormVariant = {
  id: string;
  name: LocalizedText | null;
  price: string | null;
  /** Display only, when above the price. */
  was: string | null;
  /** Formatted SDG totals for quantity 1..n, from the database. */
  totals: string[] | null;
  fields: FormField[];
};

type Strings = {
  chooseOption: string;
  details: string;
  addToCart: string;
  added: string;
  viewCart: string;
  quantity: string;
  increase: string;
  decrease: string;
  total: string;
  signInAction: string;
  required: string;
  optional: string;
  select: string;
  priceUnavailable: string;
  wasPrice: string;
  errors: Record<string, string>;
  reasons: Record<string, string>;
};

export function AddToCartForm({
  variants,
  strings,
  loginHref,
  cartHref,
}: {
  variants: FormVariant[];
  strings: Strings;
  loginHref: string;
  cartHref: string;
}) {
  const [selected, setSelected] = useState(variants[0].id);
  const [quantity, setQuantity] = useState(1);
  const [result, setResult] = useState<CartResult | null>(null);
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();
  const variant = variants.find((v) => v.id === selected) ?? variants[0];
  const maxQuantity = variant.totals?.length ?? 1;
  const total = variant.totals?.[quantity - 1] ?? null;
  const errors: Record<string, FieldErrorCode> =
    result && !result.ok ? (result.errors ?? {}) : {};
  const reason = result && !result.ok && !result.errors ? result.error : null;

  return (
    <form
      method="post"
      // onSubmit rather than a form action: React resets uncontrolled fields
      // after a form action, which would wipe what the customer typed when
      // the server answers with an error.
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(form);
        setPending(true);
        startTransition(async () => {
          const res = await addToCart(formData);
          setResult(res);
          setPending(false);
        });
      }}
      className="grid gap-5"
      data-testid="add-to-cart-form"
    >
      {/* Disabled until hydrated: controlled fields (package, quantity)
          would be reset by hydration, and the form needs JS to submit. */}
      <fieldset disabled={!hydrated} className="contents">
        <input type="hidden" name="quantity" value={quantity} />
        <fieldset className="grid gap-2.5">
          <legend className="mb-2.5 text-base font-bold">
            {strings.chooseOption}
          </legend>
          <div className="grid grid-cols-2 gap-2.5">
            {variants.map((v) => (
              <label
                key={v.id}
                className="relative flex cursor-pointer flex-col gap-0.5 rounded-xl border-[1.5px] bg-card p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50"
                data-testid="variant-option"
              >
                <input
                  type="radio"
                  name="variantId"
                  value={v.id}
                  checked={v.id === selected}
                  onChange={() => {
                    setSelected(v.id);
                    setQuantity(1);
                    setResult(null);
                  }}
                  className="sr-only"
                />
                <span className="text-[15px] font-bold">
                  <Text value={v.name} />
                </span>
                <span
                  className="flex flex-wrap items-baseline gap-x-1.5 text-sm"
                  dir="auto"
                >
                  <span className={v.was ? "font-bold" : undefined}>
                    {v.price ?? strings.priceUnavailable}
                  </span>
                  {v.was && (
                    <s className="text-xs text-muted-foreground">
                      <span className="sr-only">{strings.wasPrice} </span>
                      {v.was}
                    </s>
                  )}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {(variant.fields.length > 0 || maxQuantity > 1) && (
          <div className="grid gap-4 rounded-2xl border bg-card p-4">
            {variant.fields.length > 0 && (
              <fieldset className="grid gap-4" key={variant.id}>
                <legend className="mb-1 text-base font-bold">
                  {strings.details}
                </legend>
                <FulfillmentFields
                  fields={variant.fields}
                  errors={errors}
                  strings={strings}
                />
              </fieldset>
            )}
            {maxQuantity > 1 && (
              <div className="flex items-center justify-between gap-3">
                <span className={labelClasses} id="qty-label">
                  {strings.quantity}
                </span>
                <div
                  className="inline-flex h-11 items-center rounded-xl border bg-background"
                  role="group"
                  aria-labelledby="qty-label"
                >
                  <button
                    type="button"
                    aria-label={strings.decrease}
                    disabled={quantity <= 1}
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    className="grid size-11 place-items-center text-xl font-bold text-primary-text disabled:opacity-40"
                  >
                    −
                  </button>
                  <output
                    className="min-w-8 text-center font-bold tabular-nums"
                    aria-live="polite"
                    data-testid="quantity"
                  >
                    {quantity}
                  </output>
                  <button
                    type="button"
                    aria-label={strings.increase}
                    disabled={quantity >= maxQuantity}
                    onClick={() =>
                      setQuantity((q) => Math.min(maxQuantity, q + 1))
                    }
                    className="grid size-11 place-items-center text-xl font-bold text-primary-text disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
              </div>
            )}
          </div>
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
        {reason && (
          <div
            role="alert"
            className={`${alertClasses.base} ${alertClasses.error}`}
            data-testid="cart-error"
            data-reason={reason}
          >
            {strings.reasons[reason] ?? strings.reasons.server_error}{" "}
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
              {total ?? strings.priceUnavailable}
            </p>
          </div>
          <button
            type="submit"
            disabled={pending || !hydrated || total === null}
            className={`${buttonVariants({ size: "xl" })} flex-1`}
          >
            {strings.addToCart}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
