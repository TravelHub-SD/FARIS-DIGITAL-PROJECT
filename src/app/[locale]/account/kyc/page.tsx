import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { KycUploadForm } from "@/components/account/kyc-upload-form";
import { Alert } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Locale } from "@/i18n/routing";
import { requireCompleteUser } from "@/server/auth/session";

export const metadata: Metadata = { robots: { index: false } };

export default async function KycPage({
  params,
}: PageProps<"/[locale]/account/kyc">) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  const { profile } = await requireCompleteUser(locale);
  const t = await getTranslations("Kyc");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("intro")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm">
          <span data-testid="kyc-status" className="font-medium">
            {t(`status.${profile.kyc_status}`)}
          </span>
        </p>
        {profile.kyc_status === "pending" && <Alert>{t("pendingNote")}</Alert>}
        {profile.kyc_status === "verified" && (
          <Alert tone="success">{t("verifiedNote")}</Alert>
        )}
        {profile.kyc_status === "rejected" && profile.kyc_rejection_reason && (
          <Alert tone="warning">
            {t("rejectedReason", { reason: profile.kyc_rejection_reason })}
          </Alert>
        )}
        {(profile.kyc_status === "none" ||
          profile.kyc_status === "rejected") && <KycUploadForm />}
      </CardContent>
    </Card>
  );
}
