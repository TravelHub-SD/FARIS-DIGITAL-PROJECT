// Sums the gzip size of every <script src> a page loads on first render.
// Usage: node scripts/measure-js.mjs http://localhost:3200 /ar/login /ar ...
// Measure against `next build && next start`, never `next dev`.
import { gzipSync } from "node:zlib";

const [base, ...paths] = process.argv.slice(2);
for (const path of paths) {
  const html = await (await fetch(new URL(path, base))).text();
  const srcs = [
    ...new Set(
      [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]),
    ),
  ];
  let total = 0;
  for (const src of srcs) {
    const body = await (await fetch(new URL(src, base))).arrayBuffer();
    total += gzipSync(Buffer.from(body)).length;
  }
  console.log(
    `${path.padEnd(22)} ${String(srcs.length).padStart(2)} scripts  ${(total / 1024).toFixed(1).padStart(6)} KB gzip`,
  );
}
