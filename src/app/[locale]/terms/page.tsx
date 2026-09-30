import type { Metadata } from "next";

import { SitePageView, sitePageMetadata } from "@/components/site/site-page";
import type { Locale } from "@/i18n/routing";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/terms">): Promise<Metadata> {
  return sitePageMetadata("terms", (await params).locale as Locale);
}

export default async function TermsPage({
  params,
}: PageProps<"/[locale]/terms">) {
  return <SitePageView slug="terms" locale={(await params).locale as Locale} />;
}
