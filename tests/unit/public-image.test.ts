// Product/banner/logo uploads: type, size and dimensions validated, then
// re-encoded server-side (WebP, fixed sizes, no metadata) like the KYC pipeline.
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  IMAGE_MAX_BYTES,
  processPublicImage,
  PUBLIC_IMAGE_PROFILES,
} from "@/server/files/image";

const product = PUBLIC_IMAGE_PROFILES.product;
const jpeg = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: "#336699" } })
    .withExif({ IFD0: { Model: "Secret-Model-9" } })
    .jpeg()
    .toBuffer();

describe("public image pipeline (product profile)", () => {
  it("re-encodes to WebP at 1000 px and a 400 px thumbnail, metadata stripped", async () => {
    const input = await jpeg(1600, 1200);
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const out = await processPublicImage(
      { name: "pubg.jpg", type: "image/jpeg", bytes: input },
      product,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const sizes = [];
    for (const o of out.outputs) {
      const meta = await sharp(o.webp).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.exif).toBeUndefined();
      expect(o.webp.includes(Buffer.from("Secret-Model-9"))).toBe(false);
      sizes.push(`${o.name}:${meta.width}x${meta.height}`);
    }
    console.log(
      `[demo] 1600x1200 JPEG with EXIF -> ${sizes.join(", ")}, no EXIF`,
    );
    expect(sizes).toEqual(["full:1000x750", "thumb:400x300"]);
  });

  it("never upscales a small but acceptable image", async () => {
    const out = await processPublicImage(
      { name: "a.jpg", type: "image/jpeg", bytes: await jpeg(320, 320) },
      product,
    );
    expect(out.ok && out.outputs.map((o) => `${o.width}x${o.height}`)).toEqual([
      "320x320",
      "320x320",
    ]);
  });

  const cases: [
    string,
    () => Promise<{ name: string; type: string; bytes: Buffer }>,
    string,
  ][] = [
    [
      "too small (200x200)",
      async () => ({
        name: "s.jpg",
        type: "image/jpeg",
        bytes: await jpeg(200, 200),
      }),
      "too_small",
    ],
    [
      "too wide (2400x500, 4.8:1)",
      async () => ({
        name: "w.jpg",
        type: "image/jpeg",
        bytes: await jpeg(2400, 500),
      }),
      "bad_dimensions",
    ],
    [
      "too tall (400x1500)",
      async () => ({
        name: "t.jpg",
        type: "image/jpeg",
        bytes: await jpeg(400, 1500),
      }),
      "bad_dimensions",
    ],
    [
      "a text file renamed .png",
      async () => ({
        name: "x.png",
        type: "image/png",
        bytes: Buffer.from("<?php system($_GET['c']); ?>"),
      }),
      "not_an_image",
    ],
    [
      "a JPEG named .png",
      async () => ({
        name: "x.png",
        type: "image/png",
        bytes: await jpeg(800, 800),
      }),
      "type_mismatch",
    ],
    [
      "an SVG (script-capable)",
      async () => ({
        name: "x.svg",
        type: "image/svg+xml",
        bytes: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        ),
      }),
      "bad_extension",
    ],
    [
      "a GIF",
      async () => ({
        name: "x.gif",
        type: "image/gif",
        bytes: await sharp({
          create: { width: 400, height: 400, channels: 3, background: "#000" },
        })
          .gif()
          .toBuffer(),
      }),
      "bad_extension",
    ],
    [
      "over 5 MB",
      async () => ({
        name: "big.jpg",
        type: "image/jpeg",
        bytes: Buffer.alloc(IMAGE_MAX_BYTES + 1, 0xff),
      }),
      "too_large",
    ],
    [
      "empty",
      async () => ({
        name: "e.jpg",
        type: "image/jpeg",
        bytes: Buffer.alloc(0),
      }),
      "empty",
    ],
  ];
  for (const [label, make, expected] of cases) {
    it(`rejects ${label} -> ${expected}`, async () => {
      const out = await processPublicImage(await make(), product);
      expect(out).toEqual({ ok: false, error: expected });
    });
  }

  it("drops anything appended to the file (polyglot)", async () => {
    const payload = Buffer.from(
      "<script>alert(1)</script>PK\u0003\u0004evil.zip",
    );
    const out = await processPublicImage(
      {
        name: "p.jpg",
        type: "image/jpeg",
        bytes: Buffer.concat([await jpeg(800, 600), payload]),
      },
      product,
    );
    expect(out.ok).toBe(true);
    if (out.ok)
      for (const o of out.outputs)
        expect(o.webp.includes(Buffer.from("<script>"))).toBe(false);
  });

  it("logo keeps transparency", async () => {
    const png = await sharp({
      create: {
        width: 300,
        height: 100,
        channels: 4,
        background: { r: 0, g: 92, b: 255, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    const out = await processPublicImage(
      { name: "logo.png", type: "image/png", bytes: png },
      PUBLIC_IMAGE_PROFILES.logo,
    );
    expect(out.ok).toBe(true);
    if (out.ok)
      expect((await sharp(out.outputs[0].webp).metadata()).hasAlpha).toBe(true);
  });
});

describe("upload limits (handover guide: resize before upload)", () => {
  it("rejects an original whose longest side exceeds the profile's maximum", async () => {
    const big = await sharp({
      create: { width: 4200, height: 3000, channels: 3, background: "#123456" },
    })
      .jpeg({ quality: 40 })
      .toBuffer();
    const out = await processPublicImage(
      { name: "camera.jpg", type: "image/jpeg", bytes: big },
      PUBLIC_IMAGE_PROFILES.product,
    );
    expect(out).toEqual({ ok: false, error: "too_big_dimensions" });
  });
});
