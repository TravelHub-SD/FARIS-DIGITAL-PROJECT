import { readFileSync } from "node:fs";

import { createServerClient } from "@supabase/ssr";
import type { BrowserContext } from "@playwright/test";

import { anonKey, url } from "../integration/helpers";

export * from "../integration/helpers";

/** The WhatsApp dev driver's console output, read like an inbox. */
export async function readOtp(phoneE164: string, after = 0): Promise<string> {
  const pattern = new RegExp(`OTP for \\${phoneE164}: (\\d{6})`, "g");
  for (let i = 0; i < 40; i++) {
    const log = readFileSync(".e2e/dev.log", "utf8").slice(after);
    const match = [...log.matchAll(pattern)].pop();
    if (match) return match[1];
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no OTP for ${phoneE164} in .e2e/dev.log`);
}

export const logSize = () => readFileSync(".e2e/dev.log", "utf8").length;

/** Real Supabase session cookies (as the app sets them) for a phone user. */
export async function signInCookies(
  context: BrowserContext,
  phone: string,
  password: string,
) {
  const jar = new Map<string, string>();
  const client = createServerClient(url(), anonKey(), {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { error } = await client.auth.signInWithPassword({ phone, password });
  if (error) throw new Error(`signIn: ${error.message}`);
  await context.addCookies(
    [...jar].map(([name, value]) => ({
      name,
      value,
      domain: "localhost",
      path: "/",
      sameSite: "Lax" as const,
    })),
  );
}

export function localNumber() {
  return "09" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
}
export const toE164 = (local: string) => "+249" + local.slice(1);
