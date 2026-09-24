"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { KycErrorKey } from "@/i18n/keys";
import { submitKyc } from "@/server/kyc/actions";
import { useHydrated } from "@/lib/use-hydrated";

import { prepareImage } from "./prepare-image";

const DOC_TYPES = ["national_id", "passport", "driving_license"] as const;

export function KycUploadForm() {
  const t = useTranslations("Kyc");
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();

  return (
    <form
      method="post"
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const docType = (
          form.elements.namedItem("docType") as HTMLSelectElement
        ).value;
        const picked = (form.elements.namedItem("file") as HTMLInputElement)
          .files?.[0];
        if (!picked) {
          setResult({ ok: false, error: "empty" });
          return;
        }
        startTransition(async () => {
          const data = new FormData();
          data.set("docType", docType);
          data.set("file", await prepareImage(picked));
          const res = await submitKyc(data);
          setResult(res.ok ? { ok: true } : { ok: false, error: res.error });
        });
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="docType">{t("docType")}</Label>
        <NativeSelect id="docType" name="docType" defaultValue="national_id">
          {DOC_TYPES.map((d) => (
            <option key={d} value={d}>
              {t(`docTypes.${d}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="file">{t("file")}</Label>
        <Input
          id="file"
          name="file"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-describedby="file-help"
        />
        <p id="file-help" className="text-xs text-muted-foreground">
          {t("fileHint")}
        </p>
      </div>
      {result?.ok && <Alert tone="success">{t("submitted")}</Alert>}
      {result && !result.ok && (
        <Alert tone="error">
          {t.has(`errors.${result.error as KycErrorKey}`)
            ? t(`errors.${result.error as KycErrorKey}`)
            : t("errors.server_error")}
        </Alert>
      )}
      <Button
        type="submit"
        disabled={pending || !hydrated}
        className="justify-self-start"
      >
        {t("submit")}
      </Button>
    </form>
  );
}
