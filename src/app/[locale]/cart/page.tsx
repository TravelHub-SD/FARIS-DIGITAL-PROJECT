import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { CartLineActions } from "@/components/cart/cart-line-actions";
import { toFormFields } from "@/components/catalog/fulfillment-fields";
import { L10n } from "@/components/catalog/l10n";
import { ProductVisual } from "@/components/catalog/product-visual";
import { InfoIcon } from "@/components/icons";
import { Link } from "@/components/link";
import { buttonVariants } from "@/components/ui/button-variants";
import type { Locale } from "@/i18n/routing";
import { formatSdg } from "@/lib/format";
import type { FieldDefinition } from "@/lib/fulfillment";
import { localized } from "@/lib/localized";
import { getSessionUser } from "@/server/auth/session";
import { type CartLine, getMyCart } from "@/server/cart/queries";

export const metadata: Metadata = { robots: { index: false } };

/** Sensitive details (e.g. an account email) are shown shortened. */
function mask(value: string) {
  const at = value.indexOf("@");
  if (at > 0) return `${value[0]}•••${value.slice(at)}`;
  return value.length > 4 ? `${value[0]}•••${value.slice(-2)}` : "•••";
}

function Details({
  line,
  defs,
  locale,
}: {
  line: CartLine;
  defs: FieldDefinition[];
  locale: Locale;
}) {
  const rows = defs.filter((f) => line.fulfillment_data[f.key]);
  if (rows.length === 0) return null;
  return (
    <dl className="grid gap-0.5 text-xs text-muted-foreground">
      {rows.map((f) => {
        const value = line.fulfillment_data[f.key];
        return (
          <div key={f.key} className="flex flex-wrap gap-1">
            <dt>
              <L10n value={localized(f.label_ar, f.label_en, locale)} />:
            </dt>
            <dd dir="auto" className="font-bold wrap-anywhere text-foreground">
              {f.sensitive ? mask(value) : value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export default async function CartPage({
  params,
}: PageProps<"/[locale]/cart">) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  const t = await getTranslations("Cart");
  const tc = await getTranslations("Catalog");
  const user = await getSessionUser();

  const shell = (children: React.ReactNode) => (
    <div className="mx-auto grid w-full max-w-3xl grid-cols-[minmax(0,1fr)] gap-4 px-4 pt-4 pb-32 md:pb-10">
      {children}
    </div>
  );

  if (!user) {
    return shell(
      <>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <div
          className="grid justify-items-center gap-3 rounded-2xl border bg-card px-4 py-10 text-center"
          data-testid="cart-sign-in"
        >
          <p className="font-bold">{t("signInTitle")}</p>
          <p className="text-sm text-muted-foreground">{t("signInHint")}</p>
          <Link
            href={`/login?next=${encodeURIComponent(`/${locale}/cart`)}`}
            className={buttonVariants({ size: "xl" })}
          >
            {tc("signInAction")}
          </Link>
        </div>
      </>,
    );
  }

  const cart = await getMyCart();
  const count = cart.lines.length;
  const total = formatSdg(cart.total_sdg, locale)!;
  const blocked = cart.unavailable > 0 || cart.kyc_needed || count === 0;
  const fieldStrings = {
    required: tc("required"),
    optional: tc("optional"),
    select: tc("select"),
    errors: {
      missing: tc("errors.missing"),
      unknown: tc("errors.unknown"),
      type: tc("errors.type"),
      length: tc("errors.length"),
      format: tc("errors.format"),
      option: tc("errors.option"),
    },
  };
  const lineStrings = {
    ...fieldStrings,
    quantity: tc("quantity"),
    increase: tc("increase"),
    decrease: tc("decrease"),
    edit: t("edit"),
    save: t("save"),
    remove: t("remove"),
    reasons: {
      sign_in: tc("cartReasons.sign_in"),
      incomplete_account: tc("cartReasons.incomplete_account"),
      customer_blocked: tc("cartReasons.customer_blocked"),
      variant_unavailable: tc("cartReasons.variant_unavailable"),
      invalid_quantity: tc("cartReasons.invalid_quantity"),
      fulfillment_invalid: tc("cartReasons.fulfillment_invalid"),
      cart_full: tc("cartReasons.cart_full"),
      not_found: tc("cartReasons.not_found"),
      invalid_input: tc("cartReasons.invalid_input"),
      server_error: tc("cartReasons.server_error"),
    },
  };

  if (count === 0) {
    return shell(
      <>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <div
          className="grid justify-items-center gap-3 rounded-2xl border bg-card px-4 py-10 text-center"
          data-testid="cart-empty"
        >
          <p className="font-bold">{t("empty")}</p>
          <p className="text-sm text-muted-foreground">{t("emptyHint")}</p>
          <Link href="/" className={buttonVariants({ size: "xl" })}>
            {t("browse")}
          </Link>
        </div>
      </>,
    );
  }

  return shell(
    <>
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <span className="text-sm text-muted-foreground">
          {tc("productCount", { count })}
        </span>
      </div>

      {cart.kyc_needed && (
        <div
          role="status"
          className="flex gap-2.5 rounded-xl bg-warning-soft p-3 text-sm text-warning-text"
          data-testid="cart-kyc"
        >
          <InfoIcon className="mt-0.5 size-5 shrink-0" />
          <p>
            {t("kycNote")}{" "}
            <Link href="/account/kyc" className="font-bold underline">
              {tc("kycAction")}
            </Link>
          </p>
        </div>
      )}
      {cart.unavailable > 0 && (
        <div
          role="status"
          className="flex gap-2.5 rounded-xl bg-warning-soft p-3 text-sm text-warning-text"
          data-testid="cart-unavailable"
        >
          <InfoIcon className="mt-0.5 size-5 shrink-0" />
          <p>{t("unavailableNote", { count: cart.unavailable })}</p>
        </div>
      )}

      <ul
        className="grid divide-y rounded-2xl border bg-card px-3.5"
        data-testid="cart-lines"
      >
        {cart.lines.map((line) => {
          const product = localized(
            line.product_name_ar,
            line.product_name_en,
            locale,
          );
          return (
            <li
              key={line.id}
              className="flex gap-3 py-3.5"
              data-testid="cart-line"
              data-available={line.available}
            >
              <Link
                href={`/p/${line.product_slug}`}
                className="size-16 shrink-0"
                tabIndex={-1}
                aria-hidden
              >
                <ProductVisual
                  name={product?.text ?? line.product_slug}
                  imagePath={line.image_path}
                  className={`rounded-xl text-xl ${line.available ? "" : "opacity-50 grayscale"}`}
                  decorative
                />
              </Link>
              <div className="grid min-w-0 flex-1 gap-1">
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/p/${line.product_slug}`}
                    className="text-sm font-bold hover:underline"
                  >
                    <L10n value={product} />
                  </Link>
                  <span
                    className="shrink-0 text-sm font-bold"
                    dir="auto"
                    data-testid="line-total"
                  >
                    {line.available
                      ? formatSdg(line.line_total_sdg, locale)
                      : t("unavailable")}
                  </span>
                </div>
                <L10n
                  value={localized(
                    line.variant_name_ar,
                    line.variant_name_en,
                    locale,
                  )}
                  className="text-xs text-muted-foreground"
                />
                <Details
                  line={line}
                  defs={line.required_fields}
                  locale={locale}
                />
                <CartLineActions
                  key={`${line.quantity}:${JSON.stringify(line.fulfillment_data)}`}
                  lineId={line.id}
                  quantity={line.quantity}
                  maxQuantity={line.max_quantity}
                  available={line.available}
                  fields={toFormFields(line.required_fields, locale)}
                  values={line.fulfillment_data}
                  strings={lineStrings}
                />
              </div>
            </li>
          );
        })}
      </ul>

      <div className="grid gap-2 rounded-2xl border bg-card p-4">
        <div className="flex justify-between gap-3 text-sm">
          <span className="text-muted-foreground">
            {t("subtotal", { count: count - cart.unavailable })}
          </span>
          <span dir="auto">{total}</span>
        </div>
        <div className="flex justify-between gap-3 border-t pt-2">
          <span className="font-bold">{tc("total")}</span>
          <span
            className="text-lg font-bold"
            dir="auto"
            data-testid="cart-total"
          >
            {total}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{t("rateNote")}</p>
      </div>

      <div
        data-dock
        className="fixed inset-x-0 bottom-16 z-30 flex items-center gap-3 border-t bg-card px-4 py-2.5 shadow-[0_-6px_20px_-12px_rgb(0_0_0/0.25)] md:static md:rounded-2xl md:border md:shadow-none"
      >
        <div className="shrink-0">
          <p className="text-xs text-muted-foreground">{tc("total")}</p>
          <p className="text-lg leading-6 font-bold" dir="auto">
            {total}
          </p>
        </div>
        {blocked ? (
          <span
            aria-disabled
            className={`${buttonVariants({ size: "xl" })} flex-1 cursor-not-allowed opacity-50`}
            data-testid="checkout-link"
            data-disabled
          >
            {t("checkout")}
          </span>
        ) : (
          <Link
            href="/checkout"
            className={`${buttonVariants({ size: "xl" })} flex-1`}
            data-testid="checkout-link"
          >
            {t("checkout")}
          </Link>
        )}
      </div>
    </>,
  );
}
