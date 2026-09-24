"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { KycErrorKey } from "@/i18n/keys";
import { useRouter } from "@/i18n/navigation";
import { reviewKyc } from "@/server/kyc/actions";

export function KycReviewForm({ submissionId }: { submissionId: string }) {
  const t = useTranslations("Admin");
  const tKyc = useTranslations("Kyc");
  const locale = useLocale();
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const decide = (approve: boolean) =>
    startTransition(async () => {
      setError(null);
      const res = await reviewKyc({
        submissionId,
        approve,
        reason: approve ? undefined : reason,
      });
      if (res.ok) router.replace("/admin/kyc", { locale });
      else {
        const key = `errors.${res.error as KycErrorKey}` as const;
        setError(tKyc.has(key) ? tKyc(key) : tKyc("errors.server_error"));
      }
    });

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="reason">{t("reason")}</Label>
        <Input
          id="reason"
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={pending} onClick={() => decide(true)}>
          {t("approve")}
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={pending}
          onClick={() => decide(false)}
        >
          {t("reject")}
        </Button>
      </div>
    </div>
  );
}
