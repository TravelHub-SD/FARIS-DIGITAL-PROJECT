import type { Locale } from "@/i18n/routing";

// Bilingual content (paired _ar/_en columns). The requested language wins;
// otherwise the other language is used and flagged as a fallback so it can be
// rendered with the right lang/dir attributes (correct shaping, bidi and
// screen-reader pronunciation).
export type LocalizedText = { text: string; lang: Locale; fallback: boolean };

export function localized(
  ar: string | null | undefined,
  en: string | null | undefined,
  locale: Locale,
): LocalizedText | null {
  const primary = locale === "ar" ? ar : en;
  if (primary && primary.trim())
    return { text: primary, lang: locale, fallback: false };
  const other = locale === "ar" ? en : ar;
  if (other && other.trim())
    return { text: other, lang: locale === "ar" ? "en" : "ar", fallback: true };
  return null;
}

export const dirOf = (lang: Locale) => (lang === "ar" ? "rtl" : "ltr");
