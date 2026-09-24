"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatPhone } from "@/lib/phone";
import { otpCodeSchema, phoneSchema } from "@/lib/validation/auth";
import { completePhoneLink, requestPhoneLinkOtp } from "@/server/auth/actions";
import { useHydrated } from "@/lib/use-hydrated";

import {
  type ActionFailure,
  Field,
  useCountdown,
  useErrorText,
} from "./form-bits";

const phoneForm = z.object({ phone: phoneSchema });
const codeForm = z.object({ code: otpCodeSchema });

export function CompleteAccountForm() {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const errorText = useErrorText();
  const [phone, setPhone] = useState<string | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();
  const cooldown = useCountdown();
  const first = useForm<
    z.input<typeof phoneForm>,
    unknown,
    z.output<typeof phoneForm>
  >({
    resolver: zodResolver(phoneForm),
  });
  const second = useForm<
    z.input<typeof codeForm>,
    unknown,
    z.output<typeof codeForm>
  >({
    resolver: zodResolver(codeForm),
  });

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

  return phone ? (
    <form
      method="post"
      className="grid gap-4"
      noValidate
      onSubmit={second.handleSubmit((v) =>
        startTransition(async () => {
          setFailure(null);
          const res = await completePhoneLink({ ...v, phone, locale });
          if (res && !res.ok) setFailure(res);
        }),
      )}
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
        error={second.formState.errors.code}
        {...second.register("code")}
      />
      {failure && <Alert tone="error">{errorText(failure)}</Alert>}
      <Button type="submit" disabled={pending || !hydrated}>
        {t("complete.submit")}
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
  ) : (
    <form
      method="post"
      className="grid gap-4"
      noValidate
      onSubmit={first.handleSubmit((v) => sendCode(v.phone))}
    >
      <Field
        id="phone"
        label={t("phone")}
        hint={t("phoneHint")}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        dir="ltr"
        error={first.formState.errors.phone}
        {...first.register("phone")}
      />
      {failure && (
        <Alert tone="error">
          {errorText(failure)}
          {failure.error === "phone_taken" && (
            <span className="mt-1 block">{t("complete.existingAccount")}</span>
          )}
        </Alert>
      )}
      <Button type="submit" disabled={pending || !hydrated}>
        {t("sendCode")}
      </Button>
    </form>
  );
}
