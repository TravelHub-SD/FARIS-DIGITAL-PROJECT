import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

// Google OAuth return. A first-time Google user now has an INCOMPLETE account
// (no verified phone). /account's guard sends them to /complete-account; no
// other authenticated route or data is usable until the phone OTP succeeds.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const locale = url.searchParams.get("locale") === "en" ? "en" : "ar";
  const code = url.searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error)
      return NextResponse.redirect(new URL(`/${locale}/account`, url.origin));
  }
  return NextResponse.redirect(
    new URL(`/${locale}/login?error=oauth`, url.origin),
  );
}
