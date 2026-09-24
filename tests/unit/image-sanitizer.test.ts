// CLAUDE.md rule 4: MIME type + extension + size validated, EXIF stripped.
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";

import { IMAGE_MAX_BYTES, sanitizeImage } from "@/server/files/image";

let photoWithGps: Buffer;

beforeAll(async () => {
  // A realistic phone photo: EXIF with camera model and GPS coordinates.
  photoWithGps = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: "#336699" },
  })
    .withExif({
      IFD0: {
        Make: "PhoneMaker",
        Model: "Secret-Model-9",
        Copyright: "Customer Name",
      },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "15/1 35/1 0/1",
        GPSLongitudeRef: "E",
        GPSLongitude: "32/1 32/1 0/1",
      },
    })
    .jpeg()
    .toBuffer();
});

describe("image sanitizer", () => {
  it("strips EXIF / GPS: input has it, output has no metadata at all", async () => {
    const inMeta = await sharp(photoWithGps).metadata();
    expect(inMeta.exif, "fixture must carry EXIF").toBeDefined();
    expect(photoWithGps.includes(Buffer.from("Secret-Model-9"))).toBe(true);

    const out = await sanitizeImage({
      name: "id.jpg",
      type: "image/jpeg",
      bytes: photoWithGps,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const outMeta = await sharp(out.jpeg).metadata();
    console.log(
      `[demo] EXIF before: ${inMeta.exif?.length} bytes (GPS + model) -> after: ${outMeta.exif?.length ?? "none"};`,
      `xmp: ${outMeta.xmp?.length ?? "none"}; icc: ${outMeta.icc?.length ?? "none"}`,
    );
    expect(outMeta.exif).toBeUndefined();
    expect(outMeta.xmp).toBeUndefined();
    expect(outMeta.format).toBe("jpeg");
    expect(out.jpeg.includes(Buffer.from("Secret-Model-9"))).toBe(false);
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("re-encoding drops anything appended to the file (polyglot)", async () => {
    const payload = Buffer.from(
      "<script>alert(1)</script>PK\u0003\u0004evil.zip",
    );
    const polyglot = Buffer.concat([photoWithGps, payload]);
    const out = await sanitizeImage({
      name: "id.jpg",
      type: "image/jpeg",
      bytes: polyglot,
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.jpeg.includes(Buffer.from("<script>"))).toBe(false);
  });

  it("converts PNG and WebP to JPEG", async () => {
    for (const [format, mime] of [
      ["png", "image/png"],
      ["webp", "image/webp"],
    ] as const) {
      const bytes = await sharp({
        create: { width: 600, height: 400, channels: 3, background: "#fff" },
      })
        .toFormat(format)
        .toBuffer();
      const out = await sanitizeImage({
        name: `id.${format}`,
        type: mime,
        bytes,
      });
      expect(out.ok, format).toBe(true);
      if (out.ok)
        expect((await sharp(out.jpeg).metadata()).format).toBe("jpeg");
    }
  });

  it.each([
    ["id.gif", "image/jpeg", "bad_extension"],
    ["id.jpg.exe", "image/jpeg", "bad_extension"],
    ["id", "image/jpeg", "bad_extension"],
    ["id.jpg", "application/pdf", "bad_mime"],
    ["id.jpg", "image/svg+xml", "bad_mime"],
  ])("rejects name=%s type=%s → %s", async (name, type, error) => {
    expect(await sanitizeImage({ name, type, bytes: photoWithGps })).toEqual({
      ok: false,
      error,
    });
  });

  it("checks real content, not the name: a PNG named .jpg is refused", async () => {
    const png = await sharp({
      create: { width: 600, height: 400, channels: 3, background: "#fff" },
    })
      .png()
      .toBuffer();
    expect(
      await sanitizeImage({ name: "id.jpg", type: "image/jpeg", bytes: png }),
    ).toEqual({
      ok: false,
      error: "type_mismatch",
    });
  });

  it("a text/HTML file disguised as a JPEG is refused", async () => {
    const html = Buffer.from("<html><script>alert(1)</script></html>");
    expect(
      await sanitizeImage({ name: "id.jpg", type: "image/jpeg", bytes: html }),
    ).toEqual({
      ok: false,
      error: "not_an_image",
    });
  });

  it("SVG (scriptable) is refused even with an image name", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><script>x</script></svg>',
    );
    const out = await sanitizeImage({
      name: "id.png",
      type: "image/png",
      bytes: svg,
    });
    expect(out.ok).toBe(false);
  });

  it("size limits: empty, over 5 MB, and too small to read", async () => {
    expect(
      await sanitizeImage({
        name: "a.jpg",
        type: "image/jpeg",
        bytes: Buffer.alloc(0),
      }),
    ).toEqual({
      ok: false,
      error: "empty",
    });
    expect(
      await sanitizeImage({
        name: "a.jpg",
        type: "image/jpeg",
        bytes: Buffer.alloc(IMAGE_MAX_BYTES + 1),
      }),
    ).toEqual({ ok: false, error: "too_large" });
    const tiny = await sharp({
      create: { width: 120, height: 80, channels: 3, background: "#000" },
    })
      .jpeg()
      .toBuffer();
    expect(
      await sanitizeImage({ name: "a.jpg", type: "image/jpeg", bytes: tiny }),
    ).toEqual({
      ok: false,
      error: "too_small",
    });
  });

  it("decompression bomb: a small file with 48 megapixels (limit 40) is refused", async () => {
    const bomb = await sharp({
      create: { width: 8000, height: 6000, channels: 3, background: "#000" },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    console.log(
      `[demo] bomb: ${bomb.length} bytes on disk, 48,000,000 pixels decoded`,
    );
    expect(bomb.length).toBeLessThan(IMAGE_MAX_BYTES);
    expect(
      await sanitizeImage({ name: "a.png", type: "image/png", bytes: bomb }),
    ).toEqual({
      ok: false,
      error: "too_many_pixels",
    });
  });
});
