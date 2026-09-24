import { Link } from "@/components/link";
import type { Locale } from "@/i18n/routing";
import { localized } from "@/lib/localized";
import type { Category } from "@/server/catalog/queries";

import { L10n } from "./l10n";

export function CategoryGrid({
  categories,
  locale,
}: {
  categories: Category[];
  locale: Locale;
}) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {categories.map((c) => (
        <li key={c.id}>
          <Link
            href={`/c/${c.slug}`}
            className="flex h-full flex-col gap-1 rounded-xl border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-accent"
          >
            <L10n
              value={localized(c.name_ar, c.name_en, locale)}
              className="font-bold"
            />
            <L10n
              value={localized(c.description_ar, c.description_en, locale)}
              className="line-clamp-2 text-xs text-muted-foreground"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
