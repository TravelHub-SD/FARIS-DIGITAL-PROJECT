import { createBrowserClient } from "@supabase/ssr";

import { getPublicEnv } from "@/lib/env";

// Browser client: session handling and OAuth redirects only.
// All data writes go through Server Actions.
export function createClient() {
  const env = getPublicEnv();
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
