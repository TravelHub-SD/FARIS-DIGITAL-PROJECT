import { randomUUID } from "node:crypto";

import { type APIRequestContext, expect, test } from "@playwright/test";

import { createFixtures, type Fixtures } from "../integration/catalog-fixtures";

// Sitemap, structured data and link metadata, validated against what the
// pages really serve. Fixtures add a visible product next to hidden,
// inactive, archived and variant-less ones in the same category; none of the
// latter may appear anywhere a crawler looks.

let fx: Fixtures;
test.beforeAll(async () => {
  fx = await createFixtures(`seo${randomUUID().slice(0, 6)}`);
});

const hiddenSlugs = () => [
  fx.slugs.hiddenCat,
  fx.slugs.inHiddenCat,
  fx.slugs.inactive,
  fx.slugs.archived,
  fx.slugs.noVariants,
];

/** Absolute site URLs point at NEXT_PUBLIC_SITE_URL; fetch them locally. */
const localPath = (url: string) => {
  const u = new URL(url);
  return u.pathname + u.search;
};

async function status(request: APIRequestContext, url: string) {
  return (await request.get(localPath(url), { maxRedirects: 0 })).status();
}

type Head = {
  canonical: string[];
  alternates: Record<string, string>;
  robots: string | null;
  og: Record<string, string>;
  jsonLd: Record<string, unknown>[];
};

async function head(request: APIRequestContext, path: string): Promise<Head> {
  const res = await request.get(path);
  expect(res.status(), path).toBe(200);
  const html = await res.text();
  const attr = (tag: string, name: string) =>
    new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? "";
  const tags = (re: RegExp) => html.match(re) ?? [];
  const unescape = (s: string) =>
    s.replace(/&amp;/g, "&").replace(/&quot;/g, '"');
  return {
    canonical: tags(/<link rel="canonical"[^>]*>/g).map((t) => attr(t, "href")),
    alternates: Object.fromEntries(
      tags(/<link rel="alternate" hrefLang="[^"]+"[^>]*>/g).map((t) => [
        attr(t, "hrefLang"),
        attr(t, "href"),
      ]),
    ),
    robots:
      tags(/<meta name="robots"[^>]*>/g).map((t) => attr(t, "content"))[0] ??
      null,
    og: Object.fromEntries(
      tags(/<meta property="og:[^"]+" content="[^"]*"\/>/g).map((t) => [
        attr(t, "property"),
        unescape(attr(t, "content")),
      ]),
    ),
    jsonLd: [
      ...html.matchAll(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
      ),
    ].flatMap((m) => [JSON.parse(m[1])].flat()),
  };
}

// Required and recommended properties per Google's rich-result docs
// (Product snippets, Breadcrumb, Organization, sitelinks search box).
function validate(node: Record<string, unknown>, errors: string[]) {
  const type = node["@type"];
  const need = (cond: unknown, msg: string) => {
    if (!cond) errors.push(`${type}: ${msg}`);
  };
  need(node["@context"] === "https://schema.org", "@context");
  const isAbs = (u: unknown) =>
    typeof u === "string" && /^https?:\/\/[^/]+\//.test(u);
  switch (type) {
    case "Product": {
      const offers = node.offers as Record<string, unknown> | undefined;
      need(typeof node.name === "string" && node.name, "name");
      need(isAbs(node.url), "absolute url");
      need(offers?.["@type"] === "AggregateOffer", "AggregateOffer");
      need(offers?.priceCurrency === "SDG", "priceCurrency SDG");
      need(Number(offers?.lowPrice) > 0, "lowPrice > 0");
      need(
        Number(offers?.highPrice) >= Number(offers?.lowPrice),
        "highPrice >= lowPrice",
      );
      need(Number.isInteger(offers?.offerCount), "offerCount");
      break;
    }
    case "BreadcrumbList": {
      const items = node.itemListElement as Record<string, unknown>[];
      need(items?.length >= 2, "at least 2 items");
      items?.forEach((it, i) => {
        need(it.position === i + 1, `position ${i + 1}`);
        need(typeof it.name === "string" && it.name, `name ${i + 1}`);
        need(isAbs(it.item), `absolute item ${i + 1}`);
      });
      break;
    }
    case "ItemList": {
      const items = node.itemListElement as Record<string, unknown>[];
      need(items?.length === node.numberOfItems, "numberOfItems");
      items?.forEach((it, i) => need(isAbs(it.url), `absolute url ${i + 1}`));
      break;
    }
    case "Organization":
      need(typeof node.name === "string" && node.name, "name");
      need(isAbs(node.url), "absolute url");
      break;
    case "WebSite": {
      const action = node.potentialAction as Record<string, unknown>;
      const target = action?.target as Record<string, string>;
      need(action?.["@type"] === "SearchAction", "SearchAction");
      need(
        target?.urlTemplate?.includes("{search_term_string}"),
        "urlTemplate placeholder",
      );
      need(
        action?.["query-input"] === "required name=search_term_string",
        "query-input",
      );
      break;
    }
    default:
      errors.push(`unexpected @type ${String(type)}`);
  }
}

const allUrls = (value: unknown): string[] =>
  typeof value === "string"
    ? /^https?:\/\//.test(value)
      ? [value]
      : []
    : Array.isArray(value)
      ? value.flatMap(allUrls)
      : value && typeof value === "object"
        ? Object.values(value).flatMap(allUrls)
        : [];

