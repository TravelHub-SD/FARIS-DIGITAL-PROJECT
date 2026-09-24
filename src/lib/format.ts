import type { Locale } from "@/i18n/routing";

// Prices use Latin digits in both languages: customers copy amounts into
// banking apps and WhatsApp (decisions: Phase 0 §0).
export function formatSdg(
  amount: number | string | null | undefined,
  locale: Locale,
): string | null {
  if (amount === null || amount === undefined) return null;
  return new Intl.NumberFormat(locale === "ar" ? "ar-SD-u-nu-latn" : "en-SD", {
    style: "currency",
    currency: "SDG",
    currencyDisplay: locale === "ar" ? "symbol" : "code",
    maximumFractionDigits: 0,
  }).format(Number(amount));
}

export function formatUsd(
  amount: number | string | null | undefined,
  locale: Locale,
): string | null {
  if (amount === null || amount === undefined) return null;
  return new Intl.NumberFormat(locale === "ar" ? "ar-SD-u-nu-latn" : "en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(Number(amount));
}

/** Date and time in Khartoum, Latin digits (same reason as prices). */
export function formatDateTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(
    locale === "ar" ? "ar-SD-u-nu-latn" : "en-GB",
    {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Africa/Khartoum",
    },
  ).format(new Date(iso));
}
