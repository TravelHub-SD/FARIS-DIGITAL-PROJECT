import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { L10n } from "@/components/catalog/l10n";
import { type Locale } from "@/i18n/routing";
import { dirOf, localized } from "@/lib/localized";
import { alternates, metaDescription, openGraph } from "@/lib/seo";
import { listPublishedPages, type SitePageSlug } from "@/server/catalog/site";

// About / Terms / Privacy: texts written by the client in the dashboard
// (Pages). Plain text only: paragraphs are separated by an empty line and
// line breaks are kept. Nothing is interpreted as HTML or Markdown, so a
// pasted tag is shown as text. Unpublished pages are a 404.

async function findPage(slug: SitePageSlug) {
  return (await listPublishedPages()).find((p) => p.slug === slug) ?? null;
}

export async function sitePageMetadata(
  slug: SitePageSlug,
  locale: Locale,
): Promise<Metadata> {
  const page = await findPage(slug);
  if (!page) return {};
  const title = localized(page.title_ar, page.title_en, locale)?.text ?? "";
  const description = metaDescription(
    localized(page.body_ar, page.body_en, locale)?.text,
  );
  return {
    title,
    description,
    alternates: alternates(locale, `/${slug}`),
    openGraph: openGraph(locale, {
      siteName: (await getTranslations({ locale, namespace: "Metadata" }))(
        "title",
      ),
      title,
      description,
      path: `/${slug}`,
    }),
  };
}

export async function SitePageView({
  slug,
  locale,
}: {
  slug: SitePageSlug;
  locale: Locale;
}) {
  setRequestLocale(locale);
  const page = await findPage(slug);
  if (!page) notFound();
  const title = localized(page.title_ar, page.title_en, locale);
  const body = localized(page.body_ar, page.body_en, locale);
  const paragraphs = (body?.text ?? "")
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <article
      className="mx-auto grid w-full max-w-3xl gap-6 px-4 py-10 sm:py-14"
      data-testid={`site-page-${slug}`}
    >
      <L10n
        as="h1"
        value={title}
        className="text-3xl leading-tight font-bold text-balance"
      />
      <div
        className="grid gap-4 leading-relaxed wrap-anywhere whitespace-pre-line"
        lang={body?.fallback ? body.lang : undefined}
        dir={body?.fallback ? dirOf(body.lang) : undefined}
      >
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
    </article>
  );
}
