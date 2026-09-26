import { getTranslations } from "next-intl/server";

import { Link } from "@/components/link";
import type { Locale } from "@/i18n/routing";
import { formatSdg } from "@/lib/format";
import { localized } from "@/lib/localized";
import type { ProductSummary } from "@/server/catalog/queries";

import { L10n } from "./l10n";
import { ProductVisual } from "./product-visual";

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
  const category = localized(
    product.category_name_ar,
    product.category_name_en,
    locale,
  );
  const price = formatSdg(product.min_price_sdg, locale);

  return (
    <li>
      <Link
        href={`/p/${product.slug}`}
        className="group flex h-full flex-col gap-3 rounded-xl border bg-card p-3 transition-colors hover:border-primary/50"
      >
        <ProductVisual
          name={name?.text ?? product.slug}
          imagePath={product.image_path}
        />
        <div className="grid gap-1">
          <L10n
            value={name}
            as={heading}
            className="text-base leading-snug font-bold group-hover:text-primary"
          />
          <L10n value={category} className="text-xs text-muted-foreground" />
        </div>
        <p className="mt-auto text-sm font-medium" dir="auto">
          {price ? t("from", { price }) : t("priceUnavailable")}
        </p>
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
