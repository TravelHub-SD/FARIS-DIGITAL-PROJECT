import { randomUUID } from "node:crypto";

import { resolveWhatsAppDriver } from "./guard";
import type { SendResult, WhatsAppDriver, WhatsAppMessage } from "./types";

// LOCAL DEVELOPMENT ONLY. Prints messages (including OTP codes) to the local
// console so development is not blocked by Meta template approval. The guard
// runs again on every send, so this driver cannot deliver anything in a
// production or preview runtime even if it were constructed there.
export function createDevDriver(
  env: Record<string, string | undefined> = process.env,
): WhatsAppDriver {
  resolveWhatsAppDriver({ ...env, WHATSAPP_DRIVER: "dev" });
  return {
    name: "dev",
    async send(message: WhatsAppMessage): Promise<SendResult> {
      resolveWhatsAppDriver({ ...process.env, WHATSAPP_DRIVER: "dev" });
      console.info(`[whatsapp:dev] ${describe(message)}`);
      return { providerMessageId: `dev-${randomUUID()}` };
    },
  };
}

function describe(message: WhatsAppMessage): string {
  switch (message.type) {
    case "otp":
      return `OTP for ${message.to}: ${message.code}`;
    case "kyc_result":
      return `KYC ${message.approved ? "approved" : "rejected"} for ${message.to}`;
    case "order_status":
      return `Order ${message.reference} is now ${message.status} (${message.to})`;
  }
}
