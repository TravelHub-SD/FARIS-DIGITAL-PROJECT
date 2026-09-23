import { getTranslations, setRequestLocale } from "next-intl/server";

import type { Locale } from "@/i18n/routing";

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  // Validated by the locale layout, which 404s unknown locales.
  setRequestLocale(locale as Locale);
  const t = await getTranslations("Home");

  return (
    <section className="relative overflow-hidden border-b">
      <div
        aria-hidden
        className="pointer-events-none absolute start-1/2 -top-24 size-[36rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl rtl:translate-x-1/2"
      />
      <div className="relative mx-auto max-w-6xl px-4 py-20 sm:py-28">
        <h1 className="max-w-2xl text-3xl leading-tight font-bold text-balance sm:text-5xl">
          {t("title")}
        </h1>
        <p className="mt-5 max-w-xl text-base text-pretty text-muted-foreground sm:text-lg">
          {t("subtitle")}
        </p>
        <div className="mt-8 flex items-center gap-2">
          <span className="h-1.5 w-12 rounded-full bg-primary" />
          <span className="h-1.5 w-4 rounded-full bg-highlight" />
        </div>
      </div>
    </section>
  );
}
