import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Breadcrumbs } from "@/components/catalog/breadcrumbs";
import { L10n } from "@/components/catalog/l10n";
import { ProductCard, ProductGrid } from "@/components/catalog/product-card";
import { Link } from "@/components/link";
import type { Locale } from "@/i18n/routing";
import { localized } from "@/lib/localized";
import { alternates, metaDescription, ogLocale } from "@/lib/seo";
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
    openGraph: {
      type: "website",
      title: name,
      description,
      url: `/${locale}/c/${slug}`,
      locale: ogLocale(locale),
    },
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

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8">
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
            <ProductCard key={p.id} product={p} locale={locale} />
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
