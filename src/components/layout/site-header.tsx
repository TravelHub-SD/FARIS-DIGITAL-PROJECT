import { getLocale, getTranslations } from "next-intl/server";

import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/components/link";
import { SearchIcon } from "@/components/search-icon";

import { LocaleSwitcher } from "./locale-switcher";
import { ThemeToggle } from "./theme-toggle";
import { Wordmark } from "./wordmark";

export async function SiteHeader() {
  const t = await getTranslations("Header");

  return (
    <header
      data-testid="site-header"
      className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70 print:hidden"
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
        <Wordmark />
        <nav className="flex items-center gap-1" aria-label={t("language")}>
          <Link
            href="/search"
            className={buttonVariants({ variant: "ghost", size: "icon" })}
            aria-label={t("search")}
          >
            <SearchIcon />
          </Link>
          <Link
            href="/account"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            {t("account")}
          </Link>
          <LocaleSwitcher
            label={t("switchTo")}
            target={(await getLocale()) === "ar" ? "en" : "ar"}
          />
          <ThemeToggle label={t("theme")} />
        </nav>
      </div>
    </header>
  );
}
