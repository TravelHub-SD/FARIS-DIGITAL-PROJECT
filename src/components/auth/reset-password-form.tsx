"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/lib/use-hydrated";
import {
  newPasswordRule,
  otpCodeRule,
  phoneRule,
} from "@/lib/validation/auth-rules";
import {
  completePasswordReset,
  requestPasswordResetOtp,
} from "@/server/auth/actions";

import {
  type ActionFailure,
  Field,
  useCountdown,
  useErrorText,
  useRuleForm,
} from "./form-bits";

export function ResetPasswordForm() {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const errorText = useErrorText();
  const [phone, setPhone] = useState<string | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();
  const cooldown = useCountdown();

  const sendCode = (e164: string) =>
    startTransition(async () => {
      setFailure(null);
      const res = await requestPasswordResetOtp({ phone: e164, locale });
      if (res.ok) {
        setPhone(e164);
        cooldown.start(60);
      } else {
        setFailure(res);
        if (res.retryAfter) cooldown.start(res.retryAfter);
      }
    });
  const first = useRuleForm({ phone: phoneRule }, (v) => sendCode(v.phone));
  const second = useRuleForm(
    { code: otpCodeRule, password: newPasswordRule },
    (v) =>
      startTransition(async () => {
        setFailure(null);
        const res = await completePasswordReset({ ...v, phone, locale });
        if (res && !res.ok) setFailure(res);
      }),
  );

  if (!phone) {
    return (
      <form
        method="post"
        className="grid gap-4"
        noValidate
        onSubmit={first.onSubmit}
        onChange={first.onChange}
      >
        <Field
          id="phone"
          label={t("phone")}
          hint={t("phoneHint")}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          dir="ltr"
          name="phone"
          error={first.errors.phone}
        />
        {failure && <Alert tone="error">{errorText(failure)}</Alert>}
        <Button type="submit" disabled={pending || !hydrated}>
          {t("sendCode")}
        </Button>
      </form>
    );
  }

  return (
    <form
      method="post"
      className="grid gap-4"
      noValidate
      onSubmit={second.onSubmit}
      onChange={second.onChange}
    >
      <Alert>{t("reset.sentGeneric")}</Alert>
      <Field
        id="code"
        label={t("code")}
        hint={t("codeHint")}
        inputMode="numeric"
        autoComplete="one-time-code"
        dir="ltr"
        maxLength={6}
        name="code"
        error={second.errors.code}
      />
      <Field
        id="password"
        label={t("newPassword")}
        hint={t("passwordHint")}
        type="password"
        autoComplete="new-password"
        name="password"
        error={second.errors.password}
      />
      {failure && <Alert tone="error">{errorText(failure)}</Alert>}
      <Button type="submit" disabled={pending || !hydrated}>
        {t("reset.submit")}
      </Button>
      <Button
        type="button"
        variant="link"
        className="justify-self-start px-0"
        disabled={pending || cooldown.seconds > 0}
        onClick={() => sendCode(phone)}
      >
        {cooldown.seconds > 0
          ? t("resendIn", { seconds: cooldown.seconds })
          : t("resendCode")}
      </Button>
    </form>
  );
}
