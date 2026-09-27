import { describe, expect, it } from "vitest";

import { contentSecurityPolicy, createNonce } from "@/lib/csp";

const prod = {
  supabaseUrl: "https://abc.supabase.co",
  dev: false,
  https: true,
};

const directives = (csp: string) =>
  Object.fromEntries(
    csp.split("; ").map((d) => {
      const [name, ...values] = d.split(" ");
      return [name, values];
    }),
  );

describe("contentSecurityPolicy", () => {
  it("production: scripts only by nonce, no inline or eval, no framing", () => {
    const d = directives(contentSecurityPolicy("N0nce", prod));
    expect(d["script-src"]).toEqual([
      "'self'",
      "'nonce-N0nce'",
      "'strict-dynamic'",
    ]);
    expect(d["script-src"]).not.toContain("'unsafe-inline'");
    expect(d["script-src"]).not.toContain("'unsafe-eval'");
    expect(d["object-src"]).toEqual(["'none'"]);
    expect(d["base-uri"]).toEqual(["'self'"]);
    expect(d["form-action"]).toEqual(["'self'"]);
    expect(d["frame-ancestors"]).toEqual(["'none'"]);
    expect(d["upgrade-insecure-requests"]).toEqual([]);
  });

  it("allows the Supabase origin only for images and API calls", () => {
    const d = directives(
      contentSecurityPolicy("n", {
        ...prod,
        supabaseUrl: "https://abc.supabase.co/some/path",
      }),
    );
    expect(d["img-src"]).toContain("https://abc.supabase.co");
    expect(d["connect-src"]).toContain("https://abc.supabase.co");
    expect(d["script-src"].join(" ")).not.toContain("supabase");
    expect(d["default-src"]).toEqual(["'self'"]);
  });

  it("development adds eval and the HMR socket; http sites are not upgraded", () => {
    const d = directives(
      contentSecurityPolicy("n", {
        supabaseUrl: "http://127.0.0.1:54321",
        dev: true,
        https: false,
      }),
    );
    expect(d["script-src"]).toContain("'unsafe-eval'");
    expect(d["connect-src"]).toContain("ws:");
    expect(d["img-src"]).toContain("http://127.0.0.1:54321");
    expect("upgrade-insecure-requests" in d).toBe(false);
  });

  it("nonces are 128-bit base64 and never repeat", () => {
    const seen = new Set(Array.from({ length: 1000 }, createNonce));
    expect(seen.size).toBe(1000);
    for (const n of seen) expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});
