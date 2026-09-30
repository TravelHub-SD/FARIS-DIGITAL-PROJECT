"use client";

import { useActionState, useState } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { alertClasses } from "@/components/ui/styles";
import type { Locale } from "@/i18n/routing";
import { formatSdg } from "@/lib/format";
import { useHydrated } from "@/lib/use-hydrated";
import { checkoutCart, type CheckoutState } from "@/server/cart/actions";

// Sends only what the customer agreed to (the total shown) and a key that
// makes a double tap create one order. The database re-prices the cart and
// answers "price_changed" with the new total if it differs; the customer then
// confirms again with that total.

type Strings = {
  confirm: string;
  total: string;
  priceChanged: string;
  reasons: Record<string, string>;
  actions: { cart: string; kyc: string; complete: string; signIn: string };
};

const REASON_LINK: Record<string, [keyof Strings["actions"], string]> = {
  kyc_required: ["kyc", "/account/kyc"],
  incomplete_account: ["complete", "/complete-account"],
  phone_not_verified: ["complete", "/complete-account"],
  sign_in: ["signIn", "/login"],
  variant_unavailable: ["cart", "/cart"],
  invalid_quantity: ["cart", "/cart"],
  fulfillment_invalid: ["cart", "/cart"],
  cart_empty: ["cart", "/cart"],
};

export function CheckoutForm({
  locale,
  totalSdg,
  idempotencyKey,
  strings,
}: {
  locale: Locale;
  totalSdg: number;
  idempotencyKey: string;
  strings: Strings;
}) {
  const hydrated = useHydrated();
  const [expected, setExpected] = useState(totalSdg);
  const [state, action, pending] = useActionState(
    async (prev: CheckoutState, formData: FormData) => {
      const next = await checkoutCart(prev, formData);
      if (next.status === "price_changed") setExpected(next.totalSdg);
      return next;
    },
    { status: "idle" },
  );
  const link = state.status === "error" ? REASON_LINK[state.reason] : undefined;

  return (
    <form action={action} className="grid gap-3" data-testid="checkout-form">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="expectedTotalSdg" value={String(expected)} />

      {state.status === "price_changed" && (
        <p
          role="alert"
          className={`${alertClasses.base} ${alertClasses.warning}`}
          data-testid="price-changed"
        >
          {strings.priceChanged.replace(
            "{price}",
            formatSdg(state.totalSdg, locale) ?? "",
          )}
        </p>
      )}
      {state.status === "error" && (
        <p
          role="alert"
          className={`${alertClasses.base} ${alertClasses.error}`}
          data-testid="checkout-error"
          data-reason={state.reason}
        >
          {strings.reasons[state.reason] ?? strings.reasons.server_error}{" "}
          {link && (
            <a href={`/${locale}${link[1]}`} className="font-bold underline">
              {strings.actions[link[0]]}
            </a>
          )}
        </p>
      )}

      <div
        data-dock
        className="fixed inset-x-0 bottom-16 z-30 flex items-center gap-3 border-t bg-card px-4 py-2.5 shadow-[0_-6px_20px_-12px_rgb(0_0_0/0.25)] md:static md:rounded-2xl md:border md:shadow-none"
      >
        <div className="shrink-0">
          <p className="text-xs text-muted-foreground">{strings.total}</p>
          <p
            className="text-lg leading-6 font-bold"
            dir="auto"
            data-testid="checkout-total"
          >
            {formatSdg(expected, locale)}
          </p>
        </div>
        <button
          type="submit"
          disabled={pending || !hydrated}
          className={`${buttonVariants({ size: "xl" })} flex-1`}
          data-testid="confirm-order"
        >
          {strings.confirm}
        </button>
      </div>
    </form>
  );
}
