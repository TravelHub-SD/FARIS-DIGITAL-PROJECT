import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader, Section } from "@/components/admin/ui";
import {
  RemoveTotpButton,
  TotpEnrol,
} from "@/components/auth/two-factor-forms";
import { ClientMessages } from "@/components/layout/client-messages";
import type { Locale } from "@/i18n/routing";
import { formatDateTime } from "@/lib/format";
import { verifiedTotpFactors } from "@/server/auth/mfa";
import { getIsOwner, requireAdmin } from "@/server/auth/session";

export const metadata: Metadata = { robots: { index: false } };

// Every staff member: their own authenticators. A second (backup) one on
// another phone means a lost phone does not lock them out.
export default async function SecurityPage({
  params,
}: PageProps<"/[locale]/admin/security">) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  const { user } = await requireAdmin(locale);
  const [t, factors, owner] = await Promise.all([
    getTranslations("Auth.twoFactor"),
    verifiedTotpFactors(),
    getIsOwner(user.id),
  ]);

  return (
    <ClientMessages namespaces={["Auth", "Admin"]}>
      <PageHeader title={t("securityTitle")} description={t("securityIntro")} />
      {factors.length < 2 && (
        <p
          role="note"
          data-testid="backup-advice"
          className="rounded-lg border border-border bg-muted p-3 text-sm"
        >
          {t(owner ? "backupAdviceOwner" : "backupAdvice")}
        </p>
      )}
      <Section title={t("yourAuthenticators")}>
        <ul className="grid gap-3" data-testid="authenticators">
          {factors.map((f, i) => (
            <li
              key={f.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
            >
              <span className="text-sm">
                {t("authenticatorN", { n: i + 1 })} ·{" "}
                <span className="text-muted-foreground">
                  {t("added", { at: formatDateTime(f.createdAt, locale) })}
                </span>
              </span>
              {factors.length > 1 && <RemoveTotpButton factorId={f.id} />}
            </li>
          ))}
        </ul>
      </Section>
      <Section title={t("addBackupTitle")} description={t("addBackupHint")}>
        <TotpEnrol backup />
      </Section>
    </ClientMessages>
  );
}
