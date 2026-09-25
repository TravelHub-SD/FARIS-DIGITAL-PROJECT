import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import {
  Badge,
  Empty,
  PageHeader,
  Pagination,
  Section,
  TableWrap,
  withQuery,
} from "@/components/admin/ui";
import { L10n } from "@/components/catalog/l10n";
import { Link } from "@/components/link";
import { buttonVariants } from "@/components/ui/button-variants";
import { inputClasses, selectClasses } from "@/components/ui/styles";
import type { Locale } from "@/i18n/routing";
import { formatDateTime, formatSdg } from "@/lib/format";
import { localized } from "@/lib/localized";
import { formatPhone } from "@/lib/phone";
import { requireAdmin } from "@/server/auth/session";
import { type InvoiceStatus, searchInvoices } from "@/server/invoices/queries";

export const metadata: Metadata = { robots: { index: false } };

const STATUSES: InvoiceStatus[] = ["issued", "void"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function AdminInvoicesPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/invoices">) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  await requireAdmin(locale, "invoices");
  const sp = await searchParams;
  const one = (k: string) =>
    typeof sp[k] === "string" ? (sp[k] as string) : undefined;
  const filters = {
    q: one("q")?.slice(0, 100) || undefined,
    status: STATUSES.find((s) => s === one("status")),
    from: DATE.test(one("from") ?? "") ? one("from") : undefined,
    to: DATE.test(one("to") ?? "") ? one("to") : undefined,
    page: /^\d{1,5}$/.test(one("page") ?? "") ? Number(one("page")) : 1,
  };
  const [t, tAdmin, tInv] = await Promise.all([
    getTranslations("Admin.invoices"),
    getTranslations("Admin"),
    getTranslations("Invoices"),
  ]);
  const result = await searchInvoices(filters);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={`${t("intro")} ${t("count", { count: result.total })}`}
      />
      <Section>
        <form
          method="get"
          role="search"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        >
          <input
            name="q"
            defaultValue={filters.q}
            placeholder={t("searchPlaceholder")}
            aria-label={tInv("searchLabel")}
            className={`${inputClasses} sm:col-span-2`}
            dir="auto"
          />
          <select
            name="status"
            defaultValue={filters.status ?? ""}
            aria-label={tAdmin("orders.status")}
            className={selectClasses}
          >
            <option value="">{t("statusAll")}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {tInv(`status.${s}`)}
              </option>
            ))}
          </select>
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("from")}
            <input
              type="date"
              name="from"
              defaultValue={filters.from}
              className={inputClasses}
            />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("to")}
            <input
              type="date"
              name="to"
              defaultValue={filters.to}
              className={inputClasses}
            />
          </label>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-5">
            <button type="submit" className={buttonVariants({ size: "sm" })}>
              {tAdmin("filter")}
            </button>
            <Link
              href="/admin/invoices"
              className={buttonVariants({ size: "sm", variant: "ghost" })}
            >
              {tAdmin("clear")}
            </Link>
          </div>
        </form>
      </Section>

      <Section>
        {result.rows.length === 0 ? (
          <Empty>{tInv("noResults")}</Empty>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th>{tInv("doc.number")}</th>
                <th>{tInv("doc.order")}</th>
                <th>{t("customer")}</th>
                <th>{tInv("doc.item")}</th>
                <th>{t("issued")}</th>
                <th>{t("total")}</th>
                <th>{tAdmin("orders.status")}</th>
              </tr>
            </thead>
            <tbody data-testid="admin-invoices">
              {result.rows.map((i) => (
                <tr
                  key={i.id}
                  className="hover:bg-muted/40"
                  data-invoice-number={i.invoice_number}
                >
                  <td>
                    <Link
                      href={`/admin/invoices/${i.invoice_number}`}
                      className="font-medium whitespace-nowrap text-primary hover:underline"
                      dir="ltr"
                    >
                      {i.invoice_number}
                    </Link>
                  </td>
                  <td dir="ltr" className="whitespace-nowrap">
                    {i.order_reference}
                  </td>
                  <td>
                    <span className="grid min-w-32">
                      <span>{i.customer_name ?? "—"}</span>
                      {i.customer_phone && (
                        <span
                          className="text-xs whitespace-nowrap text-muted-foreground"
                          dir="ltr"
                        >
                          {formatPhone(i.customer_phone)}
                        </span>
                      )}
                    </span>
                  </td>
                  <td>
                    <L10n
                      value={localized(
                        i.product_name_ar,
                        i.product_name_en,
                        locale,
                      )}
                    />
                  </td>
                  <td className="whitespace-nowrap">
                    {formatDateTime(i.issued_at, locale)}
                  </td>
                  <td className="whitespace-nowrap" dir="auto">
                    {formatSdg(i.total_sdg, locale)}
                  </td>
                  <td>
                    <Badge tone={i.status === "issued" ? "success" : "danger"}>
                      {tInv(`status.${i.status}`)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        <Pagination
          page={result.page}
          pages={result.pages}
          href={(p) => withQuery("/admin/invoices", { ...filters, page: p })}
          labels={{
            previous: tAdmin("previous"),
            next: tAdmin("next"),
            page: tAdmin("page", { page: result.page, pages: result.pages }),
          }}
        />
      </Section>
    </>
  );
}
