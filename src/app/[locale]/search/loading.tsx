import { PageLoading } from "@/components/layout/page-loading";

// The section's layout (nav, container) stays; only the page area waits.
export default function Loading() {
  return <PageLoading className="mx-auto max-w-6xl px-4 py-8" />;
}
