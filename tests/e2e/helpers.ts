import { createServerClient } from "@supabase/ssr";
import type { BrowserContext } from "@playwright/test";

import { anonKey, url } from "../integration/helpers";

export * from "../integration/helpers";

export const FAKE_META = "http://127.0.0.1:3199";

export type FakeMessage = {
  seq: number;
  id: string;
  at: number;
  to: string;
  template: string;
  language: string;
  category: string;
  params: string[];
  buttonParam: string | null;
};

/** Messages the app's real Meta driver delivered to the fake Graph API. */
export async function fakeInbox(
  to?: string,
  since = 0,
): Promise<FakeMessage[]> {
  const q = new URLSearchParams({
    since: String(since),
    ...(to ? { to: to.replace(/^\+/, "") } : {}),
  });
  return (await fetch(`${FAKE_META}/__inbox?${q}`)).json();
}

export async function fakeControl(body: Record<string, unknown>) {
  const r = await fetch(`${FAKE_META}/__control`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return r.json();
}

/** Reads the OTP the customer received on "WhatsApp" (the fake's inbox). */
export async function readOtp(phoneE164: string, after = 0): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const otp = (await fakeInbox(phoneE164, after))
      .filter((m) => m.template === "otp_code")
      .pop();
    if (otp) return otp.params[0];
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no OTP for ${phoneE164} in the fake WhatsApp inbox`);
}

/** A point in time: messages delivered from now on. */
export const logSize = () => Date.now();

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
