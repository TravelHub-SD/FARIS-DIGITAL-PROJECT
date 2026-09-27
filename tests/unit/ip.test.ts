import { describe, expect, it } from "vitest";

import { rateLimitIp } from "@/lib/ip";

describe("rateLimitIp: the unit per-IP limits count against", () => {
  it.each([
    ["196.29.160.10", "196.29.160.10"],
    [" 41.95.1.2 ", "41.95.1.2"],
    ["::ffff:41.95.1.2", "41.95.1.2"],
    ["2001:db8:aa:bb:1:2:3:4", "2001:db8:aa:bb::/64"],
    ["2001:DB8:00aa:00bb::1", "2001:db8:aa:bb::/64"],
    ["2001:db8::1", "2001:db8:0:0::/64"],
    ["fe80::1%eth0", "fe80:0:0:0::/64"],
    ["::1", "0:0:0:0::/64"],
    ["64:ff9b::1.2.3.4", "64:ff9b:0:0::/64"],
    ["not an ip", null],
    ["", null],
    [null, null],
  ])("%s → %s", (raw, expected) => {
    expect(rateLimitIp(raw)).toBe(expected);
  });

  it("every address of one /64 is one key; the next /64 is another", () => {
    const keys = new Set(
      Array.from({ length: 200 }, () => {
        const r = () => Math.floor(Math.random() * 0x10000).toString(16);
        return rateLimitIp(`2c0f:fc88:10:20:${r()}:${r()}:${r()}:${r()}`);
      }),
    );
    expect([...keys]).toEqual(["2c0f:fc88:10:20::/64"]);
    expect(rateLimitIp("2c0f:fc88:10:21::1")).not.toBe("2c0f:fc88:10:20::/64");
  });
});
