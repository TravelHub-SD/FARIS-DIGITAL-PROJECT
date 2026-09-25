import "server-only";

import { createClient } from "@/lib/supabase/server";

// WhatsApp delivery, as seen by staff (orders permission; RLS). Spend and
// rates need the settings permission.

export type MessageRow = {
  id: string;
  message_type: "otp" | "order_status" | "kyc_result";
  template_name: string;
  status: "queued" | "sent" | "delivered" | "read" | "failed";
  phone_e164: string;
  attempts: number;
  max_attempts: number;
  next_retry_at: string | null;
  error_code: string | null;
  needs_attention: boolean;
  handled_at: string | null;
  created_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  cost_usd: number | null;
  cost_source: "estimate" | "webhook" | null;
  pricing_category: string | null;
  order: { reference: string } | null;
  customer: { full_name: string | null } | null;
};

const SELECT =
  "id, message_type, template_name, status, phone_e164, attempts, max_attempts, next_retry_at, error_code, needs_attention, handled_at, created_at, sent_at, delivered_at, cost_usd, cost_source, pricing_category, order:orders(reference), customer:profiles!message_logs_user_id_fkey(full_name)";

const PAGE = 50;

export async function listMessages(filter: {
  view: "attention" | "failed" | "all";
  type?: MessageRow["message_type"];
  page?: number;
}) {
  const page = Math.max(1, filter.page ?? 1);
  const supabase = await createClient();
  let q = supabase
    .from("message_logs")
    .select(SELECT, { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (filter.view === "attention") q = q.eq("needs_attention", true);
  if (filter.view === "failed") q = q.eq("status", "failed");
  if (filter.type) q = q.eq("message_type", filter.type);
  const { data, count, error } = await q;
  if (error) throw new Error(error.message);
  return {
    rows: (data ?? []) as unknown as MessageRow[],
    page,
    pages: Math.max(1, Math.ceil((count ?? 0) / PAGE)),
    total: count ?? 0,
  };
}

export async function orderMessages(orderId: string): Promise<MessageRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("message_logs")
    .select(SELECT)
    .eq("order_id", orderId)
    .order("created_at");
  return (data ?? []) as unknown as MessageRow[];
}

/** Errors that mean "nothing will get through until someone fixes the setup". */
export const SYSTEMIC_ERRORS = [
  "config:not_configured",
  "meta:190", // access token expired / invalid
  "meta:10", // permission denied
  "meta:200",
  "meta:131031", // business account locked
  "meta:131042", // payment method problem
  "meta:368", // temporarily blocked for policy violations
  "meta:132001", // template missing / not approved in this language
];

export type MessagingHealth = {
  attention: number;
  failed24h: number;
  sent24h: number;
  systemic: { code: string; at: string } | null;
  // The last few sends all failed and nothing got through since: Meta or the
  // network is down right now (shown before the retries run out).
  outage: { code: string; at: string } | null;
  stuck: number; // due for over 10 minutes: the scheduler is not running
};

const OUTAGE_WINDOW_MS = 15 * 60 * 1000;
const OUTAGE_FAILURES = 3;

export async function messagingHealth(): Promise<MessagingHealth> {
  const supabase = await createClient();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const stuckBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const recent = new Date(Date.now() - OUTAGE_WINDOW_MS).toISOString();
  const head = { count: "exact" as const, head: true };
  const [attention, failed, sent, systemic, stuck, failing] = await Promise.all(
    [
      supabase
        .from("message_logs")
        .select("id", head)
        .eq("needs_attention", true),
      supabase
        .from("message_logs")
        .select("id", head)
        .eq("status", "failed")
        .gte("created_at", since),
      supabase
        .from("message_logs")
        .select("id", head)
        .in("status", ["sent", "delivered", "read"])
        .gte("created_at", since),
      supabase
        .from("message_logs")
        .select("error_code, failed_at")
        .in("error_code", SYSTEMIC_ERRORS)
        .gte("failed_at", since)
        .order("failed_at", { ascending: false })
        .limit(1),
      supabase
        .from("message_logs")
        .select("id", head)
        .eq("status", "queued")
        .lt("next_retry_at", stuckBefore),
      supabase
        .from("message_logs")
        .select("error_code, updated_at")
        .in("status", ["queued", "failed"])
        .not("error_code", "is", null)
        .gte("updated_at", recent)
        .order("updated_at", { ascending: false })
        .limit(OUTAGE_FAILURES),
    ],
  );
  const last = systemic.data?.[0];
  // A systemic error is over once something was sent after it.
  let active = last
    ? { code: last.error_code as string, at: last.failed_at as string }
    : null;
  if (active) {
    const { count } = await supabase
      .from("message_logs")
      .select("id", head)
      .in("status", ["sent", "delivered", "read"])
      .gt("sent_at", active.at);
    if ((count ?? 0) > 0) active = null;
  }
  let outage: MessagingHealth["outage"] = null;
  const fails = failing.data ?? [];
  if (!active && fails.length === OUTAGE_FAILURES) {
    const { count } = await supabase
      .from("message_logs")
      .select("id", head)
      .gt("sent_at", fails[OUTAGE_FAILURES - 1].updated_at);
    if ((count ?? 0) === 0) {
      outage = {
        code: fails[0].error_code as string,
        at: fails[0].updated_at as string,
      };
    }
  }
  return {
    attention: attention.count ?? 0,
    failed24h: failed.count ?? 0,
    sent24h: sent.count ?? 0,
    systemic: active,
    outage,
    stuck: stuck.count ?? 0,
  };
}

export type SpendRow = {
  message_type: MessageRow["message_type"];
  pricing_category: string | null;
  messages: number;
  delivered: number;
  failed: number;
  priced: number;
  cost_usd: number;
};

/** Settings permission (the RPC refuses others). */
export async function spend(from: string, to: string) {
  const supabase = await createClient();
  const [rows, rates] = await Promise.all([
    supabase.rpc("whatsapp_spend", { p_from: from, p_to: to }),
    supabase
      .from("whatsapp_rates")
      .select("category, usd_per_message, updated_at")
      .order("category"),
  ]);
  if (rows.error) throw new Error(rows.error.message);
  return {
    rows: ((rows.data ?? []) as SpendRow[]).map((r) => ({
      ...r,
      messages: Number(r.messages),
      delivered: Number(r.delivered),
      failed: Number(r.failed),
      priced: Number(r.priced),
      cost_usd: Number(r.cost_usd),
    })),
    rates: (rates.data ?? []) as {
      category: string;
      usd_per_message: number | null;
      updated_at: string;
    }[],
  };
}
