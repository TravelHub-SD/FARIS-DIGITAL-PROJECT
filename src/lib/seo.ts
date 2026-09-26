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

/**
 * Search engines may index this deployment only when it is Vercel production
 * on its own domain. Staging (a *.vercel.app address), previews and local
 * runs answer robots.txt with "Disallow: /" and mark every page noindex, so a
 * copy of the shop with demo data can never compete with the real one.
 */
export function isIndexable(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.VERCEL_ENV !== "production") return false;
  try {
    const host = new URL(env.NEXT_PUBLIC_SITE_URL ?? "").hostname;
    return host !== "" && !host.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

/** Shared brand image for link previews (public/og.png, 1200×630). */
export const DEFAULT_OG_IMAGE = {
  url: "/og.png",
  width: 1200,
  height: 630,
  alt: "Faris Digital · فارس ديجيتال",
};

/** Open Graph for an indexable page; page-level openGraph replaces the layout's. */
export function openGraph(
  locale: Locale,
  page: {
    siteName: string;
    title: string;
    description?: string;
    path: string;
    image?: string | null;
  },
): Metadata["openGraph"] {
  const suffix = page.path === "/" ? "" : page.path;
  return {
    type: "website",
    siteName: page.siteName,
    title: page.title,
    description: page.description,
    url: `/${locale}${suffix}`,
    locale: ogLocale(locale),
    alternateLocale: ogLocale(locale === "ar" ? "en" : "ar"),
    images: page.image
      ? [{ url: page.image, alt: page.title }]
      : [DEFAULT_OG_IMAGE],
  };
}
