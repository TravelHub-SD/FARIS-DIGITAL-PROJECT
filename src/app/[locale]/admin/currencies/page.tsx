import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { CurrencyForm } from "@/components/admin/custom-amount-forms";
import { Badge, Empty, PageHeader, Section } from "@/components/admin/ui";
import type { Locale } from "@/i18n/routing";
import { formatDecimal } from "@/lib/custom-amount";
import { formatDateTime } from "@/lib/format";
import { listAdminCurrencies } from "@/server/admin/custom-amount-queries";
import { requireAdmin } from "@/server/auth/session";

export const metadata: Metadata = { robots: { index: false } };

// Currencies for custom-amount products: each rate is SDG per 1 unit,
// updated by hand. Settings permission; every change is audited.
export default async function CurrenciesPage({
  params,
}: PageProps<"/[locale]/admin/currencies">) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  await requireAdmin(locale, "settings");
  const t = await getTranslations("Admin.currencies");
  const currencies = await listAdminCurrencies();

  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} />
      <Section title={t("list")}>
        {currencies.length === 0 ? (
          <Empty>{t("empty")}</Empty>
        ) : (
          <ul className="grid gap-4" data-testid="currencies">
            {currencies.map((c) => (
              <li
                key={c.id}
                className="grid gap-3 rounded-lg border p-3"
                data-currency={c.code}
              >
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-bold" dir="ltr">
                    {c.code}
                  </span>
                  <span>{locale === "ar" ? c.name_ar : c.name_en}</span>
                  <bdi
                    dir="ltr"
                    className="tabular-nums"
                    data-testid="currency-rate"
                  >
                    1 {c.code} = {formatDecimal(c.sdg_rate)} SDG
                  </bdi>
                  <span
                    className="text-muted-foreground"
                    data-testid="currency-updated"
                  >
                    {t("updated", {
                      date: formatDateTime(c.rate_updated_at, locale),
                    })}
                  </span>
                  <Badge tone={c.is_active ? "success" : "neutral"}>
                    {c.is_active ? t("active") : t("disabled")}
                  </Badge>
                </p>
                <CurrencyForm currency={c} locale={locale} />
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title={t("addTitle")} description={t("addHint")}>
        <CurrencyForm locale={locale} />
      </Section>
    </>
  );
}
