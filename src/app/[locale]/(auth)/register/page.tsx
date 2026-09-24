import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { GoogleButton } from "@/components/auth/google-button";
import { RegisterForm } from "@/components/auth/register-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Link } from "@/components/link";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { getSessionUser } from "@/server/auth/session";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/register">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "Auth.register",
  });
  return { title: t("title"), robots: { index: false } };
}

export default async function RegisterPage({
  params,
}: PageProps<"/[locale]/register">) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  if (await getSessionUser()) redirect({ href: "/account", locale });
  const t = await getTranslations("Auth");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("register.title")}</CardTitle>
        <CardDescription>{t("register.description")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <RegisterForm />
        {process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true" && (
          <>
            <p className="text-center text-xs text-muted-foreground">
              {t("or")}
            </p>
            <GoogleButton />
          </>
        )}
        <p className="text-sm text-muted-foreground">
          {t("register.haveAccount")}{" "}
          <Link href="/login" className="text-primary hover:underline">
            {t("register.login")}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
