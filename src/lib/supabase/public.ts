import { createClient } from "@supabase/supabase-js";

import { getPublicEnv } from "@/lib/env";

import { fetchWithTimeout } from "./fetch";

// Cookie-less client for PUBLIC pages: reads as `anon`, exactly like any
// visitor or crawler. RLS decides what is visible; admins browsing the
// storefront see only what customers see. Reading no cookies keeps the pages
// static (ISR).
export function createPublicClient() {
  const env = getPublicEnv();
  return createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchWithTimeout },
    },
  );
}
