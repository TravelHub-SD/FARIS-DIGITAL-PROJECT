import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AuthShell } from "@/components/auth/auth-shell";
import { TotpEnrol, TotpVerify } from "@/components/auth/two-factor-forms";
import { ShieldIcon } from "@/components/icons";
import { ClientMessages } from "@/components/layout/client-messages";
import { Button } from "@/components/ui/button";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { signOut } from "@/server/auth/actions";
import { currentAal, verifiedTotpFactors } from "@/server/auth/mfa";
import {
  getAdminPermissions,
  requireCompleteUser,
} from "@/server/auth/session";

export const metadata: Metadata = { robots: { index: false } };

// Staff only: the step between a password sign-in and the dashboard. First
// visit sets up an authenticator app; later visits ask for its code. Outside
// /admin on purpose: the admin layout sends aal1 sessions here.
export default async function TwoFactorPage({
  params,
}: PageProps<"/[locale]/two-factor">) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  const user = await requireCompleteUser(locale);
  if (!(await getAdminPermissions(user.id))) notFound();
  if ((await currentAal()) === "aal2") redirect({ href: "/admin", locale });
  const enrolled = (await verifiedTotpFactors()).length > 0;
  const t = await getTranslations("Auth.twoFactor");

  return (
    <ClientMessages namespaces={["Auth"]}>
      <AuthShell
        icon={<ShieldIcon />}
        title={t(enrolled ? "verifyTitle" : "setupTitle")}
        description={t(enrolled ? "verifyDescription" : "setupDescription")}
        footer={
          <>
            <p className="text-xs text-muted-foreground">
              {t(enrolled ? "lostPhone" : "whyRequired")}
            </p>
            <form action={signOut.bind(null, locale)}>
              <Button type="submit" variant="ghost" size="sm" className="-ms-3">
                {t("signOut")}
              </Button>
            </form>
          </>
        }
      >
        {enrolled ? <TotpVerify /> : <TotpEnrol />}
      </AuthShell>
    </ClientMessages>
  );
}