test("sitemap: valid, reciprocal hreflang, every URL live, hidden items absent", async ({
  request,
  page,
}) => {
  const res = await request.get("/sitemap.xml");
  expect(res.headers()["content-type"]).toContain("xml");
  const xml = await res.text();
  await page.goto("/ar");
  const entries = await page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.querySelector("parsererror")) return null;
    const root = doc.documentElement;
    return {
      ns: root.namespaceURI,
      root: root.localName,
      urls: [...root.children].map((u) => ({
        loc: u.getElementsByTagName("loc")[0]?.textContent ?? "",
        lastmod: u.getElementsByTagName("lastmod")[0]?.textContent ?? null,
        alternates: Object.fromEntries(
          [
            ...u.getElementsByTagNameNS("http://www.w3.org/1999/xhtml", "link"),
          ].map((l) => [l.getAttribute("hreflang"), l.getAttribute("href")]),
        ),
      })),
    };
  }, xml);
  expect(entries, "well-formed XML").not.toBeNull();
  expect(entries!.root).toBe("urlset");
  expect(entries!.ns).toBe("http://www.sitemaps.org/schemas/sitemap/0.9");
  const locs = entries!.urls.map((u) => u.loc);
  expect(new Set(locs).size, "no duplicate <loc>").toBe(locs.length);
  expect(locs.some((l) => l.endsWith(`/ar/p/${fx.slugs.ok}`))).toBe(true);
  expect(locs.some((l) => l.endsWith(`/ar/c/${fx.slugs.visibleCat}`))).toBe(
    true,
  );
  for (const slug of hiddenSlugs()) expect(xml, slug).not.toContain(slug);

  let checked = 0;
  for (const u of entries!.urls) {
    expect(Object.keys(u.alternates).sort(), u.loc).toEqual([
      "ar",
      "en",
      "x-default",
    ]);
    expect(u.alternates.ar).toBe(u.loc);
    expect(u.alternates["x-default"]).toBe(u.loc);
    if (u.lastmod) expect(Number.isNaN(Date.parse(u.lastmod))).toBe(false);
    for (const url of [u.alternates.ar, u.alternates.en]) {
      expect(await status(request, url), url).toBe(200);
      // Reciprocal: the page names itself canonical and lists both languages.
      const h = await head(request, localPath(url));
      expect(h.canonical, url).toEqual([url]);
      expect(h.alternates.ar, url).toBe(u.alternates.ar);
      expect(h.alternates.en, url).toBe(u.alternates.en);
      checked++;
    }
  }
  console.log(
    `[demo] sitemap: ${entries!.urls.length} entries, ${checked} URLs live with reciprocal hreflang + self canonical; hidden slugs absent: ${hiddenSlugs().length}/${hiddenSlugs().length}`,
  );
});

test("structured data: valid on home, category and product; hidden items absent", async ({
  request,
}) => {
  const pages = ["ar", "en"].flatMap((l) => [
    `/${l}`,
    `/${l}/c/${fx.slugs.visibleCat}`,
    `/${l}/p/${fx.slugs.ok}`,
  ]);
  const summary: string[] = [];
  for (const path of pages) {
    const h = await head(request, path);
    const errors: string[] = [];
    h.jsonLd.forEach((node) => validate(node, errors));
    expect(errors, path).toEqual([]);
    const types = h.jsonLd.map((n) => n["@type"]);
    const json = JSON.stringify(h.jsonLd);
    for (const slug of hiddenSlugs())
      expect(json, `${path} ${slug}`).not.toContain(slug);
    // Every URL it names is live.
    for (const url of new Set(allUrls(h.jsonLd))) {
      if (new URL(url).pathname.includes("{")) continue; // search template
      if (!url.startsWith(new URL(h.canonical[0]).origin)) continue; // storage
      expect(await status(request, url), `${path} → ${url}`).toBe(200);
    }
    // Open Graph: absolute URL, locale, and an image that loads.
    expect(h.og["og:url"], path).toBe(h.canonical[0]);
    expect(h.og["og:locale"]).toBe(path.startsWith("/ar") ? "ar_SD" : "en_US");
    expect(await status(request, h.og["og:image"]), "og:image").toBe(200);
    summary.push(`${path}: ${types.join("+")}`);
  }
  const category = await head(request, `/en/c/${fx.slugs.visibleCat}`);
  const list = category.jsonLd.find((n) => n["@type"] === "ItemList")!;
  expect(JSON.stringify(list)).toContain(`/en/p/${fx.slugs.ok}`);
  console.log(`[demo] JSON-LD valid, 0 errors:\n  ${summary.join("\n  ")}`);
});

test("private pages: noindex and no canonical; robots.txt closes non-production deployments", async ({
  request,
}) => {
  for (const path of [
    "/ar/login",
    "/en/register",
    "/ar/reset-password",
    "/en/search?q=x",
  ]) {
    const h = await head(request, path);
    expect(h.robots, path).toContain("noindex");
    expect(h.canonical, `${path} must not claim a canonical`).toEqual([]);
  }
  // Local and staging are not Vercel production on their own domain.
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toMatch(/User-Agent: \*\nDisallow: \/\n/);
  expect(robots).not.toContain("Sitemap:");
  const home = await head(request, "/ar");
  expect(home.robots).toBe("noindex, nofollow");
});
