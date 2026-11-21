import { getLocale, getTranslations } from "next-intl/server";

import {
  CartIcon,
  GridIcon,
  HomeIcon,
  ReceiptIcon,
  UserIcon,
} from "@/components/icons";
import { cartCount } from "@/server/cart/queries";

import { BottomNavTabs, type TabKey } from "./bottom-nav-tabs";

// Phone navigation: five tabs pinned to the bottom (hidden from md up, where
// the header carries the same links). Labels, icons and the cart badge are
// rendered here on the server; BottomNavTabs marks the current tab from the
// browser's path, so it follows client navigation.
const TABS: { key: TabKey; href: string; icon: typeof HomeIcon }[] = [
  { key: "home", href: "/", icon: HomeIcon },
  { key: "categories", href: "/categories", icon: GridIcon },
  { key: "cart", href: "/cart", icon: CartIcon },
  { key: "orders", href: "/account/orders", icon: ReceiptIcon },
  { key: "account", href: "/account", icon: UserIcon },
];

export async function BottomNav() {
  const t = await getTranslations("Nav");
  const locale = await getLocale();
  const count = await cartCount();
  return (
    <BottomNavTabs
      label={t("label")}
      tabs={TABS.map(({ key, href, icon: Icon }) => ({
        key,
        href: `/${locale}${href === "/" ? "" : href}`,
        icon: (
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
        ),
        text: (
          <>
            {t(key)}
            {key === "cart" && count > 0 && (
              <span className="sr-only">{t("cartCount", { count })}</span>
            )}
          </>
        ),
      }))}
    />
  );
}
