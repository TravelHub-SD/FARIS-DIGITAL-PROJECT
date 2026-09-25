import "server-only";

import { getServerEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendOtp } from "@/server/whatsapp";

import { issueOtp, type OtpDeps, verifyOtp } from "./otp-core";

export type { OtpFailure, OtpPurpose } from "./otp-core";

function deps(): OtpDeps {
  return {
    db: createAdminClient(),
    pepper: getServerEnv().OTP_HMAC_PEPPER,
    send: (message, context) => sendOtp(message, context),
  };
}

export const otp = {
  issue: (input: Parameters<typeof issueOtp>[0]) => issueOtp(input, deps()),
  verify: (input: Parameters<typeof verifyOtp>[0]) => verifyOtp(input, deps()),
};
