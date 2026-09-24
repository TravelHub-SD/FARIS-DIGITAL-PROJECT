// A Google sign-in creates an INCOMPLETE account (no verified phone). Google is
// not configured locally, so the account is SIMULATED exactly as GoTrue would
// create it: an auth.users row with app_metadata.provider = 'google' and no
// phone. The DB guard must accept it; nothing useful may be possible with it
// until the phone OTP step; abandoned ones are purged.
import { randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import {
  CHEAP_FIELDS,
  customerClaims,
  service,
  signJwt,
  sql,
  VARIANT_CHEAP,
  withToken,
} from "./helpers";

function simulateGoogleUser(createdHoursAgo = 0) {
  const id = randomUUID();
  // GoTrue stores '' (not NULL) in its token columns; mirror that exactly.
  sql(`insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at,
                               raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                               confirmation_token, recovery_token, email_change_token_new, email_change,
                               email_change_token_current, phone_change, phone_change_token, reauthentication_token)
       values ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
               'g-${id}@gmail.test', now(), '{"provider":"google","providers":["google"]}',
               '{"full_name":"Google User"}', now() - interval '${createdHoursAgo} hours', now(),
               '', '', '', '', '', '', '', '')`);
  return id;
}

let googleUser: string;
let token: string;

beforeAll(() => {
  googleUser = simulateGoogleUser();
  token = signJwt(
    customerClaims(googleUser, 300),
    process.env.TEST_JWT_SECRET!,
  );
});

describe("Incomplete (Google, phone-unverified) accounts are unusable", () => {
  it("the account exists but its profile has no verified phone", () => {
    expect(
      sql(
        `select phone_e164 is null and phone_verified_at is null from public.profiles where id = '${googleUser}'`,
      ),
    ).toBe("t");
  });

  it("cannot place an order (DB trigger, any insert path)", async () => {
    const res = await service().from("orders").insert({
      user_id: googleUser,
      variant_id: VARIANT_CHEAP,
      quantity: 1,
      idempotency_key: randomUUID(),
      fulfillment_data: CHEAP_FIELDS,
    });
    expect(res.error?.message).toMatch(/PHONE_NOT_VERIFIED/);
  });

  it("cannot submit KYC", async () => {
    const res = await withToken(token).rpc("submit_kyc", {
      p_doc_type: "passport",
      p_storage_path: `${googleUser}/${randomUUID()}.jpg`,
      p_file_sha256: "0".repeat(64),
    });
    expect(res.error?.message).toMatch(/PHONE_NOT_VERIFIED/);
  });

  it("cannot post comments", async () => {
    const res = await withToken(token).from("comments").insert({
      product_id: "00000000-0000-4000-b000-000000000001",
      body: "spam",
    });
    expect(res.error).not.toBeNull();
  });

  it("completing the phone step (what completePhoneLink does) makes it a normal account", async () => {
    const id = simulateGoogleUser();
    const phone =
      "2499" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
    const { error } = await service().auth.admin.updateUserById(id, {
      phone,
      phone_confirm: true,
      app_metadata: { signup_verified: "otp" },
    });
    expect(error).toBeNull();
    expect(
      sql(
        `select phone_e164, phone_verified_at is not null from public.profiles where id = '${id}'`,
      ),
    ).toBe(`+${phone}|t`);
    const order = await service().from("orders").insert({
      user_id: id,
      variant_id: VARIANT_CHEAP,
      quantity: 1,
      idempotency_key: randomUUID(),
      fulfillment_data: CHEAP_FIELDS,
    });
    expect(order.error).toBeNull();
  });

  it("abandoned incomplete accounts older than 24 h are purged; complete and recent ones are kept", () => {
    const abandoned = simulateGoogleUser(25);
    const recent = simulateGoogleUser(1);
    const deleted = Number(sql(`select private.purge_incomplete_accounts()`));
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(
      sql(`select count(*) from auth.users where id = '${abandoned}'`),
    ).toBe("0");
    expect(
      sql(`select count(*) from public.profiles where id = '${abandoned}'`),
    ).toBe("0");
    expect(sql(`select count(*) from auth.users where id = '${recent}'`)).toBe(
      "1",
    );
    expect(
      sql(
        `select count(*) from auth.users where phone_confirmed_at is not null`,
      ),
    ).not.toBe("0");
  });

  it("the purge is scheduled nightly with pg_cron", () => {
    expect(
      sql(
        `select schedule || ' ' || command from cron.job where jobname = 'purge-incomplete-accounts'`,
      ),
    ).toBe("17 3 * * * select private.purge_incomplete_accounts()");
  });
});
