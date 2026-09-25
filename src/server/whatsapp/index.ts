import "server-only";

import { after } from "next/server";

import type { Locale } from "@/i18n/routing";
import { createAdminClient } from "@/lib/supabase/admin";

import { createDevDriver } from "./dev-driver";
import { resolveWhatsAppDriver } from "./guard";
import { createMetaDriver } from "./meta-driver";
import { TEMPLATES } from "./templates";
import type {
  OtpMessage,
  OutgoingMessage,
  TemplateName,
  WhatsAppDriver,
} from "./types";

let cached: WhatsAppDriver | undefined;

export function getWhatsAppDriver(): WhatsAppDriver {
  if (!cached) {
    const name = resolveWhatsAppDriver(process.env);
    cached = name === "dev" ? createDevDriver() : createMetaDriver();
  }
  return cached;
}

/**
 * OTP: sent while the user waits (they need the code now). Logged without the
 * code and never retried: a stale code is useless, the user asks for a new one.
 */
export async function sendOtp(
  message: OtpMessage,
  context: { userId?: string | null } = {},
  driver: WhatsAppDriver = getWhatsAppDriver(),
): Promise<{ ok: boolean }> {
  const db = createAdminClient();
  const logged = await db.rpc("whatsapp_log_otp", {
    p_phone: message.to,
    p_user_id: context.userId ?? null,
    p_language: message.locale,
  });
  const id = logged.data as string | null;
  const result = await driver.send({
    to: message.to,
    template: "otp_code",
    language: message.locale,
    params: { code: message.code },
  });
  if (id) {
    if (result.ok) {
      await db.rpc("whatsapp_mark_sent", {
        p_id: id,
        p_provider_message_id: result.providerMessageId,
        p_category: TEMPLATES.otp_code.category,
      });
    } else {
      await db.rpc("whatsapp_mark_failure", {
        p_id: id,
        p_error_code: result.errorCode,
        p_retryable: false,
      });
      console.warn(`[whatsapp] otp ${id} failed: ${result.errorCode}`);
    }
  }
  return { ok: result.ok };
}

type Context = {
  id: string;
  type: "order_status" | "kyc_result";
  template: TemplateName;
  language: Locale;
  to: string;
  reference: string | null;
  status_ar: string | null;
  status_en: string | null;
  customer_note: string | null;
  kyc_reason: string | null;
};

/** Template parameters, built from the source records at send time. */
export function render(ctx: Context): OutgoingMessage {
  const params: Record<string, string> =
    ctx.template === "order_status_update"
      ? {
          reference: ctx.reference ?? "",
          status: (ctx.language === "ar" ? ctx.status_ar : ctx.status_en) ?? "",
          note: ctx.customer_note ?? "",
        }
      : ctx.template === "kyc_rejected"
        ? { reason: ctx.kyc_reason ?? "" }
        : {};
  return { to: ctx.to, template: ctx.template, language: ctx.language, params };
}

const CLAIM_BATCH = 3;
const DISPATCH_BUDGET_MS = 25_000;

export type DispatchSummary = {
  claimed: number;
  sent: number;
  retrying: number;
  failed: number;
};

/**
 * Sends due notifications (claimed with a lease, so concurrent runs never
 * send the same row). Called right after a request that queued something,
 * and every minute by the database scheduler for retries.
 */
export async function dispatchDue(
  limit = 20,
  driver: WhatsAppDriver = getWhatsAppDriver(),
): Promise<DispatchSummary> {
  const db = createAdminClient();
  const summary: DispatchSummary = {
    claimed: 0,
    sent: 0,
    retrying: 0,
    failed: 0,
  };
  // Small batches within a time budget: when Meta is slow (10 s timeouts),
  // a run stops claiming well before the platform's function time limit, so
  // no row is claimed (costing an attempt) without actually being tried.
  const started = Date.now();
  while (summary.claimed < limit && Date.now() - started < DISPATCH_BUDGET_MS) {
    const { data: rows, error } = await db.rpc("whatsapp_claim", {
      p_limit: Math.min(CLAIM_BATCH, limit - summary.claimed),
    });
    if (error) {
      console.error(`[whatsapp] claim failed: ${error.code ?? "db"}`);
      break;
    }
    if (!rows || rows.length === 0) break;
    for (const row of rows as { id: string }[]) {
      summary.claimed++;
      const { data: ctx, error: ctxError } = await db.rpc(
        "whatsapp_message_context",
        { p_id: row.id },
      );
      if (ctxError) {
        // Database hiccup, not a bad message: try again under the same policy.
        await db.rpc("whatsapp_mark_failure", {
          p_id: row.id,
          p_error_code: "app:db",
          p_retryable: true,
        });
        summary.retrying++;
        continue;
      }
      const context = ctx as Context | null;
      if (!context || !(context.template in TEMPLATES)) {
        await db.rpc("whatsapp_mark_failure", {
          p_id: row.id,
          p_error_code: "app:unrenderable",
          p_retryable: false,
        });
        summary.failed++;
        continue;
      }
      const result = await driver.send(render(context));
      if (result.ok) {
        const marked = await db.rpc("whatsapp_mark_sent", {
          p_id: row.id,
          p_provider_message_id: result.providerMessageId,
          p_category: TEMPLATES[context.template].category,
        });
        if (marked.error) {
          console.error(
            `[whatsapp] message ${row.id} sent but not recorded: ${marked.error.code ?? "db"}`,
          );
        }
        summary.sent++;
      } else {
        const { data: outcome } = await db.rpc("whatsapp_mark_failure", {
          p_id: row.id,
          p_error_code: result.errorCode,
          p_retryable: result.retryable,
        });
        if (outcome === "retry") summary.retrying++;
        else summary.failed++;
        console.warn(
          `[whatsapp] message ${row.id} ${outcome}: ${result.errorCode}`,
        );
      }
    }
  }
  return summary;
}

/**
 * Schedules a dispatch after the current response is sent: the customer's
 * request never waits for (or fails because of) WhatsApp.
 */
export function dispatchSoon() {
  after(async () => {
    try {
      await dispatchDue();
    } catch (error) {
      console.error(
        `[whatsapp] dispatch error: ${error instanceof Error ? error.name : "unknown"}`,
      );
    }
  });
}
