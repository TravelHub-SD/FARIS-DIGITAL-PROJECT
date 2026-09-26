import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ProfileForm } from "@/components/account/profile-form";
import { GoogleButton } from "@/components/auth/google-button";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/components/link";
import type { Locale } from "@/i18n/routing";
import { formatPhone } from "@/lib/phone";
import { signOut } from "@/server/auth/actions";
import {
  getAdminPermissions,
  requireCompleteUser,
} from "@/server/auth/session";

export const metadata: Metadata = { robots: { index: false } };

export default async function AccountPage({
  params,
}: PageProps<"/[locale]/account">) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  const user = await requireCompleteUser(locale);
  const t = await getTranslations("Account");
  const tKyc = await getTranslations("Kyc");
  const tInv = await getTranslations("Invoices");
  const { profile } = user;
  // Staff reach the dashboard from here (the site header is shared by static
  // public pages, so it cannot depend on who is signed in). Customers get no
  // hint that an admin area exists.
  const isStaff = (await getAdminPermissions(user.id)) !== null;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <form action={signOut.bind(null, locale)}>
          <Button type="submit" variant="outline" size="sm">
            {t("signOut")}
          </Button>
        </form>
      </div>
      {profile.is_blocked && <Alert tone="error">{t("blocked")}</Alert>}

      {isStaff && (
        <Card data-testid="admin-entry" className="border-primary/40">
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1">
              <span className="font-bold">{t("adminTitle")}</span>
              <span className="text-sm text-muted-foreground">
                {t("adminDescription")}
              </span>
            </div>
            <Link href="/admin" className={buttonVariants({ size: "sm" })}>
              {t("adminAction")}
            </Link>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("profile")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-sm">
            <span className="text-muted-foreground">{t("phone")}: </span>
            <span dir="ltr">
              {profile.phone_e164 ? formatPhone(profile.phone_e164) : "—"}
            </span>
          </p>
          <ProfileForm
            fullName={profile.full_name ?? ""}
            locale={profile.locale}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <span className="font-bold">{t("orders")}</span>
          <Link
            href="/account/orders"
            className={buttonVariants({ size: "sm", variant: "outline" })}
          >
            {t("ordersAction")}
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <span className="font-bold">{tInv("title")}</span>
          <Link
            href="/account/invoices"
            className={buttonVariants({ size: "sm", variant: "outline" })}
          >
            {t("invoicesLink")}
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("kycStatus")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <span data-testid="kyc-status" className="font-medium">
            {tKyc(`status.${profile.kyc_status}`)}
          </span>
          {(profile.kyc_status === "none" ||
            profile.kyc_status === "rejected") && (
            <Link
              href="/account/kyc"
              className={buttonVariants({ size: "sm" })}
            >
              {t("kycAction")}
            </Link>
          )}
        </CardContent>
      </Card>

      {process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true" && (
        <Card>
          <CardContent>
            {user.providers.includes("google") ? (
              <p className="text-sm text-muted-foreground">
                {t("googleLinked")}
              </p>
            ) : (
              <GoogleButton mode="link" />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
