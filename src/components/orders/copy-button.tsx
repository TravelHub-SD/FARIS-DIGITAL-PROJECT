"use client";

import { useState } from "react";

import { CheckIcon, CopyIcon } from "@/components/icons";

// Copies a reference, an amount or an account number: customers paste them
// into banking apps. Without JavaScript (or clipboard access) the value next
// to it is still selectable.
export function CopyButton({
  value,
  label,
  copied,
}: {
  value: string;
  label: string;
  copied: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          // Clipboard refused: the value stays selectable.
        }
      }}
      className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border bg-background px-2.5 text-xs font-bold text-primary-text hover:bg-accent"
      aria-label={`${label}: ${value}`}
    >
      {done ? (
        <CheckIcon className="size-4" />
      ) : (
        <CopyIcon className="size-4" />
      )}
      <span aria-live="polite">{done ? copied : label}</span>
    </button>
  );
}
