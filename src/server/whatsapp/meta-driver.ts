import type { WhatsAppDriver } from "./types";
import { WhatsAppNotConfiguredError } from "./types";

// Real Meta Cloud API driver: Phase 7. Until then it fails loudly instead of
// pretending to deliver (CLAUDE.md rule 1: nothing fake).
export function createMetaDriver(): WhatsAppDriver {
  return {
    name: "meta",
    async send() {
      throw new WhatsAppNotConfiguredError(
        "WhatsApp Meta driver is not implemented yet (roadmap Phase 7).",
      );
    },
  };
}
