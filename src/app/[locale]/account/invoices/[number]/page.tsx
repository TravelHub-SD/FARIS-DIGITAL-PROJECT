import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { InvoiceDocument } from "@/components/invoice/invoice-document";
import { PrintButton } from "@/components/invoice/print-button";
import { Link } from "@/components/link";
import { buttonVariants } from "@/components/ui/button";
import type { Locale } from "@/i18n/routing";
import { requireCompleteUser } from "@/server/auth/session";
import { getInvoice } from "@/server/invoices/queries";

// The page title is the invoice number alone: browsers use it as the default
// file name when the customer saves the page as PDF.
export async function generateMetadata({
  params,
}: PageProps<"/[locale]/account/invoices/[number]">): Promise<Metadata> {
  const { number } = await params;
  return { title: { absolute: number.slice(0, 32) }, robots: { index: false } };
}

export default async function MyInvoicePage({
  params,
}: PageProps<"/[locale]/account/invoices/[number]">) {
  const { locale: l, number } = await params;
  const locale = l as Locale;
  setRequestLocale(locale);
  const user = await requireCompleteUser(locale);
  // Own issued invoices only; anyone else's number is the same 404 as a
  // number that does not exist.
  const invoice = await getInvoice(number, { ownerId: user.id });
  if (!invoice) notFound();
  const t = await getTranslations("Invoices");

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex flex-wrap gap-2">
          <Link
            href="/account/invoices"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            {t("back")}
          </Link>
          <Link
            href={`/account/orders/${invoice.snapshot.order.reference}`}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            {t("backToOrder")}
          </Link>
        </div>
        <PrintButton label={t("print")} />
      </div>
      <p className="text-xs text-muted-foreground print:hidden">
        {t("printHint")}
      </p>
      <InvoiceDocument invoice={invoice} locale={locale} />
    </div>
  );
}
