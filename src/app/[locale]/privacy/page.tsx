import type { Metadata } from "next";

import { SitePageView, sitePageMetadata } from "@/components/site/site-page";
import type { Locale } from "@/i18n/routing";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/privacy">): Promise<Metadata> {
  return sitePageMetadata("privacy", (await params).locale as Locale);
}

export default async function PrivacyPage({
  params,
}: PageProps<"/[locale]/privacy">) {
  return (
    <SitePageView slug="privacy" locale={(await params).locale as Locale} />
  );
}
