import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Baseline headers. A nonce-based Content-Security-Policy is deferred to the
// Phase 10 security review, once third-party scripts (Turnstile) are known.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // Next 16.3 inlines a layout's prefetch data into the page when it is
    // under 2 KB gzip and writes it to its own file otherwise, per param
    // value. Our Arabic layout is just over the limit and the English one just
    // under, but the client router uses one route tree for both, so it asked
    // for /en's layout file, which was never written (404 on prefetch).
    // Without inlining every segment gets its own file in both locales, so
    // prefetch no longer depends on how many bytes the header and footer hold.
    // (docs/decisions.md 2026-09-26; revisit when Next fixes it upstream.)
    prefetchInlining: false,
    serverActions: {
      // KYC photos: 5 MB file limit + multipart overhead. The browser shrinks
      // photos first, so real uploads are far smaller.
      bodySizeLimit: "6mb",
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);
