import { getTranslations } from "next-intl/server";

import { SearchIcon } from "@/components/search-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Locale } from "@/i18n/routing";

/** Plain GET form: works with zero client JavaScript. */
export async function SearchForm({
  locale,
  defaultValue,
}: {
  locale: Locale;
  defaultValue?: string;
}) {
  const t = await getTranslations("Catalog");
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
