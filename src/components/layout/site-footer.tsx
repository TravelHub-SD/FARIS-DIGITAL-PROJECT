import { getTranslations } from "next-intl/server";

import { siteConfig } from "@/lib/site";

const socialLinks = [
  { name: "Facebook", href: siteConfig.social.facebook },
  { name: "Instagram", href: siteConfig.social.instagram },
  { name: "X", href: siteConfig.social.x },
  { name: "Telegram", href: siteConfig.social.telegram },
] as const;

export async function SiteFooter() {
  const t = await getTranslations("Footer");
  const year = new Date().getFullYear();

  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>{t("rights", { year })}</p>
        <div className="flex items-center gap-3">
          <span>{t("followUs")}</span>
          <ul className="flex flex-wrap items-center gap-3">
            {socialLinks.map((link) => (
              <li key={link.name}>
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground"
                  dir="ltr"
                >
                  {link.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
