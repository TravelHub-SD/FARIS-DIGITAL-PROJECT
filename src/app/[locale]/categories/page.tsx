import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { CategoryTiles } from "@/components/catalog/category-tiles";
import { L10n } from "@/components/catalog/l10n";
import type { Locale } from "@/i18n/routing";
import { localized } from "@/lib/localized";
import { alternates } from "@/lib/seo";
import { listSections } from "@/server/catalog/queries";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/categories">): Promise<Metadata> {
  const locale = (await params).locale as Locale;
  const t = await getTranslations({ locale, namespace: "Catalog" });
  return {
    title: t("allCategories"),
    alternates: alternates(locale, "/categories"),
  };
}

/** Every section and its categories (the "Categories" tab). */
export default async function CategoriesPage({
  params,
}: PageProps<"/[locale]/categories">) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  const t = await getTranslations("Catalog");
  const { sections, unsectioned } = await listSections();
  return (
    <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-7 px-4 py-4 sm:py-8">
      <h1 className="text-2xl font-bold">{t("allCategories")}</h1>
      {sections.map((s) => (
        <section
          key={s.id}
          id={`section-${s.id}`}
          data-section-anchor
          aria-labelledby={`h-${s.id}`}
          className="grid gap-3"
        >
          <h2 id={`h-${s.id}`} className="text-lg font-bold">
            <L10n value={localized(s.name_ar, s.name_en, locale)} />
          </h2>
          <CategoryTiles categories={s.categories} locale={locale} />
        </section>
      ))}
      {unsectioned.length > 0 && (
        <section aria-labelledby="h-more" className="grid gap-3">
          <h2 id="h-more" className="text-lg font-bold">
            {sections.length ? t("moreCategories") : t("categories")}
          </h2>
          <CategoryTiles categories={unsectioned} locale={locale} />
        </section>
      )}
      {sections.length === 0 && unsectioned.length === 0 && (
        <p className="text-muted-foreground">{t("noProducts")}</p>
      )}
    </div>
  );
}
