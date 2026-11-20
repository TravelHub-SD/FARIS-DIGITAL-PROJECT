import { ClientMessages } from "@/components/layout/client-messages";

// Each page draws its own frame (AuthShell).
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ClientMessages namespaces={["Auth"]}>{children}</ClientMessages>;
}
