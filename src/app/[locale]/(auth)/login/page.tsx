import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AuthShell } from "@/components/auth/auth-shell";
import { GoogleButton } from "@/components/auth/google-button";
import { LoginForm } from "@/components/auth/login-form";
import { UserIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { Link } from "@/components/link";
import { redirect } from "@/i18n/navigation";
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
    <AuthShell
      icon={<UserIcon />}
      title={t("login.title")}
      description={t("login.description")}
      footer={
        <>
          <Link
            href="/reset-password"
            className="justify-self-start font-bold text-primary-text underline underline-offset-4"
          >
            {t("login.forgot")}
          </Link>
          <p className="text-muted-foreground">
            {t("login.noAccount")}{" "}
            <Link
              href="/register"
              className="font-bold text-primary-text underline underline-offset-4"
            >
              {t("login.register")}
            </Link>
          </p>
        </>
      }
    >
      {error === "oauth" && <Alert tone="error">{t("errors.oauth")}</Alert>}
      <LoginForm next={typeof next === "string" ? next : undefined} />
      {process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true" && (
        <>
          <p className="text-center text-xs text-muted-foreground">{t("or")}</p>
          <GoogleButton />
        </>
      )}
    </AuthShell>
  );
}
