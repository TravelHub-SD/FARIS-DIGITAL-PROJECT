import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ActionForm } from "@/components/admin/action-form";
import { MessageList } from "@/components/admin/message-list";
import {
  Empty,
  Field,
  PageHeader,
  Pagination,
  Section,
  TableWrap,
  withQuery,
} from "@/components/admin/ui";
import { Link } from "@/components/link";
import { buttonVariants } from "@/components/ui/button-variants";
import { inputClasses } from "@/components/ui/styles";
import type { Locale } from "@/i18n/routing";
import {
  listMessages,
  messagingHealth,
  spend,
} from "@/server/admin/messages-queries";
import { saveWhatsAppRates } from "@/server/admin/settings";
import { requireAdmin } from "@/server/auth/session";

export const metadata: Metadata = { robots: { index: false } };

const VIEWS = ["attention", "failed", "all"] as const;
const TYPES = ["order_status", "kyc_result", "otp"] as const;

function monthBounds() {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Africa/Khartoum" }),
  );
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const last = new Date(y, now.getMonth() + 1, 0).getDate();
  return {
    from: `${y}-${m}-01`,
    to: `${y}-${m}-${String(last).padStart(2, "0")}`,
  };
}

export default async function MessagesPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/messages">) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  const { permissions } = await requireAdmin(locale, "orders");
  const sp = await searchParams;
  const view = VIEWS.find((v) => v === sp.view) ?? "attention";
  const type = TYPES.find((v) => v === sp.type);
  const page =
    typeof sp.page === "string" && /^\d{1,5}$/.test(sp.page)
      ? Number(sp.page)
      : 1;
  const t = await getTranslations("Admin.messages");
  const tAdmin = await getTranslations("Admin");
  const [health, list] = await Promise.all([
    messagingHealth(),
    listMessages({ view, type, page }),
  ]);
  const month = monthBounds();
  const money = permissions.has("settings")
    ? await spend(month.from, month.to)
    : null;
  const total = money?.rows.reduce((s, r) => s + r.cost_usd, 0) ?? 0;
  const unpriced =
    money?.rows.reduce((s, r) => s + (r.messages - r.priced), 0) ?? 0;

  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} />
      <ul className="grid grid-cols-3 gap-3" data-testid="messaging-health">
        {[
          [health.attention, t("attentionCount")],
          [health.sent24h, t("sent24h")],
          [health.failed24h, t("failed24h")],
        ].map(([value, label]) => (
          <li
            key={String(label)}
            className="grid gap-1 rounded-xl border bg-card p-4"
          >
            <span className="text-2xl font-bold">{value}</span>
            <span className="text-xs text-muted-foreground">{label}</span>
          </li>
        ))}
      </ul>

      <Section>
        <nav className="flex flex-wrap gap-2" aria-label={t("views")}>
          {VIEWS.map((v) => (
            <Link
              key={v}
              href={withQuery("/admin/messages", { view: v, type })}
              aria-current={v === view ? "page" : undefined}
              className={buttonVariants({
                variant: v === view ? "default" : "outline",
                size: "sm",
              })}
            >
              {t(`view.${v}`)}
            </Link>
          ))}
          <span className="mx-2 border-s" />
          {TYPES.map((ty) => (
            <Link
              key={ty}
              href={withQuery("/admin/messages", {
                view,
                type: ty === type ? undefined : ty,
              })}
              aria-current={ty === type ? "true" : undefined}
              className={buttonVariants({
                variant: ty === type ? "secondary" : "ghost",
                size: "sm",
              })}
            >
              {t(`types.${ty}`)}
            </Link>
          ))}
        </nav>
        {list.rows.length === 0 ? (
          <Empty>{view === "attention" ? t("noneAttention") : t("none")}</Empty>
        ) : (
          <MessageList rows={list.rows} />
        )}
        <Pagination
          page={list.page}
          pages={list.pages}
          href={(p) => withQuery("/admin/messages", { view, type, page: p })}
          labels={{
            previous: tAdmin("previous"),
            next: tAdmin("next"),
            page: tAdmin("page", { page: list.page, pages: list.pages }),
          }}
        />
      </Section>

      {money && (
        <Section
          title={t("spendTitle")}
          description={t("spendIntro", { from: month.from, to: month.to })}
          testId="whatsapp-spend"
        >
          <p className="text-2xl font-bold" dir="ltr" data-testid="spend-total">
            ${total.toFixed(4)}
          </p>
          {unpriced > 0 && (
            <p className="text-sm text-highlight-text">
              {t("unpriced", { count: unpriced })}
            </p>
          )}
          <TableWrap>
            <thead>
              <tr>
                <th>{t("type")}</th>
                <th>{t("category")}</th>
                <th>{t("messages")}</th>
                <th>{t("delivered")}</th>
                <th>{t("failed")}</th>
                <th>{t("cost")}</th>
              </tr>
            </thead>
            <tbody data-testid="spend-rows">
              {money.rows.map((r) => (
                <tr key={`${r.message_type}-${r.pricing_category}`}>
                  <td>{t(`types.${r.message_type}`)}</td>
                  <td>
                    {r.pricing_category
                      ? t(`categories.${r.pricing_category as "utility"}`)
                      : "—"}
                  </td>
                  <td>{r.messages}</td>
                  <td>{r.delivered}</td>
                  <td>{r.failed}</td>
                  <td dir="ltr">${r.cost_usd.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <h3 className="font-bold">{t("ratesTitle")}</h3>
          <p className="text-sm text-muted-foreground">{t("ratesIntro")}</p>
          <ActionForm action={saveWhatsAppRates} testId="whatsapp-rates">
            <div className="grid gap-4 sm:grid-cols-4">
              {money.rates.map((r) => (
                <Field
                  key={r.category}
                  label={t(`categories.${r.category as "utility"}`)}
                  htmlFor={`rate-${r.category}`}
                  hint={t("perMessage")}
                >
                  <input
                    id={`rate-${r.category}`}
                    name={r.category}
                    inputMode="decimal"
                    pattern="\d{1,4}(\.\d{1,5})?"
                    defaultValue={r.usd_per_message ?? ""}
                    placeholder={t("notSet")}
                    dir="ltr"
                    className={inputClasses}
                  />
                </Field>
              ))}
            </div>
            <button
              type="submit"
              className={`${buttonVariants()} justify-self-start`}
            >
              {tAdmin("save")}
            </button>
          </ActionForm>
        </Section>
      )}
    </>
  );
}
