import { randomUUID } from "node:crypto";

import { resolveWhatsAppDriver } from "./guard";
import type { OutgoingMessage, SendResult, WhatsAppDriver } from "./types";

// LOCAL DEVELOPMENT ONLY (`npm run dev` without Meta credentials). Prints the
// OTP code to the local console so sign-up works offline; other messages
// print only their template name. The guard runs again on every send, so this
// driver cannot deliver anything in a production or preview runtime even if
// it were constructed there. Automated tests use the real Meta driver against
// a fake Graph API instead (tests/fakes).
export function createDevDriver(
  env: Record<string, string | undefined> = process.env,
): WhatsAppDriver {
  resolveWhatsAppDriver({ ...env, WHATSAPP_DRIVER: "dev" });
  return {
    name: "dev",
    async send(message: OutgoingMessage): Promise<SendResult> {
      resolveWhatsAppDriver({ ...process.env, WHATSAPP_DRIVER: "dev" });
      console.info(
        message.template === "otp_code"
          ? `[whatsapp:dev] OTP for ${message.to}: ${message.params.code}`
          : `[whatsapp:dev] ${message.template} (${message.language}) to ${message.to}`,
      );
      return { ok: true, providerMessageId: `dev-${randomUUID()}` };
    },
  };
}
