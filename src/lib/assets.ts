// Public catalog/site images live in the public `public-assets` bucket and
// are served straight from Supabase Storage (already re-encoded to WebP at
// fixed sizes by the upload pipeline, so no image optimizer is involved).
export function publicAssetUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return `${base}/storage/v1/object/public/public-assets/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

/** Product images are stored as `<id>.webp` (1000 px) + `<id>.thumb.webp` (400 px). */
export const thumbPath = (path: string) =>
  path.replace(/\.webp$/, ".thumb.webp");
