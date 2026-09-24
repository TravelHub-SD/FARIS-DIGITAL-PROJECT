import { ClientMessages } from "@/components/layout/client-messages";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClientMessages namespaces={["Auth"]}>
      <div className="mx-auto w-full max-w-md px-4 py-10 sm:py-16">
        {children}
      </div>
    </ClientMessages>
  );
}
