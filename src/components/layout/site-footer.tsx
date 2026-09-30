import { getLocale, getTranslations } from "next-intl/server";

import { L10n } from "@/components/catalog/l10n";
import { Link } from "@/components/link";
import type { Locale } from "@/i18n/routing";
import { localized } from "@/lib/localized";
import {
  getSiteSettings,
  listPublishedPages,
  SITE_PAGE_SLUGS,
} from "@/server/catalog/site";

// Contacts and social accounts are edited in the dashboard (Settings).
const NETWORKS = [
  ["facebook", "Facebook"],
  ["instagram", "Instagram"],
  ["x", "X"],
  ["telegram", "Telegram"],
] as const;

export async function SiteFooter() {
  const t = await getTranslations("Footer");
  const [locale, settings, pages] = await Promise.all([
    getLocale(),
    getSiteSettings(),
    listPublishedPages(),
  ]);
  // About / Terms / Privacy, in that order, once published in the dashboard.
  const pageLinks = SITE_PAGE_SLUGS.flatMap((slug) => {
    const page = pages.find((p) => p.slug === slug);
    const title =
      page && localized(page.title_ar, page.title_en, locale as Locale);
    return title ? [{ slug, title }] : [];
  });
  const year = new Date().getFullYear();
  const social = NETWORKS.filter(([key]) => settings.social_links?.[key]);
  const address =
    (locale as Locale) === "ar" ? settings.address_ar : settings.address_en;
  const whatsapp = settings.contact_whatsapp?.replace(/[^\d]/g, "");

  return (
    <footer data-testid="site-footer" className="border-t print:hidden">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 text-sm text-muted-foreground sm:grid-cols-2">
        <div className="grid content-start gap-2" data-testid="footer-contacts">
          {(settings.contact_phone ||
            whatsapp ||
            settings.contact_email ||
            address) && (
            <p className="font-medium text-foreground">{t("contactUs")}</p>
          )}
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {settings.contact_phone && (
              <li>
                <a
                  href={`tel:${settings.contact_phone.replace(/\s/g, "")}`}
                  dir="ltr"
                  className="hover:text-foreground"
                >
                  {settings.contact_phone}
                </a>
              </li>
            )}
            {whatsapp && (
              <li>
                <a
                  href={`https://wa.me/${whatsapp}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground"
                >
                  {t("whatsapp")}
                </a>
              </li>
            )}
            {settings.contact_email && (
              <li>
                <a
                  href={`mailto:${settings.contact_email}`}
                  dir="ltr"
                  className="hover:text-foreground"
                >
                  {settings.contact_email}
                </a>
              </li>
            )}
          </ul>
          {address && <p>{address}</p>}
          {pageLinks.length > 0 && (
            <nav aria-label={t("pages")} data-testid="footer-pages">
              <ul className="flex flex-wrap gap-x-4 gap-y-1">
                {pageLinks.map(({ slug, title }) => (
                  <li key={slug}>
                    <Link
                      href={`/${slug}`}
                      className="underline-offset-4 hover:text-foreground hover:underline"
                    >
                      <L10n value={title} />
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          <p>{t("rights", { year })}</p>
        </div>
        {social.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 sm:justify-end">
            <span>{t("followUs")}</span>
            <ul className="flex flex-wrap items-center gap-3">
              {social.map(([key, name]) => (
                <li key={key}>
                  <a
                    href={settings.social_links[key]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground"
                    dir="ltr"
                  >
                    {name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </footer>
  );
}
