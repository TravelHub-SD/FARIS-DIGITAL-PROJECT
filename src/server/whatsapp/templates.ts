import type { OutgoingMessage, TemplateName } from "./types";

// Approved-template registry. Names, languages, categories and parameter
// order must match the templates submitted to Meta (docs/whatsapp-templates.md);
// verifying that against the real account is a Phase 10 item.

export type PricingCategory = "authentication" | "utility";

export const TEMPLATES: Record<
  TemplateName,
  { category: PricingCategory; body: string[]; copyCodeButton?: boolean }
> = {
  // Meta authentication template: body {{1}} = code, plus a copy-code button
  // whose URL parameter is the same code.
  otp_code: {
    category: "authentication",
    body: ["code"],
    copyCodeButton: true,
  },
  order_status_update: {
    category: "utility",
    body: ["reference", "status", "note"],
  },
  kyc_approved: { category: "utility", body: [] },
  kyc_rejected: { category: "utility", body: ["reason"] },
};

/** Meta language codes used when the templates are created. */
export const LANGUAGE_CODE = { ar: "ar", en: "en" } as const;

/**
 * Meta rejects parameters with newlines, tabs or more than four consecutive
 * spaces, and empty parameters. Normalise instead of failing the send.
 */
export function cleanParam(
  value: string | null | undefined,
  max = 300,
): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return text === "" ? "—" : text;
}

/** Graph API `template` object for a rendered message. */
export function templatePayload(message: OutgoingMessage) {
  const def = TEMPLATES[message.template];
  const body = def.body.map((key) => ({
    type: "text",
    text: cleanParam(message.params[key]),
  }));
  const components: Record<string, unknown>[] = [];
  if (body.length) components.push({ type: "body", parameters: body });
  if (def.copyCodeButton) {
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: cleanParam(message.params.code) }],
    });
  }
  return {
    name: message.template,
    language: { code: LANGUAGE_CODE[message.language] },
    ...(components.length ? { components } : {}),
  };
}
