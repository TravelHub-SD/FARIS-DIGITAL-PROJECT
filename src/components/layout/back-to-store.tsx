import { getTranslations } from "next-intl/server";

import { BackArrowIcon } from "@/components/icons";
import { Link } from "@/components/link";

// Top of every customer page outside the storefront (account, orders,
// invoices, KYC, cart, checkout). It scrolls with the page: on phones the
// bottom bar stays the only fixed navigation. Not printed (invoices).
export async function BackToStore() {
  const t = await getTranslations("Nav");
  return (
    <Link
      href="/"
      data-testid="back-to-store"
      className="-ms-2 inline-flex min-h-11 items-center gap-1.5 justify-self-start rounded-lg px-2 text-sm font-bold text-primary-text hover:bg-primary-soft print:hidden"
    >
      <BackArrowIcon className="size-4" />
      {t("backToStore")}
    </Link>
  );
}
