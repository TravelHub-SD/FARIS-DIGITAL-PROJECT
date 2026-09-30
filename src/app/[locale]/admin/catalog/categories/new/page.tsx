import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { CategoryForm } from "@/components/admin/catalog-forms";
import { PageHeader, Section } from "@/components/admin/ui";
import { Link } from "@/components/link";
import type { Locale } from "@/i18n/routing";
import { localized } from "@/lib/localized";
import { listAdminSections } from "@/server/admin/catalog-queries";
import { requireAdmin } from "@/server/auth/session";

export const metadata: Metadata = { robots: { index: false } };

export default async function NewCategoryPage({
  params,
}: PageProps<"/[locale]/admin/catalog/categories/new">) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  await requireAdmin(locale, "products");
  const t = await getTranslations("Admin");
  const sections = (await listAdminSections()).map((s) => ({
    id: s.id,
    name: localized(s.name_ar, s.name_en, locale)?.text ?? "",
  }));
  return (
    <>
      <Link
        href="/admin/catalog"
        className="text-sm text-muted-foreground hover:underline"
      >
        {t("catalog.back")}
      </Link>
      <PageHeader title={t("catalog.newCategory")} />
      <Section>
        <CategoryForm sections={sections} />
      </Section>
    </>
  );
}
