import { type Messages, NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";

/** Ships only the listed namespaces to the browser (keeps client JS small). */
export async function ClientMessages({
  namespaces,
  children,
}: {
  namespaces: (keyof Messages)[];
  children: React.ReactNode;
}) {
  const all = (await getMessages()) as Messages;
  const picked = Object.fromEntries(
    namespaces.map((n) => [n, all[n as keyof Messages]]),
  ) as Partial<Messages>;
  return (
    <NextIntlClientProvider messages={{ ...picked, Errors: all.Errors }}>
      {children}
    </NextIntlClientProvider>
  );
}
