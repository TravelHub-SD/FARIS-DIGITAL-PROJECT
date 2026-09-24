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
