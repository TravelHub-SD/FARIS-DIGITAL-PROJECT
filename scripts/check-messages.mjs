// Every locale must define exactly the same translation keys as English.
import { readFileSync } from "node:fs";

const LOCALES = ["ar", "en"];

function keys(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

const sets = Object.fromEntries(
  LOCALES.map((l) => [
    l,
    new Set(keys(JSON.parse(readFileSync(`messages/${l}.json`, "utf8")))),
  ]),
);

let failed = false;
for (const a of LOCALES) {
  for (const b of LOCALES) {
    if (a === b) continue;
    for (const key of sets[a]) {
      if (!sets[b].has(key)) {
        console.error(
          `messages/${b}.json is missing "${key}" (present in ${a})`,
        );
        failed = true;
      }
    }
  }
}
if (failed) process.exit(1);
console.log("messages: ok");
