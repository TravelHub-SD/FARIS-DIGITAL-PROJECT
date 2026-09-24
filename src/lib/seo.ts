import type { Metadata } from "next";

import type { Locale } from "@/i18n/routing";

/** Canonical + hreflang for a locale-independent path ("/p/pubg-uc"). */
export function alternates(
  locale: Locale,
  path: string,
): Metadata["alternates"] {
  const suffix = path === "/" ? "" : path;
  return {
    canonical: `/${locale}${suffix}`,
    languages: {
      ar: `/ar${suffix}`,
      en: `/en${suffix}`,
      "x-default": `/ar${suffix}`,
    },
  };
}

export const ogLocale = (locale: Locale) =>
  locale === "ar" ? "ar_SD" : "en_US";

/** JSON for <script type="application/ld+json">, safe against "</script>". */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** First ~160 chars of a description, on a word boundary. */
export function metaDescription(
  text: string | null | undefined,
): string | undefined {
  if (!text) return undefined;
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 160) return clean;
  return clean.slice(0, 157).replace(/\s+\S*$/, "") + "…";
}
