import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import {
  Badge,
  Empty,
  KYC_TONE,
  PageHeader,
  Pagination,
  Section,
  TableWrap,
  withQuery,
} from "@/components/admin/ui";
import { Link } from "@/components/link";
import { buttonVariants } from "@/components/ui/button-variants";
import { inputClasses, selectClasses } from "@/components/ui/styles";
import type { Locale } from "@/i18n/routing";
import { formatDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { listCustomers, type CustomerRow } from "@/server/admin/people-queries";
import { requireAdmin } from "@/server/auth/session";

export const metadata: Metadata = { robots: { index: false } };

const KYC: CustomerRow["kyc_status"][] = [
  "none",
  "pending",
  "verified",
  "rejected",
];

export default async function CustomersPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/customers">) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  await requireAdmin(locale, "customers");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 60) : undefined;
  const kyc = KYC.find((k) => k === sp.kyc);
  const blocked = sp.blocked === "1";
  const page =
    typeof sp.page === "string" && /^\d{1,5}$/.test(sp.page)
      ? Number(sp.page)
      : 1;
  const t = await getTranslations("Admin");
  const result = await listCustomers({ q, kyc, blocked, page });

  return (
    <>
      <PageHeader
        title={t("customers.title")}
        description={t("customers.count", { count: result.total })}
      />
      <Section>
        <form
          method="get"
          className="grid gap-3 sm:grid-cols-[1fr_12rem_auto_auto]"
          role="search"
        >
          <input
            name="q"
            defaultValue={q}
            placeholder={t("customers.searchPlaceholder")}
            aria-label={t("customers.search")}
            className={inputClasses}
          />
          <select
            name="kyc"
            defaultValue={kyc ?? ""}
            aria-label={t("customers.kyc")}
            className={selectClasses}
          >
            <option value="">{t("customers.anyKyc")}</option>
            {KYC.map((k) => (
              <option key={k} value={k}>
                {t(`kyc.${k}`)}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="blocked"
              value="1"
              defaultChecked={blocked}
              className="size-4 accent-primary"
            />
            {t("customers.onlyBlocked")}
          </label>
          <button
            type="submit"
            className={buttonVariants({ variant: "outline" })}
          >
            {t("filter")}
          </button>
        </form>
        {result.rows.length === 0 ? (
          <Empty>{t("customers.none")}</Empty>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th>{t("customers.name")}</th>
                <th>{t("customers.phone")}</th>
                <th>{t("customers.kyc")}</th>
                <th>{t("customers.joined")}</th>
                <th>{t("customers.state")}</th>
              </tr>
            </thead>
            <tbody data-testid="admin-customers">
              {result.rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link
                      href={`/admin/customers/${c.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {c.full_name ?? t("customers.noName")}
                    </Link>
                  </td>
                  <td dir="ltr" className="text-start">
                    {c.phone_e164 ? formatPhone(c.phone_e164) : "—"}
                  </td>
                  <td>
                    <Badge tone={KYC_TONE[c.kyc_status]}>
                      {t(`kyc.${c.kyc_status}`)}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(c.created_at, locale)}
                  </td>
                  <td>
                    {c.is_blocked ? (
                      <Badge tone="danger">{t("customers.blocked")}</Badge>
                    ) : !c.phone_verified_at ? (
                      <Badge tone="warning">{t("customers.incomplete")}</Badge>
                    ) : (
                      <Badge tone="success">{t("customers.active")}</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        <Pagination
          page={result.page}
          pages={result.pages}
          href={(p) =>
            withQuery("/admin/customers", {
              q,
              kyc,
              blocked: blocked ? 1 : undefined,
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
