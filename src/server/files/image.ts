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

export async function sanitizeImage(input: {
  name: string;
  type: string;
  bytes: Buffer;
}): Promise<SanitizedImage | { ok: false; error: ImageRejection }> {
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
