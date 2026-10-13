import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ProfileForm } from "@/components/account/profile-form";
import { GoogleButton } from "@/components/auth/google-button";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { ReceiptIcon, ShieldIcon } from "@/components/icons";
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

  const kycTone =
    profile.kyc_status === "verified"
      ? "bg-success-soft text-success-text"
      : profile.kyc_status === "pending"
        ? "bg-primary-soft text-primary-text"
        : "bg-warning-soft text-warning-text";
  const row =
    "flex min-h-14 items-center justify-between gap-3 px-4 py-3 hover:bg-muted/50";

  return (
    <div className="grid gap-4">
      <h1 className="sr-only">{t("title")}</h1>
      <div className="flex items-center gap-3 rounded-2xl border bg-card p-4">
        <span
          aria-hidden
          className="grid size-14 shrink-0 place-items-center rounded-full bg-primary text-2xl font-bold text-primary-foreground"
        >
          {[...(profile.full_name?.trim() || "•")][0]}
        </span>
        <div className="grid min-w-0 gap-0.5">
          <p className="truncate text-lg font-bold">
            {profile.full_name || t("title")}
          </p>
          <p className="text-sm text-muted-foreground" dir="ltr">
            {profile.phone_e164 ? formatPhone(profile.phone_e164) : "—"}
          </p>
        </div>
      </div>
      {profile.is_blocked && <Alert tone="error">{t("blocked")}</Alert>}

      {isStaff && (
        <div
          data-testid="admin-entry"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/40 bg-primary-soft p-4"
        >
          <div className="grid gap-1">
            <span className="font-bold">{t("adminTitle")}</span>
            <span className="text-sm text-muted-foreground">
              {t("adminDescription")}
            </span>
          </div>
          <Link href="/admin" className={buttonVariants({ size: "sm" })}>
            {t("adminAction")}
          </Link>
        </div>
      )}

      <nav
        aria-label={t("title")}
        className="grid divide-y overflow-hidden rounded-2xl border bg-card"
      >
        <Link href="/account/orders" className={row}>
          <span className="flex items-center gap-3 font-bold">
            <ReceiptIcon className="size-5 text-primary-text" />
            {t("orders")}
          </span>
          <span aria-hidden className="text-muted-foreground rtl:rotate-180">
            ›
          </span>
        </Link>
        <Link href="/account/invoices" className={row}>
          <span className="flex items-center gap-3 font-bold">
            <ReceiptIcon className="size-5 text-primary-text" />
            {tInv("title")}
          </span>
          <span aria-hidden className="text-muted-foreground rtl:rotate-180">
            ›
          </span>
        </Link>
        <Link href="/account/kyc" className={row}>
          <span className="flex items-center gap-3 font-bold">
            <ShieldIcon className="size-5 text-primary-text" />
            {t("kycStatus")}
          </span>
          <span
            data-testid="kyc-status"
            className={`rounded-full px-3 py-1 text-xs font-bold ${kycTone}`}
          >
            {tKyc(`status.${profile.kyc_status}`)}
          </span>
        </Link>
      </nav>

      <section className="grid gap-4 rounded-2xl border bg-card p-4">
        <h2 className="text-lg font-bold">{t("profile")}</h2>
        <ProfileForm
          fullName={profile.full_name ?? ""}
          locale={profile.locale}
        />
      </section>

      {process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true" && (
        <div className="rounded-2xl border bg-card p-4">
          {user.providers.includes("google") ? (
            <p className="text-sm text-muted-foreground">{t("googleLinked")}</p>
          ) : (
            <GoogleButton mode="link" />
          )}
        </div>
      )}

      <form action={signOut.bind(null, locale)}>
        <Button type="submit" variant="outline" className="w-full">
          {t("signOut")}
        </Button>
      </form>
    </div>
  );
}
