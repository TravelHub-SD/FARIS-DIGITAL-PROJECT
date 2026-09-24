"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { OrderErrorKey } from "@/i18n/keys";
import { submitReceipt } from "@/server/orders/actions";

import { prepareImage } from "./prepare-image";

// Banking-app screenshots are small and go up unchanged, so the same
// screenshot always produces the same stored file (duplicate detection by
// hash). Only large camera photos are shrunk in the browser first.
const SHRINK_ABOVE_BYTES = 1.5 * 1024 * 1024;

export function ReceiptForm({
  orderId,
  banks,
}: {
  orderId: string;
  banks: { id: string; name: string }[];
}) {
  const t = useTranslations("Orders");
  const router = useRouter();
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="grid gap-4"
      data-testid="receipt-form"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const value = (name: string) =>
          (form.elements.namedItem(name) as HTMLInputElement).value;
        const picked = (form.elements.namedItem("file") as HTMLInputElement)
          .files?.[0];
        if (!picked) {
          setResult({ ok: false, error: "empty" });
          return;
        }
        startTransition(async () => {
          const data = new FormData();
          data.set("orderId", orderId);
          data.set("bankAccountId", value("bankAccountId"));
          data.set("transactionRef", value("transactionRef"));
          data.set(
            "file",
            picked.size > SHRINK_ABOVE_BYTES
              ? await prepareImage(picked, "receipt.jpg")
              : picked,
          );
          const res = await submitReceipt(data);
          setResult(res.ok ? { ok: true } : { ok: false, error: res.error });
          if (res.ok) router.refresh();
        });
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="bankAccountId">{t("bank")}</Label>
        <NativeSelect id="bankAccountId" name="bankAccountId" required>
          {banks.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="transactionRef">{t("transactionRef")}</Label>
        <Input
          id="transactionRef"
          name="transactionRef"
          required
          maxLength={64}
          dir="ltr"
          autoComplete="off"
          aria-describedby="transactionRef-help"
        />
        <p id="transactionRef-help" className="text-xs text-muted-foreground">
          {t("transactionRefHint")}
        </p>
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
        <Alert tone="error" data-error={result.error}>
          {t.has(`errors.${result.error as OrderErrorKey}`)
            ? t(`errors.${result.error as OrderErrorKey}`)
            : t("errors.server_error")}
        </Alert>
      )}
      <Button type="submit" disabled={pending} className="justify-self-start">
        {t("submit")}
      </Button>
    </form>
  );
}
