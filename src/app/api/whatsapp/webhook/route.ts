import { timingSafeEqual } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { parseStatuses, verifySignature } from "@/server/whatsapp/webhook";

// Meta WhatsApp webhook (delivery statuses).
//   GET  = subscription handshake (verify token).
//   POST = signed events. Unsigned, badly signed or oversized requests are
//          refused before anything is parsed. Each (message, status) is
//          recorded once in the database, so a replayed payload changes
//          nothing. Nothing from the payload is logged.

export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 1024 * 1024;

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const expected = process.env.WHATSAPP_VERIFY_TOKEN ?? "";
  if (
    params.get("hub.mode") === "subscribe" &&
    expected.length >= 16 &&
    safeEqual(params.get("hub.verify_token") ?? "", expected)
  ) {
    return new Response(params.get("hub.challenge") ?? "", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(request: Request) {
  const appSecret = process.env.WHATSAPP_APP_SECRET ?? "";
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
  if (appSecret.length < 16 || !phoneNumberId) {
    return new Response("not configured", { status: 503 });
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES)
    return new Response("too large", { status: 413 });
  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.length > MAX_BODY_BYTES)
    return new Response("too large", { status: 413 });

  if (
    !verifySignature(raw, request.headers.get("x-hub-signature-256"), appSecret)
  ) {
    return new Response("invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const db = createAdminClient();
  const counts = { applied: 0, duplicate: 0, unknown_message: 0 };
  for (const s of parseStatuses(payload, phoneNumberId)) {
    const { data, error } = await db.rpc("whatsapp_apply_status", {
      p_provider_message_id: s.providerMessageId,
      p_status: s.status,
      p_occurred_at: s.occurredAt,
      p_error_code: s.errorCode,
      p_pricing_category: s.pricingCategory,
      p_billable: s.billable,
    });
    if (error) {
      // Let Meta retry the delivery later (it retries non-2xx responses).
      console.error(`[whatsapp] webhook apply failed: ${error.code ?? "db"}`);
      return new Response("temporary failure", { status: 500 });
    }
    counts[data as keyof typeof counts]++;
  }
  return Response.json(counts);
}
