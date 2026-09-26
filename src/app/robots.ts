import type { MetadataRoute } from "next";

import { getSiteUrl } from "@/lib/env";
import { isIndexable } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  // Staging, previews and local runs: nothing may be crawled (lib/seo.ts).
  if (!isIndexable()) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
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
