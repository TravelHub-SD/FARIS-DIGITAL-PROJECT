"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * Google sign-in (or linking, for a signed-in phone account). Rendered only
 * when NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true: the provider needs client
 * credentials that do not exist in local development.
 */
export function GoogleButton({
  mode = "signin",
}: {
  mode?: "signin" | "link";
}) {
  const t = useTranslations(mode === "link" ? "Account" : "Auth");
  const tAuth = useTranslations("Auth");
  const locale = useLocale();
  const [failed, setFailed] = useState(false);

  async function start() {
    setFailed(false);
    // Loaded on click: supabase-js (≈68 KB gzip) stays out of the page's
    // initial JavaScript, which matters on weak connections.
    const { createClient } = await import("@/lib/supabase/browser");
    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback?locale=${locale}`;
    const { error } =
      mode === "link"
        ? await supabase.auth.linkIdentity({
            provider: "google",
            options: { redirectTo },
          })
        : await supabase.auth.signInWithOAuth({
            provider: "google",
            options: { redirectTo },
          });
    if (error) setFailed(true);
  }

  return (
    <div className="grid gap-2">
      <Button type="button" variant="outline" onClick={start}>
        {mode === "link" ? t("linkGoogle") : t("google")}
      </Button>
      {failed && <Alert tone="error">{tAuth("googleUnavailable")}</Alert>}
    </div>
  );
}
