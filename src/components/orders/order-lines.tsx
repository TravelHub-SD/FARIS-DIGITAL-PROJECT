import { getTranslations } from "next-intl/server";

import { L10n } from "@/components/catalog/l10n";
import type { Locale } from "@/i18n/routing";
import { formatSdg } from "@/lib/format";
import { localized } from "@/lib/localized";
import type { OrderLine } from "@/server/orders/queries";

// The lines of one order with the details each one was ordered with. Used by
// the customer's order page and the admin order page. Sensitive values that
// were removed when the order closed show as "removed".
export async function OrderLines({
  items,
  locale,
  closed,
}: {
  items: OrderLine[];
  locale: Locale;
  closed: boolean;
}) {
  const t = await getTranslations("Orders");
  return (
    <ol className="grid divide-y" data-testid="order-lines">
      {items.map((line) => (
        <li
          key={line.line_no}
          className="grid gap-1 py-3 text-sm first:pt-0 last:pb-0"
          data-testid="order-line"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p>
              <L10n
                value={localized(
                  line.product_name_ar,
                  line.product_name_en,
                  locale,
                )}
                className="font-medium"
              />{" "}
              —{" "}
              <L10n
                value={localized(
                  line.variant_name_ar,
                  line.variant_name_en,
                  locale,
                )}
              />{" "}
              <span className="text-muted-foreground">
                × <span data-testid="line-quantity">{line.quantity}</span>
              </span>
            </p>
            <span className="font-medium" dir="auto" data-testid="line-total">
              {formatSdg(line.line_total_sdg, locale)}
            </span>
          </div>
          {line.fulfillment_fields.length > 0 && (
            <dl className="grid gap-0.5">
              {line.fulfillment_fields.map((f) => {
                const value = line.fulfillment_data[f.key];
                if (value === undefined && !(closed && f.sensitive))
                  return null;
                return (
                  <div key={f.key} className="flex flex-wrap gap-2">
                    <dt className="text-muted-foreground">
                      <L10n value={localized(f.label_ar, f.label_en, locale)} />
                      :
                    </dt>
                    <dd dir="auto" className="wrap-anywhere">
                      {value ?? t("removed")}
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
        </li>
      ))}
    </ol>
  );
}
