import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ActionForm } from "@/components/admin/action-form";
import {
  Badge,
  Field,
  KeyValues,
  ORDER_STATUS_TONE,
  PageHeader,
  Section,
} from "@/components/admin/ui";
import { L10n } from "@/components/catalog/l10n";
import { Link } from "@/components/link";
import { buttonVariants } from "@/components/ui/button-variants";
import { inputClasses, selectClasses } from "@/components/ui/styles";
import type { Locale } from "@/i18n/routing";
import { formatDateTime, formatSdg, formatUsd } from "@/lib/format";
import { localized } from "@/lib/localized";
import { formatPhone } from "@/lib/phone";
import {
  addInternalNote,
  changeOrderStatus,
  reviewReceipt,
} from "@/server/admin/orders";
import {
  getAdminOrder,
  RECEIPT_URL_TTL_SECONDS,
} from "@/server/admin/orders-queries";
import { requireAdmin } from "@/server/auth/session";
import type { OrderStatus } from "@/server/orders/queries";

export const metadata: Metadata = { robots: { index: false } };

const RECEIPT_TONE = {
  pending: "warning",
  accepted: "success",
  rejected: "danger",
} as const;

export default async function AdminOrderPage({
  params,
}: PageProps<"/[locale]/admin/orders/[reference]">) {
  const { locale: raw, reference } = await params;
  const locale = raw as Locale;
  setRequestLocale(locale);
  const { permissions } = await requireAdmin(locale, "orders");
  const data = await getAdminOrder(reference);
  if (!data) notFound();
  const t = await getTranslations("Admin");
  const { order, customer, receipts, history, notes, nextStatuses } = data;
  const closed = order.status === "completed" || order.status === "cancelled";
  const bankName = (b: { bank_name_ar: string; bank_name_en: string }) =>
    locale === "ar" ? b.bank_name_ar : b.bank_name_en;

  return (
    <>
      <Link
        href="/admin/orders"
        className="text-sm text-muted-foreground hover:underline"
      >
        {t("orders.back")}
      </Link>
      <PageHeader
        title={
          <>
            {t("orders.orderTitle")}{" "}
            <span dir="ltr" data-testid="admin-order-reference">
              {order.reference}
            </span>
          </>
        }
        description={formatDateTime(order.created_at, locale)}
        actions={
          <Badge
            tone={ORDER_STATUS_TONE[order.status]}
            data-testid="admin-order-status"
            data-status={order.status}
          >
            {t(`status.${order.status}`)}
          </Badge>
        }
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title={t("orders.customer")}>
          {customer ? (
            <KeyValues
              items={[
                [t("customers.name"), customer.full_name ?? "—"],
                [
                  t("customers.phone"),
                  customer.phone_e164 ? (
                    <span dir="ltr" className="flex flex-wrap gap-3">
                      <a
                        href={`tel:${customer.phone_e164}`}
                        className="text-primary hover:underline"
                      >
                        {formatPhone(customer.phone_e164)}
                      </a>
                      <a
                        href={`https://wa.me/${customer.phone_e164.slice(1)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        WhatsApp
                      </a>
                    </span>
                  ) : (
                    "—"
                  ),
                ],
                [
                  t("customers.kyc"),
                  t(
                    `kyc.${customer.kyc_status as "none" | "pending" | "verified" | "rejected"}`,
                  ),
                ],
                ...(customer.is_blocked
                  ? ([
                      [
                        t("customers.state"),
                        <Badge key="b" tone="danger">
                          {t("customers.blocked")}
                        </Badge>,
                      ],
                    ] as [React.ReactNode, React.ReactNode][])
                  : []),
              ]}
            />
          ) : (
            <p className="text-sm text-muted-foreground">—</p>
          )}
          {customer && permissions.has("customers") && (
            <Link
              href={`/admin/customers/${customer.id}`}
              className="text-sm text-primary hover:underline"
            >
              {t("orders.customerProfile")}
            </Link>
          )}
        </Section>

        <Section title={t("orders.summary")}>
          <KeyValues
            items={[
              [
                t("orders.item"),
                <>
                  <L10n
                    value={localized(
                      order.product_name_ar,
                      order.product_name_en,
                      locale,
                    )}
                  />{" "}
                  —{" "}
                  <L10n
                    value={localized(
                      order.variant_name_ar,
                      order.variant_name_en,
                      locale,
                    )}
                  />
                </>,
              ],
              [t("orders.quantity"), order.quantity],
              [t("orders.unitPrice"), formatUsd(order.unit_price_usd, locale)],
              [t("orders.totalUsd"), formatUsd(order.total_usd, locale)],
              [t("orders.rate"), `${order.usd_sdg_rate}`],
              [
                t("orders.total"),
                <span
                  key="t"
                  className="text-base"
                  dir="auto"
                  data-testid="admin-order-total"
                >
                  {formatSdg(order.total_sdg, locale)}
                </span>,
              ],
              [
                t("orders.kycRequired"),
                order.kyc_required ? t("yes") : t("no"),
              ],
            ]}
          />
        </Section>
      </div>

      <Section
        title={t("orders.fulfillment")}
        description={t("orders.fulfillmentHint")}
      >
        {order.fulfillment_fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("orders.noFields")}
          </p>
        ) : (
          <KeyValues
            items={order.fulfillment_fields.map((f) => [
              <>
                <L10n value={localized(f.label_ar, f.label_en, locale)} />
                {f.sensitive && (
                  <>
                    {" "}
                    <Badge tone="warning">{t("orders.sensitive")}</Badge>
                  </>
                )}
              </>,
              order.fulfillment_data[f.key] !== undefined ? (
                <span dir="auto" className="font-mono select-all">
                  {order.fulfillment_data[f.key]}
                </span>
              ) : closed && f.sensitive ? (
                <span className="text-muted-foreground">
                  {t("orders.purged")}
                </span>
              ) : (
                "—"
              ),
            ])}
          />
        )}
      </Section>

      <Section
        title={t("orders.receipts")}
        description={t("orders.receiptsHint", {
          seconds: RECEIPT_URL_TTL_SECONDS,
        })}
        testId="admin-receipts"
      >
        {receipts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("orders.noReceipts")}
          </p>
        ) : (
          <ul className="grid gap-4">
            {receipts.map((r) => (
              <li
                key={r.id}
                className="grid gap-4 rounded-lg border p-3 md:grid-cols-[14rem_1fr]"
                data-receipt={r.status}
              >
                {r.imageUrl ? (
                  <a
                    href={r.imageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    {/* Plain <img>: a short-lived signed URL, never copied into an image cache. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={r.imageUrl}
                      alt={t("orders.receiptImage")}
                      referrerPolicy="no-referrer"
                      className="max-h-72 w-full rounded-md border object-contain"
                      data-testid="receipt-image"
                    />
                  </a>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("orders.noImage")}
                  </p>
                )}
                <div className="grid content-start gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      tone={RECEIPT_TONE[r.status as keyof typeof RECEIPT_TONE]}
                    >
                      {t(
                        `receipt.${r.status as "pending" | "accepted" | "rejected"}`,
                      )}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(r.created_at, locale)}
                    </span>
                  </div>
                  <KeyValues
                    items={[
                      [
                        t("orders.transactionRef"),
                        <span
                          key="r"
                          dir="ltr"
                          className="font-mono select-all"
                        >
                          {r.transaction_ref}
                        </span>,
                      ],
                      [
                        t("orders.bank"),
                        r.bank ? (
                          <>
                            {bankName(r.bank)} ·{" "}
                            <span dir="ltr">{r.bank.account_number}</span>
                          </>
                        ) : (
                          "—"
                        ),
                      ],
                      ...(r.reviewer
                        ? ([
                            [
                              t("orders.reviewedBy"),
                              `${r.reviewer} · ${r.reviewed_at ? formatDateTime(r.reviewed_at, locale) : ""}`,
                            ],
                          ] as [React.ReactNode, React.ReactNode][])
                        : []),
                      ...(r.rejection_reason
                        ? ([
                            [t("orders.rejectionReason"), r.rejection_reason],
                          ] as [React.ReactNode, React.ReactNode][])
                        : []),
                    ]}
                  />
                  {r.status === "pending" && (
                    <ActionForm
                      action={reviewReceipt}
                      testId="review-receipt"
                      successMessage={t("orders.reviewed")}
                    >
                      <input type="hidden" name="receiptId" value={r.id} />
                      <p className="text-sm">
                        {t("orders.checkAmount", {
                          amount: formatSdg(order.total_sdg, locale) ?? "",
                        })}
                      </p>
                      <Field
                        label={t("orders.rejectReason")}
                        htmlFor={`reason-${r.id}`}
                        hint={t("orders.rejectReasonHint")}
                      >
                        <input
                          id={`reason-${r.id}`}
                          name="reason"
                          maxLength={500}
                          className={inputClasses}
                        />
                      </Field>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="submit"
                          name="decision"
                          value="accept"
                          className={buttonVariants()}
                        >
                          {t("orders.accept")}
                        </button>
                        <button
                          type="submit"
                          name="decision"
                          value="reject"
                          className={buttonVariants({ variant: "destructive" })}
                        >
                          {t("orders.reject")}
                        </button>
                      </div>
                    </ActionForm>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title={t("orders.statusTitle")} testId="status-section">
          {nextStatuses.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("orders.final")}</p>
          ) : (
            <ActionForm
              action={changeOrderStatus}
              testId="change-status"
              successMessage={t("orders.statusChanged")}
            >
              <input type="hidden" name="orderId" value={order.id} />
              <Field label={t("orders.newStatus")} htmlFor="to">
                <select
                  id="to"
                  name="to"
                  className={selectClasses}
                  defaultValue={nextStatuses[0]}
                >
                  {nextStatuses.map((s) => (
                    <option key={s} value={s}>
                      {t(`status.${s}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={t("orders.customerNote")}
                htmlFor="customerNote"
                hint={t("orders.customerNoteHint")}
              >
                <textarea
                  id="customerNote"
                  name="customerNote"
                  maxLength={500}
                  rows={2}
                  className={inputClasses + " h-auto"}
                />
              </Field>
              {order.status === "new" && (
                <p className="text-xs text-muted-foreground">
                  {t("orders.processingNeedsPayment")}
                </p>
              )}
              <button
                type="submit"
                className={`${buttonVariants()} justify-self-start`}
              >
                {t("orders.updateStatus")}
              </button>
            </ActionForm>
          )}
          <ol
            className="grid gap-2 border-t pt-4 text-sm"
            data-testid="admin-status-history"
          >
            {history.map((h, i) => (
              <li key={i} className="grid gap-0.5">
                <span>
                  <span className="font-medium">
                    {t(`status.${h.to_status as OrderStatus}`)}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    · {formatDateTime(h.created_at, locale)} ·{" "}
                    {h.actor ?? t("orders.system")}
                  </span>
                </span>
                {h.customer_note && (
                  <span className="text-muted-foreground">
                    {t("orders.noteToCustomer")}: {h.customer_note}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </Section>

        <Section
          title={t("orders.notes")}
          description={t("orders.notesHint")}
          testId="internal-notes"
          className="border-highlight/50 bg-highlight/5"
        >
          {notes.length > 0 && (
            <ul className="grid gap-3 text-sm">
              {notes.map((n) => (
                <li
                  key={n.id}
                  className="grid gap-1 rounded-md border bg-card p-3"
                >
                  <span className="whitespace-pre-wrap">{n.body}</span>
                  <span className="text-xs text-muted-foreground">
                    {n.author} · {formatDateTime(n.created_at, locale)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <ActionForm
            action={addInternalNote}
            resetOnSuccess
            testId="add-note"
            successMessage={t("orders.noteAdded")}
          >
            <input type="hidden" name="orderId" value={order.id} />
            <Field label={t("orders.addNote")} htmlFor="note-body">
              <textarea
                id="note-body"
                name="body"
                required
                maxLength={2000}
                rows={3}
                className={inputClasses + " h-auto"}
              />
            </Field>
            <button
              type="submit"
              className={`${buttonVariants({ variant: "outline" })} justify-self-start`}
            >
              {t("orders.saveNote")}
            </button>
          </ActionForm>
        </Section>
      </div>
    </>
  );
}
