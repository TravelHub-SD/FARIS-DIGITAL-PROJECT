"use client";

import { useTheme } from "next-themes";

import { buttonVariants } from "@/components/ui/button-variants";

// Rendered on every page, so it stays tiny: inline SVG (no icon library) and
// a plain button (no Radix Slot / tailwind-merge). Icons swap via the `dark`
// class, so server and client markup match with no flash.
export function ThemeToggle({ label }: { label: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const icon =
    "size-4 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]";
  return (
    <button
      type="button"
      className={buttonVariants({ variant: "ghost", size: "icon" })}
      aria-label={label}
      title={label}
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <svg viewBox="0 0 24 24" aria-hidden className={`${icon} dark:hidden`}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </svg>
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        className={`${icon} hidden dark:block`}
      >
        <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
      </svg>
    </button>
  );
}
