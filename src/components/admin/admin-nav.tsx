"use client";

import NextLink from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

// Shows only the sections this admin may open. Hiding a link is a
// convenience, never the protection: every page and action checks again.
export function AdminNav({
  items,
  label,
}: {
  items: {
    href: string;
    label: string;
    exact?: boolean;
    badge?: number | null;
  }[];
  label: string;
}) {
  const pathname = usePathname();
  return (
    <nav
      aria-label={label}
      className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0"
    >
      <ul className="flex gap-1 lg:flex-col">
        {items.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <NextLink
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {item.label}
                {item.badge ? (
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-xs font-bold",
                      active
                        ? "bg-primary-foreground text-primary"
                        : "bg-highlight text-highlight-foreground",
                    )}
                  >
                    {item.badge}
                  </span>
                ) : null}
              </NextLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
