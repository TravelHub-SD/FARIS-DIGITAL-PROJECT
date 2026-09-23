import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getPublicEnv, getServerEnv } from "@/lib/env";

import { fetchWithTimeout } from "./fetch";

// Service-role client: BYPASSES RLS. Import is restricted by ESLint to the
// few server modules listed in eslint.config.mjs (see docs/architecture.md §B).
// Never use it for admin-dashboard mutations; those run as the admin's session.
export function createAdminClient() {
  const { NEXT_PUBLIC_SUPABASE_URL } = getPublicEnv();
  const { SUPABASE_SECRET_KEY } = getServerEnv();

  return createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchWithTimeout },
  });
}
