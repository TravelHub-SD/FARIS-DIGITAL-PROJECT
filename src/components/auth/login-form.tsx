"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { loginPasswordRule, phoneRule } from "@/lib/validation/auth-rules";
import { login } from "@/server/auth/actions";
import { useHydrated } from "@/lib/use-hydrated";

import {
  type ActionFailure,
  Field,
  useErrorText,
  useRuleForm,
} from "./form-bits";

export function LoginForm({ next }: { next?: string }) {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const errorText = useErrorText();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();
  const form = useRuleForm(
    { phone: phoneRule, password: loginPasswordRule },
    (v) =>
      startTransition(async () => {
        setFailure(null);
        const res = await login({ ...v, locale, next });
        if (res && !res.ok) setFailure(res);
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
        id="phone"
        name="phone"
        label={t("phone")}
        hint={t("phoneHint")}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        dir="ltr"
        error={form.errors.phone}
      />
      <Field
        id="password"
        name="password"
        label={t("password")}
        type="password"
        autoComplete="current-password"
        error={form.errors.password}
      />
      {failure && <Alert tone="error">{errorText(failure)}</Alert>}
      <Button type="submit" disabled={pending || !hydrated}>
        {t("login.submit")}
      </Button>
    </form>
  );
}
