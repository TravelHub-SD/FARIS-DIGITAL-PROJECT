import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader, Section } from "@/components/admin/ui";
import { Link } from "@/components/link";
import type { Locale } from "@/i18n/routing";
import { getIsOwner, requireAdmin } from "@/server/auth/session";
import { dashboardCounts } from "@/server/admin/orders-queries";

export const metadata: Metadata = { robots: { index: false } };

export default async function AdminHome({
  params,
}: PageProps<"/[locale]/admin">) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  const { user, permissions } = await requireAdmin(locale);
  const t = await getTranslations("Admin");
  const [counts, owner] = await Promise.all([
    dashboardCounts(permissions),
    getIsOwner(user.id),
  ]);

  const cards = [
    {
      value: counts.paymentsToReview,
      label: t("home.paymentsToReview"),
      href: "/admin/orders?review=1",
      urgent: true,
    },
    {
      value: counts.awaitingPayment,
      label: t("home.awaitingPayment"),
      href: "/admin/orders?status=new",
    },
    {
      value: counts.processing,
      label: t("home.processing"),
      href: "/admin/orders?status=processing",
      urgent: true,
    },
    {
      value: counts.pendingKyc,
      label: t("home.pendingKyc"),
      href: "/admin/kyc",
      urgent: true,
    },
    {
      value: counts.messagesAttention,
      label: t("home.messagesAttention"),
      href: "/admin/messages",
      urgent: true,
    },
    {
      value: counts.hiddenComments,
      label: t("home.hiddenComments"),
      href: "/admin/comments?status=hidden",
    },
  ].filter((c) => c.value !== null);

  return (
    <>
      <PageHeader
        title={t("home.title")}
        description={t("home.welcome", {
          name: user.profile.full_name ?? user.profile.phone_e164 ?? "",
        })}
      />
      {cards.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {cards.map((c) => (
            <li key={c.href}>
              <Link
                href={c.href}
                className="grid h-full gap-1 rounded-xl border bg-card p-4 transition-colors hover:border-primary/50"
                data-testid="dashboard-card"
              >
                <span
                  className={
                    c.urgent && c.value
                      ? "text-3xl font-bold text-highlight"
                      : "text-3xl font-bold"
                  }
                >
                  {c.value}
                </span>
                <span className="text-sm text-muted-foreground">{c.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Section title={t("home.yourAccess")}>
        <p className="text-sm" data-testid="my-permissions">
          {owner
            ? t("home.owner")
            : [...permissions].map((p) => t(`permissions.${p}`)).join(" · ") ||
              t("home.noPermissions")}
        </p>
      </Section>
    </>
  );
}
