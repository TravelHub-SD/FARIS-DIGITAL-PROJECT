"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatPhone } from "@/lib/phone";
import { useHydrated } from "@/lib/use-hydrated";
import {
  fullNameRule,
  newPasswordRule,
  otpCodeRule,
  phoneRule,
} from "@/lib/validation/auth-rules";
import {
  completeRegistration,
  requestRegistrationOtp,
} from "@/server/auth/actions";

import {
  type ActionFailure,
  Field,
  useCountdown,
  useErrorText,
  useRuleForm,
} from "./form-bits";

export function RegisterForm() {
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
      const res = await requestRegistrationOtp({ phone: e164, locale });
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
    { code: otpCodeRule, fullName: fullNameRule, password: newPasswordRule },
    (v) =>
      startTransition(async () => {
        setFailure(null);
        const res = await completeRegistration({ ...v, phone, locale });
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
      <Alert>{t("codeSentTo", { phone: formatPhone(phone) })}</Alert>
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
        id="fullName"
        label={t("fullName")}
        autoComplete="name"
        name="fullName"
        error={second.errors.fullName}
      />
      <Field
        id="password"
        label={t("password")}
        hint={t("passwordHint")}
        type="password"
        autoComplete="new-password"
        name="password"
        error={second.errors.password}
      />
      {failure && <Alert tone="error">{errorText(failure)}</Alert>}
      <Button type="submit" disabled={pending || !hydrated}>
        {t("register.submit")}
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <Button
          type="button"
          variant="link"
          className="px-0"
          onClick={() => setPhone(null)}
        >
          {t("changePhone")}
        </Button>
        <Button
          type="button"
          variant="link"
          className="px-0"
          disabled={pending || cooldown.seconds > 0}
          onClick={() => sendCode(phone)}
        >
          {cooldown.seconds > 0
            ? t("resendIn", { seconds: cooldown.seconds })
            : t("resendCode")}
        </Button>
      </div>
    </form>
  );
}
