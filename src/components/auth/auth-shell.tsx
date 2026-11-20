import { getTranslations } from "next-intl/server";

import { WhatsAppButton } from "@/components/layout/whatsapp-button";

// The frame of every sign-in screen (sign in, register, password reset,
// complete account, two-step sign-in): a brand band with the page's icon and
// title, then the form on a clean card. Server-rendered: no JavaScript.
// On phones the WhatsApp button sits under the card, never over it.
export async function AuthShell({
  icon,
  title,
  description,
  children,
  footer,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
  /** Links under the form (forgot password, register, sign out). */
  footer?: React.ReactNode;
}) {
  const t = await getTranslations("Brand");
  return (
    <div className="mx-auto w-full max-w-md px-4 py-6 sm:py-14" data-auth-shell>
      <section className="overflow-hidden rounded-3xl border bg-card text-card-foreground shadow-sm">
        <header className="relative grid justify-items-center gap-3 bg-primary px-6 pt-6 pb-7 text-center text-primary-foreground">
          <p className="text-sm font-bold tracking-tight">{t("name")}</p>
          <span
            aria-hidden
            className="grid size-14 place-items-center rounded-2xl bg-primary-foreground/15 ring-1 ring-primary-foreground/25 [&_svg]:size-7"
          >
            {icon}
          </span>
          <div className="grid gap-1.5">
            <h1 className="text-2xl leading-tight font-bold">{title}</h1>
            <p className="text-sm">{description}</p>
          </div>
          <span
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-1 bg-highlight"
          />
        </header>
        {/* Larger fields on the sign-in screens (48 px, like the buttons). */}
        <div className="grid gap-5 p-6 sm:p-8 [&_input]:h-12 [&_input]:rounded-xl">
          {children}
          {footer && (
            <div className="grid gap-3 border-t pt-5 text-sm">{footer}</div>
          )}
        </div>
      </section>
      <WhatsAppButton inline />
    </div>
  );
}
