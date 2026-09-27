import { getTranslations } from "next-intl/server";

import { Link } from "@/components/link";

/** From this share of the budget on, settings staff are warned. */
export const OTP_BUDGET_WARN_AT = 0.8;

// Shown on every admin page to settings staff when today's verification codes
// near or reach the daily budget: at the limit, new registrations and password
// resets are refused until midnight (Khartoum), which may be an attack on the
// WhatsApp budget or simply a busy day.
export async function OtpBudgetAlert({
  usage,
}: {
  usage: { used: number; budget: number };
}) {
  const { used, budget } = usage;
  if (used < budget * OTP_BUDGET_WARN_AT) return null;
  const t = await getTranslations("Admin.otpBudget");
  return (
    <div
      role="alert"
      data-testid="otp-budget-alert"
      className="grid gap-1 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
    >
      <p>{t(used >= budget ? "exhausted" : "near", { used, budget })}</p>
      <Link
        href="/admin/settings#otp_daily_budget"
        className="font-medium underline"
      >
        {t("open")}
      </Link>
    </div>
  );
}
