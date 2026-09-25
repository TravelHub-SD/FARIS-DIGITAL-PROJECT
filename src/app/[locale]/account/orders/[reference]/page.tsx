import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ReceiptForm } from "@/components/account/receipt-form";
import { L10n } from "@/components/catalog/l10n";
import { Link } from "@/components/link";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Locale } from "@/i18n/routing";
import { formatDateTime, formatSdg, formatUsd } from "@/lib/format";
import { localized } from "@/lib/localized";
import { buttonVariants } from "@/components/ui/button";
import { requireCompleteUser } from "@/server/auth/session";
import { invoicesForOrder } from "@/server/invoices/queries";
import { getMyOrder } from "@/server/orders/queries";

export const metadata: Metadata = { robots: { index: false } };

export default async function OrderPage({
  params,
}: PageProps<"/[locale]/account/orders/[reference]">) {
  const { locale: raw, reference } = await params;
  const locale = raw as Locale;
  setRequestLocale(locale);
  const user = await requireCompleteUser(locale);
  // Someone else's reference and a non-existent one are the same 404.
  const data = await getMyOrder(user.id, reference);
  if (!data) notFound();
  const { order, receipts, history, banks } = data;
  const t = await getTranslations("Orders");
  const tInv = await getTranslations("Invoices");
  const invoice =
    order.status === "completed"
      ? (await invoicesForOrder(order.id, { ownerId: user.id }))[0]
      : undefined;

  const amount = formatSdg(order.total_sdg, locale)!;
  const pendingReceipt = receipts.some((r) => r.status === "pending");
  const awaitingReceipt =
    order.status === "new" &&
    !pendingReceipt &&
    !receipts.some((r) => r.status === "accepted");
  const bankName = (b: { bank_name_ar: string; bank_name_en: string }) =>
    locale === "ar" ? b.bank_name_ar : b.bank_name_en;

  return (
    <div className="grid gap-6">
      <Link
        href="/account/orders"
        className="text-sm text-muted-foreground hover:underline"
      >
        {t("back")}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">
          {t("orderTitle", { reference: "" })}
          <span dir="ltr" data-testid="order-reference">
            {order.reference}
          </span>
        </h1>
        <span
          className="rounded-full border px-3 py-1 text-sm font-medium"
          data-testid="order-status"
          data-status={order.status}
        >
          {order.status === "new" && pendingReceipt
            ? t("paymentReview")
            : t(`statuses.${order.status}`)}
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("summary")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <p>
            <L10n
              value={localized(
                order.product_name_ar,
                order.product_name_en,
                locale,
              )}
              className="font-medium"
            />{" "}
            —{" "}
            <L10n
              value={localized(
                order.variant_name_ar,
                order.variant_name_en,
                locale,
              )}
            />
          </p>
          <p>
            {t("quantity")}: {order.quantity}
          </p>
          <p className="text-base font-bold" dir="auto">
            {t("total")}: <span data-testid="order-total">{amount}</span>
          </p>
          <p className="text-muted-foreground">
            {t("rateNote", {
              usd: formatUsd(order.total_usd, locale)!,
              rate: String(order.usd_sdg_rate),
            })}
          </p>
          <p className="text-muted-foreground">
            {formatDateTime(order.created_at, locale)}
          </p>
          {invoice && (
            <Link
              href={`/account/invoices/${invoice.invoice_number}`}
              className={`${buttonVariants({ size: "sm", variant: "outline" })} justify-self-start`}
              data-testid="order-invoice-link"
            >
              {tInv("viewInvoice")}{" "}
              <bdi dir="ltr">{invoice.invoice_number}</bdi>
            </Link>
          )}
        </CardContent>
      </Card>

      {order.fulfillment_fields.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("fulfillment")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-2 text-sm">
              {order.fulfillment_fields.map((f) => {
                const value = order.fulfillment_data[f.key];
                const closed =
                  order.status === "completed" || order.status === "cancelled";
                if (value === undefined && !(closed && f.sensitive))
                  return null;
                return (
                  <div key={f.key} className="flex flex-wrap gap-2">
                    <dt className="text-muted-foreground">
                      <L10n value={localized(f.label_ar, f.label_en, locale)} />
                      :
                    </dt>
                    <dd dir="auto">{value ?? t("removed")}</dd>
                  </div>
                );
              })}
            </dl>
          </CardContent>
        </Card>
      )}

      {pendingReceipt && order.status === "new" && (
        <Alert data-testid="receipt-pending">{t("pendingNote")}</Alert>
      )}

      {awaitingReceipt && (
        <Card data-testid="payment-instructions">
          <CardHeader>
            <CardTitle>{t("payTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-sm">
              {t("payIntro", { amount, reference: order.reference })}
            </p>
            <ul className="grid gap-3">
              {banks.map((b) => (
                <li key={b.id} className="rounded-lg border p-3 text-sm">
                  <p className="font-medium">{bankName(b)}</p>
                  <p>
                    {t("accountNumber")}:{" "}
                    <span dir="ltr" className="font-mono font-bold select-all">
                      {b.account_number}
                    </span>
                  </p>
                  <p>
                    {t("accountHolder")}: {b.account_holder}
                  </p>
                  {(locale === "ar" ? b.branch_ar : b.branch_en) && (
                    <p>
                      {t("branch")}:{" "}
                      {locale === "ar" ? b.branch_ar : b.branch_en}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <h2 className="font-bold">{t("receiptTitle")}</h2>
            <ReceiptForm
              orderId={order.id}
              banks={banks.map((b) => ({ id: b.id, name: bankName(b) }))}
            />
          </CardContent>
        </Card>
      )}

      {receipts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("receipts")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm" data-testid="receipts">
              {receipts.map((r) => (
                <li key={r.id} className="grid gap-1 py-2">
                  <span className="flex flex-wrap justify-between gap-2">
                    <span dir="ltr">{r.transaction_ref}</span>
                    <span data-receipt-status={r.status}>
                      {t(`receiptStatuses.${r.status}`)}
                    </span>
                  </span>
                  <span className="text-muted-foreground">
                    {r.bank ? bankName(r.bank) : null} ·{" "}
                    {formatDateTime(r.created_at, locale)}
                  </span>
                  {r.rejection_reason && (
                    <span className="text-destructive">
                      {t("rejectedReason", { reason: r.rejection_reason })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("history")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-2 text-sm" data-testid="status-history">
            {history.map((h) => (
              <li key={h.created_at + h.to_status}>
                <span className="font-medium">
                  {t(`statuses.${h.to_status}`)}
                </span>{" "}
                <span className="text-muted-foreground">
                  · {formatDateTime(h.created_at, locale)}
                </span>
                {h.customer_note && <p>{h.customer_note}</p>}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
