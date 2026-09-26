import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ProductCard, ProductGrid } from "@/components/catalog/product-card";
import { SearchForm } from "@/components/catalog/search-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Link } from "@/components/link";
import type { Locale } from "@/i18n/routing";
import { localized } from "@/lib/localized";
import {
  listCategories,
  searchProducts,
  type SearchParams,
} from "@/server/catalog/queries";

// Dynamic (reads the query string). Results are not indexed; the static
// category and product pages are what search engines should crawl.
export const metadata: Metadata = { robots: { index: false, follow: true } };

const PAGE_SIZE = 24;
const SORTS = ["popular", "price_asc", "price_desc", "newest"] as const;

function one(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}
function price(value: string | undefined) {
  const n = value ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 && n < 1e12 ? Math.floor(n) : undefined;
}

export default async function SearchPage({
  params,
  searchParams,
}: PageProps<"/[locale]/search">) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  const sp = await searchParams;
  const query = one(sp.q)?.slice(0, 100).trim() || undefined;
  const category = one(sp.category)?.match(/^[a-z0-9-]{1,80}$/)?.[0];
  const sort = SORTS.find((s) => s === one(sp.sort)) ?? "popular";
  const minSdg = price(one(sp.min));
  const maxSdg = price(one(sp.max));
  const page = Math.max(
    1,
    Math.min(100, Math.floor(Number(one(sp.page)) || 1)),
  );

  const filters: SearchParams = {
    query,
    category,
    sort,
    minSdg,
    maxSdg,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };
  const [t, categories, results] = await Promise.all([
    getTranslations("Catalog"),
    listCategories(),
    searchProducts(filters),
  ]);
  const total = results[0]?.total_count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (p: number) => {
    const q = new URLSearchParams();
    if (query) q.set("q", query);
    if (category) q.set("category", category);
    if (sort !== "popular") q.set("sort", sort);
    if (minSdg !== undefined) q.set("min", String(minSdg));
    if (maxSdg !== undefined) q.set("max", String(maxSdg));
    if (p > 1) q.set("page", String(p));
    return `/search?${q.toString()}`;
  };

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8">
      <h1 className="text-2xl font-bold">
        {query ? t("resultsFor", { query }) : t("searchTitle")}
      </h1>
      <SearchForm locale={locale} defaultValue={query} />

      {/* GET form: filtering works without client JavaScript. */}
      <form
        method="get"
        className="grid gap-3 rounded-xl border p-4 sm:grid-cols-5 sm:items-end"
        aria-label={t("filters")}
      >
        {query && <input type="hidden" name="q" value={query} />}
        <div className="grid gap-1.5">
          <Label htmlFor="category">{t("category")}</Label>
          <NativeSelect
            id="category"
            name="category"
            defaultValue={category ?? ""}
          >
            <option value="">{t("anyCategory")}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.slug}>
                {localized(c.name_ar, c.name_en, locale)?.text ?? c.slug}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="min">{t("minPrice")}</Label>
          <Input
            id="min"
            name="min"
            type="number"
            min={0}
            inputMode="numeric"
            dir="ltr"
            defaultValue={minSdg}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="max">{t("maxPrice")}</Label>
          <Input
            id="max"
            name="max"
            type="number"
            min={0}
            inputMode="numeric"
            dir="ltr"
            defaultValue={maxSdg}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="sort">{t("sort")}</Label>
          <NativeSelect id="sort" name="sort" defaultValue={sort}>
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`sorts.${s}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit">{t("apply")}</Button>
      </form>

      <p className="text-sm text-muted-foreground" data-testid="result-count">
        {t("productCount", { count: total })}
      </p>
      {results.length === 0 ? (
        <p className="text-muted-foreground">{t("noResults")}</p>
      ) : (
        <ProductGrid>
          {results.map((p) => (
            <ProductCard key={p.id} product={p} locale={locale} heading="h2" />
          ))}
        </ProductGrid>
      )}
      {pages > 1 && (
        <nav
          className="flex items-center justify-between text-sm"
          aria-label="pagination"
        >
          {page > 1 ? (
            <Link href={link(page - 1)}>{t("previous")}</Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            {t("page", { page, pages })}
          </span>
          {page < pages ? (
            <Link href={link(page + 1)}>{t("next")}</Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
