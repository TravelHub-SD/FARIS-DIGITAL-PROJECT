import { Link } from "@/components/link";
import type { Locale } from "@/i18n/routing";
import { localized } from "@/lib/localized";
import type { CategoryTile } from "@/server/catalog/queries";

import { L10n } from "./l10n";
import { ProductVisual } from "./product-visual";

/**
 * Square icons, four per row on phones. A category with exactly one product
 * opens that product directly (one tap fewer; decided 2026-09-30).
 */
export function CategoryTiles({
  categories,
  locale,
}: {
  categories: CategoryTile[];
  locale: Locale;
}) {
  return (
    <ul
      className="grid grid-cols-4 gap-x-2 gap-y-4 sm:grid-cols-6 lg:grid-cols-8"
      data-testid="category-tiles"
    >
      {categories.map((c) => {
        const name = localized(c.name_ar, c.name_en, locale);
        return (
          <li key={c.id}>
            <Link
              href={c.only_product ? `/p/${c.only_product}` : `/c/${c.slug}`}
              className="group flex flex-col items-center gap-1.5 text-center"
              data-testid="category-tile"
            >
              <ProductVisual
                name={name?.text ?? c.slug}
                imagePath={c.image_path}
                decorative
                className="rounded-2xl shadow-sm ring-1 ring-black/5 transition-transform group-hover:scale-[1.03] dark:ring-white/10"
              />
              <L10n
                value={name}
                className="line-clamp-2 min-h-8 text-xs leading-4"
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
