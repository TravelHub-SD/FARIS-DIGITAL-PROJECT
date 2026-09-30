import { headers } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "@/components/link";
import {
  CartIcon,
  GridIcon,
  HomeIcon,
  ReceiptIcon,
  UserIcon,
} from "@/components/icons";
import { cartCount } from "@/server/cart/queries";

// Phone navigation: five tabs pinned to the bottom (hidden from md up, where
// the header carries the same links). Rendered on the server: the current tab
// comes from the request path (x-pathname, set by proxy.ts), the cart badge
// from the database. No client JavaScript.
const TABS = [
  { key: "home", href: "/", icon: HomeIcon, match: /^\/(ar|en)\/?$/ },
  {
    key: "categories",
    href: "/categories",
    icon: GridIcon,
    match: /^\/(ar|en)\/(categories|c\/|p\/)/,
  },
  {
    key: "cart",
    href: "/cart",
    icon: CartIcon,
    match: /^\/(ar|en)\/(cart|checkout)/,
  },
  {
    key: "orders",
    href: "/account/orders",
    icon: ReceiptIcon,
    match: /^\/(ar|en)\/account\/(orders|invoices)/,
  },
  {
    key: "account",
    href: "/account",
    icon: UserIcon,
    match: /^\/(ar|en)\/(account(?!\/(orders|invoices))|login|register)/,
  },
] as const;

export async function BottomNav() {
  const t = await getTranslations("Nav");
  const locale = await getLocale();
  const path = (await headers()).get("x-pathname") ?? `/${locale}`;
  const count = await cartCount();
  return (
    <nav
      aria-label={t("label")}
      data-testid="bottom-nav"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden print:hidden"
    >
      <ul className="grid h-16 grid-cols-5">
        {TABS.map(({ key, href, icon: Icon, match }) => {
          const current = match.test(path);
          return (
            <li key={key}>
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                data-tab={key}
                className={`relative flex h-full flex-col items-center justify-center gap-0.5 text-[11px] leading-4 ${
                  current
                    ? "font-bold text-primary-text"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {current && (
                  <span
                    aria-hidden
                    className="absolute top-0 h-[3px] w-7 rounded-b-full bg-primary"
                  />
                )}
                <span className="relative">
                  <Icon className="size-6" />
                  {key === "cart" && count > 0 && (
                    <span
                      className="absolute -end-2.5 -top-1.5 grid min-w-[1.125rem] place-items-center rounded-full border-2 border-card bg-highlight px-1 text-[10px] leading-4 font-bold text-highlight-foreground"
                      data-testid="cart-count"
                    >
                      {count > 99 ? "99+" : count}
                    </span>
                  )}
                </span>
                {t(key)}
                {key === "cart" && count > 0 && (
                  <span className="sr-only">{t("cartCount", { count })}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
