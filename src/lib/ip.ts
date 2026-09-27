import { isIP } from "node:net";

/**
 * The unit per-IP rate limits count against. IPv4: the address. IPv6: its
 * /64 network, because one subscriber or server is normally given a whole
 * /64 and could otherwise rotate through 2^64 addresses to escape every
 * per-IP limit. IPv4-mapped IPv6 (::ffff:1.2.3.4) counts as the IPv4 address.
 * Returns null for anything that is not an IP (the per-IP limit is then
 * skipped; the per-phone limits and the daily budget still apply).
 */
export function rateLimitIp(raw: string | null | undefined): string | null {
  const ip = raw?.trim();
  if (!ip) return null;
  const kind = isIP(ip);
  if (kind === 4) return ip;
  if (kind !== 6) return null;

  const lower = ip.toLowerCase().replace(/%.*$/, ""); // drop a zone id
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return mapped[1];
  const [head, tail] = lower.includes("::") ? lower.split("::") : [lower, ""];
  const parts = (s: string) => (s ? s.split(":") : []);
  // An embedded IPv4 tail occupies two groups; the /64 never reaches it.
  const tailGroups = parts(tail).flatMap((g) =>
    g.includes(".") ? ["0", "0"] : [g],
  );
  const headGroups = parts(head);
  const groups = [
    ...headGroups,
    ...Array(8 - headGroups.length - tailGroups.length).fill("0"),
    ...tailGroups,
  ];
  const prefix = groups
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(":");
  return `${prefix}::/64`;
}
