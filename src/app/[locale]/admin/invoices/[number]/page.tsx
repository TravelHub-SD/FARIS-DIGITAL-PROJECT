import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ActionForm } from "@/components/admin/action-form";
import { Badge, Field, Section } from "@/components/admin/ui";
import { InvoiceDocument } from "@/components/invoice/invoice-document";
import { PrintButton } from "@/components/invoice/print-button";
import { Link } from "@/components/link";
import { buttonVariants } from "@/components/ui/button-variants";
import { inputClasses } from "@/components/ui/styles";
import type { Locale } from "@/i18n/routing";
import { formatDateTime } from "@/lib/format";
import { reissueInvoice, voidInvoice } from "@/server/admin/invoices";
import { requireAdmin } from "@/server/auth/session";
import { getInvoice, invoicesForOrder } from "@/server/invoices/queries";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/invoices/[number]">): Promise<Metadata> {
  const { number } = await params;
  return { title: { absolute: number.slice(0, 32) }, robots: { index: false } };
}

export default async function AdminInvoicePage({
  params,
}: PageProps<"/[locale]/admin/invoices/[number]">) {
  const { locale: l, number } = await params;
  const locale = l as Locale;
  setRequestLocale(locale);
  const { permissions } = await requireAdmin(locale, "invoices");
  const invoice = await getInvoice(number);
  if (!invoice) notFound();
  const [t, tInv, history] = await Promise.all([
    getTranslations("Admin.invoices"),
    getTranslations("Invoices"),
    invoicesForOrder(invoice.order_id),
  ]);
  const hasIssued = history.some((h) => h.status === "issued");

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/admin/invoices"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            {tInv("back")}
          </Link>
          {permissions.has("orders") && (
            <Link
              href={`/admin/orders/${invoice.snapshot.order.reference}`}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              {t("openOrder")}
            </Link>
          )}
          <Badge tone={invoice.status === "issued" ? "success" : "danger"}>
            {tInv(`status.${invoice.status}`)}
          </Badge>
        </div>
        <PrintButton label={tInv("print")} />
      </div>

      <InvoiceDocument invoice={invoice} locale={locale} />

      <div className="grid gap-6 print:hidden">
        {invoice.status === "issued" && (
          <Section
            title={t("voidTitle")}
            description={t("voidIntro")}
            testId="void-invoice"
          >
            <ActionForm
              action={voidInvoice}
              confirmMessage={t("voidConfirm")}
              successMessage={t("voided")}
            >
              <input type="hidden" name="id" value={invoice.id} />
              <Field label={t("voidReason")} htmlFor="void-reason">
                <textarea
                  id="void-reason"
                  name="reason"
                  required
                  maxLength={500}
                  rows={2}
                  className={inputClasses}
                />
              </Field>
              <button
                type="submit"
                className={`${buttonVariants({ variant: "destructive", size: "sm" })} justify-self-start`}
              >
                {t("voidSubmit")}
              </button>
            </ActionForm>
          </Section>
        )}
        {invoice.status === "void" && !hasIssued && (
          <Section
            title={t("reissueTitle")}
            description={t("reissueIntro")}
            testId="reissue-invoice"
          >
            <ActionForm action={reissueInvoice} successMessage={t("reissued")}>
              <input type="hidden" name="orderId" value={invoice.order_id} />
              <button
                type="submit"
                className={`${buttonVariants({ size: "sm" })} justify-self-start`}
              >
                {t("reissueSubmit")}
              </button>
            </ActionForm>
          </Section>
        )}
        {history.length > 1 && (
          <Section title={t("history")}>
            <ul className="grid gap-2 text-sm" data-testid="invoice-history">
              {history.map((h) => (
                <li key={h.invoice_number} className="flex flex-wrap gap-3">
                  <Link
                    href={`/admin/invoices/${h.invoice_number}`}
                    className="font-medium text-primary hover:underline"
                    dir="ltr"
                  >
                    {h.invoice_number}
                  </Link>
                  <Badge tone={h.status === "issued" ? "success" : "danger"}>
                    {tInv(`status.${h.status}`)}
                  </Badge>
                  <span className="text-muted-foreground">
                    {formatDateTime(h.issued_at, locale)}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}
