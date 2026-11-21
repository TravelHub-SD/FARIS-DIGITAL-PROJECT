"use client";

import NextLink from "next/link";
import { usePathname } from "next/navigation";

// The current tab is worked out in the browser: the root layout that holds
// the bar is not rendered again on client navigation, so a tab chosen on the
// server stayed on the first page's (Categories tapped, Home still marked).
export type TabKey = "home" | "categories" | "cart" | "orders" | "account";

const MATCH: Record<TabKey, RegExp> = {
  home: /^\/(ar|en)\/?$/,
  categories: /^\/(ar|en)\/(categories|c\/|p\/)/,
  cart: /^\/(ar|en)\/(cart|checkout)/,
  orders: /^\/(ar|en)\/account\/(orders|invoices)/,
  account: /^\/(ar|en)\/(account(?!\/(orders|invoices))|login|register)/,
};

export function BottomNavTabs({
  label,
  tabs,
}: {
  label: string;
  tabs: {
    key: TabKey;
    href: string;
    icon: React.ReactNode;
    text: React.ReactNode;
  }[];
}) {
  const path = usePathname() ?? "";
  // The dashboard has its own navigation (also after a client navigation
  // from the shop, which keeps this layout).
  if (/^\/(ar|en)\/admin(\/|$)/.test(path)) return null;
  return (
    <nav
      aria-label={label}
      data-testid="bottom-nav"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden print:hidden"
    >
      <ul className="grid h-16 grid-cols-5">
        {tabs.map(({ key, href, icon, text }) => {
          const current = MATCH[key].test(path);
          return (
            <li key={key}>
              <NextLink
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
                {icon}
                {text}
              </NextLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
