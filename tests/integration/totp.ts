import { createHmac } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

// RFC 6238 TOTP (SHA-1, 30 s, 6 digits), exactly what an authenticator app
// computes from the secret in the QR code. Tests use it to act as the
// staff member's phone.

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of input.replace(/=+$/, "").toUpperCase()) {
    const v = alphabet.indexOf(ch);
    if (v < 0) throw new Error("invalid base32");
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totp(secret: string, at = Date.now(), stepOffset = 0): string {
  const counter = Math.floor(at / 1000 / 30) + stepOffset;
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  const n = (h.readUInt32BE(o) & 0x7fffffff) % 1_000_000;
  return String(n).padStart(6, "0");
}

/**
 * Enrols a new authenticator for the signed-in staff member of `client` and
 * verifies it, which upgrades that session to aal2, as the /two-factor page
 * does (label first: GoTrue needs one). Returns the secret (the "phone").
 */
export async function enrolTotp(
  client: SupabaseClient,
  friendlyName = `test-${Date.now()}`,
): Promise<{ secret: string; factorId: string; accessToken: string }> {
  const label = await client.rpc("staff_totp_label");
  if (label.error) throw new Error(`staff_totp_label: ${label.error.message}`);
  const enrol = await client.auth.mfa.enroll({
    factorType: "totp",
    friendlyName,
  });
  if (enrol.error) throw new Error(`mfa.enroll: ${enrol.error.message}`);
  const { id, totp: t } = enrol.data;
  const verified = await client.auth.mfa.challengeAndVerify({
    factorId: id,
    code: totp(t.secret),
  });
  if (verified.error) throw new Error(`mfa.verify: ${verified.error.message}`);
  return {
    secret: t.secret,
    factorId: id,
    accessToken: verified.data.access_token,
  };
}
