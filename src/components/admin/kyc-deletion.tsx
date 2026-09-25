import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "@/components/link";
import { buttonVariants } from "@/components/ui/button-variants";
import type { KycDocTypeKey } from "@/i18n/keys";
import type { Locale } from "@/i18n/routing";
import { formatDateTime } from "@/lib/format";
import { deleteReviewedKycFile } from "@/server/admin/kyc";
import type { PendingDeletion } from "@/server/kyc/queries";

import { ActionForm } from "./action-form";
import { Badge, Empty, Section } from "./ui";

/** Red banner (every admin page, `kyc` staff) while a document lingers > 24 h. */
export async function KycDeletionAlert({
  overdue,
}: {
  overdue: { count: number; oldest: string | null };
}) {
  if (overdue.count === 0) return null;
  const t = await getTranslations("Admin.kycDeletion");
  const locale = (await getLocale()) as Locale;
  return (
    <div
      role="alert"
      data-testid="kyc-deletion-alert"
      className="grid gap-1 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
    >
      <p>
        {t("alert", {
          count: overdue.count,
          at: overdue.oldest ? formatDateTime(overdue.oldest, locale) : "",
        })}
      </p>
      <Link
        href="/admin/kyc#pending-deletion"
        className="font-medium underline"
      >
        {t("open")}
      </Link>
    </div>
  );
}

export async function PendingDeletionList({
  rows,
}: {
  rows: PendingDeletion[];
}) {
  const [t, tKyc, tAdmin] = await Promise.all([
    getTranslations("Admin.kycDeletion"),
    getTranslations("Kyc"),
    getTranslations("Admin"),
  ]);
  const locale = (await getLocale()) as Locale;
  return (
    <Section
      title={t("title")}
      description={t("intro")}
      testId="kyc-pending-deletion"
    >
      <span id="pending-deletion" />
      {rows.length === 0 ? (
        <Empty>{t("none")}</Empty>
      ) : (
        <ul className="divide-y">
          {rows.map((r) => (
            <li
              key={r.id}
              data-submission-id={r.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
            >
              <span>{tKyc(`docTypes.${r.doc_type as KycDocTypeKey}`)}</span>
              <Badge tone={r.status === "accepted" ? "success" : "danger"}>
                {tAdmin(
                  r.status === "accepted" ? "kyc.verified" : "kyc.rejected",
                )}
              </Badge>
              <span className="text-muted-foreground">
                {t("reviewed", { at: formatDateTime(r.reviewed_at, locale) })}
              </span>
              {r.overdue && <Badge tone="danger">{t("overdue")}</Badge>}
              <ActionForm
                action={deleteReviewedKycFile}
                testId="delete-kyc-file"
                successMessage={t("deleted")}
              >
                <input type="hidden" name="id" value={r.id} />
                <button
                  type="submit"
                  className={buttonVariants({
                    variant: "destructive",
                    size: "sm",
                  })}
                >
                  {t("delete")}
                </button>
              </ActionForm>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
