import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ArchiveForm, CategoryForm } from "@/components/admin/catalog-forms";
import { PageHeader, Section } from "@/components/admin/ui";
import { L10n } from "@/components/catalog/l10n";
import { Link } from "@/components/link";
import type { Locale } from "@/i18n/routing";
import { localized } from "@/lib/localized";
import { getAdminCategory } from "@/server/admin/catalog-queries";
import { requireAdmin } from "@/server/auth/session";

export const metadata: Metadata = { robots: { index: false } };

export default async function EditCategoryPage({
  params,
}: PageProps<"/[locale]/admin/catalog/categories/[id]">) {
  const { locale: raw, id } = await params;
  const locale = raw as Locale;
  setRequestLocale(locale);
  await requireAdmin(locale, "products");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const category = await getAdminCategory(id);
  if (!category) notFound();
  const t = await getTranslations("Admin");
  return (
    <>
      <Link
        href="/admin/catalog"
        className="text-sm text-muted-foreground hover:underline"
      >
        {t("catalog.back")}
      </Link>
      <PageHeader
        title={
          <L10n value={localized(category.name_ar, category.name_en, locale)} />
        }
      />
      <Section>
        <CategoryForm category={category} />
      </Section>
      <Section title={t("catalog.archiveTitle")}>
        <ArchiveForm
          kind="category"
          id={category.id}
          archived={!!category.archived_at}
        />
      </Section>
    </>
  );
}
