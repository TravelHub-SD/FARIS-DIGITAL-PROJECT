import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AuthShell } from "@/components/auth/auth-shell";
import { GoogleButton } from "@/components/auth/google-button";
import { RegisterForm } from "@/components/auth/register-form";
import { UserIcon } from "@/components/icons";
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
    <AuthShell
      icon={<UserIcon />}
      title={t("register.title")}
      description={t("register.description")}
      footer={
        <p className="text-muted-foreground">
          {t("register.haveAccount")}{" "}
          <Link
            href="/login"
            className="font-bold text-primary-text underline underline-offset-4"
          >
            {t("register.login")}
          </Link>
        </p>
      }
    >
      <RegisterForm />
      {process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true" && (
        <>
          <p className="text-center text-xs text-muted-foreground">{t("or")}</p>
          <GoogleButton />
        </>
      )}
    </AuthShell>
  );
}
