import type { Locale } from "@/i18n/routing";

// One method per Meta template (spec §6). Business logic depends on this
// interface only; it never calls the Meta API directly.
export type WhatsAppMessage =
  | { type: "otp"; to: string; code: string; locale: Locale }
  | {
      type: "kyc_result";
      to: string;
      approved: boolean;
      reason?: string | null;
      locale: Locale;
    }
  | {
      type: "order_status";
      to: string;
      reference: string;
      status: string;
      locale: Locale;
    };

export type SendResult = { providerMessageId: string | null };

export interface WhatsAppDriver {
  readonly name: "dev" | "meta";
  send(message: WhatsAppMessage): Promise<SendResult>;
}

export class WhatsAppNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatsAppNotConfiguredError";
  }
}
