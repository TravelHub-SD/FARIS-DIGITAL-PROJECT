"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/server/admin/common";

// Every admin form posts through this component to a Server Action that
// returns { ok } or { ok: false, error }. Submitting via onSubmit (not a form
// `action`) keeps what the admin typed when the server refuses: React resets
// uncontrolled fields after a form action. The clicked button's name/value is
// included, so one form can offer "accept" and "reject".
export function ActionForm({
  action,
  children,
  className,
  successMessage,
  confirmMessage,
  resetOnSuccess = false,
  testId,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
  successMessage?: string;
  confirmMessage?: string;
  resetOnSuccess?: boolean;
  testId?: string;
}) {
  const t = useTranslations("Admin");
  const router = useRouter();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();

  return (
    <form
      method="post"
      className={cn("grid gap-4", className)}
      data-testid={testId}
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        if (confirmMessage && !window.confirm(confirmMessage)) return;
        const form = event.currentTarget;
        // Refuse oversized files before uploading them over a slow
        // connection. The server enforces the same limit regardless.
        for (const input of form.querySelectorAll<HTMLInputElement>(
          "input[type=file][data-max-bytes]",
        )) {
          const file = input.files?.[0];
          if (file && file.size > Number(input.dataset.maxBytes)) {
            setResult({ ok: false, error: "too_large" });
            return;
          }
        }
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        const formData = new FormData(form, submitter);
        startTransition(async () => {
          const res = await action(formData);
          if (!res) return; // the action redirected
          setResult(res);
          if (res.ok) {
            if (resetOnSuccess) form.reset();
            router.refresh();
          }
        });
      }}
    >
      <fieldset disabled={pending || !hydrated} className="contents">
        {children}
      </fieldset>
      {result && (
        <p
          role={result.ok ? "status" : "alert"}
          data-tone={result.ok ? "success" : "error"}
          data-result={result.ok ? "ok" : result.error}
          className={cn(
            "rounded-md border px-3 py-2 text-sm",
            result.ok
              ? "border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
              : "border-destructive/40 bg-destructive/10 text-destructive",
          )}
        >
          {result.ok
            ? (successMessage ?? t("saved"))
            : t.has(`errors.${result.error}`)
              ? t(`errors.${result.error}`)
              : t("errors.server_error")}
        </p>
      )}
    </form>
  );
}
