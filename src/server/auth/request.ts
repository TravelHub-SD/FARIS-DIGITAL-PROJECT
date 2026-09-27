import "server-only";

import { headers } from "next/headers";

import { rateLimitIp } from "@/lib/ip";

// Client IP for rate limiting (IPv6 as its /64, see rateLimitIp). On Vercel,
// x-forwarded-for / x-real-ip are set by the platform and cannot be forged by
// the client; behind any other host they must be overwritten by the proxy.
// Anything that is not a valid IP is ignored (null), which only disables the
// per-IP limit, never the per-phone ones.
export async function getClientIp(): Promise<string | null> {
  const h = await headers();
  const candidates = [
    h.get("x-real-ip"),
    h.get("x-forwarded-for")?.split(",")[0],
  ];
  for (const raw of candidates) {
    const ip = rateLimitIp(raw);
    if (ip) return ip;
  }
  return null;
}
