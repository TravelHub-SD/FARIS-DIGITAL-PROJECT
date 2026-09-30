import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { L10n } from "@/components/catalog/l10n";
import { Link } from "@/components/link";
import { StatusChip } from "@/components/orders/status-chip";
import { buttonVariants } from "@/components/ui/button-variants";
import type { Locale } from "@/i18n/routing";
import { formatDateTime, formatSdg } from "@/lib/format";
import { localized } from "@/lib/localized";
import { requireCompleteUser } from "@/server/auth/session";
import { listMyOrders } from "@/server/orders/queries";

export const metadata: Metadata = { robots: { index: false } };

export default async function OrdersPage({
  params,
}: PageProps<"/[locale]/account/orders">) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  const user = await requireCompleteUser(locale);
  const t = await getTranslations("Orders");
  const orders = await listMyOrders(user.id);

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      {orders.length === 0 ? (
        <div className="grid justify-items-center gap-3 rounded-2xl border bg-card px-4 py-10 text-center">
          <p className="text-muted-foreground">{t("empty")}</p>
          <Link href="/" className={buttonVariants({ size: "xl" })}>
            {t("browse")}
          </Link>
        </div>
      ) : (
        <ul className="grid gap-2.5" data-testid="orders-list">
          {orders.map((o) => (
            <li key={o.id}>
              <Link
                href={`/account/orders/${o.reference}`}
                className="grid gap-1.5 rounded-2xl border bg-card p-3.5 transition-colors hover:border-primary/50"
              >
                <span className="flex items-center justify-between gap-2">
                  <bdi dir="ltr" className="font-bold">
                    {o.reference}
                  </bdi>
                  <StatusChip status={o.status} />
                </span>
                <span className="text-sm">
                  <L10n
                    value={localized(
                      o.items[0]?.product_name_ar ?? null,
                      o.items[0]?.product_name_en ?? null,
                      locale,
                    )}
                  />{" "}
                  ×{o.items[0]?.quantity}
                  {o.items.length > 1 &&
                    ` ${t("moreItems", { count: o.items.length - 1 })}`}
                </span>
                <span className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">
                    {formatDateTime(o.created_at, locale)}
                  </span>
                  <span className="font-bold" dir="auto">
                    {formatSdg(o.total_sdg, locale)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
