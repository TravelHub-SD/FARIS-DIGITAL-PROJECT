"use client";

import { useParams } from "next/navigation";

import { buttonVariants } from "@/components/ui/button-variants";

// Client error boundary. It cannot call getTranslations, and public pages do
// not ship next-intl's client runtime, so its three strings live here; they
// mirror the "Errors" namespace in messages/*.json.
const copy = {
  ar: {
    title: "الخدمة غير متاحة مؤقتاً",
    body: "حدث خطأ أثناء تحميل الصفحة. يرجى المحاولة مرة أخرى بعد لحظات.",
    retry: "إعادة المحاولة",
  },
  en: {
    title: "Temporarily unavailable",
    body: "Something went wrong while loading this page. Please try again in a moment.",
    retry: "Try again",
  },
} as const;

// Typical cause on the free tier: the Supabase project is paused or cold.
// `retry` re-fetches and re-renders the segment (Next 16.3). `reset` would
// only re-render on the client and never recover from a server error.
export default function ErrorBoundary({ retry }: { retry: () => void }) {
  const params = useParams<{ locale?: string }>();
  const t = copy[params?.locale === "en" ? "en" : "ar"];
  return (
    <div
      role="alert"
      className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-24 text-center"
    >
      <h1 className="text-2xl font-bold">{t.title}</h1>
      <p className="text-muted-foreground">{t.body}</p>
      <button
        type="button"
        className={buttonVariants()}
        onClick={() => retry()}
      >
        {t.retry}
      </button>
    </div>
  );
}
