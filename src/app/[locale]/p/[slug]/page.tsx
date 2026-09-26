import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Breadcrumbs } from "@/components/catalog/breadcrumbs";
import { CommentForm } from "@/components/catalog/comment-form";
import { L10n } from "@/components/catalog/l10n";
import {
  type FormVariant,
  OrderDetailsForm,
} from "@/components/catalog/order-details-form";
import { ProductVisual } from "@/components/catalog/product-visual";
import type { Locale } from "@/i18n/routing";
import { getSiteUrl } from "@/lib/env";
import { formatDateTime, formatSdg } from "@/lib/format";
import { localized } from "@/lib/localized";
import { publicAssetUrl } from "@/lib/assets";
import { alternates, jsonLd, metaDescription, openGraph } from "@/lib/seo";
import { getProduct } from "@/server/catalog/queries";
import { listProductComments } from "@/server/catalog/site";
import type { PlaceOrderError } from "@/server/orders/actions";

const REASONS = [
  "sign_in",
  "incomplete_account",
  "kyc_required",
  "phone_not_verified",
  "customer_blocked",
  "variant_unavailable",
  "invalid_quantity",
  "fulfillment_invalid",
  "rate_limited",
  "invalid_input",
  "server_error",
] as const satisfies readonly PlaceOrderError[];

// Static per product, rendered on first visit and regenerated every 5 min.
export const revalidate = 300;
export function generateStaticParams() {
  return [];
}

type Props = PageProps<"/[locale]/p/[slug]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw, slug } = await params;
  const locale = raw as Locale;
  const product = await getProduct(slug);
  if (!product) return {};
  const name =
    localized(product.name_ar, product.name_en, locale)?.text ?? slug;
  const description = metaDescription(
    localized(product.description_ar, product.description_en, locale)?.text,
  );
  return {
    title: name,
    description,
    alternates: alternates(locale, `/p/${slug}`),
    openGraph: openGraph(locale, {
      siteName: (await getTranslations({ locale, namespace: "Metadata" }))(
        "title",
      ),
      title: name,
      description,
      path: `/p/${slug}`,
      image: product.image_path ? publicAssetUrl(product.image_path) : null,
    }),
  };
}

