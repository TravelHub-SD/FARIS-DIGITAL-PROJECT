import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { GoogleButton } from "@/components/auth/google-button";
import { LoginForm } from "@/components/auth/login-form";
import { Alert } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Link, redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { getSessionUser } from "@/server/auth/session";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/login">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "Auth.login",
  });
  return { title: t("title"), robots: { index: false } };
}

export default async function LoginPage({
  params,
  searchParams,
}: PageProps<"/[locale]/login">) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  const { next, error } = await searchParams;
  if (await getSessionUser()) redirect({ href: "/account", locale });
  const t = await getTranslations("Auth");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("login.title")}</CardTitle>
        <CardDescription>{t("login.description")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {error === "oauth" && <Alert tone="error">{t("errors.oauth")}</Alert>}
        <LoginForm next={typeof next === "string" ? next : undefined} />
        {process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true" && (
          <>
            <p className="text-center text-xs text-muted-foreground">
              {t("or")}
            </p>
            <GoogleButton />
          </>
        )}
        <div className="flex flex-wrap justify-between gap-2 text-sm">
          <Link href="/reset-password" className="text-primary hover:underline">
            {t("login.forgot")}
          </Link>
          <span className="text-muted-foreground">
            {t("login.noAccount")}{" "}
            <Link href="/register" className="text-primary hover:underline">
              {t("login.register")}
            </Link>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
