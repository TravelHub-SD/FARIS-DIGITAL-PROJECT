// OTP: brute force, cooldown, rate limits, budget, expiry, and proof that the
// plaintext code is never stored or logged. Drives the real otp-core code
// against the real database functions; the "WhatsApp" sender captures the
// code the way the customer's phone would receive it.
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  hashOtp,
  issueOtp,
  type OtpDeps,
  verifyOtp,
} from "@/server/auth/otp-core";
import type { WhatsAppMessage } from "@/server/whatsapp/types";

import { randomPhoneDigits, service, sql } from "./helpers";

const PEPPER = "test-pepper-" + randomUUID() + randomUUID();
const inbox: WhatsAppMessage[] = [];
const deps = (): OtpDeps => ({
  db: service(),
  pepper: PEPPER,
  send: async (message) => {
    inbox.push(message);
    return { ok: true };
  },
});
const lastCode = (phone: string) => {
  const m = [...inbox]
    .reverse()
    .find((x) => x.type === "otp" && x.to === phone);
  return m && m.type === "otp" ? m.code : undefined;
};
const newPhone = () => `+${randomPhoneDigits()}`;
/** Fresh IP per test so repeated runs never share rate-limit history. */
const newIp = () =>
  `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 250) + 1).join(".")}`;
const wrong = (code: string) =>
  String((Number(code) + 1) % 1_000_000).padStart(6, "0");
/** Moves this phone's OTP history back in time (simulates waiting). */
const ageCodes = (phone: string, seconds: number) =>
  sql(
    `update private.otp_codes set created_at = created_at - interval '${seconds} seconds' where phone_e164 = '${phone}'`,
  );

describe("OTP brute force is impossible", () => {
  it("5 wrong attempts kill the code; the RIGHT code is refused afterwards", async () => {
    const phone = newPhone();
    const ip = newIp();
    expect(
      await issueOtp({ phone, purpose: "register", ip, locale: "ar" }, deps()),
    ).toEqual({ ok: true });
    const code = lastCode(phone)!;

    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(
        await verifyOtp(
          { phone, purpose: "register", code: wrong(code), ip },
          deps(),
        ),
      );
    }
    console.log("[demo] 5 wrong attempts ->", JSON.stringify(results));
    expect(results.slice(0, 4).map((r) => !r.ok && r.attemptsLeft)).toEqual([
      4, 3, 2, 1,
    ]);
    expect(results[4]).toEqual({
      ok: false,
      reason: "too_many_attempts",
      attemptsLeft: undefined,
    });

    const withRightCode = await verifyOtp(
      { phone, purpose: "register", code, ip },
      deps(),
    );
    console.log(
      "[demo] 6th attempt with the CORRECT code ->",
      JSON.stringify(withRightCode),
    );
    expect(withRightCode).toMatchObject({
      ok: false,
      reason: "too_many_attempts",
    });
    expect(
      sql(
        `select attempts, consumed_at is null from private.otp_codes where phone_e164 = '${phone}'`,
      ),
    ).toBe("5|t");
  });

  it("cooldown: a second code within 60 s is refused with retry_after", async () => {
    const phone = newPhone();
    expect(
      (
        await issueOtp(
          { phone, purpose: "register", ip: null, locale: "ar" },
          deps(),
        )
      ).ok,
    ).toBe(true);
    const second = await issueOtp(
      { phone, purpose: "register", ip: null, locale: "ar" },
      deps(),
    );
    console.log("[demo] immediate second request ->", JSON.stringify(second));
    expect(second).toMatchObject({ ok: false, reason: "cooldown" });
    expect(second.ok === false && second.retryAfter).toBeGreaterThan(55);
    expect(inbox.filter((m) => m.to === phone)).toHaveLength(1); // nothing sent the 2nd time
  });

  it("per phone: at most 5 codes per hour (so at most 25 guesses/hour of 1,000,000)", async () => {
    const phone = newPhone();
    const outcomes: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await issueOtp(
        { phone, purpose: "register", ip: null, locale: "ar" },
        deps(),
      );
      outcomes.push(r.ok ? "ok" : r.reason);
      ageCodes(phone, 61); // skip past the cooldown, stay inside the hour
    }
    console.log(
      "[demo] 6 requests spaced past the cooldown ->",
      outcomes.join(", "),
    );
    expect(outcomes).toEqual([
      "ok",
      "ok",
      "ok",
      "ok",
      "ok",
      "phone_hourly_limit",
    ]);
  });

  it("per IP: at most 10 codes per hour across different phones", async () => {
    const ip = newIp();
    const outcomes: string[] = [];
    for (let i = 0; i < 11; i++) {
      const r = await issueOtp(
        { phone: newPhone(), purpose: "register", ip, locale: "ar" },
        deps(),
      );
      outcomes.push(r.ok ? "ok" : r.reason);
    }
    console.log("[demo] 11 phones from one IP ->", outcomes.join(", "));
    expect(outcomes.filter((o) => o === "ok")).toHaveLength(10);
    expect(outcomes[10]).toBe("ip_hourly_limit");
  });

  it("per IP: failed verifications are capped at 30/hour across phones (spraying)", async () => {
    const ip = newIp();
    sql(`insert into private.rate_limit_events (bucket, key)
         select 'otp_verify_fail_ip', '${ip}' from generate_series(1, 30)`);
    const phone = newPhone();
    await issueOtp(
      { phone, purpose: "register", ip: null, locale: "ar" },
      deps(),
    );
    const r = await verifyOtp(
      { phone, purpose: "register", code: lastCode(phone)!, ip },
      deps(),
    );
    expect(r).toMatchObject({ ok: false, reason: "ip_verify_limit" });
  });

  it("global daily budget stops all sending once reached", async () => {
    const used = Number(
      sql(`select count(*) from private.otp_codes
            where created_at >= (date_trunc('day', now() at time zone 'Africa/Khartoum') at time zone 'Africa/Khartoum')`),
    );
    sql(
      `update public.security_settings set otp_daily_budget = ${used} where id`,
    );
    try {
      const r = await issueOtp(
        { phone: newPhone(), purpose: "register", ip: null, locale: "ar" },
        deps(),
      );
      console.log("[demo] request after budget reached ->", JSON.stringify(r));
      expect(r).toMatchObject({ ok: false, reason: "budget_exhausted" });
    } finally {
      sql(
        `update public.security_settings set otp_daily_budget = 300 where id`,
      );
    }
  });

  it("codes expire after 5 minutes, even when correct", async () => {
    const phone = newPhone();
    await issueOtp(
      { phone, purpose: "register", ip: null, locale: "ar" },
      deps(),
    );
    sql(
      `update private.otp_codes set expires_at = now() - interval '1 second' where phone_e164 = '${phone}'`,
    );
    const r = await verifyOtp(
      { phone, purpose: "register", code: lastCode(phone)!, ip: null },
      deps(),
    );
    expect(r).toMatchObject({ ok: false, reason: "invalid_or_expired" });
  });

  it("a code is single-use, bound to its purpose, and superseded by a newer code", async () => {
    const phone = newPhone();
    await issueOtp(
      { phone, purpose: "register", ip: null, locale: "ar" },
      deps(),
    );
    const first = lastCode(phone)!;
    expect(
      await verifyOtp(
        { phone, purpose: "reset_password", code: first, ip: null },
        deps(),
      ),
    ).toMatchObject({
      ok: false,
    });
    ageCodes(phone, 61);
    await issueOtp(
      { phone, purpose: "register", ip: null, locale: "ar" },
      deps(),
    );
    const second = lastCode(phone)!;
    if (first !== second) {
      expect(
        (
          await verifyOtp(
            { phone, purpose: "register", code: first, ip: null },
            deps(),
          )
        ).ok,
      ).toBe(false);
    }
    expect(
      await verifyOtp(
        { phone, purpose: "register", code: second, ip: null },
        deps(),
      ),
    ).toEqual({ ok: true });
    expect(
      await verifyOtp(
        { phone, purpose: "register", code: second, ip: null },
        deps(),
      ),
    ).toMatchObject({
      ok: false,
      reason: "invalid_or_expired",
    });
  });
});