export default async function ProductPage({ params }: Props) {
  const { locale: raw, slug } = await params;
  const locale = raw as Locale;
  setRequestLocale(locale);
  // Null when the product, its category, or all of its variants are hidden.
  const product = await getProduct(slug);
  if (!product) notFound();
  const t = await getTranslations("Catalog");
  const comments = await listProductComments(product.id);

  const name = localized(product.name_ar, product.name_en, locale);
  const description = localized(
    product.description_ar,
    product.description_en,
    locale,
  );
  const categoryName = localized(
    product.category.name_ar,
    product.category.name_en,
    locale,
  );

  const variants: FormVariant[] = product.variants.map((v) => ({
    id: v.id,
    name: localized(v.name_ar, v.name_en, locale),
    price: formatSdg(v.price_sdg, locale),
    totals: v.totals_sdg,
    fields: v.fields.map((f) => ({
      key: f.key,
      type: f.type,
      label: localized(f.label_ar, f.label_en, locale),
      required: f.required,
      minLength: f.min_length,
      maxLength: f.max_length,
      options: f.options?.map((o) => ({
        value: o.value,
        label: localized(o.label_ar, o.label_en, locale),
      })),
    })),
  }));

  const prices = product.variants
    .map((v) => v.price_sdg)
    .filter((p): p is number => p !== null);
  const url = new URL(`/${locale}/p/${product.slug}`, getSiteUrl()).toString();
  const structured = [
    {
      "@context": "https://schema.org",
      "@type": "Product",
      name: name?.text,
      description: description?.text,
      category: categoryName?.text,
      url,
      ...(product.image_path
        ? { image: publicAssetUrl(product.image_path) }
        : {}),
      ...(prices.length
        ? {
            offers: {
              "@type": "AggregateOffer",
              priceCurrency: "SDG",
              lowPrice: Math.min(...prices),
              highPrice: Math.max(...prices),
              offerCount: prices.length,
              availability: "https://schema.org/InStock",
            },
          }
        : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: t("home"),
          item: new URL(`/${locale}`, getSiteUrl()).toString(),
        },
        {
          "@type": "ListItem",
          position: 2,
          name: categoryName?.text,
          item: new URL(
            `/${locale}/c/${product.category.slug}`,
            getSiteUrl(),
          ).toString(),
        },
        { "@type": "ListItem", position: 3, name: name?.text, item: url },
      ],
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
          {
            href: `/c/${product.category.slug}`,
            label: <L10n value={categoryName} />,
          },
          { label: <L10n value={name} /> },
        ]}
      />
      <header className="grid gap-1">
        <L10n value={name} as="h1" className="text-2xl font-bold sm:text-3xl" />
        <p className="font-medium text-primary" dir="auto">
          {prices.length
            ? t("from", { price: formatSdg(Math.min(...prices), locale)! })
            : t("priceUnavailable")}
        </p>
      </header>
      <div className="grid gap-8 md:grid-cols-2">
        <div className="grid content-start gap-4">
          <ProductVisual
            name={name?.text ?? product.slug}
            imagePath={product.image_path}
            size="full"
            priority
            className="max-h-72 md:max-h-80"
          />
          <L10n
            value={description}
            as="p"
            className="leading-relaxed text-muted-foreground"
          />
        </div>
        <div className="grid content-start gap-6">
          <OrderDetailsForm
            variants={variants}
            locale={locale}
            loginHref={`/${locale}/login?next=${encodeURIComponent(`/${locale}/p/${product.slug}`)}`}
            strings={{
              chooseOption: t("chooseOption"),
              details: t("details"),
              placeOrder: t("placeOrder"),
              quantity: t("quantity"),
              total: t("total"),
              // Filled in on the client with the formatted new total.
              priceChanged: t("priceChanged", { price: "{price}" }),
              signInAction: t("signInAction"),
              kycAction: t("kycAction"),
              completeAction: t("completeAction"),
              required: t("required"),
              optional: t("optional"),
              select: t("select"),
              priceUnavailable: t("priceUnavailable"),
              errors: {
                missing: t("errors.missing"),
                unknown: t("errors.unknown"),
                type: t("errors.type"),
                length: t("errors.length"),
                format: t("errors.format"),
                option: t("errors.option"),
                unavailable: t("errors.unavailable"),
              },
              reasons: Object.fromEntries(
                REASONS.map((r) => [r, t(`reasons.${r}`)]),
              ),
            }}
          />
          <p className="text-xs text-muted-foreground">{t("priceNote")}</p>
        </div>
      </div>
      <section
        aria-labelledby="comments"
        className="grid gap-4 border-t pt-8"
        data-testid="comments"
      >
        <h2 id="comments" className="text-xl font-bold">
          {t("comments.title")}{" "}
          <span className="text-sm font-normal text-muted-foreground">
            ({t("comments.count", { count: comments.length })})
          </span>
        </h2>
        {comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("comments.empty")}</p>
        ) : (
          <ul className="grid gap-3" data-testid="comment-list">
            {comments.map((c) => (
              <li
                key={c.id}
                className="grid gap-1 rounded-lg border bg-card p-3"
              >
                <span className="text-sm">
                  <span className="font-medium">
                    {c.author ?? t("comments.customer")}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    · {formatDateTime(c.created_at, locale)}
                  </span>
                </span>
                <p
                  className="text-sm wrap-anywhere whitespace-pre-wrap"
                  dir="auto"
                >
                  {c.body}
                </p>
              </li>
            ))}
          </ul>
        )}
        <div className="max-w-xl">
          <CommentForm
            productId={product.id}
            slug={product.slug}
            loginHref={`/${locale}/login?next=${encodeURIComponent(`/${locale}/p/${product.slug}`)}`}
            strings={{
              label: t("comments.label"),
              placeholder: t("comments.placeholder"),
              submit: t("comments.submit"),
              posted: t("comments.posted"),
              signIn: t("comments.signIn"),
              errors: {
                sign_in: t("comments.errors.sign_in"),
                incomplete_account: t("comments.errors.incomplete_account"),
                not_allowed: t("comments.errors.not_allowed"),
                rate_limited: t("comments.errors.rate_limited"),
                invalid_input: t("comments.errors.invalid_input"),
                server_error: t("comments.errors.server_error"),
              },
            }}
          />
        </div>
      </section>
    </div>
  );
}
