import { afterEach, describe, expect, it } from "vitest";

import { isIndexable } from "@/lib/seo";

describe("isIndexable: only production on its own domain may be crawled", () => {
  it.each([
    [
      {
        VERCEL_ENV: "production",
        NEXT_PUBLIC_SITE_URL: "https://farisdigital.sd",
      },
      true,
    ],
    [
      {
        VERCEL_ENV: "production",
        NEXT_PUBLIC_SITE_URL: "https://faris-digital.vercel.app",
      },
      false,
    ],
    [
      {
        VERCEL_ENV: "preview",
        NEXT_PUBLIC_SITE_URL: "https://farisdigital.sd",
      },
      false,
    ],
    [{ NEXT_PUBLIC_SITE_URL: "https://farisdigital.sd" }, false],
    [{ VERCEL_ENV: "production" }, false],
    [{ VERCEL_ENV: "production", NEXT_PUBLIC_SITE_URL: "not a url" }, false],
  ])("%j → %s", (env, expected) => {
    expect(isIndexable(env)).toBe(expected);
  });
});

describe("robots.txt", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("production on its own domain: private areas closed, sitemap listed", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.NEXT_PUBLIC_SITE_URL = "https://farisdigital.sd";
    const { default: robots } = await import("@/app/robots");
    const r = robots();
    const rule = [r.rules].flat()[0]!;
    expect(rule.allow).toBe("/");
    expect(rule.disallow).toEqual(
      expect.arrayContaining([
        "/ar/account",
        "/en/admin",
        "/ar/login",
        "/auth/",
      ]),
    );
    expect(r.sitemap).toBe("https://farisdigital.sd/sitemap.xml");
  });

  it("anything else (staging, previews, local): everything closed, no sitemap", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.NEXT_PUBLIC_SITE_URL = "https://faris-digital.vercel.app";
    const { default: robots } = await import("@/app/robots");
    const r = robots();
    expect(r.rules).toEqual([{ userAgent: "*", disallow: "/" }]);
    expect(r.sitemap).toBeUndefined();
  });
});
