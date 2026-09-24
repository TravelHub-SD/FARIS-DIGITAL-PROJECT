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
import { localized } from "@/lib/localized";
import { deleteFaq, saveFaq } from "@/server/admin/settings";
import { type FaqRow, listFaqs } from "@/server/admin/settings-queries";
import { requireAdmin } from "@/server/auth/session";

export const metadata: Metadata = { robots: { index: false } };

async function FaqForm({ faq }: { faq?: FaqRow }) {
  const t = await getTranslations("Admin");
  const p = faq?.id ?? "new";
  const area = `${inputClasses} h-auto min-h-24`;
  return (
    <ActionForm
      action={saveFaq}
      resetOnSuccess={!faq}
      testId={faq ? "faq-form" : "new-faq-form"}
    >
      {faq && <input type="hidden" name="id" value={faq.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={`${t("faqs.question")} — ${t("lang.ar")}`}
          htmlFor={`q-ar-${p}`}
        >
          <input
            id={`q-ar-${p}`}
            name="question_ar"
            defaultValue={faq?.question_ar ?? ""}
            maxLength={300}
            dir="rtl"
            lang="ar"
            className={inputClasses}
          />
        </Field>
        <Field
          label={`${t("faqs.question")} — ${t("lang.en")}`}
          htmlFor={`q-en-${p}`}
        >
          <input
            id={`q-en-${p}`}
            name="question_en"
            defaultValue={faq?.question_en ?? ""}
            maxLength={300}
            dir="ltr"
            lang="en"
            className={inputClasses}
          />
        </Field>
        <Field
          label={`${t("faqs.answer")} — ${t("lang.ar")}`}
          htmlFor={`a-ar-${p}`}
        >
          <textarea
            id={`a-ar-${p}`}
            name="answer_ar"
            defaultValue={faq?.answer_ar ?? ""}
            maxLength={4000}
            dir="rtl"
            lang="ar"
            className={area}
          />
        </Field>
        <Field
          label={`${t("faqs.answer")} — ${t("lang.en")}`}
          htmlFor={`a-en-${p}`}
        >
          <textarea
            id={`a-en-${p}`}
            name="answer_en"
            defaultValue={faq?.answer_en ?? ""}
            maxLength={4000}
            dir="ltr"
            lang="en"
            className={area}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <Field label={t("catalog.sortOrder")} htmlFor={`sort-${p}`}>
          <input
            id={`sort-${p}`}
            name="sort_order"
            type="number"
            defaultValue={faq?.sort_order ?? 0}
            className={`${inputClasses} w-28`}
          />
        </Field>
        <CheckboxField
          id={`pub-${p}`}
          name="is_published"
          label={t("faqs.published")}
          defaultChecked={faq?.is_published ?? true}
        />
      </div>
      <button
        type="submit"
        className={`${buttonVariants({ variant: faq ? "outline" : "default" })} justify-self-start`}
      >
        {faq ? t("save") : t("faqs.add")}
      </button>
    </ActionForm>
  );
}

export default async function FaqsPage({
  params,
}: PageProps<"/[locale]/admin/faqs">) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  await requireAdmin(locale, "settings");
  const t = await getTranslations("Admin");
  const faqs = await listFaqs();

  return (
    <>
      <PageHeader title={t("faqs.title")} description={t("faqs.intro")} />
      <Section title={t("faqs.add")}>
        <FaqForm />
      </Section>
      {faqs.map((f) => (
        <Section
          key={f.id}
          title={localized(f.question_ar, f.question_en, locale)?.text}
          actions={
            <Badge tone={f.is_published ? "success" : "neutral"}>
              {f.is_published ? t("faqs.published") : t("faqs.draft")}
            </Badge>
          }
          testId="faq-item"
        >
          <FaqForm faq={f} />
          <ActionForm
            action={deleteFaq}
            confirmMessage={t("faqs.deleteConfirm")}
          >
            <input type="hidden" name="id" value={f.id} />
            <button
              type="submit"
              className={`${buttonVariants({ variant: "ghost", size: "sm" })} justify-self-start text-destructive`}
            >
              {t("faqs.delete")}
            </button>
          </ActionForm>
        </Section>
      ))}
    </>
  );
}
