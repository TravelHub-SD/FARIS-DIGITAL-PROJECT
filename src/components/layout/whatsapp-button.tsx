import { getTranslations } from "next-intl/server";

import { ChatIcon } from "@/components/icons";
import { getSiteSettings } from "@/server/catalog/site";

// Floating "talk to us" button: the WhatsApp number from Settings. Nothing
// when no number is set. Sits above the bottom navigation on phones and above
// a page's sticky action bar (pages with one set data-dock on <main>).
export async function WhatsAppButton() {
  const settings = await getSiteSettings();
  const digits = settings.contact_whatsapp?.replace(/\D/g, "");
  if (!digits) return null;
  const t = await getTranslations("Nav");
  return (
    <a
      href={`https://wa.me/${digits}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t("whatsapp")}
      title={t("whatsapp")}
      data-testid="whatsapp-button"
      className="fixed end-4 bottom-20 z-30 grid size-13 place-items-center rounded-full bg-whatsapp text-whatsapp-foreground shadow-lg transition-transform hover:scale-105 md:bottom-6 print:hidden [body:has([data-dock])_&]:bottom-36 md:[body:has([data-dock])_&]:bottom-6"
    >
      <ChatIcon className="size-6" />
    </a>
  );
}
