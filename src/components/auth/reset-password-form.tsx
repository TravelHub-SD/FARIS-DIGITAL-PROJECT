"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  otpCodeSchema,
  passwordSchema,
  phoneSchema,
} from "@/lib/validation/auth";
import {
  completePasswordReset,
  requestPasswordResetOtp,
} from "@/server/auth/actions";

import {
  type ActionFailure,
  Field,
  useCountdown,
  useErrorText,
} from "./form-bits";

const phoneForm = z.object({ phone: phoneSchema });
const resetForm = z.object({ code: otpCodeSchema, password: passwordSchema });

export function ResetPasswordForm() {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const errorText = useErrorText();
  const [phone, setPhone] = useState<string | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const cooldown = useCountdown();
  const first = useForm<
    z.input<typeof phoneForm>,
    unknown,
    z.output<typeof phoneForm>
  >({
    resolver: zodResolver(phoneForm),
  });
  const second = useForm<
    z.input<typeof resetForm>,
    unknown,
    z.output<typeof resetForm>
  >({
    resolver: zodResolver(resetForm),
  });

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

  if (!phone) {
    return (
      <form
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
        {failure && <Alert tone="error">{errorText(failure)}</Alert>}
        <Button type="submit" disabled={pending}>
          {t("sendCode")}
        </Button>
      </form>
    );
  }

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={second.handleSubmit((v) =>
        startTransition(async () => {
          setFailure(null);
          const res = await completePasswordReset({ ...v, phone, locale });
          if (res && !res.ok) setFailure(res);
        }),
      )}
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
        error={second.formState.errors.code}
        {...second.register("code")}
      />
      <Field
        id="password"
        label={t("newPassword")}
        hint={t("passwordHint")}
        type="password"
        autoComplete="new-password"
        error={second.formState.errors.password}
        {...second.register("password")}
      />
      {failure && <Alert tone="error">{errorText(failure)}</Alert>}
      <Button type="submit" disabled={pending}>
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
