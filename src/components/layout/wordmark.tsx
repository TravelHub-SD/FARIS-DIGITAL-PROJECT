import { getTranslations } from "next-intl/server";

import { Link } from "@/components/link";

// Text wordmark until the client delivers the logo (docs/decisions.md:
// client-side blockers). Swap the inner markup for the asset, keep the API.
export async function Wordmark() {
  const t = await getTranslations("Brand");
  return (
    <Link href="/" className="text-lg font-bold tracking-tight text-foreground">
      <span className="text-primary">{t("name")}</span>
    </Link>
  );
}
