"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatPhone } from "@/lib/phone";
import { otpCodeRule, phoneRule } from "@/lib/validation/auth-rules";
import { completePhoneLink, requestPhoneLinkOtp } from "@/server/auth/actions";

import {
  type ActionFailure,
  Field,
  FormError,
  Steps,
  SubmitButton,
  useCountdown,
  useErrorText,
  useRuleForm,
} from "./form-bits";

export function CompleteAccountForm() {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const errorText = useErrorText();
  const [phone, setPhone] = useState<string | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const cooldown = useCountdown();

  const sendCode = (e164: string) =>
    startTransition(async () => {
      setFailure(null);
      const res = await requestPhoneLinkOtp({ phone: e164, locale });
      if (res.ok) {
        setPhone(e164);
        cooldown.start(60);
      } else {
        setFailure(res);
        if (res.retryAfter) cooldown.start(res.retryAfter);
      }
    });
  const first = useRuleForm({ phone: phoneRule }, (v) => sendCode(v.phone));
  const steps = [t("steps.phone"), t("steps.code")];
  const second = useRuleForm({ code: otpCodeRule }, (v) =>
    startTransition(async () => {
      setFailure(null);
      const res = await completePhoneLink({ ...v, phone, locale });
      if (res && !res.ok) setFailure(res);
    }),
  );

  return phone ? (
    <form
      method="post"
      className="grid gap-4"
      noValidate
      onSubmit={second.onSubmit}
      onChange={second.onChange}
    >
      <Steps current={2} labels={steps} />
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
      {failure && <FormError>{errorText(failure)}</FormError>}
      <SubmitButton pending={pending}>{t("complete.submit")}</SubmitButton>
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
  ) : (
    <form
      method="post"
      className="grid gap-4"
      noValidate
      onSubmit={first.onSubmit}
      onChange={first.onChange}
    >
      <Steps current={1} labels={steps} />
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
      {failure && (
        <FormError>
          {errorText(failure)}
          {failure.error === "phone_taken" && (
            <span className="block">{t("complete.existingAccount")}</span>
          )}
        </FormError>
      )}
      <SubmitButton pending={pending}>{t("sendCode")}</SubmitButton>
    </form>
  );
}
