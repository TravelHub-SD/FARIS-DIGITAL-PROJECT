import { getTranslations } from "next-intl/server";

import type { Locale } from "@/i18n/routing";
import { publicAssetUrl } from "@/lib/assets";
import { localized } from "@/lib/localized";
import type { PublicFaq, SiteSettings } from "@/server/catalog/site";

import { L10n } from "./l10n";

/** Promo banner from Settings; nothing when inactive or empty. */
export function PromoBanner({
  settings,
  locale,
}: {
  settings: SiteSettings;
  locale: Locale;
}) {
  const title = localized(
    settings.banner_title_ar,
    settings.banner_title_en,
    locale,
  );
  if (!settings.banner_is_active || (!title && !settings.banner_image_path))
    return null;
  const link = settings.banner_link;
  const href = link?.startsWith("/") ? `/${locale}${link}` : link;
  const body = (
    <div className="relative overflow-hidden rounded-xl border bg-primary text-primary-foreground">
      {settings.banner_image_path && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={publicAssetUrl(settings.banner_image_path)}
          alt={title?.text ?? ""}
          className="aspect-[4/1] w-full object-cover"
          loading="eager"
        />
      )}
      {title && !settings.banner_image_path && (
        <L10n
          value={title}
          as="p"
          className="p-5 text-lg font-bold sm:text-xl"
        />
      )}
    </div>
  );
  return (
    <section
      className="mx-auto w-full max-w-6xl px-4 pt-6"
      data-testid="promo-banner"
    >
      {href ? (
        <a
          href={href}
          {...(href.startsWith("https://")
            ? { target: "_blank", rel: "noopener noreferrer" }
            : {})}
          className="block transition-opacity hover:opacity-90"
        >
          {body}
        </a>
      ) : (
        body
      )}
    </section>
  );
}

/** FAQ section: native <details>, no client JavaScript. */
export async function FaqSection({
  faqs,
  locale,
}: {
  faqs: PublicFaq[];
  locale: Locale;
}) {
  const t = await getTranslations("Home");
  const items = faqs
    .map((f) => ({
      id: f.id,
      q: localized(f.question_ar, f.question_en, locale),
      a: localized(f.answer_ar, f.answer_en, locale),
    }))
    .filter((f) => f.q && f.a);
  if (items.length === 0) return null;
  return (
    <section
      aria-labelledby="faq"
      className="grid gap-4"
      data-testid="faq-section"
    >
      <h2 id="faq" className="text-xl font-bold">
        {t("faq")}
      </h2>
      <div className="grid gap-2">
        {items.map((f) => (
          <details key={f.id} className="group rounded-lg border bg-card p-4">
            <summary className="cursor-pointer font-medium">
              <L10n value={f.q} />
            </summary>
            <L10n
              value={f.a}
              as="p"
              className="mt-3 text-sm leading-relaxed wrap-anywhere whitespace-pre-line text-muted-foreground"
            />
          </details>
        ))}
      </div>
    </section>
  );
}
