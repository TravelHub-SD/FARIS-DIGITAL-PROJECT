import { createHmac, timingSafeEqual } from "node:crypto";

// Pure helpers for the Meta webhook (no server-only import: unit-tested).

/**
 * Meta signs the raw request body with the app secret:
 *   X-Hub-Signature-256: sha256=<hex HMAC-SHA256(app_secret, body)>
 * Compared in constant time over the exact bytes received.
 */
export function verifySignature(
  rawBody: Buffer,
  header: string | null,
  appSecret: string,
): boolean {
  if (!header || !appSecret) return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!match) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const given = Buffer.from(match[1], "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type StatusUpdate = {
  providerMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  occurredAt: string; // ISO
  errorCode: string | null;
  pricingCategory: string | null;
  billable: boolean | null;
};

const STATUSES = new Set(["sent", "delivered", "read", "failed"]);

/**
 * Extracts delivery statuses for OUR phone number. Everything else in the
 * payload (message text from incoming messages, error titles/details,
 * contact names) is ignored and never stored.
 */
export function parseStatuses(
  payload: unknown,
  phoneNumberId: string,
): StatusUpdate[] {
  const out: StatusUpdate[] = [];
  const p = payload as {
    object?: unknown;
    entry?: {
      changes?: { field?: unknown; value?: Record<string, unknown> }[];
    }[];
  };
  if (p?.object !== "whatsapp_business_account" || !Array.isArray(p.entry))
    return out;
  for (const entry of p.entry) {
    for (const change of entry?.changes ?? []) {
      if (change?.field !== "messages") continue;
      const value = change.value ?? {};
      const metadata = value.metadata as
        { phone_number_id?: unknown } | undefined;
      if (String(metadata?.phone_number_id ?? "") !== phoneNumberId) continue;
      for (const s of (value.statuses as
        Record<string, unknown>[] | undefined) ?? []) {
        const id = s?.id;
        const status = s?.status;
        const ts = Number(s?.timestamp);
        if (typeof id !== "string" || id.length === 0 || id.length > 200)
          continue;
        if (typeof status !== "string" || !STATUSES.has(status)) continue;
        if (!Number.isFinite(ts) || ts <= 0) continue;
        const errors = s.errors as { code?: unknown }[] | undefined;
        const code = errors?.[0]?.code;
        const pricing = s.pricing as
          { category?: unknown; billable?: unknown } | undefined;
        out.push({
          providerMessageId: id,
          status: status as StatusUpdate["status"],
          occurredAt: new Date(ts * 1000).toISOString(),
          errorCode:
            typeof code === "number" && Number.isInteger(code)
              ? `meta:${code}`
              : null,
          pricingCategory:
            typeof pricing?.category === "string" ? pricing.category : null,
          billable:
            typeof pricing?.billable === "boolean" ? pricing.billable : null,
        });
      }
    }
  }
  return out;
}
