import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ProductForm } from "@/components/admin/catalog-forms";
import { Empty, PageHeader, Section } from "@/components/admin/ui";
import { Link } from "@/components/link";
import type { Locale } from "@/i18n/routing";
import { localized } from "@/lib/localized";
import { listAdminCategories } from "@/server/admin/catalog-queries";
import { requireAdmin } from "@/server/auth/session";

export const metadata: Metadata = { robots: { index: false } };

export default async function NewProductPage({
  params,
}: PageProps<"/[locale]/admin/catalog/products/new">) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  await requireAdmin(locale, "products");
  const t = await getTranslations("Admin");
  const categories = await listAdminCategories();
  const options = categories
    .filter((c) => !c.archived_at)
    .map((c) => ({
      id: c.id,
      name: localized(c.name_ar, c.name_en, locale)?.text ?? c.slug,
    }));
  return (
    <>
      <Link
        href="/admin/catalog"
        className="text-sm text-muted-foreground hover:underline"
      >
        {t("catalog.back")}
      </Link>
      <PageHeader
        title={t("catalog.newProduct")}
        description={t("catalog.newProductHint")}
      />
      <Section>
        {options.length === 0 ? (
          <Empty>{t("catalog.needCategory")}</Empty>
        ) : (
          <ProductForm categories={options} />
        )}
      </Section>
    </>
  );
}
