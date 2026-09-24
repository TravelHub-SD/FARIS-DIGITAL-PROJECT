import { getTranslations, setRequestLocale } from "next-intl/server";

import { CategoryGrid } from "@/components/catalog/category-grid";
import { ProductCard, ProductGrid } from "@/components/catalog/product-card";
import { SearchForm } from "@/components/catalog/search-form";
import type { Locale } from "@/i18n/routing";
import { listCategories, searchProducts } from "@/server/catalog/queries";

// Static, regenerated at most every 5 minutes (ISR). If the database is cold
// during regeneration, the last good page keeps being served.
export const revalidate = 300;

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  // Validated by the locale layout, which 404s unknown locales.
  setRequestLocale(locale as Locale);
  const [t, tc, categories, popular] = await Promise.all([
    getTranslations("Home"),
    getTranslations("Catalog"),
    listCategories(),
    searchProducts({ sort: "popular", limit: 8 }),
  ]);

  return (
    <>
      <section className="relative overflow-hidden border-b">
        <div
          aria-hidden
          className="pointer-events-none absolute start-1/2 -top-24 size-[36rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl rtl:translate-x-1/2"
        />
        <div className="relative mx-auto max-w-6xl px-4 py-14 sm:py-20">
          <h1 className="max-w-2xl text-3xl leading-tight font-bold text-balance sm:text-5xl">
            {t("title")}
          </h1>
          <p className="mt-5 max-w-xl text-base text-pretty text-muted-foreground sm:text-lg">
            {t("subtitle")}
          </p>
          <div className="mt-8 max-w-xl">
            <SearchForm locale={locale as Locale} />
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-10">
        {categories.length > 0 && (
          <section aria-labelledby="categories" className="grid gap-4">
            <h2 id="categories" className="text-xl font-bold">
              {tc("categories")}
            </h2>
            <CategoryGrid categories={categories} locale={locale as Locale} />
          </section>
        )}
        {popular.length > 0 && (
          <section aria-labelledby="popular" className="grid gap-4">
            <h2 id="popular" className="text-xl font-bold">
              {tc("popular")}
            </h2>
            <ProductGrid>
              {popular.map((p) => (
                <ProductCard key={p.id} product={p} locale={locale as Locale} />
              ))}
            </ProductGrid>
          </section>
        )}
      </div>
    </>
  );
}
