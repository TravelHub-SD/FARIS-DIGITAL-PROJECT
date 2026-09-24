import { getTranslations } from "next-intl/server";

import { AdminNav } from "@/components/admin/admin-nav";
import { ClientMessages } from "@/components/layout/client-messages";
import type { Locale } from "@/i18n/routing";
import { getIsOwner, requireAdmin } from "@/server/auth/session";

// Admins only (404 for everyone else). Each page re-checks its own
// permission, every action checks again, and the database enforces it a
// third time through RLS and definer functions.
export default async function AdminLayout({
  children,
  params,
}: LayoutProps<"/[locale]/admin">) {
  const locale = (await params).locale as Locale;
  const { user, permissions } = await requireAdmin(locale);
  const owner = await getIsOwner(user.id);
  const t = await getTranslations("Admin.nav");
  const base = `/${locale}/admin`;

  const items = [
    { href: base, label: t("dashboard"), exact: true, show: true },
    {
      href: `${base}/orders`,
      label: t("orders"),
      show: permissions.has("orders"),
    },
    {
      href: `${base}/catalog`,
      label: t("catalog"),
      show: permissions.has("products"),
    },
    {
      href: `${base}/customers`,
      label: t("customers"),
      show: permissions.has("customers"),
    },
    { href: `${base}/kyc`, label: t("kyc"), show: permissions.has("kyc") },
    {
      href: `${base}/comments`,
      label: t("comments"),
      show: permissions.has("comments"),
    },
    {
      href: `${base}/faqs`,
      label: t("faqs"),
      show: permissions.has("settings"),
    },
    {
      href: `${base}/settings`,
      label: t("settings"),
      show: permissions.has("settings"),
    },
    { href: `${base}/admins`, label: t("admins"), show: owner },
    { href: `${base}/audit`, label: t("audit"), show: owner },
  ]
    .filter((i) => i.show)
    .map(({ show: _show, ...i }) => {
      void _show;
      return i;
    });

  return (
    <ClientMessages namespaces={["Admin", "Kyc"]}>
      <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[13rem_1fr] lg:py-8">
        <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          <AdminNav items={items} label={t("label")} />
        </aside>
        <div className="grid min-w-0 content-start gap-6">{children}</div>
      </div>
    </ClientMessages>
  );
}
