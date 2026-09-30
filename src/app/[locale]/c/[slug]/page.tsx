import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Breadcrumbs } from "@/components/catalog/breadcrumbs";
import { L10n } from "@/components/catalog/l10n";
import { ProductCard, ProductGrid } from "@/components/catalog/product-card";
import { ProductVisual } from "@/components/catalog/product-visual";
import { Link } from "@/components/link";
import type { Locale } from "@/i18n/routing";
import { localized } from "@/lib/localized";
import { getSiteUrl } from "@/lib/env";
import { alternates, jsonLd, metaDescription, openGraph } from "@/lib/seo";
import { browseProducts, getCategory } from "@/server/catalog/queries";

type Props = PageProps<"/[locale]/c/[slug]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw, slug } = await params;
  const locale = raw as Locale;
  const category = await getCategory(slug);
  if (!category) return {};
  const name =
    localized(category.name_ar, category.name_en, locale)?.text ?? slug;
  const description = metaDescription(
    localized(category.description_ar, category.description_en, locale)?.text,
  );
  return {
    title: name,
    description,
    alternates: alternates(locale, `/c/${slug}`),
    openGraph: openGraph(locale, {
      siteName: (await getTranslations({ locale, namespace: "Metadata" }))(
        "title",
      ),
      title: name,
      description,
      path: `/c/${slug}`,
    }),
  };
}

const SORTS = ["popular", "price_asc", "price_desc"] as const;

export default async function CategoryPage({ params, searchParams }: Props) {
  const { locale: raw, slug } = await params;
  const requested = (await searchParams).sort;
  const sort = SORTS.find((s) => s === requested) ?? "popular";
  const locale = raw as Locale;
  setRequestLocale(locale);
  const category = await getCategory(slug);
  if (!category) notFound(); // hidden, inactive, archived or unknown
  const [t, products] = await Promise.all([
    getTranslations("Catalog"),
    browseProducts({ category: slug, limit: 48, sort }),
  ]);
  const name = localized(category.name_ar, category.name_en, locale);
  const total = products[0]?.total_count ?? 0;
  const abs = (path: string) =>
    new URL(`/${locale}${path}`, getSiteUrl()).toString();
  const structured = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: t("home"), item: abs("") },
        {
          "@type": "ListItem",
          position: 2,
          name: name?.text,
          item: abs(`/c/${slug}`),
        },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: name?.text,
      numberOfItems: products.length,
      itemListElement: products.map((p, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: abs(`/p/${p.slug}`),
      })),
    },
  ];

  return (
    <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-4 px-4 py-4 sm:py-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(structured) }}
      />
      <Breadcrumbs
        items={[
          { href: "/", label: t("home") },
          { label: <L10n value={name} /> },
        ]}
      />
      <header className="flex items-center gap-3">
        <ProductVisual
          name={name?.text ?? slug}
          imagePath={category.image_path}
          size="thumb"
          priority
          className="w-16 shrink-0 rounded-2xl"
        />
        <div className="grid min-w-0 gap-0.5">
          <L10n value={name} as="h1" className="text-2xl font-bold" />
          <L10n
            value={localized(
              category.description_ar,
              category.description_en,
              locale,
            )}
            as="p"
            className="line-clamp-2 text-sm text-muted-foreground"
          />
          <p className="text-xs text-muted-foreground">
            {t("productCount", { count: total })}
          </p>
        </div>
      </header>
      {products.length > 1 && (
        <nav
          aria-label={t("sort")}
          className="-mx-4 no-scrollbar overflow-x-auto px-4"
        >
          <ul className="flex gap-2">
            {SORTS.map((s) => (
              <li key={s} className="shrink-0">
                <Link
                  href={s === "popular" ? `/c/${slug}` : `/c/${slug}?sort=${s}`}
                  aria-current={s === sort ? "page" : undefined}
                  className={`inline-flex h-9 items-center rounded-full border px-3.5 text-sm ${
                    s === sort
                      ? "border-foreground bg-foreground font-bold text-background"
                      : "bg-card hover:border-primary/50"
                  }`}
                >
                  {t(`sorts.${s}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {products.length === 0 ? (
        <p className="text-muted-foreground">{t("noProducts")}</p>
      ) : (
        <ProductGrid>
          {products.map((p) => (
            <ProductCard key={p.id} product={p} locale={locale} heading="h2" />
          ))}
        </ProductGrid>
      )}
      {total > products.length && (
        <Link
          href={`/search?category=${slug}`}
          className="text-sm text-primary hover:underline"
        >
          {t("viewAll")}
        </Link>
      )}
    </div>
  );
}
