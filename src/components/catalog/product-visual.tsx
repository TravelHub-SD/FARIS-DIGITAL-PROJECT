import { cn } from "@/lib/utils";

// Product images arrive with the admin upload in Phase 6. Until then (and for
// any product without an image) a lightweight brand tile: no network request.
export function ProductVisual({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const initial = [...name.trim()][0] ?? "•";
  return (
    <div
      aria-hidden
      className={cn(
        "flex aspect-[4/3] items-center justify-center rounded-lg bg-gradient-to-br from-primary/90 to-primary/60 text-4xl font-bold text-primary-foreground",
        className,
      )}
    >
      {initial}
    </div>
  );
}
