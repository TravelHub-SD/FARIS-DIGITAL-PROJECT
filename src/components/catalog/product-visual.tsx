import { publicAssetUrl, thumbPath } from "@/lib/assets";
import { cn } from "@/lib/utils";

// An uploaded catalog image (pre-sized WebP: 400 px thumb for cards and
// tiles, 1000 px for the product page), or a brand tile with no network
// request when there is none: a gradient picked from the name, and its
// first letter.
const GRADIENTS = [
  "from-[#005cff] to-[#0038a8]",
  "from-[#ff7a00] to-[#b34700]",
  "from-[#2fbf71] to-[#0d6b3a]",
  "from-[#a855f7] to-[#5b1ca8]",
  "from-[#e11d48] to-[#7a0a24]",
  "from-[#0ea5e9] to-[#075985]",
];

function hash(text: string) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.codePointAt(0)!) | 0;
  return Math.abs(h);
}

export function ProductVisual({
  name,
  imagePath,
  size = "thumb",
  priority = false,
  decorative = false,
  className,
}: {
  name: string;
  imagePath?: string | null;
  size?: "thumb" | "full";
  priority?: boolean;
  /** Next to the visible name (tiles, cart): empty alt, no double reading. */
  decorative?: boolean;
  className?: string;
}) {
  if (imagePath) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={publicAssetUrl(
          size === "thumb" ? thumbPath(imagePath) : imagePath,
        )}
        alt={decorative ? "" : name}
        width={size === "thumb" ? 400 : 1000}
        height={size === "thumb" ? 400 : 1000}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        className={cn("aspect-square w-full bg-muted object-cover", className)}
        data-testid="product-image"
      />
    );
  }
  const initial = [...name.trim()][0] ?? "•";
  return (
    <div
      aria-hidden
      className={cn(
        "grid aspect-square w-full place-items-center bg-gradient-to-br text-3xl font-bold text-white",
        GRADIENTS[hash(name) % GRADIENTS.length],
        className,
      )}
    >
      {initial}
    </div>
  );
}
