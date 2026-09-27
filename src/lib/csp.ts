// Content-Security-Policy for every HTML page (set per request by proxy.ts).
//
// Scripts: only those carrying this request's nonce, plus what they load
// ('strict-dynamic'). An injected <script>, inline handler or javascript: URL
// never runs, even if some user value slips through escaping. The Supabase
// session cookies are readable by page scripts (the browser client needs them
// for Google linking), so this is what stands between an XSS and a stolen
// session. Styles allow inline: React style={} attributes cannot carry a
// nonce, and CSS injection cannot read cookies or run code.
// (docs/decisions.md 2026-09-26, "Nonce CSP on every page".)

export type CspOptions = {
  /** NEXT_PUBLIC_SUPABASE_URL: images (public assets, signed KYC/receipt URLs) and the browser auth client. */
  supabaseUrl: string;
  /** Development adds 'unsafe-eval' (React dev error stacks) and the HMR websocket. */
  dev: boolean;
  /** Only on https sites; locally it would upgrade http://127.0.0.1 Supabase images and break them. */
  https: boolean;
};

export function contentSecurityPolicy(nonce: string, o: CspOptions): string {
  const supabase = new URL(o.supabaseUrl).origin;
  const directives: [string, ...string[]][] = [
    ["default-src", "'self'"],
    [
      "script-src",
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(o.dev ? ["'unsafe-eval'"] : []),
    ],
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", "data:", "blob:", supabase],
    ["font-src", "'self'"],
    ["connect-src", "'self'", supabase, ...(o.dev ? ["ws:"] : [])],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
  ];
  if (o.https) directives.push(["upgrade-insecure-requests"]);
  return directives.map((d) => d.join(" ")).join("; ");
}

/** 128 random bits, base64. A fresh one for every request. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
