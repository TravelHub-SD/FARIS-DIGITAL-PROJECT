import createIntlMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";

import { routing } from "@/i18n/routing";
import { contentSecurityPolicy, createNonce } from "@/lib/csp";
import { getSiteUrl } from "@/lib/env";
import { refreshSession } from "@/lib/supabase/proxy";

const handleI18n = createIntlMiddleware(routing);

export async function proxy(request: NextRequest) {
  const nonce = createNonce();
  const csp = contentSecurityPolicy(nonce, {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid",
    dev: process.env.NODE_ENV === "development",
    https: getSiteUrl().protocol === "https:",
  });
  // Next reads the nonce from the request's CSP header and stamps it on its
  // own scripts; set() also overwrites anything a client sent under that name.
  // next-intl forwards the request headers to the page render.
  request.headers.set("content-security-policy", csp);
  request.headers.set("x-nonce", nonce);
  const response = await refreshSession(request, () => handleI18n(request));
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Everything except API routes, the OAuth callback, Next internals and files.
  matcher: ["/((?!api|auth|_next|_vercel|.*\\..*).*)"],
};
