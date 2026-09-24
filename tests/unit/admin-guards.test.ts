// Static guarantees for the admin area, checked on every test run:
//   1. every admin page checks its own permission (a layout check alone is
//      not enough: it does not run for every navigation);
//   2. every admin Server Action checks the permission FIRST;
//   3. admin code never uses the service-role client (the database must see
//      the admin's own session so RLS and the audit log apply);
//   4. nothing in the app writes to the audit log.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const ADMIN_PAGES = "src/app/[locale]/admin";
const PAGE_GUARD: [RegExp, string][] = [
  [/^orders\//, 'requireAdmin(locale, "orders")'],
  [/^catalog\//, 'requireAdmin(locale, "products")'],
  [/^customers\//, 'requireAdmin(locale, "customers")'],
  [/^kyc\//, 'requireAdmin(locale, "kyc")'],
  [/^comments\//, 'requireAdmin(locale, "comments")'],
  [/^faqs\//, 'requireAdmin(locale, "settings")'],
  [/^settings\//, 'requireAdmin(locale, "settings")'],
  [/^admins\//, "requireOwner(locale)"],
  [/^audit\//, "requireOwner(locale)"],
  [/^page\.tsx$/, "requireAdmin(locale)"],
];

describe("admin pages check their permission on the server", () => {
  const pages = walk(ADMIN_PAGES).filter((f) => f.endsWith("page.tsx"));
  it("covers every page", () =>
    expect(pages.length).toBeGreaterThanOrEqual(18));
  for (const file of pages) {
    const rel = relative(ADMIN_PAGES, file);
    it(rel, () => {
      const guard = PAGE_GUARD.find(([re]) => re.test(rel));
      expect(guard, `no expected guard for ${rel}`).toBeDefined();
      const src = readFileSync(file, "utf8");
      expect(src).toContain(`await ${guard![1]}`);
    });
  }
});

const ACTION_GUARD: Record<string, Record<string, string>> = {
  "orders.ts": { "*": 'actionAdmin("orders")' },
  "catalog.ts": { "*": 'actionAdmin("products")' },
  "settings.ts": { "*": 'actionAdmin("settings")' },
  "people.ts": {
    setCustomerBlocked: 'actionAdmin("customers")',
    moderateComment: 'actionAdmin("comments")',
    addAdmin: "actionOwner()",
    setAdminPermission: "actionOwner()",
    setAdminActive: "actionOwner()",
  },
};

describe("admin Server Actions check the permission before anything else", () => {
  const dir = "src/server/admin";
  const files = readdirSync(dir).filter((f) =>
    readFileSync(join(dir, f), "utf8").startsWith('"use server"'),
  );
  it("every action module is mapped", () =>
    expect(files.sort()).toEqual(Object.keys(ACTION_GUARD).sort()));
  for (const file of files) {
    const src = readFileSync(join(dir, file), "utf8");
    const actions = [
      ...src.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{\n([^\n]*)/g),
    ];
    it(`${file}: ${actions.length} actions`, () => {
      expect(actions.length).toBeGreaterThan(0);
      for (const [, name, firstLine] of actions) {
        const guard = ACTION_GUARD[file][name] ?? ACTION_GUARD[file]["*"];
        expect(firstLine.trim(), `${file} ${name}`).toBe(
          `if (!(await ${guard})) return NOT_ALLOWED;`,
        );
      }
    });
  }
});

describe("admin code runs with the admin's own session", () => {
  it("no admin module or page imports the service-role client", () => {
    const files = [
      ...walk("src/server/admin"),
      ...walk(ADMIN_PAGES),
      ...walk("src/components/admin"),
    ];
    const offenders = files.filter((f) =>
      /supabase\/admin|createAdminClient|SUPABASE_SECRET_KEY/.test(
        readFileSync(f, "utf8"),
      ),
    );
    expect(offenders).toEqual([]);
  });
});

describe("the audit log is read-only in the application", () => {
  it("no source file inserts, updates, upserts or deletes audit_logs", () => {
    const writes = walk("src").filter((f) =>
      /from\(\s*["']audit_logs["']\s*\)\s*\.\s*(insert|update|upsert|delete)/.test(
        readFileSync(f, "utf8").replace(/\s+/g, " "),
      ),
    );
    expect(writes).toEqual([]);
  });
  it("the audit page has no form that writes (only the GET filter form)", () => {
    const src = readFileSync(`${ADMIN_PAGES}/audit/page.tsx`, "utf8");
    expect(src).not.toContain("ActionForm");
    expect(src).not.toMatch(
      /"use server"|from "@\/server\/admin\/(orders|catalog|settings|people)"/,
    );
    const forms = [...src.matchAll(/<form\b([^>]*)>/g)].map((m) =>
      m[1].replace(/\s+/g, " "),
    );
    expect(forms).toHaveLength(1);
    expect(forms[0]).toContain('method="get"');
  });
});
