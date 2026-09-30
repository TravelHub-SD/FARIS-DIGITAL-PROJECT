import { getTranslations } from "next-intl/server";

import { SearchIcon } from "@/components/search-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Locale } from "@/i18n/routing";

/** Plain GET form: works with zero client JavaScript. */
export async function SearchForm({
  locale,
  defaultValue,
  compact = false,
}: {
  locale: Locale;
  defaultValue?: string;
  /** Home: one rounded field with the icon inside, no visible button. */
  compact?: boolean;
}) {
  const t = await getTranslations("Catalog");
  if (compact) {
    return (
      <form
        action={`/${locale}/search`}
        method="get"
        role="search"
        className="relative"
      >
        <label htmlFor="q" className="sr-only">
          {t("searchLabel")}
        </label>
        <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
        <input
          id="q"
          name="q"
          type="search"
          maxLength={100}
          defaultValue={defaultValue}
          placeholder={t("searchPlaceholder")}
          className="h-11 w-full rounded-xl border-0 bg-muted ps-10 pe-3 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <button type="submit" className="sr-only">
          {t("searchSubmit")}
        </button>
      </form>
    );
  }
  return (
    <form
      action={`/${locale}/search`}
      method="get"
      role="search"
      className="flex gap-2"
    >
      <label htmlFor="q" className="sr-only">
        {t("searchLabel")}
      </label>
      <Input
        id="q"
        name="q"
        type="search"
        maxLength={100}
        defaultValue={defaultValue}
        placeholder={t("searchPlaceholder")}
      />
      <Button type="submit" aria-label={t("searchSubmit")}>
        <SearchIcon />
        <span className="hidden sm:inline">{t("searchSubmit")}</span>
      </Button>
    </form>
  );
}
