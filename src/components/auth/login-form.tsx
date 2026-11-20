"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { loginPasswordRule, phoneRule } from "@/lib/validation/auth-rules";
import { login } from "@/server/auth/actions";

import {
  type ActionFailure,
  Field,
  FormError,
  SubmitButton,
  useErrorText,
  useRuleForm,
} from "./form-bits";

export function LoginForm({ next }: { next?: string }) {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const errorText = useErrorText();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
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
      {failure && <FormError>{errorText(failure)}</FormError>}
      <SubmitButton pending={pending}>{t("login.submit")}</SubmitButton>
    </form>
  );
}
