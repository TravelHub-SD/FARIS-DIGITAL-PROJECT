import type { MetadataRoute } from "next";

import { getSiteUrl } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  const base = getSiteUrl();
  const privatePaths = [
    "account",
    "admin",
    "complete-account",
    "login",
    "register",
    "reset-password",
    "search",
  ].flatMap((p) => [`/ar/${p}`, `/en/${p}`]);
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: [...privatePaths, "/auth/"] },
    ],
    sitemap: new URL("/sitemap.xml", base).toString(),
  };
}
