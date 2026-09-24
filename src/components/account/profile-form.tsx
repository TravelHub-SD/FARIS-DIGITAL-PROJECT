"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import { Field } from "@/components/auth/form-bits";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { profileSchema } from "@/lib/validation/auth";
import { updateProfile } from "@/server/account/actions";

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
  const form = useForm<
    z.input<typeof profileSchema>,
    unknown,
    z.output<typeof profileSchema>
  >({
    resolver: zodResolver(profileSchema),
    defaultValues: { fullName, locale },
  });

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={form.handleSubmit((v) =>
        startTransition(async () => {
          const res = await updateProfile(v);
          setStatus(res.ok ? "saved" : "failed");
        }),
      )}
    >
      <Field
        id="fullName"
        label={tAuth("fullName")}
        error={form.formState.errors.fullName}
        {...form.register("fullName")}
      />
      <div className="grid gap-2">
        <Label htmlFor="locale">{t("language")}</Label>
        <NativeSelect id="locale" {...form.register("locale")}>
          <option value="ar">{t("languages.ar")}</option>
          <option value="en">{t("languages.en")}</option>
        </NativeSelect>
      </div>
      {status === "saved" && <Alert tone="success">{t("saved")}</Alert>}
      {status === "failed" && <Alert tone="error">{t("saveFailed")}</Alert>}
      <Button type="submit" disabled={pending} className="justify-self-start">
        {t("save")}
      </Button>
    </form>
  );
}
