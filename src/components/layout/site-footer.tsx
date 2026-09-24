import { getLocale, getTranslations } from "next-intl/server";

import type { Locale } from "@/i18n/routing";
import { getSiteSettings } from "@/server/catalog/site";

// Contacts and social accounts are edited in the dashboard (Settings).
const NETWORKS = [
  ["facebook", "Facebook"],
  ["instagram", "Instagram"],
  ["x", "X"],
  ["telegram", "Telegram"],
] as const;

export async function SiteFooter() {
  const t = await getTranslations("Footer");
  const [locale, settings] = await Promise.all([
    getLocale(),
    getSiteSettings(),
  ]);
  const year = new Date().getFullYear();
  const social = NETWORKS.filter(([key]) => settings.social_links?.[key]);
  const address =
    (locale as Locale) === "ar" ? settings.address_ar : settings.address_en;
  const whatsapp = settings.contact_whatsapp?.replace(/[^\d]/g, "");

  return (
    <footer className="border-t">
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
