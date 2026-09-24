"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { FieldError } from "react-hook-form";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AuthErrorKey } from "@/i18n/keys";

type FieldProps = React.ComponentProps<typeof Input> & {
  id: string;
  label: string;
  hint?: string;
  error?: FieldError;
};

/** Label + input + hint + translated validation message (Auth.errors.*). */
export function Field({ id, label, hint, error, ...inputProps }: FieldProps) {
  const t = useTranslations("Auth.errors");
  const message = error?.message as AuthErrorKey | undefined;
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-invalid={!!error}
        aria-describedby={`${id}-help`}
        {...inputProps}
      />
      <p
        id={`${id}-help`}
        className={
          error ? "text-sm text-destructive" : "text-xs text-muted-foreground"
        }
      >
        {message ? (t.has(message) ? t(message) : message) : hint}
      </p>
    </div>
  );
}

export type ActionFailure = {
  ok: false;
  error: string;
  retryAfter?: number;
  attemptsLeft?: number;
};

/** Translates a Server Action error code. */
export function useErrorText() {
  const t = useTranslations("Auth.errors");
  return (failure: ActionFailure | null) => {
    if (!failure) return null;
    const code = failure.error as AuthErrorKey;
    const key: AuthErrorKey = t.has(code) ? code : "server_error";
    return t(key, {
      seconds: failure.retryAfter ?? 60,
      attempts: failure.attemptsLeft ?? 0,
    });
  };
}

/** Countdown for "send a new code" that mirrors the server's cooldown. */
export function useCountdown() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (seconds <= 0) return;
    const id = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [seconds]);
  return { seconds, start: (s: number) => setSeconds(s) };
}
