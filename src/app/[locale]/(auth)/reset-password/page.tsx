import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
    <Card>
      <CardHeader>
        <CardTitle>{t("reset.title")}</CardTitle>
        <CardDescription>{t("reset.description")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <ResetPasswordForm />
        <Link
          href="/login"
          className="text-sm text-primary underline underline-offset-4"
        >
          {t("reset.back")}
        </Link>
      </CardContent>
    </Card>
  );
}
