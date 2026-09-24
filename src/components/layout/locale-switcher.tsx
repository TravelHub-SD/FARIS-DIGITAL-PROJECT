"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { buttonVariants } from "@/components/ui/button-variants";

// Swaps the /ar|/en prefix of the current path. Uses Next's own navigation
// hooks (already in the runtime) instead of next-intl's client runtime, so
// public pages ship no translation/formatting library.
export function LocaleSwitcher({
  label,
  target,
}: {
  label: string;
  target: "ar" | "en";
}) {
  const pathname = usePathname() ?? "/";
  const href = pathname.replace(/^\/(ar|en)(?=\/|$)/, `/${target}`);
  return (
    <Link
      href={href === pathname ? `/${target}` : href}
      hrefLang={target}
      lang={target}
      className={buttonVariants({ variant: "ghost", size: "sm" })}
    >
      {label}
    </Link>
  );
}
