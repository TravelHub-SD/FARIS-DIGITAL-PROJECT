import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { createDevDriver } from "./dev-driver";
import { resolveWhatsAppDriver } from "./guard";
import { createMetaDriver } from "./meta-driver";
import type { WhatsAppDriver, WhatsAppMessage } from "./types";

let cached: WhatsAppDriver | undefined;

export function getWhatsAppDriver(): WhatsAppDriver {
  if (!cached) {
    const name = resolveWhatsAppDriver(process.env);
    cached = name === "dev" ? createDevDriver() : createMetaDriver();
  }
  return cached;
}

type Context = { userId?: string | null; orderId?: string | null };

// Sends through the configured driver and records the attempt in
// message_logs. OTP rows never carry a payload (DB check constraint), so the
// code is never stored.
export async function sendWhatsApp(
  message: WhatsAppMessage,
  context: Context = {},
  driver: WhatsAppDriver = getWhatsAppDriver(),
): Promise<{ ok: boolean }> {
  const db = createAdminClient();
  const payload =
    message.type === "otp"
      ? {}
      : message.type === "kyc_result"
        ? { approved: message.approved }
        : { reference: message.reference, status: message.status };

  const logged = await db
    .from("message_logs")
    .insert({
      phone_e164: message.to,
      user_id: context.userId ?? null,
      order_id: context.orderId ?? null,
      message_type: message.type,
      template_name: templateName(message),
      payload,
      attempts: 1,
    })
    .select("id")
    .single();
  const logId = logged.data?.id as string | undefined;

  try {
    const result = await driver.send(message);
    if (logId) {
      await db
        .from("message_logs")
        .update({
          status: "sent",
          provider_message_id: result.providerMessageId,
        })
        .eq("id", logId);
    }
    return { ok: true };
  } catch (error) {
    if (logId) {
      await db
        .from("message_logs")
        .update({
          status: "failed",
          error_message:
            error instanceof Error
              ? error.message.slice(0, 500)
              : "unknown error",
        })
        .eq("id", logId);
    }
    return { ok: false };
  }
}

function templateName(message: WhatsAppMessage) {
  switch (message.type) {
    case "otp":
      return "auth_otp";
    case "kyc_result":
      return "kyc_result";
    case "order_status":
      return "order_status_update";
  }
}
