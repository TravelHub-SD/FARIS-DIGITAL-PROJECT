"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AuthErrorKey } from "@/i18n/keys";
import { useHydrated } from "@/lib/use-hydrated";
import type { Rule } from "@/lib/validation/auth-rules";

type FieldProps = React.ComponentProps<typeof Input> & {
  id: string;
  label: string;
  hint?: string;
  /** An Auth.errors key from a failed rule. */
  error?: string;
};

/** Label + input + hint + translated validation message (Auth.errors.*). */
export function Field({ id, label, hint, error, ...inputProps }: FieldProps) {
  const t = useTranslations("Auth.errors");
  const message = error as AuthErrorKey | undefined;
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

type Rules = Record<string, Rule<unknown>>;
type Values<R extends Rules> = {
  [K in keyof R]: R[K] extends Rule<infer T> ? T : never;
};

/**
 * Checks the named inputs of a submitted form against the shared auth rules
 * (the same ones the Server Action re-checks). On failure it shows the
 * messages and focuses the first invalid input; otherwise it calls `onValid`
 * with the normalised values. Editing an input clears its message.
 */
export function useRuleForm<R extends Rules>(
  rules: R,
  onValid: (values: Values<R>) => void,
) {
  const [errors, setErrors] = useState<Partial<Record<keyof R, string>>>({});
  return {
    errors,
    onSubmit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      const form = event.currentTarget;
      const next: Partial<Record<keyof R, string>> = {};
      const values = {} as Values<R>;
      for (const name of Object.keys(rules) as (keyof R & string)[]) {
        const input = form.elements.namedItem(name) as HTMLInputElement | null;
        const result = rules[name](input?.value ?? "");
        if (result.ok) values[name] = result.value as Values<R>[typeof name];
        else next[name] = result.error;
      }
      setErrors(next);
      const firstInvalid = Object.keys(rules).find((name) => next[name]);
      if (firstInvalid) {
        (form.elements.namedItem(firstInvalid) as HTMLInputElement)?.focus();
        return;
      }
      onValid(values);
    },
    onChange(event: FormEvent<HTMLFormElement>) {
      const name = (event.target as HTMLInputElement).name as keyof R;
      if (errors[name]) setErrors((e) => ({ ...e, [name]: undefined }));
    },
  };
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

/** "Step 1 of 2 · Phone number" with a progress bar, for two-step forms. */
export function Steps({
  current,
  labels,
}: {
  current: number;
  labels: string[];
}) {
  const t = useTranslations("Auth");
  return (
    <div className="grid gap-2" data-testid="auth-steps">
      <p className="text-xs font-bold text-primary-text">
        {t("stepOf", { current, total: labels.length })} · {labels[current - 1]}
      </p>
      <div className="grid grid-flow-col gap-1.5" aria-hidden>
        {labels.map((label, i) => (
          <span
            key={label}
            className={`h-1.5 rounded-full ${i < current ? "bg-primary" : "bg-muted"}`}
          />
        ))}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="size-5 animate-spin motion-reduce:animate-none"
      fill="none"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity=".3"
        strokeWidth="3"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The form's main button: full width, disabled until hydration (a click
 * before it would submit natively) and while the action runs, with a
 * spinner. The label never changes, so it keeps its accessible name.
 */
export function SubmitButton({
  pending,
  children,
}: {
  pending: boolean;
  children: React.ReactNode;
}) {
  const hydrated = useHydrated();
  return (
    <Button
      type="submit"
      size="xl"
      className="w-full"
      disabled={pending || !hydrated}
      aria-busy={pending || undefined}
    >
      {pending && <Spinner />}
      {children}
    </Button>
  );
}

/** A failed action, with an icon (the text says what to do next). */
export function FormError({ children }: { children: React.ReactNode }) {
  return (
    <Alert tone="error" className="flex items-start gap-2">
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        className="mt-0.5 size-4 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5v5.5M12 16.5h.01" />
      </svg>
      <span className="grid gap-1">{children}</span>
    </Alert>
  );
}
