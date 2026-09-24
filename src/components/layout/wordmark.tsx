import { getTranslations } from "next-intl/server";

import { Link } from "@/components/link";
import { publicAssetUrl } from "@/lib/assets";
import { getSiteSettings } from "@/server/catalog/site";

// The logo uploaded in Settings when there is one; the text wordmark until
// the client delivers it (docs/decisions.md: client-side blockers).
export async function Wordmark() {
  const t = await getTranslations("Brand");
  const settings = await getSiteSettings();
  return (
    <Link
      href="/"
      className="flex items-center text-lg font-bold tracking-tight text-foreground"
    >
      {settings.logo_path ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={publicAssetUrl(settings.logo_path)}
          alt={t("name")}
          className="h-8 w-auto"
          data-testid="site-logo"
        />
      ) : (
        <span className="text-primary">{t("name")}</span>
      )}
    </Link>
  );
}
