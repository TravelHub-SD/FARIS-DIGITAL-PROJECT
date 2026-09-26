import { getTranslations } from "next-intl/server";

// Shown by loading.tsx while a per-request page (account, admin, search) is
// on its way, so a tap on a weak connection gets an answer at once. Grey
// blocks shaped like the usual page, announced once to screen readers.
export async function PageLoading({ className = "" }: { className?: string }) {
  const t = await getTranslations("Errors");
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="page-loading"
      className={`grid w-full gap-4 ${className}`}
    >
      <span className="sr-only">{t("loading")}</span>
      <div aria-hidden className="h-8 w-48 animate-pulse rounded-md bg-muted" />
      <div
        aria-hidden
        className="h-4 w-72 max-w-full animate-pulse rounded bg-muted"
      />
      <div aria-hidden className="h-40 animate-pulse rounded-xl bg-muted" />
      <div aria-hidden className="h-24 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}
