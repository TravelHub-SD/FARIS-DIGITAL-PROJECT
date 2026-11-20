import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AuthShell } from "@/components/auth/auth-shell";
import { CompleteAccountForm } from "@/components/auth/complete-account-form";
import { ChatIcon } from "@/components/icons";
import { ClientMessages } from "@/components/layout/client-messages";
import { Button } from "@/components/ui/button";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { signOut } from "@/server/auth/actions";
import { isComplete, requireUser } from "@/server/auth/session";

export const metadata: Metadata = { robots: { index: false } };

// The ONLY authenticated page an incomplete (phone-unverified) account can open.
export default async function CompleteAccountPage({
  params,
}: PageProps<"/[locale]/complete-account">) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  if (isComplete(user)) redirect({ href: "/account", locale });
  const t = await getTranslations("Auth");

  return (
    <ClientMessages namespaces={["Auth"]}>
      <AuthShell
        icon={<ChatIcon />}
        title={t("complete.title")}
        description={t("complete.description")}
        footer={
          <form action={signOut.bind(null, locale)}>
            <Button type="submit" variant="ghost" size="sm" className="-ms-3">
              {t("complete.signOut")}
            </Button>
          </form>
        }
      >
        <CompleteAccountForm />
      </AuthShell>
    </ClientMessages>
  );
}
