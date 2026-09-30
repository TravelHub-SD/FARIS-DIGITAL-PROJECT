"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/lib/use-hydrated";
import { otpCodeRule } from "@/lib/validation/auth-rules";
import {
  confirmTotpEnrolment,
  removeTotpFactor,
  startTotpEnrolment,
  verifyTotp,
} from "@/server/auth/mfa-actions";

import {
  type ActionFailure,
  Field,
  useErrorText,
  useRuleForm,
} from "./form-bits";

function CodeForm({
  submitLabel,
  onCode,
  pending,
}: {
  submitLabel: string;
  onCode: (code: string) => void;
  pending: boolean;
}) {
  const t = useTranslations("Auth");
  const hydrated = useHydrated();
  const form = useRuleForm({ code: otpCodeRule }, (v) => onCode(v.code));
  return (
    <form
      method="post"
      className="grid gap-4"
      noValidate
      onSubmit={form.onSubmit}
      onChange={form.onChange}
      data-testid="totp-code-form"
    >
      <Field
        id="totp-code"
        name="code"
        label={t("twoFactor.code")}
        hint={t("twoFactor.codeHint")}
        inputMode="numeric"
        autoComplete="one-time-code"
        dir="ltr"
        maxLength={6}
        error={form.errors.code}
      />
      <Button type="submit" disabled={pending || !hydrated}>
        {submitLabel}
      </Button>
    </form>
  );
}

/** Sign-in step: a code from the staff member's authenticator app. */
export function TotpVerify() {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const errorText = useErrorText();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="grid gap-4">
      <CodeForm
        submitLabel={t("twoFactor.verify")}
        pending={pending}
        onCode={(code) =>
          startTransition(async () => {
            setFailure(null);
            const res = await verifyTotp({ code, locale });
            if (res && !res.ok) setFailure(res);
          })
        }
      />
      {failure && <Alert tone="error">{errorText(failure)}</Alert>}
    </div>
  );
}

/**
 * Adds an authenticator: shows the QR code (and the key for typing in by
 * hand), then asks for the first code, which also completes this sign-in.
 */
export function TotpEnrol({ backup = false }: { backup?: boolean }) {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const errorText = useErrorText();
  const hydrated = useHydrated();
  const [setup, setSetup] = useState<{
    factorId: string;
    qr: string;
    secret: string;
  } | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  const start = () =>
    startTransition(async () => {
      setFailure(null);
      const res = await startTotpEnrolment();
      if (res.ok) setSetup(res);
      else setFailure(res);
    });

  if (!setup)
    return (
      <div className="grid gap-4">
        <Button
          type="button"
          onClick={start}
          disabled={pending || !hydrated}
          variant={backup ? "outline" : "default"}
        >
          {t(backup ? "twoFactor.addBackup" : "twoFactor.start")}
        </Button>
        {failure && <Alert tone="error">{errorText(failure)}</Alert>}
      </div>
    );

  return (
    <div className="grid gap-5" data-testid="totp-setup">
      <ol className="grid list-decimal gap-2 ps-5 text-sm">
        <li>{t("twoFactor.step1")}</li>
        <li>{t("twoFactor.step2")}</li>
        <li>{t("twoFactor.step3")}</li>
      </ol>
      {/* A data: URL made by the Auth server; allowed by the CSP (img-src data:). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={setup.qr}
        alt={t("twoFactor.qrAlt")}
        width={200}
        height={200}
        className="justify-self-center rounded-md bg-white p-2"
      />
      <div className="grid gap-1 text-sm">
        <span className="text-muted-foreground">
          {t("twoFactor.manualKey")}
        </span>
        <code
          dir="ltr"
          data-testid="totp-secret"
          className="rounded-md bg-muted px-3 py-2 font-mono tracking-wider wrap-anywhere"
        >
          {setup.secret.match(/.{1,4}/g)?.join(" ")}
        </code>
      </div>
      <CodeForm
        submitLabel={t("twoFactor.confirm")}
        pending={pending}
        onCode={(code) =>
          startTransition(async () => {
            setFailure(null);
            const res = await confirmTotpEnrolment({
              factorId: setup.factorId,
              code,
              locale,
            });
            if (res && !res.ok) setFailure(res);
          })
        }
      />
      {failure && <Alert tone="error">{errorText(failure)}</Alert>}
    </div>
  );
}

/** Removes one of the signed-in staff member's authenticators. */
export function RemoveTotpButton({ factorId }: { factorId: string }) {
  const t = useTranslations("Auth");
  const errorText = useErrorText();
  const hydrated = useHydrated();
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="grid justify-items-start gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending || !hydrated}
        onClick={() => {
          if (!confirm(t("twoFactor.removeConfirm"))) return;
          startTransition(async () => {
            setFailure(null);
            const res = await removeTotpFactor({ factorId });
            if (!res.ok) setFailure(res);
            else router.refresh();
          });
        }}
      >
        {t("twoFactor.remove")}
      </Button>
      {failure && <Alert tone="error">{errorText(failure)}</Alert>}
    </div>
  );
}
