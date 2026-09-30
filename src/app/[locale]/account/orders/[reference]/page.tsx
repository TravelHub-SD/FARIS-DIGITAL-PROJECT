import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ReceiptForm } from "@/components/account/receipt-form";
import { CheckIcon } from "@/components/icons";
import { Link } from "@/components/link";
import { CopyButton } from "@/components/orders/copy-button";
import { OrderLines } from "@/components/orders/order-lines";
import { StatusChip } from "@/components/orders/status-chip";
import { buttonVariants } from "@/components/ui/button-variants";
import type { Locale } from "@/i18n/routing";
import { formatDateTime, formatSdg, formatUsd } from "@/lib/format";
import { requireCompleteUser } from "@/server/auth/session";
import { invoicesForOrder } from "@/server/invoices/queries";
import { getMyOrder } from "@/server/orders/queries";

export const metadata: Metadata = { robots: { index: false } };

const card = "grid gap-3 rounded-2xl border bg-card p-4";

export default async function OrderPage({
  params,
  searchParams,
}: PageProps<"/[locale]/account/orders/[reference]">) {
  const { locale: raw, reference } = await params;
  const locale = raw as Locale;
  setRequestLocale(locale);
  const user = await requireCompleteUser(locale);
  // Someone else's reference and a non-existent one are the same 404.
  const data = await getMyOrder(user.id, reference);
  if (!data) notFound();
  const { order, receipts, history, banks } = data;
  const justPlaced = (await searchParams).placed === "1";
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
  const copy = { label: t("copy"), copied: t("copied") };

  // Progress: placed → payment → processing → completed.
  const step =
    order.status === "completed"
      ? 4
      : order.status === "processing"
        ? 3
        : pendingReceipt
          ? 2
          : 1;
  const steps = [
    t("steps.placed"),
    t("steps.payment"),
    t("steps.processing"),
    t("steps.completed"),
  ];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <Link
        href="/account/orders"
        className="text-sm text-muted-foreground hover:underline"
      >
        {t("back")}
      </Link>

      {justPlaced && (
        <div
          role="status"
          className="flex gap-2.5 rounded-xl bg-success-soft p-3 text-sm text-success-text"
          data-testid="order-placed"
        >
          <CheckIcon className="mt-0.5 size-5 shrink-0" />
          <p>
            <span className="font-bold">{t("placedTitle")}</span>{" "}
            {order.status === "new" ? t("placedNext") : null}
          </p>
        </div>
      )}

      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">
            {t("orderTitle", { reference: "" })}
            <bdi dir="ltr" data-testid="order-reference">
              {order.reference}
            </bdi>
          </h1>
          <StatusChip
            status={order.status}
            inReview={pendingReceipt}
            testId="order-status"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>{formatDateTime(order.created_at, locale)}</span>
          <CopyButton value={order.reference} {...copy} />
        </div>
        {order.status !== "cancelled" && (
          <ol className="grid grid-cols-4 gap-1.5" data-testid="order-steps">
            {steps.map((label, i) => {
              const done = i + 1 < step || order.status === "completed";
              const current = i + 1 === step && order.status !== "completed";
              return (
                <li
                  key={label}
                  className="grid gap-1.5 text-center text-[11px] leading-4"
                  aria-current={current ? "step" : undefined}
                >
                  <span
                    className={`h-1.5 rounded-full ${done ? "bg-primary" : current ? "bg-primary/50" : "bg-muted"}`}
                  />
                  <span
                    className={
                      done || current ? "font-bold" : "text-muted-foreground"
                    }
                  >
                    {label}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {pendingReceipt && order.status === "new" && (
        <p
          role="status"
          className="rounded-xl bg-primary-soft p-3 text-sm text-primary-text"
          data-testid="receipt-pending"
        >
          {t("pendingNote")}
        </p>
      )}

      {awaitingReceipt && (
        <section className={card} data-testid="payment-instructions">
          <h2 className="text-lg font-bold">{t("payTitle")}</h2>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-primary-soft p-3">
            <div>
              <p className="text-xs text-primary-text">{t("amountToPay")}</p>
              <p className="text-xl font-bold" dir="auto">
                {amount}
              </p>
            </div>
            <CopyButton value={String(order.total_sdg)} {...copy} />
          </div>
          <p className="text-sm">
            {t("payIntro", { amount, reference: order.reference })}
          </p>
          <ul className="grid gap-2.5">
            {banks.map((b) => (
              <li
                key={b.id}
                className="grid gap-1 rounded-xl border p-3 text-sm"
              >
                <p className="font-bold">{bankName(b)}</p>
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0">
                    <span className="text-muted-foreground">
                      {t("accountNumber")}:
                    </span>{" "}
                    <span
                      dir="ltr"
                      className="font-mono font-bold wrap-anywhere select-all"
                    >
                      {b.account_number}
                    </span>
                  </p>
                  <CopyButton value={b.account_number} {...copy} />
                </div>
                <p>
                  <span className="text-muted-foreground">
                    {t("accountHolder")}:
                  </span>{" "}
                  {b.account_holder}
                </p>
                {(locale === "ar" ? b.branch_ar : b.branch_en) && (
                  <p>
                    <span className="text-muted-foreground">
                      {t("branch")}:
                    </span>{" "}
                    {locale === "ar" ? b.branch_ar : b.branch_en}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <h2 className="mt-2 font-bold">{t("receiptTitle")}</h2>
          <ReceiptForm
            orderId={order.id}
            banks={banks.map((b) => ({ id: b.id, name: bankName(b) }))}
          />
        </section>
      )}

      <section className={card}>
        <h2 className="text-lg font-bold">{t("summary")}</h2>
        <OrderLines
          items={order.items}
          locale={locale}
          closed={order.status === "completed" || order.status === "cancelled"}
        />
        <div className="flex justify-between gap-3 border-t pt-3">
          <span className="font-bold">{t("total")}</span>
          <span
            className="text-lg font-bold"
            dir="auto"
            data-testid="order-total"
          >
            {amount}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("rateNote", {
            usd: formatUsd(order.total_usd, locale)!,
            rate: String(order.usd_sdg_rate),
          })}
        </p>
        {invoice && (
          <Link
            href={`/account/invoices/${invoice.invoice_number}`}
            className={`${buttonVariants({ size: "sm", variant: "outline" })} justify-self-start`}
            data-testid="order-invoice-link"
          >
            {tInv("viewInvoice")} <bdi dir="ltr">{invoice.invoice_number}</bdi>
          </Link>
        )}
      </section>

      {receipts.length > 0 && (
        <section className={card}>
          <h2 className="text-lg font-bold">{t("receipts")}</h2>
          <ul className="divide-y text-sm" data-testid="receipts">
            {receipts.map((r) => (
              <li key={r.id} className="grid gap-1 py-2 first:pt-0 last:pb-0">
                <span className="flex flex-wrap justify-between gap-2">
                  <span dir="ltr" className="font-mono wrap-anywhere">
                    {r.transaction_ref}
                  </span>
                  <span data-receipt-status={r.status} className="font-bold">
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
        </section>
      )}

      <section className={card}>
        <h2 className="text-lg font-bold">{t("history")}</h2>
        <ol className="grid gap-2 text-sm" data-testid="status-history">
          {history.map((h) => (
            <li key={h.created_at + h.to_status}>
              <span className="font-bold">{t(`statuses.${h.to_status}`)}</span>{" "}
              <span className="text-muted-foreground">
                · {formatDateTime(h.created_at, locale)}
              </span>
              {h.customer_note && <p>{h.customer_note}</p>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
