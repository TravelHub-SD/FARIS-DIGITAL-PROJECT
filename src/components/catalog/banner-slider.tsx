import type { Locale } from "@/i18n/routing";
import { publicAssetUrl } from "@/lib/assets";
import { localized } from "@/lib/localized";
import type { Banner } from "@/server/catalog/queries";

import { L10n } from "./l10n";

// Promo slides from the dashboard. CSS scroll-snap only: no carousel library
// and no script; the next slide peeks in so it is clear there is more.
// Slides without an image get a brand gradient behind their title.
const BACKGROUNDS = [
  "bg-gradient-to-br from-[#0038a8] via-[#005cff] to-[#3d85ff] text-white",
  "bg-gradient-to-br from-[#ffb066] to-[#ff7a00] text-[#1a0d00]",
];

export function BannerSlider({
  banners,
  locale,
  label,
}: {
  banners: Banner[];
  locale: Locale;
  label: string;
}) {
  if (banners.length === 0) return null;
  const single = banners.length === 1;
  return (
    <section aria-label={label} data-testid="promo-banners">
      <ul
        tabIndex={0}
        className="no-scrollbar flex snap-x snap-mandatory scroll-px-4 gap-2.5 overflow-x-auto px-4 pb-1 outline-offset-2"
      >
        {banners.map((b, i) => {
          const title = localized(b.title_ar, b.title_en, locale);
          const subtitle = localized(b.subtitle_ar, b.subtitle_en, locale);
          const href = b.link?.startsWith("/") ? `/${locale}${b.link}` : b.link;
          const body = (
            <div
              className={`relative flex aspect-[2/1] flex-col justify-end overflow-hidden rounded-2xl p-4 sm:aspect-[3/1] ${
                b.image_path ? "bg-muted" : BACKGROUNDS[i % BACKGROUNDS.length]
              }`}
            >
              {b.image_path && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={publicAssetUrl(b.image_path)}
                  alt={title?.text ?? ""}
                  className="absolute inset-0 size-full object-cover"
                  loading={i === 0 ? "eager" : "lazy"}
                  decoding="async"
                />
              )}
              {!b.image_path && title && (
                <>
                  <L10n
                    value={title}
                    as="p"
                    className="text-xl leading-7 font-bold text-balance"
                  />
                  <L10n
                    value={subtitle}
                    as="p"
                    className="text-sm opacity-90"
                  />
                </>
              )}
            </div>
          );
          return (
            <li
              key={b.id}
              className={`shrink-0 snap-start ${single ? "w-full" : "w-[88%] sm:w-[70%] lg:w-[48%]"}`}
              data-testid="promo-banner"
            >
              {href ? (
                <a
                  href={href}
                  {...(href.startsWith("https://")
                    ? { target: "_blank", rel: "noopener noreferrer" }
                    : {})}
                  className="block rounded-2xl"
                >
                  {body}
                </a>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
