import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ActionForm } from "@/components/admin/action-form";
import { Badge, Field, PageHeader, Section } from "@/components/admin/ui";
import { buttonVariants } from "@/components/ui/button-variants";
import { inputClasses } from "@/components/ui/styles";
import type { Locale } from "@/i18n/routing";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import {
  addAdmin,
  setAdminActive,
  setAdminPermission,
} from "@/server/admin/people";
import { listAdmins } from "@/server/admin/people-queries";
import { type AppPermission, requireOwner } from "@/server/auth/session";

export const metadata: Metadata = { robots: { index: false } };

const PERMISSIONS: AppPermission[] = [
  "orders",
  "products",
  "kyc",
  "customers",
  "comments",
  "settings",
  "invoices",
];

export default async function AdminsPage({
  params,
}: PageProps<"/[locale]/admin/admins">) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  await requireOwner(locale);
  const t = await getTranslations("Admin");
  const admins = await listAdmins();

  return (
    <>
      <PageHeader title={t("admins.title")} description={t("admins.intro")} />
      <Section title={t("admins.add")} description={t("admins.addHint")}>
        <ActionForm
          action={addAdmin}
          resetOnSuccess
          testId="add-admin"
          successMessage={t("admins.added")}
        >
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t("admins.phone")} htmlFor="admin-phone">
              <input
                id="admin-phone"
                name="phone"
                required
                inputMode="tel"
                placeholder="09XXXXXXXX"
                dir="ltr"
                className={`${inputClasses} w-56`}
              />
            </Field>
            <button type="submit" className={buttonVariants()}>
              {t("admins.addButton")}
            </button>
          </div>
        </ActionForm>
      </Section>

      <ul className="grid gap-4" data-testid="admins-list">
        {admins.map((a) => (
          <li key={a.user_id}>
            <Section
              title={a.full_name ?? t("customers.noName")}
              description={
                <span dir="ltr">
                  {a.phone_e164 ? formatPhone(a.phone_e164) : ""}
                </span>
              }
              actions={
                a.is_owner ? (
                  <Badge tone="info">{t("admins.owner")}</Badge>
                ) : a.is_active ? (
                  <Badge tone="success">{t("admins.active")}</Badge>
                ) : (
                  <Badge>{t("admins.inactive")}</Badge>
                )
              }
              testId="admin-entry"
            >
              {a.is_owner ? (
                <p className="text-sm text-muted-foreground">
                  {t("admins.ownerNote")}
                </p>
              ) : (
                <>
                  <div className="grid gap-2">
                    <p className="text-sm font-medium">
                      {t("admins.permissions")}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {PERMISSIONS.map((p) => {
                        const granted = a.permissions.includes(p);
                        return (
                          <ActionForm
                            key={p}
                            action={setAdminPermission}
                            className="gap-1"
                            testId={`perm-${p}`}
                          >
                            <input
                              type="hidden"
                              name="adminId"
                              value={a.user_id}
                            />
                            <input type="hidden" name="permission" value={p} />
                            <input
                              type="hidden"
                              name="granted"
                              value={granted ? "false" : "true"}
                            />
                            <button
                              type="submit"
                              aria-pressed={granted}
                              title={
                                granted ? t("admins.revoke") : t("admins.grant")
                              }
                              className={cn(
                                buttonVariants({
                                  variant: granted ? "default" : "outline",
                                  size: "sm",
                                }),
                                "min-w-24",
                              )}
                            >
                              {granted ? "✓ " : "+ "}
                              {t(`permissions.${p}`)}
                            </button>
                          </ActionForm>
                        );
                      })}
                    </div>
                  </div>
                  <ActionForm
                    action={setAdminActive}
                    confirmMessage={
                      a.is_active ? t("admins.deactivateConfirm") : undefined
                    }
                    testId="admin-active"
                  >
                    <input type="hidden" name="adminId" value={a.user_id} />
                    <input
                      type="hidden"
                      name="active"
                      value={a.is_active ? "false" : "true"}
                    />
                    <button
                      type="submit"
                      className={`${buttonVariants({ variant: a.is_active ? "ghost" : "outline", size: "sm" })} justify-self-start ${a.is_active ? "text-destructive" : ""}`}
                    >
                      {a.is_active
                        ? t("admins.deactivate")
                        : t("admins.reactivate")}
                    </button>
                  </ActionForm>
                </>
              )}
            </Section>
          </li>
        ))}
      </ul>
    </>
  );
}
