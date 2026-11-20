import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { BackArrowIcon, KeyIcon } from "@/components/icons";
import { Link } from "@/components/link";
import type { Locale } from "@/i18n/routing";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/reset-password">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "Auth.reset",
  });
  return { title: t("title"), robots: { index: false } };
}

export default async function ResetPasswordPage({
  params,
}: PageProps<"/[locale]/reset-password">) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  const t = await getTranslations("Auth");
  return (
    <AuthShell
      icon={<KeyIcon />}
      title={t("reset.title")}
      description={t("reset.description")}
      footer={
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 justify-self-start font-bold text-primary-text underline underline-offset-4"
        >
          <BackArrowIcon className="size-4" />
          {t("reset.back")}
        </Link>
      }
    >
      <ResetPasswordForm />
    </AuthShell>
  );
}
