import NextLink from "next/link";
import { getLocale } from "next-intl/server";
import type { ComponentProps } from "react";

import type { Locale } from "@/i18n/routing";

type Props = Omit<ComponentProps<typeof NextLink>, "href"> & {
  href: string;
  locale?: Locale;
};

/**
 * Locale-prefixed link for SERVER components. Renders Next's own <Link>
 * (already in the runtime), so pages do not need next-intl's client runtime
 * (≈12 KB gzip) just to prefix "/ar" or "/en". Client components keep using
 * @/i18n/navigation under a NextIntlClientProvider.
 */
export async function Link({ href, locale, ...props }: Props) {
  const l = locale ?? ((await getLocale()) as Locale);
  const path = href === "/" ? "" : href;
  return <NextLink href={`/${l}${path}`} {...props} />;
}
