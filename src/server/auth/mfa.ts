import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

// Staff two-factor authentication (Supabase MFA, TOTP). The database is the
// authority: every admin policy requires the session's aal2 claim
// (private.admin_assurance_ok). These helpers only decide which screen to
// show; nothing here grants access.

export type TotpFactor = { id: string; name: string; createdAt: string };

/** "aal2" once this session was confirmed with an authenticator code. */
export const currentAal = cache(async (): Promise<"aal1" | "aal2" | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return (data?.currentLevel as "aal1" | "aal2" | undefined) ?? null;
});

/** The signed-in user's confirmed authenticators. */
export const verifiedTotpFactors = cache(async (): Promise<TotpFactor[]> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.listFactors();
  return (data?.totp ?? [])
    .filter((f) => f.status === "verified")
    .map((f) => ({
      id: f.id,
      name: f.friendly_name ?? "",
      createdAt: f.created_at,
    }));
});

/** Failed codes per staff member before a 15-minute pause (GoTrue has none). */
export const MFA_FAIL_LIMIT = 5;
export const MFA_FAIL_WINDOW_SECONDS = 15 * 60;
