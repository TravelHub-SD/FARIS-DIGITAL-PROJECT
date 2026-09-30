import type { Metadata } from "next";

import { SitePageView, sitePageMetadata } from "@/components/site/site-page";
import type { Locale } from "@/i18n/routing";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/about">): Promise<Metadata> {
  return sitePageMetadata("about", (await params).locale as Locale);
}

export default async function AboutPage({
  params,
}: PageProps<"/[locale]/about">) {
  return <SitePageView slug="about" locale={(await params).locale as Locale} />;
}
