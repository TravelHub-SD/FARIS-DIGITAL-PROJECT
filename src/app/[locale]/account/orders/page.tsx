import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { L10n } from "@/components/catalog/l10n";
import { Link } from "@/components/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {orders.length === 0 ? (
          <div className="grid justify-items-start gap-3">
            <p className="text-muted-foreground">{t("empty")}</p>
            <Link href="/" className={buttonVariants({ size: "sm" })}>
              {t("browse")}
            </Link>
          </div>
        ) : (
          <ul className="divide-y" data-testid="orders-list">
            {orders.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/account/orders/${o.reference}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 hover:bg-muted/50"
                >
                  <span className="grid gap-0.5">
                    <span className="font-medium" dir="ltr">
                      {o.reference}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      <L10n
                        value={localized(
                          o.product_name_ar,
                          o.product_name_en,
                          locale,
                        )}
                      />{" "}
                      ×{o.quantity} · {formatDateTime(o.created_at, locale)}
                    </span>
                  </span>
                  <span className="grid justify-items-end gap-0.5 text-sm">
                    <span className="font-medium" dir="auto">
                      {formatSdg(o.total_sdg, locale)}
                    </span>
                    <span data-status={o.status}>
                      {t(`statuses.${o.status}`)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
