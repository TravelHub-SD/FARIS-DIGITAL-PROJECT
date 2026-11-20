import { getTranslations } from "next-intl/server";

import { ChatIcon } from "@/components/icons";
import { getSiteSettings } from "@/server/catalog/site";

// "Talk to us" on WhatsApp: the number from Settings. Nothing when no number
// is set. Floating by default: above the bottom navigation on phones and
// above a page's sticky action bar (pages with one set data-dock on <main>).
// The sign-in screens (data-auth-shell) fill a phone's width, so a floating
// button would cover their fields while scrolling: below md the floating
// one hides there and AuthShell shows the inline one under the card.
export async function WhatsAppButton({ inline = false }: { inline?: boolean }) {
  const settings = await getSiteSettings();
  const digits = settings.contact_whatsapp?.replace(/\D/g, "");
  if (!digits) return null;
  const t = await getTranslations("Nav");
  const link = {
    href: `https://wa.me/${digits}`,
    target: "_blank",
    rel: "noopener noreferrer",
  };
  if (inline)
    return (
      <a
        {...link}
        data-testid="whatsapp-inline"
        className="mx-auto mt-4 flex h-11 w-fit items-center gap-2 rounded-full bg-whatsapp px-5 text-sm font-bold text-whatsapp-foreground shadow-sm md:hidden print:hidden"
      >
        <ChatIcon className="size-5" />
        {t("whatsapp")}
      </a>
    );
  return (
    <a
      {...link}
      aria-label={t("whatsapp")}
      title={t("whatsapp")}
      data-testid="whatsapp-button"
      className="fixed end-4 bottom-20 z-30 grid size-13 place-items-center rounded-full bg-whatsapp text-whatsapp-foreground shadow-lg transition-transform hover:scale-105 md:bottom-6 print:hidden max-md:[body:has([data-auth-shell])_&]:hidden [body:has([data-dock])_&]:bottom-36 md:[body:has([data-dock])_&]:bottom-6"
    >
      <ChatIcon className="size-6" />
    </a>
  );
}
