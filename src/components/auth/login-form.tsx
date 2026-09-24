"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { phoneSchema } from "@/lib/validation/auth";
import { login } from "@/server/auth/actions";

import { type ActionFailure, Field, useErrorText } from "./form-bits";

const loginForm = z.object({
  phone: phoneSchema,
  password: z.string().min(1, "password_required"),
});

export function LoginForm({ next }: { next?: string }) {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const errorText = useErrorText();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<
    z.input<typeof loginForm>,
    unknown,
    z.output<typeof loginForm>
  >({
    resolver: zodResolver(loginForm),
  });

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={form.handleSubmit((v) =>
        startTransition(async () => {
          setFailure(null);
          const res = await login({ ...v, locale, next });
          if (res && !res.ok) setFailure(res);
        }),
      )}
    >
      <Field
        id="phone"
        label={t("phone")}
        hint={t("phoneHint")}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        dir="ltr"
        error={form.formState.errors.phone}
        {...form.register("phone")}
      />
      <Field
        id="password"
        label={t("password")}
        type="password"
        autoComplete="current-password"
        error={form.formState.errors.password}
        {...form.register("password")}
      />
      {failure && <Alert tone="error">{errorText(failure)}</Alert>}
      <Button type="submit" disabled={pending}>
        {t("login.submit")}
      </Button>
    </form>
  );
}
