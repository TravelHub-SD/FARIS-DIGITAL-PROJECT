import { publicAssetUrl, thumbPath } from "@/lib/assets";
import { cn } from "@/lib/utils";

// The product image uploaded in the dashboard (pre-sized WebP: 400 px thumb
// for cards, 1000 px for the product page), or a brand tile with no network
// request when there is none.
export function ProductVisual({
  name,
  imagePath,
  size = "thumb",
  priority = false,
  className,
}: {
  name: string;
  imagePath?: string | null;
  size?: "thumb" | "full";
  priority?: boolean;
  className?: string;
}) {
  if (imagePath) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={publicAssetUrl(
          size === "thumb" ? thumbPath(imagePath) : imagePath,
        )}
        alt={name}
        width={size === "thumb" ? 400 : 1000}
        height={size === "thumb" ? 300 : 750}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        className={cn(
          "aspect-[4/3] w-full rounded-lg bg-muted object-contain",
          className,
        )}
        data-testid="product-image"
      />
    );
  }
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
