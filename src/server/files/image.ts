import { createHash } from "node:crypto";

import sharp, { type Metadata, type OutputInfo } from "sharp";

// Pure image sanitiser (no Supabase, no server-only) so it is unit-testable.
// CLAUDE.md rule 4: validate MIME type + extension + size, strip EXIF.
// Every accepted file is DECODED and RE-ENCODED: the stored JPEG contains only
// pixels. EXIF/GPS/XMP/ICC metadata, comments, and anything appended to the
// original file (polyglots) are gone.

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000; // decompression-bomb guard
const MIN_DIMENSION = 300; // an unreadable thumbnail is useless for review
const OUTPUT_MAX_DIMENSION = 2400;

const EXTENSIONS: Record<string, "jpeg" | "png" | "webp"> = {
  ".jpg": "jpeg",
  ".jpeg": "jpeg",
  ".png": "png",
  ".webp": "webp",
};
const MIME_TYPES: Record<string, "jpeg" | "png" | "webp"> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};

export type ImageRejection =
  | "empty"
  | "too_large"
  | "bad_extension"
  | "bad_mime"
  | "type_mismatch"
  | "not_an_image"
  | "too_small"
  | "too_many_pixels";

export type SanitizedImage = {
  ok: true;
  jpeg: Buffer;
  sha256: string;
  width: number;
  height: number;
};

type ImageInput = { name: string; type: string; bytes: Buffer };

/**
 * Checks shared by every upload: size, extension, declared MIME type, and the
 * real format read from the bytes (all three must agree).
 */
async function inspect(
  input: ImageInput,
): Promise<
  { ok: true; meta: Metadata } | { ok: false; error: ImageRejection }
> {
  if (input.bytes.length === 0) return { ok: false, error: "empty" };
  if (input.bytes.length > IMAGE_MAX_BYTES)
    return { ok: false, error: "too_large" };

  const ext = /\.[a-z0-9]+$/i.exec(input.name)?.[0]?.toLowerCase() ?? "";
  const extFormat = EXTENSIONS[ext];
  if (!extFormat) return { ok: false, error: "bad_extension" };
  const mimeFormat = MIME_TYPES[input.type];
  if (!mimeFormat) return { ok: false, error: "bad_mime" };

  // The real format comes from the file's bytes, not from its name or header.
  let actual: Metadata;
  try {
    actual = await sharp(input.bytes, {
      limitInputPixels: MAX_INPUT_PIXELS,
    }).metadata();
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    return {
      ok: false,
      error: /pixel limit/i.test(msg) ? "too_many_pixels" : "not_an_image",
    };
  }
  const actualFormat = actual.format;
  if (
    actualFormat !== "jpeg" &&
    actualFormat !== "png" &&
    actualFormat !== "webp"
  ) {
    return { ok: false, error: "not_an_image" };
  }
  if (actualFormat !== extFormat || actualFormat !== mimeFormat) {
    return { ok: false, error: "type_mismatch" };
  }
  if ((actual.width ?? 0) * (actual.height ?? 0) > MAX_INPUT_PIXELS) {
    return { ok: false, error: "too_many_pixels" };
  }
  return { ok: true, meta: actual };
}

/** Private documents (KYC, receipts): re-encoded JPEG, readable size. */
export async function sanitizeImage(
  input: ImageInput,
): Promise<SanitizedImage | { ok: false; error: ImageRejection }> {
  const checked = await inspect(input);
  if (!checked.ok) return checked;

  let out: { data: Buffer; info: OutputInfo };
  try {
    out = await sharp(input.bytes, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate() // apply EXIF orientation to the pixels before metadata is dropped
      .resize({
        width: OUTPUT_MAX_DIMENSION,
        height: OUTPUT_MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 85, mozjpeg: true }) // sharp writes no metadata unless asked
      .toBuffer({ resolveWithObject: true });
  } catch {
    return { ok: false, error: "not_an_image" };
  }
  if (Math.min(out.info.width, out.info.height) < MIN_DIMENSION) {
    return { ok: false, error: "too_small" };
  }

  return {
    ok: true,
    jpeg: out.data,
    sha256: createHash("sha256").update(out.data).digest("hex"),
    width: out.info.width,
    height: out.info.height,
  };
}

// Public images (catalog, banner, logo): served to every visitor on weak
// connections, so they are re-encoded to WebP at fixed sizes. Transparency is
// kept (logos). Dimensions are checked on the ORIGINAL (after orientation):
// an upscaled thumbnail would look broken on the site.
export type PublicImageProfile = {
  minWidth: number;
  minHeight: number;
  /** Longest side of the ORIGINAL; larger files must be resized before upload. */
  maxEdge: number;
  /** width / height must fall inside this range */
  aspect: [number, number];
  /** Output sizes, largest first; each fits inside a box of this edge. */
  sizes: { name: string; box: number; quality: number }[];
};

export const PUBLIC_IMAGE_PROFILES = {
  product: {
    minWidth: 300,
    minHeight: 300,
    maxEdge: 4000,
    aspect: [1 / 3, 3],
    sizes: [
      { name: "full", box: 1000, quality: 80 },
      { name: "thumb", box: 400, quality: 75 },
    ],
  },
  banner: {
    minWidth: 800,
    minHeight: 200,
    maxEdge: 6000,
    aspect: [1.5, 6],
    sizes: [{ name: "full", box: 1600, quality: 80 }],
  },
  logo: {
    minWidth: 64,
    minHeight: 64,
    maxEdge: 2000,
    aspect: [1 / 2, 6],
    sizes: [{ name: "full", box: 512, quality: 90 }],
  },
} satisfies Record<string, PublicImageProfile>;

export type PublicImageRejection =
  ImageRejection | "bad_dimensions" | "too_big_dimensions";

export type ProcessedPublicImage = {
  ok: true;
  width: number;
  height: number;
  outputs: { name: string; webp: Buffer; width: number; height: number }[];
};

export async function processPublicImage(
  input: ImageInput,
  profile: PublicImageProfile,
): Promise<ProcessedPublicImage | { ok: false; error: PublicImageRejection }> {
  const checked = await inspect(input);
  if (!checked.ok) return checked;
  // EXIF orientations 5–8 swap width and height.
  const swap = (checked.meta.orientation ?? 1) >= 5;
  const width = (swap ? checked.meta.height : checked.meta.width) ?? 0;
  const height = (swap ? checked.meta.width : checked.meta.height) ?? 0;
  if (width < profile.minWidth || height < profile.minHeight) {
    return { ok: false, error: "too_small" };
  }
  if (Math.max(width, height) > profile.maxEdge) {
    return { ok: false, error: "too_big_dimensions" };
  }
  const ratio = width / height;
  if (ratio < profile.aspect[0] || ratio > profile.aspect[1]) {
    return { ok: false, error: "bad_dimensions" };
  }

  const outputs: ProcessedPublicImage["outputs"] = [];
  try {
    for (const size of profile.sizes) {
      const out = await sharp(input.bytes, {
        limitInputPixels: MAX_INPUT_PIXELS,
      })
        .rotate()
        .resize({
          width: size.box,
          height: size.box,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: size.quality }) // no metadata unless asked
        .toBuffer({ resolveWithObject: true });
      outputs.push({
        name: size.name,
        webp: out.data,
        width: out.info.width,
        height: out.info.height,
      });
    }
  } catch {
    return { ok: false, error: "not_an_image" };
  }
  return { ok: true, width, height, outputs };
}
