import { getTranslations } from "next-intl/server";

import { PlusIcon } from "@/components/icons";
import { Link } from "@/components/link";
import type { Locale } from "@/i18n/routing";
import { formatSdg } from "@/lib/format";
import { localized } from "@/lib/localized";
import type { ProductSummary } from "@/server/catalog/queries";

import { L10n } from "./l10n";
import { ProductVisual } from "./product-visual";

/**
 * Image, "New" badge, name, short description, lowest price with the "was"
 * price struck through, and a "Choose a package" button (the details are
 * entered on the product page, so the card never adds to the cart directly).
 */
export async function ProductCard({
  product,
  locale,
  heading = "h3",
}: {
  product: ProductSummary;
  locale: Locale;
  /** h3 under a section heading (home); h2 in a list right under the h1. */
  heading?: "h2" | "h3";
}) {
  const t = await getTranslations("Catalog");
  const name = localized(product.name_ar, product.name_en, locale);
  const description = localized(
    product.description_ar,
    product.description_en,
    locale,
  );
  const price = formatSdg(product.min_price_sdg, locale);
  const was = formatSdg(product.compare_at_sdg, locale);

  return (
    <li className="min-w-0" data-testid="product-card">
      <Link
        href={`/p/${product.slug}`}
        className="group flex h-full flex-col overflow-hidden rounded-2xl border bg-card transition-colors hover:border-primary/50"
      >
        <div className="relative">
          <ProductVisual
            name={name?.text ?? product.slug}
            imagePath={product.image_path}
          />
          {product.is_new && (
            <span
              className="absolute start-2 top-2 rounded-full bg-highlight px-2 text-[11px] leading-5 font-bold text-highlight-foreground"
              data-testid="badge-new"
            >
              {t("new")}
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-0.5 p-2.5">
          <L10n
            value={name}
            as={heading}
            className="line-clamp-2 text-sm leading-5 font-bold group-hover:text-primary-text"
          />
          <L10n
            value={description}
            className="line-clamp-2 text-xs leading-[1.125rem] text-muted-foreground"
          />
          <p
            className="mt-auto flex flex-wrap items-baseline gap-x-1.5 pt-1.5"
            dir="auto"
          >
            {price ? (
              <>
                <span className="text-[11px] text-muted-foreground">
                  {t("fromShort")}
                </span>
                <span className="text-base font-bold" data-testid="card-price">
                  {price}
                </span>
                {was && (
                  <s
                    className="text-xs text-muted-foreground"
                    data-testid="card-compare-at"
                  >
                    <span className="sr-only">{t("wasPrice")} </span>
                    {was}
                  </s>
                )}
              </>
            ) : (
              <span className="text-sm">{t("priceUnavailable")}</span>
            )}
          </p>
          <span className="mt-2 flex h-9 items-center justify-center gap-1 rounded-lg bg-primary-soft text-sm font-bold text-primary-text">
            <PlusIcon className="size-4" />
            {t("choosePackage")}
          </span>
        </div>
      </Link>
    </li>
  );
}

export function ProductGrid({ children }: { children: React.ReactNode }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {children}
    </ul>
  );
}

/** A horizontal row that scrolls (home "Most ordered"). */
export function ProductRail({ children }: { children: React.ReactNode }) {
  return (
    <ul
      className="-mx-4 no-scrollbar flex snap-x gap-3 overflow-x-auto px-4 pb-1 [&>li]:w-[44%] [&>li]:shrink-0 [&>li]:snap-start sm:[&>li]:w-[30%] lg:[&>li]:w-[22%]"
      tabIndex={0}
    >
      {children}
    </ul>
  );
}
