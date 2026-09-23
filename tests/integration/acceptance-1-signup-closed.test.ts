// ACCEPTANCE TEST 1 — public sign-up is closed: an account cannot be created
// without a verified OTP. Only the server path (service role + the
// `signup_verified: 'otp'` marker it sets after OTP verification) may create one.
import { randomBytes, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { anon, randomPhoneDigits, service } from "./helpers";

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

describe("Acceptance 1: public auth.signUp is closed", () => {
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

  it("rejects phone + password sign-up with the anon key, and creates no user", async () => {
    const phone = randomPhoneDigits();
    const { error } = await anon().auth.signUp({
      phone: `+${phone}`,
      password: password(),
    });
    expect(error, "signUp must fail").not.toBeNull();
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

  it("rejects anonymous sign-in", async () => {
    const { data, error } = await anon().auth.signInAnonymously();
    expect(error, "anonymous sign-in must fail").not.toBeNull();
    expect(data.session).toBeNull();
  });

  it("rejects a server-side createUser that lacks the OTP marker (guards server bugs too)", async () => {
    const email = `unmarked-${randomUUID()}@test.local`;
    const { error } = await service().auth.admin.createUser({
      email,
      password: password(),
      email_confirm: true,
    });
    expect(
      error,
      "createUser without signup_verified marker must fail",
    ).not.toBeNull();
    expect(await userExists({ email })).toBe(false);
  });

  it("control: the server's post-OTP path still creates accounts", async () => {
    const email = `server-${randomUUID()}@test.local`;
    const { data, error } = await service().auth.admin.createUser({
      email,
      password: password(),
      email_confirm: true,
      phone: randomPhoneDigits(),
      phone_confirm: true,
      app_metadata: { signup_verified: "otp" },
    });
    expect(error).toBeNull();
    expect(data.user?.id).toBeTruthy();
    expect(await userExists({ email })).toBe(true);
  });
});
