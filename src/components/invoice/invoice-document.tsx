import { getTranslations } from "next-intl/server";

import type { Locale } from "@/i18n/routing";
import { formatDateTime, formatSdg, formatUsd } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import type { Invoice } from "@/server/invoices/queries";

// The invoice as a printable A4 document. Rendered ONLY from the snapshot
// taken when it was issued (never from live orders, prices or profiles), so
// what the customer sees, prints and saves as PDF never changes.
// Always "paper" colours, also in dark mode, so print and screen agree.
// Numbers, references and phones are isolated LTR runs inside Arabic text.

const pick = (
  ar: string | null | undefined,
  en: string | null | undefined,
  locale: Locale,
) => (locale === "ar" ? ar || en : en || ar) ?? "";

/** Latin-only tokens (invoice/order numbers, phones, USD, transfer refs): LTR. */
function Ltr({ children }: { children: React.ReactNode }) {
  return (
    <bdi dir="ltr" className="tabular-nums">
      {children}
    </bdi>
  );
}

/**
 * Values Intl already formatted for the locale (Arabic dates, SDG amounts,
 * the rate sentence): isolated but NOT forced LTR, or "م" and "ج.س." would
 * be torn from their numbers (found by reading the rendered PDF).
 */
function Iso({
  children,
  testId,
}: {
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <bdi className="tabular-nums" data-testid={testId}>
      {children}
    </bdi>
  );
}

