"use client";

import { startTransition, useState } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { alertClasses } from "@/components/ui/styles";
import {
  type FieldStrings,
  type FormField,
  FulfillmentFields,
} from "@/components/catalog/fulfillment-fields";
import type { FieldErrorCode } from "@/lib/fulfillment";
import { useHydrated } from "@/lib/use-hydrated";
import {
  type CartResult,
  removeCartLine,
  updateCartLine,
} from "@/server/cart/actions";

// Quantity, edit and remove for one cart line. The actions run with the
// customer's session; the database re-checks the quantity and details and
// re-prices the cart, and the page re-renders with the new total.

type Strings = FieldStrings & {
  quantity: string;
  increase: string;
  decrease: string;
  edit: string;
  save: string;
  remove: string;
  reasons: Record<string, string>;
};

export function CartLineActions({
  lineId,
  quantity,
  maxQuantity,
  available,
  fields,
  values,
  strings,
}: {
  lineId: string;
  quantity: number;
  maxQuantity: number;
  available: boolean;
  fields: FormField[];
  values: Record<string, string>;
  strings: Strings;
}) {
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<CartResult | null>(null);
  const errors: Record<string, FieldErrorCode> =
    result && !result.ok ? (result.errors ?? {}) : {};
  const reason = result && !result.ok && !result.errors ? result.error : null;

  function run(action: () => Promise<CartResult>) {
    setPending(true);
    startTransition(async () => {
      const res = await action();
      setResult(res);
      setPending(false);
    });
  }
  function setQuantity(q: number) {
    const fd = new FormData();
    fd.set("lineId", lineId);
    fd.set("quantity", String(q));
    run(() => updateCartLine(fd));
  }
  const busy = pending || !hydrated;

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {available ? (
          <div
            className="inline-flex h-9 items-center rounded-lg border bg-background"
            role="group"
            aria-label={strings.quantity}
          >
            <button
              type="button"
              aria-label={strings.decrease}
              disabled={busy || quantity <= 1}
              onClick={() => setQuantity(quantity - 1)}
              className="grid size-9 place-items-center text-lg font-bold text-primary-text disabled:opacity-40"
            >
              −
            </button>
            <output
              className="min-w-7 text-center text-sm font-bold tabular-nums"
              aria-live="polite"
              data-testid="line-quantity"
            >
              {quantity}
            </output>
            <button
              type="button"
              aria-label={strings.increase}
              disabled={busy || quantity >= maxQuantity}
              onClick={() => setQuantity(quantity + 1)}
              className="grid size-9 place-items-center text-lg font-bold text-primary-text disabled:opacity-40"
            >
              +
            </button>
          </div>
        ) : (
          <span />
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            const fd = new FormData();
            fd.set("lineId", lineId);
            run(() => removeCartLine(fd));
          }}
          className="text-sm font-bold text-destructive hover:underline disabled:opacity-50"
          data-testid="remove-line"
        >
          {strings.remove}
        </button>
      </div>

      {available && fields.length > 0 && (
        <details className="group" open={Object.keys(errors).length > 0}>
          <summary className="cursor-pointer list-none text-sm font-bold text-primary-text hover:underline [&::-webkit-details-marker]:hidden">
            {strings.edit}
          </summary>
          <form
            className="mt-3 grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const fd = new FormData(event.currentTarget);
              fd.set("lineId", lineId);
              fd.set("quantity", String(quantity));
              run(() => updateCartLine(fd));
            }}
            data-testid="edit-line"
          >
            <fieldset disabled={busy} className="contents">
              <FulfillmentFields
                fields={fields}
                errors={errors}
                strings={strings}
                defaults={values}
                idPrefix={`l-${lineId.slice(0, 8)}`}
              />
              <button
                type="submit"
                className={`${buttonVariants({ variant: "outline", size: "sm" })} justify-self-start`}
              >
                {strings.save}
              </button>
            </fieldset>
          </form>
        </details>
      )}

      {reason && (
        <p
          role="alert"
          className={`${alertClasses.base} ${alertClasses.error}`}
          data-testid="line-error"
          data-reason={reason}
        >
          {strings.reasons[reason] ?? strings.reasons.server_error}
        </p>
      )}
    </div>
  );
}
