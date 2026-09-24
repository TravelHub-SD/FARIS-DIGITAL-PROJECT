import "server-only";

import { isIP } from "node:net";

import { headers } from "next/headers";

// Client IP for rate limiting. On Vercel, x-forwarded-for / x-real-ip are set
// by the platform. Anything that is not a valid IP is ignored (null), which
// only disables the per-IP limit, never the per-phone ones.
export async function getClientIp(): Promise<string | null> {
  const h = await headers();
  const candidates = [
    h.get("x-real-ip"),
    h.get("x-forwarded-for")?.split(",")[0],
  ];
  for (const raw of candidates) {
    const ip = raw?.trim();
    if (ip && isIP(ip)) return ip;
  }
  return null;
}
