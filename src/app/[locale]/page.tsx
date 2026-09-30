import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { BannerSlider } from "@/components/catalog/banner-slider";
import { CategoryTiles } from "@/components/catalog/category-tiles";
import { FaqSection } from "@/components/catalog/home-extras";
import { L10n } from "@/components/catalog/l10n";
import { ProductCard, ProductRail } from "@/components/catalog/product-card";
import { SearchForm } from "@/components/catalog/search-form";
import { SectionBar } from "@/components/catalog/section-bar";
import type { Locale } from "@/i18n/routing";
import { publicAssetUrl } from "@/lib/assets";
import { getSiteUrl } from "@/lib/env";
import { localized } from "@/lib/localized";
import { alternates, jsonLd, openGraph } from "@/lib/seo";
import {
  browseProducts,
  listBanners,
  listSections,
} from "@/server/catalog/queries";
import { getSiteSettings, listPublishedFaqs } from "@/server/catalog/site";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]">): Promise<Metadata> {
  const locale = (await params).locale as Locale;
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return {
    alternates: alternates(locale, "/"),
    openGraph: openGraph(locale, {
      siteName: t("title"),
      title: t("title"),
      description: t("description"),
      path: "/",
    }),
  };
}

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  // Validated by the locale layout, which 404s unknown locales.
  setRequestLocale(locale as Locale);
  const t = await getTranslations("Home");
  const tc = await getTranslations("Catalog");
  const [{ sections, unsectioned }, banners, popular, settings, faqs] =
    await Promise.all([
      listSections(),
      listBanners(),
      browseProducts({ limit: 8 }),
      getSiteSettings(),
      listPublishedFaqs(),
    ]);
  const groups = [
    ...sections.map((s) => ({
      id: s.id,
      name: localized(s.name_ar, s.name_en, locale as Locale),
      categories: s.categories,
    })),
    ...(unsectioned.length
      ? [
          {
            id: "more",
            name: {
              text: sections.length ? tc("moreCategories") : tc("categories"),
              lang: locale as Locale,
              fallback: false,
            },
            categories: unsectioned,
          },
        ]
      : []),
  ];

  const tm = await getTranslations("Metadata");
  const home = new URL(`/${locale}`, getSiteUrl()).toString();
  // One identity for both languages, anchored to a page that exists.
  const organizationId = `${new URL("/ar", getSiteUrl())}#organization`;
  const structured = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": organizationId,
      name: tm("title"),
      url: home,
      ...(settings.logo_path
        ? { logo: publicAssetUrl(settings.logo_path) }
        : {}),
      ...(settings.contact_phone || settings.contact_email
        ? {
            contactPoint: {
              "@type": "ContactPoint",
              contactType: "customer service",
              ...(settings.contact_phone
                ? { telephone: settings.contact_phone }
                : {}),
              ...(settings.contact_email
                ? { email: settings.contact_email }
                : {}),
              areaServed: "SD",
              availableLanguage: ["ar", "en"],
            },
          }
        : {}),
      sameAs: Object.values(settings.social_links).filter(Boolean),
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: tm("title"),
      url: home,
      inLanguage: locale,
      publisher: { "@id": organizationId },
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${new URL(`/${locale}/search`, getSiteUrl())}?q={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
    },
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(structured) }}
      />
      <h1 className="sr-only">{t("title")}</h1>
      <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-3 pt-3">
        <div className="px-4">
          <SearchForm locale={locale as Locale} compact />
        </div>
        <BannerSlider
          banners={banners}
          locale={locale as Locale}
          label={t("offers")}
        />
      </div>
      <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-7 px-4 pb-10">
        {groups.length > 1 && (
          <SectionBar
            label={tc("categories")}
            sections={groups.map((g) => ({
              id: g.id,
              label: g.name?.text ?? "",
            }))}
          />
        )}
        {groups.map((g) => (
          <section
            key={g.id}
            id={`section-${g.id}`}
            data-section-anchor
            aria-labelledby={`h-${g.id}`}
            className="grid gap-3 first:pt-4"
            data-testid="home-section"
          >
            <h2 id={`h-${g.id}`} className="text-lg font-bold">
              <L10n value={g.name} />
            </h2>
            <CategoryTiles
              categories={g.categories}
              locale={locale as Locale}
            />
          </section>
        ))}
        {popular.length > 0 && (
          <section aria-labelledby="popular" className="grid gap-3">
            <h2 id="popular" className="text-lg font-bold">
              {tc("popular")}
            </h2>
            <ProductRail>
              {popular.map((p) => (
                <ProductCard key={p.id} product={p} locale={locale as Locale} />
              ))}
            </ProductRail>
          </section>
        )}
        <FaqSection faqs={faqs} locale={locale as Locale} />
      </div>
    </>
  );
}
