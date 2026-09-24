import "server-only";

import { randomUUID } from "node:crypto";

import { thumbPath } from "@/lib/assets";
import { createClient } from "@/lib/supabase/server";
import {
  processPublicImage,
  type PublicImageProfile,
  type PublicImageRejection,
} from "@/server/files/image";

// Public images are written with the ADMIN'S session, not the service role:
// the storage policy lets `products` staff write under products/ and
// categories/, and `settings` staff under site/ — nothing else, nowhere else.

export async function uploadPublicImage(
  file: File,
  profile: PublicImageProfile,
  prefix: string,
): Promise<
  | { ok: true; path: string }
  | { ok: false; error: PublicImageRejection | "upload_failed" }
> {
  const image = await processPublicImage(
    {
      name: file.name,
      type: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
    },
    profile,
  );
  if (!image.ok) return image;

  const supabase = await createClient();
  const base = `${prefix}/${randomUUID()}.webp`;
  const written: string[] = [];
  for (const out of image.outputs) {
    const path = out.name === "thumb" ? thumbPath(base) : base;
    const { error } = await supabase.storage
      .from("public-assets")
      .upload(path, out.webp, {
        contentType: "image/webp",
        // Every upload gets a new name, so the file never changes.
        cacheControl: "31536000",
        upsert: false,
      });
    if (error) {
      if (written.length)
        await supabase.storage.from("public-assets").remove(written);
      return { ok: false, error: "upload_failed" };
    }
    written.push(path);
  }
  return { ok: true, path: base };
}

/** Removes an image and its thumbnail (missing files are ignored). */
export async function removePublicImage(path: string | null | undefined) {
  if (!path) return;
  const supabase = await createClient();
  await supabase.storage.from("public-assets").remove([path, thumbPath(path)]);
}
