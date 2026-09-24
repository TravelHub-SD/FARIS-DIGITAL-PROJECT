import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { AppPermission } from "@/server/auth/session";

// Customers, comments and admins lists. RLS decides what each admin sees;
// pages check the permission before calling these.

const PAGE = 25;

/** Keeps only characters that are safe inside a PostgREST or() filter. */
export const safeTerm = (q: string | undefined) =>
  (q ?? "")
    .replace(/[^\p{L}\p{N}\s+-]/gu, " ")
    .trim()
    .slice(0, 60);

export type CustomerRow = {
  id: string;
  full_name: string | null;
  phone_e164: string | null;
  kyc_status: "none" | "pending" | "verified" | "rejected";
  is_blocked: boolean;
  phone_verified_at: string | null;
  created_at: string;
};

export async function listCustomers(filters: {
  q?: string;
  blocked?: boolean;
  kyc?: CustomerRow["kyc_status"];
  page?: number;
}) {
  const page = Math.max(1, filters.page ?? 1);
  const supabase = await createClient();
  let query = supabase
    .from("profiles")
    .select(
      "id, full_name, phone_e164, kyc_status, is_blocked, phone_verified_at, created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (filters.blocked) query = query.eq("is_blocked", true);
  if (filters.kyc) query = query.eq("kyc_status", filters.kyc);
  const term = safeTerm(filters.q);
  if (term) {
    const digits = term.replace(/\D/g, "").replace(/^0+/, "");
    query = query.or(
      digits.length >= 4
        ? `full_name.ilike.*${term}*,phone_e164.like.*${digits}*`
        : `full_name.ilike.*${term}*`,
    );
  }
  const { data, count, error } = await query;
  if (error) throw new Error(error.message);
  return {
    rows: (data ?? []) as CustomerRow[],
    page,
    pages: Math.max(1, Math.ceil((count ?? 0) / PAGE)),
    total: count ?? 0,
  };
}

export async function getCustomer(id: string, permissions: Set<AppPermission>) {
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "id, full_name, phone_e164, locale, kyc_status, kyc_rejection_reason, is_blocked, phone_verified_at, created_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (!profile) return null;
  const [orders, kyc] = await Promise.all([
    permissions.has("orders")
      ? supabase
          .from("orders")
          .select("id, reference, status, total_sdg, created_at")
          .eq("user_id", id)
          .order("created_at", { ascending: false })
          .limit(50)
      : null,
    permissions.has("kyc")
      ? supabase
          .from("kyc_submissions")
          .select(
            "id, doc_type, status, rejection_reason, created_at, reviewed_at",
          )
          .eq("user_id", id)
          .order("created_at", { ascending: false })
      : null,
  ]);
  return {
    profile: profile as CustomerRow & {
      locale: string;
      kyc_rejection_reason: string | null;
    },
    orders: orders?.data ?? null,
    kyc: kyc?.data ?? null,
  };
}

export type CommentRow = {
  id: string;
  body: string;
  status: "visible" | "hidden";
  hidden_reason: string | null;
  created_at: string;
  product_slug: string;
  product_name_ar: string | null;
  product_name_en: string | null;
  author: string | null;
  total_count: number;
};

export async function listComments(filters: {
  status?: "visible" | "hidden";
  q?: string;
  page?: number;
}) {
  const page = Math.max(1, filters.page ?? 1);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_comments", {
    p_status: filters.status ?? null,
    p_q: filters.q ?? null,
    p_limit: PAGE,
    p_offset: (page - 1) * PAGE,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as CommentRow[];
  const total = rows[0] ? Number(rows[0].total_count) : 0;
  return { rows, page, pages: Math.max(1, Math.ceil(total / PAGE)), total };
}

export type AdminEntry = {
  user_id: string;
  is_owner: boolean;
  is_active: boolean;
  created_at: string;
  full_name: string | null;
  phone_e164: string | null;
  permissions: AppPermission[];
};

/** Owner only (RLS: other admins see just their own row). */
export async function listAdmins(): Promise<AdminEntry[]> {
  const supabase = await createClient();
  const { data: admins, error } = await supabase
    .from("admins")
    .select("user_id, is_owner, is_active, created_at")
    .order("is_owner", { ascending: false })
    .order("created_at");
  if (error) throw new Error(error.message);
  const ids = (admins ?? []).map((a) => a.user_id);
  if (!ids.length) return [];
  const [{ data: perms }, { data: people }] = await Promise.all([
    supabase
      .from("admin_permissions")
      .select("admin_id, permission")
      .in("admin_id", ids),
    supabase.from("profiles").select("id, full_name, phone_e164").in("id", ids),
  ]);
  return (admins ?? []).map((a) => {
    const person = people?.find((p) => p.id === a.user_id);
    return {
      ...a,
      full_name: person?.full_name ?? null,
      phone_e164: person?.phone_e164 ?? null,
      permissions: (perms ?? [])
        .filter((p) => p.admin_id === a.user_id)
        .map((p) => p.permission as AppPermission),
    };
  });
}

export type AuditRow = {
  id: number;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
  actor: string | null;
};

/** Owner only (RLS). Read-only: nothing in the app writes audit rows. */
export async function listAudit(filters: {
  entity?: string;
  action?: string;
  entityId?: string;
  actor?: string;
  from?: string;
  to?: string;
  page?: number;
}) {
  const page = Math.max(1, filters.page ?? 1);
  const size = 50;
  const supabase = await createClient();
  let query = supabase
    .from("audit_logs")
    .select(
      "id, actor_id, actor_role, action, entity_type, entity_id, old_data, new_data, created_at",
      { count: "exact" },
    )
    .order("id", { ascending: false })
    .range((page - 1) * size, page * size - 1);
  if (filters.entity) query = query.eq("entity_type", filters.entity);
  if (filters.action) query = query.eq("action", filters.action);
  if (filters.entityId) query = query.eq("entity_id", filters.entityId);
  if (filters.from)
    query = query.gte("created_at", `${filters.from}T00:00:00+02:00`);
  if (filters.to)
    query = query.lte("created_at", `${filters.to}T23:59:59.999+02:00`);
  const term = safeTerm(filters.actor);
  if (term) {
    const digits = term.replace(/\D/g, "").replace(/^0+/, "");
    const { data: people } = await supabase
      .from("profiles")
      .select("id")
      .or(
        digits.length >= 4
          ? `full_name.ilike.*${term}*,phone_e164.like.*${digits}*`
          : `full_name.ilike.*${term}*`,
      )
      .limit(50);
    const ids = (people ?? []).map((p) => p.id);
    query = query.in(
      "actor_id",
      ids.length ? ids : ["00000000-0000-0000-0000-000000000000"],
    );
  }
  const { data, count, error } = await query;
  if (error) throw new Error(error.message);
  const actorIds = [
    ...new Set((data ?? []).map((r) => r.actor_id).filter(Boolean)),
  ] as string[];
  const { data: actors } = actorIds.length
    ? await supabase
        .from("profiles")
        .select("id, full_name, phone_e164")
        .in("id", actorIds)
    : {
        data: [] as {
          id: string;
          full_name: string | null;
          phone_e164: string | null;
        }[],
      };
  const names = new Map(
    (actors ?? []).map((a) => [a.id, a.full_name ?? a.phone_e164 ?? a.id]),
  );
  return {
    rows: (data ?? []).map((r) => ({
      ...r,
      actor: r.actor_id ? (names.get(r.actor_id) ?? null) : null,
    })) as AuditRow[],
    page,
    pages: Math.max(1, Math.ceil((count ?? 0) / size)),
    total: count ?? 0,
  };
}

/** Distinct entity types for the audit filter. */
export const AUDIT_ENTITIES = [
  "orders",
  "payment_receipts",
  "order_internal_notes",
  "kyc_submissions",
  "profiles",
  "categories",
  "products",
  "product_variants",
  "app_settings",
  "security_settings",
  "bank_accounts",
  "faqs",
  "comments",
  "admins",
  "admin_permissions",
  "invoices",
] as const;
