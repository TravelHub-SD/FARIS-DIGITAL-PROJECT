import { templatePayload } from "./templates";
import type { OutgoingMessage, SendResult, WhatsAppDriver } from "./types";

// Meta WhatsApp Cloud API. Sends approved templates only (business-initiated
// messages outside a customer service window must be templates).
//
// Never logs or returns the access token, the request body or Meta's error
// text; only numeric error codes leave this file.

export type MetaConfig = {
  accessToken: string;
  phoneNumberId: string;
  apiVersion: string;
  baseUrl: string;
  timeoutMs: number;
};

export function readMetaConfig(
  env: Record<string, string | undefined> = process.env,
): MetaConfig | null {
  const accessToken = env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!accessToken || !phoneNumberId || !/^\d{5,30}$/.test(phoneNumberId))
    return null;
  return {
    accessToken,
    phoneNumberId,
    apiVersion: env.WHATSAPP_API_VERSION?.trim() || "v23.0",
    baseUrl: (
      env.WHATSAPP_API_BASE_URL?.trim() || "https://graph.facebook.com"
    ).replace(/\/$/, ""),
    // 10 s by default; tests shorten it to exercise timeouts quickly.
    timeoutMs: Math.min(
      Math.max(Number(env.WHATSAPP_API_TIMEOUT_MS) || 10_000, 1000),
      30_000,
    ),
  };
}

// Meta Cloud API error codes (developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes).
// Temporary conditions are retried; everything else fails at once and is
// flagged for staff. Unknown codes: 5xx retried, 4xx not.
const RETRYABLE_CODES = new Set([
  1, // API unknown
  2, // API service temporarily unavailable
  4, // API too many calls (app-level throttling)
  80007, // WABA rate limit
  130429, // Cloud API throughput reached
  131000, // something went wrong
  131016, // service unavailable
  131048, // spam rate limit
  131056, // pair rate limit (same recipient)
  131057, // business account in maintenance
  133004, // server temporarily unavailable
]);

export function classifyMetaError(
  httpStatus: number,
  code: number | undefined,
) {
  if (code !== undefined && RETRYABLE_CODES.has(code)) return true;
  if (code !== undefined) return false;
  return httpStatus >= 500 || httpStatus === 429;
}

export function createMetaDriver(
  config: MetaConfig | null = readMetaConfig(),
  fetchImpl: typeof fetch = fetch,
): WhatsAppDriver {
  return {
    name: "meta",
    async send(message: OutgoingMessage): Promise<SendResult> {
      // Not configured (credentials pending Meta approval): the business flow
      // continues, the message is recorded as failed and shown to staff.
      if (!config)
        return {
          ok: false,
          errorCode: "config:not_configured",
          retryable: false,
        };

      let response: Response;
      try {
        response = await fetchImpl(
          `${config.baseUrl}/${config.apiVersion}/${config.phoneNumberId}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              recipient_type: "individual",
              to: message.to.replace(/^\+/, ""),
              type: "template",
              template: templatePayload(message),
            }),
            signal: AbortSignal.timeout(config.timeoutMs),
            cache: "no-store",
          },
        );
      } catch (error) {
        const timeout =
          error instanceof Error &&
          /timeout|abort/i.test(error.name + error.message);
        return {
          ok: false,
          errorCode: timeout ? "network:timeout" : "network:error",
          retryable: true,
        };
      }

      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        // Non-JSON (proxy error page, truncated response).
      }
      const id = (body as { messages?: { id?: unknown }[] } | null)
        ?.messages?.[0]?.id;
      if (
        response.ok &&
        typeof id === "string" &&
        id.length > 0 &&
        id.length <= 200
      ) {
        return { ok: true, providerMessageId: id };
      }
      const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
      const numeric =
        typeof code === "number" && Number.isInteger(code) ? code : undefined;
      return {
        ok: false,
        errorCode:
          numeric !== undefined ? `meta:${numeric}` : `http:${response.status}`,
        retryable: classifyMetaError(response.status, numeric),
      };
    },
  };
}
