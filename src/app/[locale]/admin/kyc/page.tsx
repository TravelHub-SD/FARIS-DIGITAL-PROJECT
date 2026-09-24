import type { Metadata } from "next";
import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { KycDocTypeKey } from "@/i18n/keys";
import { Link } from "@/components/link";
import type { Locale } from "@/i18n/routing";
import { formatPhone } from "@/lib/phone";
import { requireAdmin } from "@/server/auth/session";
import { listPendingKyc } from "@/server/kyc/queries";

export const metadata: Metadata = { robots: { index: false } };

export default async function KycQueuePage({
  params,
}: PageProps<"/[locale]/admin/kyc">) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  await requireAdmin(locale, "kyc");
  const [t, tKyc, format, rows] = await Promise.all([
    getTranslations("Admin"),
    getTranslations("Kyc"),
    getFormatter(),
    listPendingKyc(),
  ]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("kycQueue")}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="divide-y">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
              >
                <div className="grid gap-1">
                  <span className="font-medium">
                    {row.customer?.full_name ?? "—"}
                  </span>
                  <span className="text-muted-foreground" dir="ltr">
                    {row.customer?.phone_e164
                      ? formatPhone(row.customer.phone_e164)
                      : ""}
                  </span>
                </div>
                <span>{tKyc(`docTypes.${row.doc_type as KycDocTypeKey}`)}</span>
                <span className="text-muted-foreground">
                  {format.dateTime(new Date(row.created_at), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
                <Link
                  href={`/admin/kyc/${row.id}`}
                  className="text-primary hover:underline"
                >
                  {t("open")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