describe("OTP codes are never stored or logged in plaintext", () => {
  const logged: string[] = [];
  let spies: ReturnType<typeof vi.spyOn>[] = [];
  beforeAll(() => {
    spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      }),
    );
  });
  afterAll(() => spies.forEach((s) => s.mockRestore()));

  it("full issue + verify: the code appears in no table and in no log line", async () => {
    const phone = newPhone();
    const ip = newIp();
    await issueOtp({ phone, purpose: "register", ip, locale: "en" }, deps());
    const code = lastCode(phone)!;
    await verifyOtp(
      { phone, purpose: "register", code: wrong(code), ip },
      deps(),
    );
    await verifyOtp({ phone, purpose: "register", code, ip }, deps());

    const stored = sql(
      `select code_hash from private.otp_codes where phone_e164 = '${phone}'`,
    );
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).toBe(hashOtp(PEPPER, phone, "register", code)); // keyed HMAC, not the code
    expect(stored).not.toContain(code);

    // Every row of every table that could plausibly hold it, as text:
    const haystack = sql(`
      select coalesce(string_agg(t::text, ' '), '') from (
        select to_jsonb(o)::text as t from private.otp_codes o
        union all select to_jsonb(m)::text from public.message_logs m
        union all select to_jsonb(a)::text from public.audit_logs a
        union all select to_jsonb(r)::text from private.rate_limit_events r
      ) x`);
    const hits = haystack.split(code).length - 1;
    console.info(
      `[demo] searched ${haystack.length} chars of DB rows for the code: ${hits} hits`,
    );
    expect(hits).toBe(0);
    expect(
      logged.filter(
        (line) => line.includes(code) && !line.startsWith("[demo]"),
      ),
    ).toEqual([]);
  });

  it("a message_logs row for an OTP cannot carry a payload (DB constraint)", () => {
    expect(() =>
      sql(`insert into public.message_logs (phone_e164, message_type, template_name, payload)
           values ('+249911111111', 'otp', 'auth_otp', '{"code":"123456"}')`),
    ).toThrow(/message_logs_no_otp_payload/);
  });
});
