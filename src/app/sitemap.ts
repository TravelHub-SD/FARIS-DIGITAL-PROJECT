import type { MetadataRoute } from "next";

import { routing } from "@/i18n/routing";
import { getSiteUrl } from "@/lib/env";
import { listSitemapEntries } from "@/server/catalog/queries";
import { listPublishedPages } from "@/server/catalog/site";

// Only what an anonymous visitor can see (RLS): hidden items never leak here.
// Rendered per request from the shared catalog cache, so a dashboard save
// (updateTag "catalog") reaches the sitemap at once, like the pages.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getSiteUrl();
  const [{ categories, products }, pages] = await Promise.all([
    listSitemapEntries(),
    listPublishedPages(),
  ]);
  const entry = (
    path: string,
    lastModified?: string,
  ): MetadataRoute.Sitemap[number] => ({
    url: new URL(`/ar${path}`, base).toString(),
    lastModified,
    alternates: {
      languages: {
        ...Object.fromEntries(
          routing.locales.map((l) => [
            l,
            new URL(`/${l}${path}`, base).toString(),
          ]),
        ),
        "x-default": new URL(`/ar${path}`, base).toString(),
      },
    },
  });
  return [
    entry(""),
    ...categories.map((c) => entry(`/c/${c.slug}`)),
    ...products.map((p) => entry(`/p/${p.slug}`, p.updated_at)),
    ...pages.map((p) => entry(`/${p.slug}`, p.updated_at)),
  ];
}
