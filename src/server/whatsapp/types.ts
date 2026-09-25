import type { Locale } from "@/i18n/routing";

// Business code talks to WhatsApp through this module only; drivers are the
// only code that knows the Meta API.

/** The OTP as produced by the OTP service (the code lives only in memory). */
export type OtpMessage = {
  type: "otp";
  to: string;
  code: string;
  locale: Locale;
};
/** Kept for the OTP service's injected sender. */
export type WhatsAppMessage = OtpMessage;

export type TemplateName =
  "otp_code" | "order_status_update" | "kyc_approved" | "kyc_rejected";

/** A rendered template ready for a driver. Never stored anywhere. */
export type OutgoingMessage = {
  to: string; // E.164
  template: TemplateName;
  language: Locale;
  params: Record<string, string>;
};

/**
 * Drivers do not throw for delivery problems: they report a short error code
 * (`meta:131026`, `http:503`, `network:timeout`, `config:not_configured`) and
 * whether trying again later can help. Provider error TEXT is never returned:
 * it can echo parameter values (codes, names).
 */
export type SendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; errorCode: string; retryable: boolean };

export interface WhatsAppDriver {
  readonly name: "dev" | "meta";
  send(message: OutgoingMessage): Promise<SendResult>;
}
