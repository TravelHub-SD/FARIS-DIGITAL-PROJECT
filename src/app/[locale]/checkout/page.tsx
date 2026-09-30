import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { CheckoutForm } from "@/components/cart/checkout-form";
import { L10n } from "@/components/catalog/l10n";
import { InfoIcon, ShieldIcon } from "@/components/icons";
import { Link } from "@/components/link";
import { buttonVariants } from "@/components/ui/button-variants";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formatSdg } from "@/lib/format";
import { localized } from "@/lib/localized";
import { requireCompleteUser } from "@/server/auth/session";
import { getMyCart } from "@/server/cart/queries";

export const metadata: Metadata = { robots: { index: false } };

export default async function CheckoutPage({
  params,
}: PageProps<"/[locale]/checkout">) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  await requireCompleteUser(locale);
  const cart = await getMyCart();
  if (cart.lines.length === 0) redirect({ href: "/cart", locale });
  const t = await getTranslations("Cart");
  const tc = await getTranslations("Catalog");
  const blocked = cart.unavailable > 0 || cart.kyc_needed;

  return (
    <div className="mx-auto grid w-full max-w-3xl grid-cols-[minmax(0,1fr)] gap-4 px-4 pt-4 pb-32 md:pb-10">
      <Link
        href="/cart"
        className="text-sm text-muted-foreground hover:underline"
      >
        {t("backToCart")}
      </Link>
      <h1 className="text-2xl font-bold">{t("checkoutTitle")}</h1>

      <section
        aria-labelledby="checkout-items"
        className="grid gap-2 rounded-2xl border bg-card p-4"
      >
        <h2 id="checkout-items" className="font-bold">
          {t("items")}
        </h2>
        <ul className="grid divide-y text-sm" data-testid="checkout-lines">
          {cart.lines.map((line) => (
            <li
              key={line.id}
              className="flex items-baseline justify-between gap-3 py-2"
            >
              <span className="min-w-0">
                <L10n
                  value={localized(
                    line.product_name_ar,
                    line.product_name_en,
                    locale,
                  )}
                  className="font-bold"
                />{" "}
                <span className="text-muted-foreground">
                  —{" "}
                  <L10n
                    value={localized(
                      line.variant_name_ar,
                      line.variant_name_en,
                      locale,
                    )}
                  />{" "}
                  × {line.quantity}
                </span>
              </span>
              <span className="shrink-0 font-bold" dir="auto">
                {line.available
                  ? formatSdg(line.line_total_sdg, locale)
                  : t("unavailable")}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex justify-between gap-3 border-t pt-2">
          <span className="font-bold">{tc("total")}</span>
          <span className="text-lg font-bold" dir="auto">
            {formatSdg(cart.total_sdg, locale)}
          </span>
        </div>
      </section>

      <section className="grid gap-2.5 rounded-2xl border bg-card p-4 text-sm">
        <h2 className="font-bold">{t("howToPay")}</h2>
        <p className="flex gap-2">
          <ShieldIcon className="mt-0.5 size-5 shrink-0 text-primary-text" />
          <span>{t("payNote")}</span>
        </p>
        <p className="flex gap-2 text-muted-foreground">
          <InfoIcon className="mt-0.5 size-5 shrink-0" />
          <span>{t("consentNote")}</span>
        </p>
      </section>

      {blocked ? (
        <div
          role="status"
          className="grid gap-3 rounded-xl bg-warning-soft p-3 text-sm text-warning-text"
          data-testid="checkout-blocked"
        >
          <p>
            {cart.kyc_needed
              ? t("kycNote")
              : t("unavailableNote", { count: cart.unavailable })}
          </p>
          <Link
            href={cart.kyc_needed ? "/account/kyc" : "/cart"}
            className={`${buttonVariants({ variant: "outline", size: "sm" })} justify-self-start`}
          >
            {cart.kyc_needed ? tc("kycAction") : t("backToCart")}
          </Link>
        </div>
      ) : (
        <CheckoutForm
          locale={locale}
          totalSdg={cart.total_sdg}
          // One key per page view: a double tap or a retry after a lost
          // response creates the order once (checkout_cart is idempotent).
          idempotencyKey={randomUUID()}
          strings={{
            confirm: t("confirm"),
            total: tc("total"),
            priceChanged: t.raw("priceChanged") as string,
            reasons: {
              sign_in: tc("reasons.sign_in"),
              incomplete_account: tc("reasons.incomplete_account"),
              kyc_required: t("kycNote"),
              phone_not_verified: tc("reasons.phone_not_verified"),
              customer_blocked: tc("reasons.customer_blocked"),
              variant_unavailable: t("reasons.variant_unavailable"),
              invalid_quantity: tc("reasons.invalid_quantity"),
              fulfillment_invalid: t("reasons.fulfillment_invalid"),
              rate_limited: tc("reasons.rate_limited"),
              cart_empty: t("reasons.cart_empty"),
              invalid_input: tc("reasons.invalid_input"),
              server_error: tc("reasons.server_error"),
            },
            actions: {
              cart: t("backToCart"),
              kyc: tc("kycAction"),
              complete: tc("completeAction"),
              signIn: tc("signInAction"),
            },
          }}
        />
      )}
    </div>
  );
}
