"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Field, useRuleForm } from "@/components/auth/form-bits";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { fullNameRule, localeRule } from "@/lib/validation/auth-rules";
import { updateProfile } from "@/server/account/actions";
import { useHydrated } from "@/lib/use-hydrated";

export function ProfileForm({
  fullName,
  locale,
}: {
  fullName: string;
  locale: "ar" | "en";
}) {
  const t = useTranslations("Account");
  const tAuth = useTranslations("Auth");
  const [status, setStatus] = useState<"idle" | "saved" | "failed">("idle");
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();
  const form = useRuleForm(
    { fullName: fullNameRule, locale: localeRule },
    (v) =>
      startTransition(async () => {
        const res = await updateProfile(v);
        setStatus(res.ok ? "saved" : "failed");
      }),
  );

  return (
    <form
      method="post"
      className="grid gap-4"
      noValidate
      onSubmit={form.onSubmit}
      onChange={form.onChange}
    >
      <Field
        id="fullName"
        name="fullName"
        label={tAuth("fullName")}
        defaultValue={fullName}
        error={form.errors.fullName}
      />
      <div className="grid gap-2">
        <Label htmlFor="locale">{t("language")}</Label>
        <NativeSelect id="locale" name="locale" defaultValue={locale}>
          <option value="ar">{t("languages.ar")}</option>
          <option value="en">{t("languages.en")}</option>
        </NativeSelect>
      </div>
      {status === "saved" && <Alert tone="success">{t("saved")}</Alert>}
      {status === "failed" && <Alert tone="error">{t("saveFailed")}</Alert>}
      <Button
        type="submit"
        disabled={pending || !hydrated}
        className="justify-self-start"
      >
        {t("save")}
      </Button>
    </form>
  );
}
