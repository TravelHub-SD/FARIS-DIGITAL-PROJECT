import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ArchiveForm, CategoryForm } from "@/components/admin/catalog-forms";
import { ImageEditor } from "@/components/admin/image-editor";
import { PageHeader, Section } from "@/components/admin/ui";
import { L10n } from "@/components/catalog/l10n";
import { Link } from "@/components/link";
import type { Locale } from "@/i18n/routing";
import { localized } from "@/lib/localized";
import {
  removeCategoryImage,
  uploadCategoryImage,
} from "@/server/admin/catalog";
import {
  getAdminCategory,
  listAdminSections,
} from "@/server/admin/catalog-queries";
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
  const [category, sections] = await Promise.all([
    getAdminCategory(id),
    listAdminSections(),
  ]);
  if (!category) notFound();
  const t = await getTranslations("Admin");
  const sectionOptions = sections.map((s) => ({
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
      <PageHeader
        title={
          <L10n value={localized(category.name_ar, category.name_en, locale)} />
        }
      />
      <Section>
        <CategoryForm category={category} sections={sectionOptions} />
      </Section>
      <Section title={t("catalog.icon")} description={t("catalog.iconHint")}>
        <ImageEditor
          path={category.image_path}
          upload={uploadCategoryImage}
          remove={removeCategoryImage}
          idName="categoryId"
          id={category.id}
          label={t("catalog.chooseImage")}
          testId="category-icon"
          previewClassName="size-32"
        />
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
