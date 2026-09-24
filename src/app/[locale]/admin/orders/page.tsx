import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import {
  Badge,
  Empty,
  ORDER_STATUS_TONE,
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
import { listOrders, type OrderFilters } from "@/server/admin/orders-queries";
import { requireAdmin } from "@/server/auth/session";
import type { OrderStatus } from "@/server/orders/queries";

export const metadata: Metadata = { robots: { index: false } };

const STATUSES: OrderStatus[] = ["new", "processing", "completed", "cancelled"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseFilters(
  sp: Record<string, string | string[] | undefined>,
): OrderFilters {
  const one = (k: string) =>
    typeof sp[k] === "string" ? (sp[k] as string) : undefined;
  const num = (k: string) => {
    const v = one(k);
    return v && /^\d{1,12}$/.test(v) ? Number(v) : undefined;
  };
  const status = one("status");
  return {
    status: STATUSES.includes(status as OrderStatus)
      ? (status as OrderStatus)
      : undefined,
    from: DATE.test(one("from") ?? "") ? one("from") : undefined,
    to: DATE.test(one("to") ?? "") ? one("to") : undefined,
    q: one("q")?.slice(0, 100) || undefined,
    min: num("min"),
    max: num("max"),
    review: one("review") === "1",
    page: num("page"),
  };
}

export default async function AdminOrdersPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/orders">) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  await requireAdmin(locale, "orders");
  const filters = parseFilters(await searchParams);
  const t = await getTranslations("Admin");
  const result = await listOrders(filters);
  const href = (page: number) =>
    withQuery("/admin/orders", {
      ...filters,
      review: filters.review ? 1 : undefined,
      page,
    });

  return (
    <>
      <PageHeader
        title={t("orders.title")}
        description={t("orders.count", { count: result.total })}
      />
      <Section>
        <form
          method="get"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          role="search"
        >
          <input
            name="q"
            defaultValue={filters.q}
            placeholder={t("orders.searchPlaceholder")}
            aria-label={t("orders.search")}
            className={`${inputClasses} sm:col-span-2`}
          />
          <select
            name="status"
            defaultValue={filters.status ?? ""}
            aria-label={t("orders.status")}
            className={selectClasses}
          >
            <option value="">{t("orders.anyStatus")}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="review"
              value="1"
              defaultChecked={filters.review}
              className="size-4 accent-primary"
            />
            {t("orders.onlyReview")}
          </label>
          <details
            className="sm:col-span-2 lg:col-span-4"
            open={!!(filters.from || filters.to || filters.min || filters.max)}
          >
            <summary className="cursor-pointer text-sm text-muted-foreground">
              {t("orders.moreFilters")}
            </summary>
            <div className="grid gap-3 pt-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="grid gap-1 text-xs text-muted-foreground">
                {t("orders.from")}
                <input
                  type="date"
                  name="from"
                  defaultValue={filters.from}
                  className={inputClasses}
                />
              </label>
              <label className="grid gap-1 text-xs text-muted-foreground">
                {t("orders.to")}
                <input
                  type="date"
                  name="to"
                  defaultValue={filters.to}
                  className={inputClasses}
                />
              </label>
              <label className="grid gap-1 text-xs text-muted-foreground">
                {t("orders.minSdg")}
                <input
                  type="number"
                  name="min"
                  min={0}
                  defaultValue={filters.min}
                  className={inputClasses}
                />
              </label>
              <label className="grid gap-1 text-xs text-muted-foreground">
                {t("orders.maxSdg")}
                <input
                  type="number"
                  name="max"
                  min={0}
                  defaultValue={filters.max}
                  className={inputClasses}
                />
              </label>
            </div>
          </details>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
            <button type="submit" className={buttonVariants({ size: "sm" })}>
              {t("filter")}
            </button>
            <Link
              href="/admin/orders"
              className={buttonVariants({ size: "sm", variant: "ghost" })}
            >
              {t("clear")}
            </Link>
          </div>
        </form>
      </Section>

      <Section>
        {result.rows.length === 0 ? (
          <Empty>{t("orders.none")}</Empty>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th>{t("orders.reference")}</th>
                <th>{t("orders.date")}</th>
                <th>{t("orders.customer")}</th>
                <th>{t("orders.item")}</th>
                <th>{t("orders.total")}</th>
                <th>{t("orders.status")}</th>
              </tr>
            </thead>
            <tbody data-testid="admin-orders">
              {result.rows.map((o) => (
                <tr key={o.id} className="hover:bg-muted/40">
                  <td>
                    <Link
                      href={`/admin/orders/${o.reference}`}
                      className="font-medium whitespace-nowrap text-primary hover:underline"
                      dir="ltr"
                    >
                      {o.reference}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(o.created_at, locale)}
                  </td>
                  <td>
                    <div className="grid">
                      <span>{o.customer_name ?? "—"}</span>
                      <span
                        className="text-xs whitespace-nowrap text-muted-foreground"
                        dir="ltr"
                      >
                        {o.customer_phone ? formatPhone(o.customer_phone) : ""}
                      </span>
                    </div>
                  </td>
                  <td>
                    <L10n
                      value={localized(
                        o.product_name_ar,
                        o.product_name_en,
                        locale,
                      )}
                    />{" "}
                    —{" "}
                    <L10n
                      value={localized(
                        o.variant_name_ar,
                        o.variant_name_en,
                        locale,
                      )}
                    />{" "}
                    ×{o.quantity}
                  </td>
                  <td className="font-medium whitespace-nowrap" dir="auto">
                    {formatSdg(o.total_sdg, locale)}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={ORDER_STATUS_TONE[o.status]}>
                        {t(`status.${o.status}`)}
                      </Badge>
                      {o.pending_receipt && (
                        <Badge tone="danger">{t("orders.toReview")}</Badge>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        <Pagination
          page={result.page}
          pages={result.pages}
          href={href}
          labels={{
            previous: t("previous"),
            next: t("next"),
            page: t("page", { page: result.page, pages: result.pages }),
          }}
        />
      </Section>
    </>
  );
}
