"use client";

import NextLink, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

// Admin pages have no loading.tsx on purpose: a loading boundary makes Next
// stream the page, so a page that ends in notFound() (a section without the
// permission) would answer 200 instead of 404. The tapped link shows that the
// section is on its way instead (decisions.md 2026-09-26).
function Pending() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      data-pending={pending || undefined}
      className={cn(
        "size-1.5 shrink-0 rounded-full bg-current opacity-0 transition-opacity",
        pending && "animate-pulse opacity-100",
      )}
    />
  );
}

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
  const nav = useRef<HTMLElement>(null);
  // On phones the bar scrolls sideways; bring the current section to the
  // middle so it is never cut off at the edge. Physical coordinates, so the
  // same code works in RTL and LTR. No effect on the desktop sidebar.
  useEffect(() => {
    const bar = nav.current;
    const current = bar?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!bar || !current || bar.scrollWidth <= bar.clientWidth) return;
    const b = bar.getBoundingClientRect();
    const c = current.getBoundingClientRect();
    bar.scrollBy({ left: c.left + c.width / 2 - (b.left + b.width / 2) });
  }, [pathname]);
  return (
    <nav
      ref={nav}
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
                <Pending />
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
