import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ActionForm } from "@/components/admin/action-form";
import {
  Badge,
  KeyValues,
  KYC_TONE,
  ORDER_STATUS_TONE,
  PageHeader,
  Section,
  TableWrap,
} from "@/components/admin/ui";
import { Link } from "@/components/link";
import { buttonVariants } from "@/components/ui/button-variants";
import type { KycDocTypeKey } from "@/i18n/keys";
import type { Locale } from "@/i18n/routing";
import { formatDateTime, formatSdg } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { setCustomerBlocked } from "@/server/admin/people";
import { getCustomer } from "@/server/admin/people-queries";
import { requireAdmin } from "@/server/auth/session";
import type { OrderStatus } from "@/server/orders/queries";

export const metadata: Metadata = { robots: { index: false } };

export default async function CustomerPage({
  params,
}: PageProps<"/[locale]/admin/customers/[id]">) {
  const { locale: raw, id } = await params;
  const locale = raw as Locale;
  setRequestLocale(locale);
  const { user, permissions } = await requireAdmin(locale, "customers");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await getCustomer(id, permissions);
  if (!data) notFound();
  const t = await getTranslations("Admin");
  const tKyc = await getTranslations("Kyc");
  const { profile, orders, kyc } = data;
  const self = profile.id === user.id;

  return (
    <>
      <Link
        href="/admin/customers"
        className="text-sm text-muted-foreground hover:underline"
      >
        {t("customers.back")}
      </Link>
      <PageHeader
        title={profile.full_name ?? t("customers.noName")}
        actions={
          profile.is_blocked ? (
            <Badge tone="danger" data-testid="customer-state">
              {t("customers.blocked")}
            </Badge>
          ) : (
            <Badge tone="success" data-testid="customer-state">
              {t("customers.active")}
            </Badge>
          )
        }
      />
      <Section title={t("customers.profile")}>
        <KeyValues
          items={[
            [
              t("customers.phone"),
              <span key="p" dir="ltr">
                {profile.phone_e164 ? formatPhone(profile.phone_e164) : "—"}
              </span>,
            ],
            [
              t("customers.phoneVerified"),
              profile.phone_verified_at
                ? formatDateTime(profile.phone_verified_at, locale)
                : t("no"),
            ],
            [
              t("customers.language"),
              profile.locale === "ar" ? t("lang.ar") : t("lang.en"),
            ],
            [
              t("customers.kyc"),
              <Badge key="k" tone={KYC_TONE[profile.kyc_status]}>
                {t(`kyc.${profile.kyc_status}`)}
              </Badge>,
            ],
            [t("customers.joined"), formatDateTime(profile.created_at, locale)],
          ]}
        />
      </Section>

      <Section
        title={t("customers.blocking")}
        description={t("customers.blockingHint")}
        testId="block-section"
      >
        {self ? (
          <p className="text-sm text-muted-foreground">
            {t("customers.cannotBlockSelf")}
          </p>
        ) : (
          <ActionForm
            action={setCustomerBlocked}
            confirmMessage={
              profile.is_blocked ? undefined : t("customers.blockConfirm")
            }
            testId="block-form"
          >
            <input type="hidden" name="userId" value={profile.id} />
            <input
              type="hidden"
              name="blocked"
              value={profile.is_blocked ? "false" : "true"}
            />
            <button
              type="submit"
              className={`${buttonVariants({ variant: profile.is_blocked ? "outline" : "destructive", size: "sm" })} justify-self-start`}
            >
              {profile.is_blocked
                ? t("customers.unblock")
                : t("customers.block")}
            </button>
          </ActionForm>
        )}
      </Section>

      {orders && (
        <Section title={t("customers.orders")}>
          {orders.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("orders.none")}</p>
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th>{t("orders.reference")}</th>
                  <th>{t("orders.date")}</th>
                  <th>{t("orders.total")}</th>
                  <th>{t("orders.status")}</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link
                        href={`/admin/orders/${o.reference}`}
                        className="text-primary hover:underline"
                        dir="ltr"
                      >
                        {o.reference}
                      </Link>
                    </td>
                    <td className="text-muted-foreground">
                      {formatDateTime(o.created_at, locale)}
                    </td>
                    <td dir="auto">{formatSdg(o.total_sdg, locale)}</td>
                    <td>
                      <Badge tone={ORDER_STATUS_TONE[o.status as OrderStatus]}>
                        {t(`status.${o.status as OrderStatus}`)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Section>
      )}

      {kyc && (
        <Section title={t("customers.kycHistory")}>
          {kyc.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("customers.noKyc")}
            </p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {kyc.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center gap-2">
                  <span>{tKyc(`docTypes.${k.doc_type as KycDocTypeKey}`)}</span>
                  <Badge
                    tone={
                      k.status === "accepted"
                        ? "success"
                        : k.status === "rejected"
                          ? "danger"
                          : "warning"
                    }
                  >
                    {t(
                      `receipt.${k.status as "pending" | "accepted" | "rejected"}`,
                    )}
                  </Badge>
                  <span className="text-muted-foreground">
                    {formatDateTime(k.created_at, locale)}
                  </span>
                  {k.status === "pending" && (
                    <Link
                      href={`/admin/kyc/${k.id}`}
                      className="text-primary hover:underline"
                    >
                      {t("open")}
                    </Link>
                  )}
                  {k.rejection_reason && (
                    <span className="text-muted-foreground">
                      — {k.rejection_reason}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </>
  );
}
