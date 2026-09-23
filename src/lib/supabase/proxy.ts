import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";

import { getPublicEnv } from "@/lib/env";

import { createTimeoutFetch } from "./fetch";

type CookieToSet = { name: string; value: string; options?: object };

function hasAuthCookie(request: NextRequest) {
  return request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"));
}

// Refreshes an existing Supabase session and copies rotated cookies onto
// `response`. This is session upkeep only, never authorization: every page,
// Server Action and RLS policy re-checks the user on its own.
export async function refreshSession(
  request: NextRequest,
  buildResponse: () => NextResponse,
): Promise<NextResponse> {
  // Anonymous visitors: skip the auth round-trip entirely (weak connections,
  // and a paused database must not slow down public pages).
  if (!hasAuthCookie(request)) return buildResponse();

  let pending: CookieToSet[] = [];
  try {
    const env = getPublicEnv();
    const supabase = createServerClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      {
        global: { fetch: createTimeoutFetch(4_000) },
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            for (const { name, value } of cookiesToSet) {
              request.cookies.set(name, value);
            }
            pending = cookiesToSet;
          },
        },
      },
    );
    // Must run before the response is built; it triggers setAll on refresh.
    await supabase.auth.getClaims();
  } catch {
    // Auth unreachable (cold/paused project) or env missing: render anyway.
    // Protected pages re-check the session and handle the failure themselves.
    pending = [];
  }

  const response = buildResponse();
  for (const { name, value, options } of pending) {
    response.cookies.set(name, value, options);
  }
  return response;
}
