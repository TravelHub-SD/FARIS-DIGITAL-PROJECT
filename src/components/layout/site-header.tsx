import { getLocale, getTranslations } from "next-intl/server";

import { CartIcon } from "@/components/icons";
import { Link } from "@/components/link";
import { SearchIcon } from "@/components/search-icon";
import { buttonVariants } from "@/components/ui/button";
import { cartCount } from "@/server/cart/queries";

import { LocaleSwitcher } from "./locale-switcher";
import { ThemeToggle } from "./theme-toggle";
import { Wordmark } from "./wordmark";

// Compact header (56 px). On phones account and cart live in the bottom
// navigation; from md up the header carries them.
export async function SiteHeader() {
  const t = await getTranslations("Header");
  const tn = await getTranslations("Nav");
  const count = await cartCount();

  return (
    <header
      data-testid="site-header"
      className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70 print:hidden"
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 ps-4 pe-2">
        <Wordmark />
        <nav className="flex items-center gap-0.5" aria-label={t("language")}>
          <Link
            href="/search"
            className={buttonVariants({ variant: "ghost", size: "icon" })}
            aria-label={t("search")}
          >
            <SearchIcon />
          </Link>
          <Link
            href="/cart"
            className={`${buttonVariants({ variant: "ghost", size: "sm" })} max-md:hidden`}
          >
            <CartIcon className="size-4" />
            {tn("cart")}
            {count > 0 && (
              <span className="rounded-full bg-highlight px-1.5 text-xs font-bold text-highlight-foreground">
                {count}
              </span>
            )}
          </Link>
          <Link
            href="/account"
            className={`${buttonVariants({ variant: "ghost", size: "sm" })} max-md:hidden`}
          >
            {t("account")}
          </Link>
          <ThemeToggle label={t("theme")} />
          <LocaleSwitcher
            label={t("switchTo")}
            target={(await getLocale()) === "ar" ? "en" : "ar"}
          />
        </nav>
      </div>
    </header>
  );
}
