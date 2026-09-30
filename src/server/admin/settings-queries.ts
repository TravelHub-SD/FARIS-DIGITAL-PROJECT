import "server-only";

import { createClient } from "@/lib/supabase/server";

// Settings area (settings permission). security_settings is readable only by
// settings staff (RLS); app_settings and active bank accounts are public.

export async function getSettings() {
  const supabase = await createClient();
  const [app, security, banks] = await Promise.all([
    supabase.from("app_settings").select("*").maybeSingle(),
    supabase.from("security_settings").select("*").maybeSingle(),
    supabase.from("bank_accounts").select("*").order("sort_order"),
  ]);
  if (app.error || security.error || banks.error)
    throw new Error(
      (app.error ?? security.error ?? banks.error)?.message ?? "settings",
    );
  return {
    app: app.data as Record<string, unknown> & {
      social_links: Record<string, string>;
    },
    security: security.data as {
      otp_login_policy: "never" | "always";
      otp_daily_budget: number;
      order_rate_limit_per_hour: number;
      receipts_per_order_limit: number;
      comment_rate_limit_per_hour: number;
      kyc_window_hours: number;
    } | null,
    banks: (banks.data ?? []) as {
      id: string;
      bank_name_ar: string;
      bank_name_en: string;
      account_number: string;
      account_holder: string;
      branch_ar: string | null;
      branch_en: string | null;
      is_active: boolean;
      sort_order: number;
    }[],
  };
}

export type FaqRow = {
  id: string;
  question_ar: string | null;
  question_en: string | null;
  answer_ar: string | null;
  answer_en: string | null;
  sort_order: number;
  is_published: boolean;
};

export async function listFaqs(): Promise<FaqRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("faqs")
    .select(
      "id, question_ar, question_en, answer_ar, answer_en, sort_order, is_published",
    )
    .order("sort_order")
    .order("created_at");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export type SitePageRow = {
  slug: "about" | "terms" | "privacy";
  title_ar: string | null;
  title_en: string | null;
  body_ar: string | null;
  body_en: string | null;
  is_published: boolean;
  updated_at: string;
};

/** About / Terms / Privacy, drafts included (settings staff, RLS). */
export async function listSitePages(): Promise<SitePageRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("site_pages")
    .select(
      "slug, title_ar, title_en, body_ar, body_en, is_published, updated_at",
    );
  if (error) throw new Error(error.message);
  const order = ["about", "terms", "privacy"];
  return ((data ?? []) as SitePageRow[]).sort(
    (a, b) => order.indexOf(a.slug) - order.indexOf(b.slug),
  );
}

/**
 * Today's OTP count against the daily budget (Khartoum day), for the admin
 * alert. Settings staff only: the function returns no row for anyone else.
 */
export async function otpBudgetToday(): Promise<{
  used: number;
  budget: number;
} | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("otp_budget_today");
  if (error) throw new Error(error.message);
  const row = (data as { used: number; budget: number }[] | null)?.[0];
  return row ?? null;
}
