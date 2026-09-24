import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ArchiveForm, VariantForm } from "@/components/admin/catalog-forms";
import { PageHeader, Section } from "@/components/admin/ui";
import { L10n } from "@/components/catalog/l10n";
import { Link } from "@/components/link";
import type { Locale } from "@/i18n/routing";
import { localized } from "@/lib/localized";
import { getAdminVariant, getRate } from "@/server/admin/catalog-queries";
import { requireAdmin } from "@/server/auth/session";

export const metadata: Metadata = { robots: { index: false } };

export default async function EditVariantPage({
  params,
}: PageProps<"/[locale]/admin/catalog/variants/[id]">) {
  const { locale: raw, id } = await params;
  const locale = raw as Locale;
  setRequestLocale(locale);
  await requireAdmin(locale, "products");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const t = await getTranslations("Admin");
  const [variant, rate] = await Promise.all([getAdminVariant(id), getRate()]);
  if (!variant) notFound();
  return (
    <>
      <Link
        href={`/admin/catalog/products/${variant.product.id}`}
        className="text-sm text-muted-foreground hover:underline"
      >
        <L10n
          value={localized(
            variant.product.name_ar,
            variant.product.name_en,
            locale,
          )}
        />
      </Link>
      <PageHeader
        title={
          <L10n value={localized(variant.name_ar, variant.name_en, locale)} />
        }
        description={t("catalog.snapshotNote")}
      />
      <Section>
        <VariantForm
          productId={variant.product_id}
          variant={variant}
          rate={rate}
        />
      </Section>
      <Section title={t("catalog.archiveTitle")}>
        <ArchiveForm
          kind="variant"
          id={variant.id}
          archived={!!variant.archived_at}
        />
      </Section>
    </>
  );
}
