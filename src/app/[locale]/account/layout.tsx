import { ClientMessages } from "@/components/layout/client-messages";
import type { Locale } from "@/i18n/routing";
import { requireCompleteUser } from "@/server/auth/session";

// Gate for every /account route: signed in AND phone verified. Pages repeat
// the check (a layout guard alone does not run for every navigation).
export default async function AccountLayout({
  children,
  params,
}: LayoutProps<"/[locale]/account">) {
  await requireCompleteUser((await params).locale as Locale);
  return (
    <ClientMessages namespaces={["Auth", "Account", "Kyc", "Orders"]}>
      <div className="mx-auto w-full max-w-3xl px-4 py-10 print:max-w-none print:p-0">
        {children}
      </div>
    </ClientMessages>
  );
}
