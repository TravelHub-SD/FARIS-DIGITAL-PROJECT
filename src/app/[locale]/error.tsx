"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

// Typical cause on the free tier: the Supabase project is paused or cold.
// `reset` re-renders the segment, which retries the failed request.
export default function ErrorBoundary({ reset }: { reset: () => void }) {
  const t = useTranslations("Errors");

  return (
    <div
      role="alert"
      className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-24 text-center"
    >
      <h1 className="text-2xl font-bold">{t("unavailableTitle")}</h1>
      <p className="text-muted-foreground">{t("unavailableBody")}</p>
      <Button onClick={() => reset()}>{t("retry")}</Button>
    </div>
  );
}
