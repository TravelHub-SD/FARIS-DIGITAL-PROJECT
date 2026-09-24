import type { MetadataRoute } from "next";

import { routing } from "@/i18n/routing";
import { getSiteUrl } from "@/lib/env";
import { listSitemapEntries } from "@/server/catalog/queries";

// Only what an anonymous visitor can see (RLS): hidden items never leak here.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getSiteUrl();
  const { categories, products } = await listSitemapEntries();
  const entry = (
    path: string,
    lastModified?: string,
  ): MetadataRoute.Sitemap[number] => ({
    url: new URL(`/ar${path}`, base).toString(),
    lastModified,
    alternates: {
      languages: Object.fromEntries(
        routing.locales.map((l) => [
          l,
          new URL(`/${l}${path}`, base).toString(),
        ]),
      ),
    },
  });
  return [
    entry(""),
    ...categories.map((c) => entry(`/c/${c.slug}`)),
    ...products.map((p) => entry(`/p/${p.slug}`, p.updated_at)),
  ];
}
