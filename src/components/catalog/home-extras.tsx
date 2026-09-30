import { getTranslations } from "next-intl/server";

import type { Locale } from "@/i18n/routing";
import { localized } from "@/lib/localized";
import type { PublicFaq } from "@/server/catalog/site";

import { L10n } from "./l10n";

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
