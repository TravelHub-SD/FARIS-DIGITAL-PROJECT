import "server-only";

import { cache } from "react";

import { createPublicClient } from "@/lib/supabase/public";

import { buildSafe, orThrow } from "./queries";

// Public site content managed from the dashboard (settings, FAQs, comments).
// Read as anon: only public columns/rows exist here.

export type SiteSettings = {
  contact_phone: string | null;
  contact_whatsapp: string | null;
  contact_email: string | null;
  address_ar: string | null;
  address_en: string | null;
  social_links: Partial<
    Record<"facebook" | "instagram" | "x" | "telegram", string>
  >;
  banner_title_ar: string | null;
  banner_title_en: string | null;
  banner_image_path: string | null;
  banner_link: string | null;
  banner_is_active: boolean;
  logo_path: string | null;
};

const EMPTY: SiteSettings = {
  contact_phone: null,
  contact_whatsapp: null,
  contact_email: null,
  address_ar: null,
  address_en: null,
  social_links: {},
  banner_title_ar: null,
  banner_title_en: null,
  banner_image_path: null,
  banner_link: null,
  banner_is_active: false,
  logo_path: null,
};

export const getSiteSettings = cache(() =>
  buildSafe<SiteSettings>(EMPTY, async () => {
    const row = orThrow(
      await createPublicClient()
        .from("app_settings")
        .select(
          "contact_phone, contact_whatsapp, contact_email, address_ar, address_en, social_links, banner_title_ar, banner_title_en, banner_image_path, banner_link, banner_is_active, logo_path",
        )
        .maybeSingle(),
    ) as SiteSettings | null;
    return row ?? EMPTY;
  }),
);

export type PublicFaq = {
  id: string;
  question_ar: string | null;
  question_en: string | null;
  answer_ar: string | null;
  answer_en: string | null;
};

/** Published FAQs only (RLS). */
export const listPublishedFaqs = cache(() =>
  buildSafe<PublicFaq[]>([], async () =>
    orThrow(
      await createPublicClient()
        .from("faqs")
        .select("id, question_ar, question_en, answer_ar, answer_en")
        .order("sort_order")
        .order("created_at"),
    ),
  ),
);

export type PublicComment = {
  id: string;
  body: string;
  created_at: string;
  author: string | null;
};

/** Visible comments of a visible product, first names only. */
export const listProductComments = cache((productId: string) =>
  buildSafe<PublicComment[]>([], async () =>
    orThrow(
      await createPublicClient().rpc("product_comments", {
        p_product_id: productId,
      }),
    ),
  ),
);
