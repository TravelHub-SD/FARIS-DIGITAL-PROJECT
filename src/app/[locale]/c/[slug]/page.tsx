import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Breadcrumbs } from "@/components/catalog/breadcrumbs";
import { L10n } from "@/components/catalog/l10n";
import { ProductCard, ProductGrid } from "@/components/catalog/product-card";
import { Link } from "@/components/link";
import type { Locale } from "@/i18n/routing";
import { localized } from "@/lib/localized";
import { getSiteUrl } from "@/lib/env";
import { alternates, jsonLd, metaDescription, openGraph } from "@/lib/seo";
import { getCategory, searchProducts } from "@/server/catalog/queries";

// Static per category, rendered on first visit and regenerated every 5 min.
export const revalidate = 300;
export function generateStaticParams() {
  return [];
}

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

export default async function CategoryPage({ params }: Props) {
  const { locale: raw, slug } = await params;
  const locale = raw as Locale;
  setRequestLocale(locale);
  const category = await getCategory(slug);
  if (!category) notFound(); // hidden, inactive, archived or unknown
  const [t, products] = await Promise.all([
    getTranslations("Catalog"),
    searchProducts({ category: slug, sort: "popular", limit: 48 }),
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
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8">
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
      <header className="grid gap-2">
        <L10n value={name} as="h1" className="text-2xl font-bold sm:text-3xl" />
        <L10n
          value={localized(
            category.description_ar,
            category.description_en,
            locale,
          )}
          as="p"
          className="text-muted-foreground"
        />
        <p className="text-sm text-muted-foreground">
          {t("productCount", { count: total })}
        </p>
      </header>
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
