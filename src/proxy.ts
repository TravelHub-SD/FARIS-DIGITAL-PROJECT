import createIntlMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";

import { routing } from "@/i18n/routing";
import { refreshSession } from "@/lib/supabase/proxy";

const handleI18n = createIntlMiddleware(routing);

export async function proxy(request: NextRequest) {
  return refreshSession(request, () => handleI18n(request));
}

export const config = {
  // Everything except API routes, the OAuth callback, Next internals and files.
  matcher: ["/((?!api|auth|_next|_vercel|.*\\..*).*)"],
};
