import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import {
  Empty,
  PageHeader,
  Pagination,
  Section,
  withQuery,
} from "@/components/admin/ui";
import { buttonVariants } from "@/components/ui/button-variants";
import { inputClasses, selectClasses } from "@/components/ui/styles";
import type { Locale } from "@/i18n/routing";
import { formatDateTime } from "@/lib/format";
import { AUDIT_ENTITIES, listAudit } from "@/server/admin/people-queries";
import { requireOwner } from "@/server/auth/session";

export const metadata: Metadata = { robots: { index: false } };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function show(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

// Read-only by construction: this page has no forms that write, the app has
// no code path that writes audit rows, and the database refuses UPDATE,
// DELETE and TRUNCATE on audit_logs for every role (triggers + no grants).
export default async function AuditPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/audit">) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  await requireOwner(locale);
  const sp = await searchParams;
  const one = (k: string) =>
    typeof sp[k] === "string" ? (sp[k] as string) : undefined;
  const filters = {
    entity: AUDIT_ENTITIES.find((e) => e === one("entity")),
    action: /^[a-z_.]{1,60}$/.test(one("action") ?? "")
      ? one("action")
      : undefined,
    entityId: /^[0-9a-zA-Z-]{1,64}$/.test(one("id") ?? "")
      ? one("id")
      : undefined,
    actor: one("actor")?.slice(0, 60),
    from: DATE.test(one("from") ?? "") ? one("from") : undefined,
    to: DATE.test(one("to") ?? "") ? one("to") : undefined,
    page: /^\d{1,5}$/.test(one("page") ?? "") ? Number(one("page")) : 1,
  };
  const t = await getTranslations("Admin");
  const result = await listAudit(filters);

  return (
    <>
      <PageHeader title={t("audit.title")} description={t("audit.intro")} />
      <Section>
        <form
          method="get"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          role="search"
        >
          <select
            name="entity"
            defaultValue={filters.entity ?? ""}
            aria-label={t("audit.entity")}
            className={selectClasses}
          >
            <option value="">{t("audit.anyEntity")}</option>
            {AUDIT_ENTITIES.map((e) => (
              <option key={e} value={e}>
                {t(`audit.entities.${e}`)}
              </option>
            ))}
          </select>
          <input
            name="actor"
            defaultValue={filters.actor}
            placeholder={t("audit.actorPlaceholder")}
            aria-label={t("audit.actor")}
            className={inputClasses}
          />
          <input
            name="id"
            defaultValue={filters.entityId}
            placeholder={t("audit.entityId")}
            aria-label={t("audit.entityId")}
            dir="ltr"
            className={inputClasses}
          />
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("orders.from")}
            <input
              type="date"
              name="from"
              defaultValue={filters.from}
              className={inputClasses}
            />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("orders.to")}
            <input
              type="date"
              name="to"
              defaultValue={filters.to}
              className={inputClasses}
            />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              className={buttonVariants({ variant: "outline" })}
            >
              {t("filter")}
            </button>
          </div>
        </form>
      </Section>
      <Section>
        {result.rows.length === 0 ? (
          <Empty>{t("audit.none")}</Empty>
        ) : (
          <ol className="grid gap-2" data-testid="audit-rows">
            {result.rows.map((r) => {
              const keys = [
                ...new Set([
                  ...Object.keys(r.old_data ?? {}),
                  ...Object.keys(r.new_data ?? {}),
                ]),
              ];
              const op = r.action.split(".").pop() as
                "insert" | "update" | "delete" | string;
              return (
                <li key={r.id} className="rounded-lg border">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
                      <span className="text-muted-foreground">
                        {formatDateTime(r.created_at, locale)}
                      </span>
                      <span className="font-medium">
                        {r.actor ??
                          (r.actor_role === "service_role"
                            ? t("audit.server")
                            : t("audit.system"))}
                      </span>
                      <span>
                        {t.has(`audit.ops.${op}` as "audit.ops.insert")
                          ? t(`audit.ops.${op as "insert"}`)
                          : op}{" "}
                        ·{" "}
                        {t.has(
                          `audit.entities.${r.entity_type}` as "audit.entities.orders",
                        )
                          ? t(
                              `audit.entities.${r.entity_type as (typeof AUDIT_ENTITIES)[number]}`,
                            )
                          : r.entity_type}
                      </span>
                      <span className="text-xs text-muted-foreground" dir="ltr">
                        {r.action === "kyc_submissions.document_viewed"
                          ? t("audit.documentViewed")
                          : r.entity_id}
                      </span>
                    </summary>
                    <div className="border-t p-3">
                      {keys.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          {t("audit.noDetails")}
                        </p>
                      ) : (
                        <div className="-mx-3 overflow-x-auto px-3">
                          <table className="w-full min-w-[32rem] text-xs [&_td]:border-t [&_td]:px-2 [&_td]:py-1 [&_td]:align-top [&_th]:px-2 [&_th]:py-1 [&_th]:text-start">
                            <thead>
                              <tr>
                                <th>{t("audit.field")}</th>
                                <th>{t("audit.before")}</th>
                                <th>{t("audit.after")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {keys.map((k) => (
                                <tr key={k}>
                                  <td className="font-mono" dir="ltr">
                                    {k}
                                  </td>
                                  <td
                                    className="font-mono break-all text-muted-foreground"
                                    dir="auto"
                                  >
                                    {show(r.old_data?.[k])}
                                  </td>
                                  <td
                                    className="font-mono break-all"
                                    dir="auto"
                                  >
                                    {show(r.new_data?.[k])}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ol>
        )}
        <Pagination
          page={result.page}
          pages={result.pages}
          href={(p) =>
            withQuery("/admin/audit", {
              entity: filters.entity,
              actor: filters.actor,
              id: filters.entityId,
              from: filters.from,
              to: filters.to,
              page: p,
            })
          }
          labels={{
            previous: t("previous"),
            next: t("next"),
            page: t("page", { page: result.page, pages: result.pages }),
          }}
        />
      </Section>
    </>
  );
}
