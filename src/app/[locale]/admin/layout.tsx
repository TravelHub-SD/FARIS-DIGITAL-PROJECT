import { getTranslations } from "next-intl/server";

import { ClientMessages } from "@/components/layout/client-messages";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { requireAdmin } from "@/server/auth/session";

// Admins only (404 for everyone else). Each page re-checks its permission,
// and the database enforces it again through RLS and definer functions.
export default async function AdminLayout({
  children,
  params,
}: LayoutProps<"/[locale]/admin">) {
  const locale = (await params).locale as Locale;
  const { permissions } = await requireAdmin(locale);
  const t = await getTranslations("Admin");
  return (
    <ClientMessages namespaces={["Admin", "Kyc"]}>
      <div className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-8">
        <nav className="flex flex-wrap gap-4 text-sm">
          <Link href="/admin" className="font-bold">
            {t("title")}
          </Link>
          {permissions.has("kyc") && (
            <Link href="/admin/kyc" className="text-primary hover:underline">
              {t("kycQueue")}
            </Link>
          )}
        </nav>
        {children}
      </div>
    </ClientMessages>
  );
}
