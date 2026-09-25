"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Opens the browser's print dialog. "Save as PDF" there produces the PDF
 * with the browser's own text engine (correct Arabic shaping and RTL);
 * decisions.md 2026-09-29. The file name defaults to the page title, which
 * is the invoice number.
 */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button
      type="button"
      onClick={() => window.print()}
      data-testid="print-invoice"
    >
      <Printer aria-hidden />
      {label}
    </Button>
  );
}
