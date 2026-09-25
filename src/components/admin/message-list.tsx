import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "@/components/link";
import { buttonVariants } from "@/components/ui/button-variants";
import type { Locale } from "@/i18n/routing";
import { formatDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { markMessageHandled, retryMessage } from "@/server/admin/messages";
import type { MessageRow } from "@/server/admin/messages-queries";

import { ActionForm } from "./action-form";
import { Badge } from "./ui";

const STATUS_TONE = {
  queued: "warning",
  sent: "info",
  delivered: "success",
  read: "success",
  failed: "danger",
} as const;

/** Human label for a stored error code (`meta:131026` → text), code kept visible. */
export async function errorLabel(code: string) {
  const t = await getTranslations("Admin.messages.errors");
  const key = code.replace(/[:.]/g, "_");
  const family = code.startsWith("http:5")
    ? "http_5xx"
    : code.split(":")[0] + "_other";
  const text = t.has(key as "config_not_configured")
    ? t(key as "config_not_configured")
    : t.has(family as "config_not_configured")
      ? t(family as "config_not_configured")
      : t("unknown");
  return `${text} (${code})`;
}

export async function MessageList({
  rows,
  showOrder = true,
  actions = true,
}: {
  rows: MessageRow[];
  showOrder?: boolean;
  actions?: boolean;
}) {
  const t = await getTranslations("Admin.messages");
  const locale = (await getLocale()) as Locale;
  const labels = await Promise.all(
    rows.map((r) => (r.error_code ? errorLabel(r.error_code) : null)),
  );
  return (
    <ul className="grid gap-3" data-testid="message-list">
      {rows.map((m, i) => (
        <li
          key={m.id}
          className="grid gap-2 rounded-lg border p-3 text-sm"
          data-message-id={m.id}
          data-message-status={m.status}
          data-attention={m.needs_attention || undefined}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[m.status]}>
              {t(`status.${m.status}`)}
            </Badge>
            {m.needs_attention && (
              <Badge tone="danger">{t("needsAttention")}</Badge>
            )}
            <span className="font-medium">
              {t(`templates.${m.template_name as "otp_code"}`)}
            </span>
            {showOrder && m.order?.reference && (
              <Link
                href={`/admin/orders/${m.order.reference}`}
                className="text-primary hover:underline"
                dir="ltr"
              >
                {m.order.reference}
              </Link>
            )}
            <span className="text-muted-foreground">
              {m.customer?.full_name ?? ""}{" "}
              <span dir="ltr">{formatPhone(m.phone_e164)}</span>
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              {t("created")}: {formatDateTime(m.created_at, locale)}
            </span>
            {m.sent_at && (
              <span>
                {t("sentAt")}: {formatDateTime(m.sent_at, locale)}
              </span>
            )}
            {m.delivered_at && (
              <span>
                {t("deliveredAt")}: {formatDateTime(m.delivered_at, locale)}
              </span>
            )}
            <span>{t("attempts", { n: m.attempts, max: m.max_attempts })}</span>
            {m.status === "queued" && m.next_retry_at && (
              <span>
                {t("nextTry")}: {formatDateTime(m.next_retry_at, locale)}
              </span>
            )}
            {m.cost_usd !== null && (
              <span dir="ltr">
                ${Number(m.cost_usd).toFixed(4)}{" "}
                {m.cost_source === "estimate" ? t("estimate") : ""}
              </span>
            )}
          </div>
          {labels[i] && (
            <p className="text-destructive" data-error-code={m.error_code}>
              {labels[i]}
            </p>
          )}
          {m.handled_at && (
            <p className="text-xs text-muted-foreground">
              {t("handled", { at: formatDateTime(m.handled_at, locale) })}
            </p>
          )}
          {actions && m.needs_attention && (
            <div className="flex flex-wrap gap-2">
              <a
                href={`https://wa.me/${m.phone_e164.slice(1)}`}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {t("contactManually")}
              </a>
              {m.message_type !== "otp" && (
                <ActionForm
                  action={retryMessage}
                  testId="retry-message"
                  successMessage={t("retried")}
                >
                  <input type="hidden" name="id" value={m.id} />
                  <button
                    type="submit"
                    className={buttonVariants({
                      variant: "outline",
                      size: "sm",
                    })}
                  >
                    {t("retry")}
                  </button>
                </ActionForm>
              )}
              <ActionForm
                action={markMessageHandled}
                testId="mark-handled"
                successMessage={t("markedHandled")}
              >
                <input type="hidden" name="id" value={m.id} />
                <button
                  type="submit"
                  className={buttonVariants({ size: "sm" })}
                >
                  {t("markHandled")}
                </button>
              </ActionForm>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Red banner when WhatsApp cannot deliver anything (setup/account problem, outage) or retries are stuck. */
export async function MessagingAlert({
  systemic,
  outage,
  stuck,
}: {
  systemic: { code: string; at: string } | null;
  outage: { code: string; at: string } | null;
  stuck: number;
}) {
  if (!systemic && !outage && !stuck) return null;
  const t = await getTranslations("Admin.messages");
  const locale = (await getLocale()) as Locale;
  return (
    <div
      role="alert"
      data-testid="messaging-alert"
      className="grid gap-1 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
    >
      {systemic && (
        <p>
          <strong>{t("systemicTitle")}</strong>{" "}
          {await errorLabel(systemic.code)} ·{" "}
          {formatDateTime(systemic.at, locale)}
        </p>
      )}
      {outage && (
        <p data-testid="messaging-outage">
          <strong>{t("outageTitle")}</strong> {await errorLabel(outage.code)} ·{" "}
          {formatDateTime(outage.at, locale)}
        </p>
      )}
      {stuck > 0 && <p>{t("stuck", { count: stuck })}</p>}
      <Link href="/admin/messages" className="font-medium underline">
        {t("open")}
      </Link>
    </div>
  );
}
