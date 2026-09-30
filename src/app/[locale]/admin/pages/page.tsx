import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ActionForm } from "@/components/admin/action-form";
import {
  Badge,
  CheckboxField,
  Field,
  PageHeader,
  Section,
} from "@/components/admin/ui";
import { buttonVariants } from "@/components/ui/button-variants";
import { inputClasses } from "@/components/ui/styles";
import type { Locale } from "@/i18n/routing";
import { formatDateTime } from "@/lib/format";
import { savePage } from "@/server/admin/settings";
import {
  listSitePages,
  type SitePageRow,
} from "@/server/admin/settings-queries";
import { requireAdmin } from "@/server/auth/session";

export const metadata: Metadata = { robots: { index: false } };

async function PageForm({ page }: { page: SitePageRow }) {
  const t = await getTranslations("Admin");
  const s = page.slug;
  const area = `${inputClasses} h-auto min-h-72 leading-relaxed`;
  return (
    <ActionForm action={savePage} testId={`page-form-${s}`}>
      <input type="hidden" name="slug" value={s} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={`${t("pages.pageTitle")} — ${t("lang.ar")}`}
          htmlFor={`t-ar-${s}`}
        >
          <input
            id={`t-ar-${s}`}
            name="title_ar"
            defaultValue={page.title_ar ?? ""}
            maxLength={150}
            dir="rtl"
            lang="ar"
            className={inputClasses}
          />
        </Field>
        <Field
          label={`${t("pages.pageTitle")} — ${t("lang.en")}`}
          htmlFor={`t-en-${s}`}
        >
          <input
            id={`t-en-${s}`}
            name="title_en"
            defaultValue={page.title_en ?? ""}
            maxLength={150}
            dir="ltr"
            lang="en"
            className={inputClasses}
          />
        </Field>
        <Field
          label={`${t("pages.body")} — ${t("lang.ar")}`}
          htmlFor={`b-ar-${s}`}
        >
          <textarea
            id={`b-ar-${s}`}
            name="body_ar"
            defaultValue={page.body_ar ?? ""}
            maxLength={30000}
            dir="rtl"
            lang="ar"
            className={area}
          />
        </Field>
        <Field
          label={`${t("pages.body")} — ${t("lang.en")}`}
          htmlFor={`b-en-${s}`}
        >
          <textarea
            id={`b-en-${s}`}
            name="body_en"
            defaultValue={page.body_en ?? ""}
            maxLength={30000}
            dir="ltr"
            lang="en"
            className={area}
          />
        </Field>
      </div>
      <CheckboxField
        id={`pub-${s}`}
        name="is_published"
        label={t("pages.published")}
        defaultChecked={page.is_published}
      />
      <button
        type="submit"
        className={`${buttonVariants()} justify-self-start`}
      >
        {t("save")}
      </button>
    </ActionForm>
  );
}

export default async function PagesPage({
  params,
}: PageProps<"/[locale]/admin/pages">) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  await requireAdmin(locale, "settings");
  const t = await getTranslations("Admin");
  const pages = await listSitePages();

  return (
    <>
      <PageHeader title={t("pages.title")} description={t("pages.intro")} />
      {pages.map((p) => (
        <Section
          key={p.slug}
          title={t(`pages.names.${p.slug}`)}
          description={
            <>
              <span dir="ltr">
                /{locale}/{p.slug}
              </span>{" "}
              ·{" "}
              {t("pages.updated", { at: formatDateTime(p.updated_at, locale) })}
            </>
          }
          actions={
            <Badge tone={p.is_published ? "success" : "neutral"}>
              {p.is_published ? t("pages.published") : t("pages.draft")}
            </Badge>
          }
          testId="site-page-item"
        >
          <PageForm page={p} />
        </Section>
      ))}
    </>
  );
}
