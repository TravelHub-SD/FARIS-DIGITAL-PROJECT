// ACCEPTANCE TEST 1 — no usable account without a verified OTP.
// Phase 3 layout: public sign-up is refused by the before_user_created hook
// (all but Google), by the DB guard on auth.users (OTP marker or Google), and
// GoTrue cannot send SMS codes at all (Send SMS hook refuses). Google
// accounts are created INCOMPLETE; see incomplete-account.test.ts.
import { randomBytes, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { anon, randomPhoneDigits, service, sql } from "./helpers";

async function userExists(match: { email?: string; phone?: string }) {
  const { data, error } = await service().auth.admin.listUsers({
    perPage: 1000,
  });
  if (error) throw error;
  return data.users.some(
    (u) =>
      (match.email && u.email === match.email) ||
      (match.phone && u.phone === match.phone),
  );
}

const password = () => randomBytes(12).toString("hex");

describe("Acceptance 1: public sign-up is closed", () => {
  it("rejects email + password sign-up with the anon key, and creates no user", async () => {
    const email = `attacker-${randomUUID()}@test.local`;
    const { data, error } = await anon().auth.signUp({
      email,
      password: password(),
    });
    expect(error, "signUp must fail").not.toBeNull();
    expect(data.session).toBeNull();
    expect(await userExists({ email })).toBe(false);
  });

  it("rejects phone + password sign-up (before_user_created hook), and creates no user", async () => {
    const phone = randomPhoneDigits();
    const { error } = await anon().auth.signUp({
      phone: `+${phone}`,
      password: password(),
    });
    expect(error?.message).toMatch(/phone registration with a verified code/);
    expect(await userExists({ phone })).toBe(false);
  });

  it("rejects passwordless sign-up (email OTP / magic link with shouldCreateUser)", async () => {
    const email = `attacker-${randomUUID()}@test.local`;
    const { error } = await anon().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    expect(error, "signInWithOtp must fail").not.toBeNull();
    expect(await userExists({ email })).toBe(false);
  });

  it("rejects phone OTP sign-up through GoTrue (SMS disabled)", async () => {
    const phone = randomPhoneDigits();
    const { error } = await anon().auth.signInWithOtp({
      phone: `+${phone}`,
      options: { shouldCreateUser: true },
    });
    expect(error, "phone OTP must fail").not.toBeNull();
    expect(await userExists({ phone })).toBe(false);
  });

  it("GoTrue cannot send its own OTP to an EXISTING phone (no second login path)", async () => {
    const phone = randomPhoneDigits();
    await service().auth.admin.createUser({
      phone,
      password: password(),
      phone_confirm: true,
      app_metadata: { signup_verified: "otp" },
    });
    const { data, error } = await anon().auth.signInWithOtp({
      phone: `+${phone}`,
    });
    expect(error?.message, "GoTrue must refuse to send an SMS OTP").toMatch(
      /SMS delivery is disabled/,
    );
    expect(data.session).toBeNull();
  });

  it("rejects anonymous sign-in", async () => {
    const { data, error } = await anon().auth.signInAnonymously();
    expect(error, "anonymous sign-in must fail").not.toBeNull();
    expect(data.session).toBeNull();
  });

  it("rejects a server-side createUser that lacks the OTP marker (guards server bugs too)", async () => {
    const phone = randomPhoneDigits();
    const { error } = await service().auth.admin.createUser({
      phone,
      password: password(),
      phone_confirm: true,
    });
    expect(
      error,
      "createUser without signup_verified marker must fail",
    ).not.toBeNull();
    expect(await userExists({ phone })).toBe(false);
  });

  it("DB guard: a raw auth.users insert that is neither OTP-marked nor Google is refused", () => {
    expect(() =>
      sql(`insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, created_at, updated_at)
           values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
                   'authenticated', 'raw-${randomUUID()}@test.local', '{"provider":"email"}', now(), now())`),
    ).toThrow(/SIGNUP_NOT_ALLOWED/);
  });

  it("hook: only Google OAuth passes before_user_created (SIMULATED payloads)", () => {
    const decide = (provider: string) =>
      sql(
        `select private.auth_hook_before_user_created('{"user":{"app_metadata":{"provider":"${provider}"}}}'::jsonb)::text`,
      );
    expect(decide("google")).toBe("{}");
    for (const provider of ["phone", "email", "anonymous", "github", ""]) {
      expect(decide(provider), provider).toMatch(/"http_code": 403/);
    }
  });

  it("control: the server's post-OTP path still creates accounts", async () => {
    const phone = randomPhoneDigits();
    const { data, error } = await service().auth.admin.createUser({
      phone,
      password: password(),
      phone_confirm: true,
      app_metadata: { signup_verified: "otp" },
    });
    expect(error).toBeNull();
    expect(data.user?.id).toBeTruthy();
    expect(await userExists({ phone })).toBe(true);
  });
});
