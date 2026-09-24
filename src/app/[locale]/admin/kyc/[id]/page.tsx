import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { KycReviewForm } from "@/components/admin/kyc-review-form";
import { Alert } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { KycDocTypeKey } from "@/i18n/keys";
import { Link } from "@/components/link";
import type { Locale } from "@/i18n/routing";
import { formatPhone } from "@/lib/phone";
import { requireAdmin } from "@/server/auth/session";
import { getKycForReview } from "@/server/kyc/queries";

export const metadata: Metadata = { robots: { index: false } };

export default async function KycReviewPage({
  params,
}: PageProps<"/[locale]/admin/kyc/[id]">) {
  const { locale: raw, id } = await params;
  const locale = raw as Locale;
  setRequestLocale(locale);
  await requireAdmin(locale, "kyc");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await getKycForReview(id);
  if (!data) notFound();
  const t = await getTranslations("Admin");
  const tKyc = await getTranslations("Kyc");
  const { submission, customer, imageUrl } = data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("review")}</CardTitle>
        <CardDescription>
          {customer?.full_name ?? "—"} ·{" "}
          <span dir="ltr">
            {customer?.phone_e164 ? formatPhone(customer.phone_e164) : ""}
          </span>{" "}
          · {tKyc(`docTypes.${submission.doc_type as KycDocTypeKey}`)}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {imageUrl ? (
          <>
            {/* Plain <img>, never next/image: the optimizer would copy the
                identity document into a server-side cache. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={tKyc(`docTypes.${submission.doc_type as KycDocTypeKey}`)}
              referrerPolicy="no-referrer"
              className="max-h-[70vh] w-auto rounded-md border object-contain"
            />
            <p className="text-xs text-muted-foreground">{t("imageNote")}</p>
          </>
        ) : (
          <Alert tone="warning">{t("noImage")}</Alert>
        )}
        {submission.status === "pending" && (
          <KycReviewForm submissionId={submission.id} />
        )}
        <Link
          href="/admin/kyc"
          className="text-sm text-primary hover:underline"
        >
          {t("back")}
        </Link>
      </CardContent>
    </Card>
  );
}
