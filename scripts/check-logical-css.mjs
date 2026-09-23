// Fails on physical-direction Tailwind utilities, which break RTL.
// Use logical ones instead: ms/me, ps/pe, start/end, text-start/text-end,
// border-s/border-e, rounded-s/rounded-e (docs/spec.md §7).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src";
const PHYSICAL =
  /(?<![\w-])(?:-?(?:ml|mr|pl|pr|left|right|scroll-ml|scroll-mr|scroll-pl|scroll-pr)-[\w./[\]-]+|text-(?:left|right)|float-(?:left|right)|clear-(?:left|right)|border-[lr](?:-[\w./[\]-]+)?|rounded-(?:[lr]|tl|tr|bl|br)(?:-[\w./[\]-]+)?|space-x-reverse)(?![\w-])/g;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(tsx?|jsx?|css)$/.test(name)) yield path;
  }
}

const problems = [];
for (const file of walk(ROOT)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (line.includes("logical-css-ignore")) return;
    for (const match of line.matchAll(PHYSICAL)) {
      problems.push(`${file}:${i + 1}  ${match[0]}`);
    }
  });
}

if (problems.length) {
  console.error("Physical direction utilities found (use logical ones):");
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}
console.log("logical-css: ok");
