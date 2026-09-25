import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Pagination, withQuery } from "@/components/admin/ui";
import { L10n } from "@/components/catalog/l10n";
import { Link } from "@/components/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { inputClasses } from "@/components/ui/styles";
import type { Locale } from "@/i18n/routing";
import { formatDateTime, formatSdg } from "@/lib/format";
import { localized } from "@/lib/localized";
import { requireCompleteUser } from "@/server/auth/session";
import { searchInvoices } from "@/server/invoices/queries";

export const metadata: Metadata = { robots: { index: false } };

export default async function MyInvoicesPage({
  params,
  searchParams,
}: PageProps<"/[locale]/account/invoices">) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  await requireCompleteUser(locale);
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : undefined;
  const page =
    typeof sp.page === "string" && /^\d{1,5}$/.test(sp.page)
      ? Number(sp.page)
      : 1;
  const [t, tAdmin] = await Promise.all([
    getTranslations("Invoices"),
    getTranslations("Admin"),
  ]);
  // `mine`: only the caller's own issued invoices, even for staff.
  const result = await searchInvoices({ q, page, mine: true });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form method="get" role="search" className="flex flex-wrap gap-2">
          <input
            name="q"
            defaultValue={q}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchLabel")}
            className={`${inputClasses} max-w-xs flex-1`}
            dir="auto"
          />
          <button type="submit" className={buttonVariants({ size: "sm" })}>
            {t("search")}
          </button>
          {q && (
            <Link
              href="/account/invoices"
              className={buttonVariants({ size: "sm", variant: "ghost" })}
            >
              {t("clear")}
            </Link>
          )}
        </form>
        {result.rows.length === 0 ? (
          <p className="text-muted-foreground">
            {q ? t("noResults") : t("empty")}
          </p>
        ) : (
          <ul className="divide-y" data-testid="invoices-list">
            {result.rows.map((i) => (
              <li key={i.id}>
                <Link
                  href={`/account/invoices/${i.invoice_number}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 hover:bg-muted/50"
                  data-invoice-number={i.invoice_number}
                >
                  <span className="grid gap-0.5">
                    <span className="font-medium" dir="ltr">
                      {i.invoice_number}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      <L10n
                        value={localized(
                          i.product_name_ar,
                          i.product_name_en,
                          locale,
                        )}
                      />{" "}
                      · <bdi dir="ltr">{i.order_reference}</bdi> ·{" "}
                      {formatDateTime(i.issued_at, locale)}
                    </span>
                  </span>
                  <span className="font-medium" dir="auto">
                    {formatSdg(i.total_sdg, locale)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Pagination
          page={result.page}
          pages={result.pages}
          href={(p) => withQuery("/account/invoices", { q, page: p })}
          labels={{
            previous: tAdmin("previous"),
            next: tAdmin("next"),
            page: tAdmin("page", { page: result.page, pages: result.pages }),
          }}
        />
      </CardContent>
    </Card>
  );
}
