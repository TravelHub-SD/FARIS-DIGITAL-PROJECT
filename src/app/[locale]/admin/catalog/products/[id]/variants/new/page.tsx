import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { VariantForm } from "@/components/admin/catalog-forms";
import { PageHeader, Section } from "@/components/admin/ui";
import { L10n } from "@/components/catalog/l10n";
import { Link } from "@/components/link";
import type { Locale } from "@/i18n/routing";
import { localized } from "@/lib/localized";
import { getAdminProduct, getRate } from "@/server/admin/catalog-queries";
import { requireAdmin } from "@/server/auth/session";

export const metadata: Metadata = { robots: { index: false } };

export default async function NewVariantPage({
  params,
}: PageProps<"/[locale]/admin/catalog/products/[id]/variants/new">) {
  const { locale: raw, id } = await params;
  const locale = raw as Locale;
  setRequestLocale(locale);
  await requireAdmin(locale, "products");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const t = await getTranslations("Admin");
  const [product, rate] = await Promise.all([getAdminProduct(id), getRate()]);
  if (!product) notFound();
  return (
    <>
      <Link
        href={`/admin/catalog/products/${product.id}`}
        className="text-sm text-muted-foreground hover:underline"
      >
        <L10n value={localized(product.name_ar, product.name_en, locale)} />
      </Link>
      <PageHeader title={t("catalog.newVariant")} />
      <Section>
        <VariantForm productId={product.id} rate={rate} />
      </Section>
    </>
  );
}
