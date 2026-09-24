import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { CompleteAccountForm } from "@/components/auth/complete-account-form";
import { ClientMessages } from "@/components/layout/client-messages";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
      <div className="mx-auto w-full max-w-md px-4 py-10 sm:py-16">
        <Card>
          <CardHeader>
            <CardTitle>{t("complete.title")}</CardTitle>
            <CardDescription>{t("complete.description")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <CompleteAccountForm />
            <form action={signOut.bind(null, locale)}>
              <Button type="submit" variant="ghost" size="sm">
                {t("complete.signOut")}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </ClientMessages>
  );
}