export async function InvoiceDocument({
  invoice,
  locale,
}: {
  invoice: Invoice;
  locale: Locale;
}) {
  const t = await getTranslations({ locale, namespace: "Invoices.doc" });
  const s = invoice.snapshot;
  const o = s.order;
  const seller = s.seller;
  const sellerName = pick(seller?.name_ar, seller?.name_en, locale);
  const rate = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 4,
  }).format(Number(o.usd_sdg_rate));
  const isVoid = invoice.status === "void";
  const product = pick(o.product_name_ar, o.product_name_en, locale);
  const variant = pick(o.variant_name_ar, o.variant_name_en, locale);

  return (
    <article
      data-testid="invoice-document"
      data-invoice-number={invoice.invoice_number}
      data-status={invoice.status}
      className="relative mx-auto grid w-full max-w-[210mm] gap-6 overflow-hidden rounded-lg bg-white p-6 text-sm text-neutral-900 shadow-sm ring-1 ring-neutral-200 sm:p-10 print:max-w-none print:rounded-none print:p-0 print:shadow-none print:ring-0"
    >
      {isVoid && (
        <div
          aria-hidden
          data-testid="void-stamp"
          className="pointer-events-none absolute inset-0 grid place-items-center"
        >
          <span className="-rotate-12 rounded-lg border-8 border-red-600/50 px-8 text-7xl font-bold text-red-600/50">
            {t("voidStamp")}
          </span>
        </div>
      )}

      <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-[#005CFF] pb-5">
        <div className="grid gap-1">
          <p className="text-2xl font-bold text-[#005CFF]">{sellerName}</p>
          {pick(seller?.address_ar, seller?.address_en, locale) && (
            <p className="text-neutral-600">
              {pick(seller?.address_ar, seller?.address_en, locale)}
            </p>
          )}
          {seller?.contact_phone && (
            <p className="text-neutral-600">
              {t("phone")}: <Ltr>{formatPhone(seller.contact_phone)}</Ltr>
            </p>
          )}
          {seller?.contact_email && (
            <p className="text-neutral-600">
              {t("email")}: <Ltr>{seller.contact_email}</Ltr>
            </p>
          )}
        </div>
        <div className="grid gap-1 sm:text-end">
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <p>
            {t("number")}:{" "}
            <Ltr>
              <strong data-testid="invoice-number">
                {invoice.invoice_number}
              </strong>
            </Ltr>
          </p>
          <p>
            {t("issued")}:{" "}
            <Iso testId="invoice-issued-at">
              {formatDateTime(invoice.issued_at, locale)}
            </Iso>
          </p>
        </div>
      </header>

      <section className="grid gap-6 sm:grid-cols-2">
        <div className="grid content-start gap-1">
          <h2 className="text-xs font-bold tracking-wide text-neutral-500 uppercase">
            {t("billTo")}
          </h2>
          <p className="text-base font-bold" data-testid="invoice-customer">
            {s.customer.full_name ?? "—"}
          </p>
          {s.customer.phone && (
            <p>
              {t("phone")}: <Ltr>{formatPhone(s.customer.phone)}</Ltr>
            </p>
          )}
        </div>
        <dl className="grid grid-cols-[auto_1fr] content-start gap-x-4 gap-y-1">
          <dt className="text-neutral-500">{t("order")}</dt>
          <dd>
            <Ltr>{o.reference}</Ltr>
          </dd>
          <dt className="text-neutral-500">{t("placed")}</dt>
          <dd>
            <Iso>{formatDateTime(o.created_at, locale)}</Iso>
          </dd>
          {o.completed_at && (
            <>
              <dt className="text-neutral-500">{t("completed")}</dt>
              <dd>
                <Iso>{formatDateTime(o.completed_at, locale)}</Iso>
              </dd>
            </>
          )}
        </dl>
      </section>

      <table className="w-full border-collapse" data-testid="invoice-lines">
        <thead>
          <tr className="border-b-2 border-neutral-300 text-start text-xs text-neutral-500">
            <th className="py-2 text-start font-bold">{t("item")}</th>
            <th className="py-2 text-center font-bold">{t("qty")}</th>
            <th className="py-2 text-end font-bold">{t("unitPrice")}</th>
            <th className="py-2 text-end font-bold">{t("amount")}</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-neutral-200 align-top">
            <td className="py-3">
              <p className="font-bold">{product}</p>
              {variant && <p className="text-neutral-600">{variant}</p>}
            </td>
            <td className="py-3 text-center">
              <Ltr>{o.quantity}</Ltr>
            </td>
            <td className="py-3 text-end">
              <Ltr>{formatUsd(o.unit_price_usd, "en")}</Ltr>
            </td>
            <td className="py-3 text-end">
              <Ltr>{formatUsd(o.total_usd, "en")}</Ltr>
            </td>
          </tr>
        </tbody>
      </table>

      <dl
        className="ms-auto grid w-full max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-2"
        data-testid="invoice-totals"
      >
        <dt className="text-neutral-600">{t("subtotal")}</dt>
        <dd className="text-end">
          <Ltr>{formatUsd(o.total_usd, "en")}</Ltr>
        </dd>
        <dt className="text-neutral-600">{t("rate")}</dt>
        <dd className="text-end">
          <Iso testId="invoice-rate">{t("rateValue", { rate })}</Iso>
        </dd>
        <dt className="border-t-2 border-neutral-900 pt-2 text-base font-bold">
          {t("total")}
        </dt>
        <dd
          className="border-t-2 border-neutral-900 pt-2 text-end text-lg font-bold"
          data-testid="invoice-total"
        >
          <Iso>{formatSdg(o.total_sdg, locale)}</Iso>
        </dd>
      </dl>

      {s.payment && (
        <section className="grid gap-1 rounded-md bg-neutral-50 p-4 print:bg-transparent print:p-0">
          <h2 className="text-xs font-bold tracking-wide text-neutral-500 uppercase">
            {t("payment")}
          </h2>
          <p>
            {t("bank")}:{" "}
            {pick(s.payment.bank_name_ar, s.payment.bank_name_en, locale)}
          </p>
          <p>
            {t("transfer")}: <Ltr>{s.payment.transaction_ref}</Ltr>
          </p>
          {s.payment.accepted_at && (
            <p>
              {t("acceptedAt")}:{" "}
              <Iso>{formatDateTime(s.payment.accepted_at, locale)}</Iso>
            </p>
          )}
        </section>
      )}

      {isVoid && (
        <p
          className="rounded-md border border-red-300 bg-red-50 p-3 text-red-800"
          data-testid="void-notice"
        >
          {t("voidNotice", {
            at: invoice.voided_at
              ? formatDateTime(invoice.voided_at, locale)
              : "",
            reason: invoice.void_reason ?? "",
          })}
        </p>
      )}

      <footer className="border-t border-neutral-200 pt-4 text-xs text-neutral-500">
        {t("footer", { seller: sellerName })}
      </footer>
    </article>
  );
}
