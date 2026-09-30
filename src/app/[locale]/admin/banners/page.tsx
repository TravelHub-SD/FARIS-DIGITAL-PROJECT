import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ActionForm } from "@/components/admin/action-form";
import { ImageEditor } from "@/components/admin/image-editor";
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
import {
  deleteBanner,
  removeBannerImage,
  saveBanner,
  uploadBannerImage,
} from "@/server/admin/settings";
import {
  type BannerRow,
  listAdminBanners,
} from "@/server/admin/settings-queries";
import { requireAdmin } from "@/server/auth/session";

export const metadata: Metadata = { robots: { index: false } };

async function BannerForm({ banner }: { banner?: BannerRow }) {
  const t = await getTranslations("Admin");
  const p = banner?.id ?? "new";
  const text = (name: "title" | "subtitle", lang: "ar" | "en", max: number) => (
    <Field
      label={`${t(name === "title" ? "banners.slideTitle" : "banners.subtitle")} — ${t(`lang.${lang}`)}`}
      htmlFor={`${name}-${lang}-${p}`}
    >
      <input
        id={`${name}-${lang}-${p}`}
        name={`${name}_${lang}`}
        defaultValue={banner?.[`${name}_${lang}`] ?? ""}
        maxLength={max}
        dir={lang === "ar" ? "rtl" : "ltr"}
        lang={lang}
        className={inputClasses}
      />
    </Field>
  );
  return (
    <ActionForm
      action={saveBanner}
      resetOnSuccess={!banner}
      testId={banner ? "banner-form" : "new-banner-form"}
    >
      {banner && <input type="hidden" name="id" value={banner.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        {text("title", "ar", 120)}
        {text("title", "en", 120)}
        {text("subtitle", "ar", 200)}
        {text("subtitle", "en", 200)}
        <Field
          label={t("banners.link")}
          htmlFor={`link-${p}`}
          hint={t("banners.linkHint")}
        >
          <input
            id={`link-${p}`}
            name="link"
            defaultValue={banner?.link ?? ""}
            maxLength={300}
            dir="ltr"
            className={inputClasses}
          />
        </Field>
        <Field label={t("catalog.sortOrder")} htmlFor={`sort-${p}`}>
          <input
            id={`sort-${p}`}
            name="sort_order"
            type="number"
            defaultValue={banner?.sort_order ?? 0}
            className={`${inputClasses} w-28`}
          />
        </Field>
      </div>
      <CheckboxField
        id={`active-${p}`}
        name="is_active"
        label={t("banners.active")}
        defaultChecked={banner?.is_active ?? true}
      />
      <button
        type="submit"
        className={`${buttonVariants({ variant: banner ? "outline" : "default" })} justify-self-start`}
      >
        {banner ? t("save") : t("banners.add")}
      </button>
    </ActionForm>
  );
}

export default async function BannersPage({
  params,
}: PageProps<"/[locale]/admin/banners">) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  await requireAdmin(locale, "settings");
  const t = await getTranslations("Admin");
  const banners = await listAdminBanners();

  return (
    <>
      <PageHeader title={t("banners.title")} description={t("banners.intro")} />
      <Section title={t("banners.add")} description={t("banners.addHint")}>
        <BannerForm />
      </Section>
      {banners.map((b) => (
        <Section
          key={b.id}
          title={
            localized(b.title_ar, b.title_en, locale)?.text ??
            t("banners.untitled")
          }
          actions={
            <Badge tone={b.is_active ? "success" : "neutral"}>
              {b.is_active ? t("banners.active") : t("banners.hidden")}
            </Badge>
          }
          testId="banner-item"
        >
          <BannerForm banner={b} />
          <ImageEditor
            path={b.image_path}
            upload={uploadBannerImage}
            remove={removeBannerImage}
            idName="id"
            id={b.id}
            label={t("banners.image")}
            hint={t("banners.imageHint")}
            testId="banner-image"
            previewClassName="max-h-40 w-full max-w-md object-cover"
            // A slide needs a title or an image (table CHECK).
            canRemove={!!(b.title_ar || b.title_en)}
          />
          <ActionForm
            action={deleteBanner}
            confirmMessage={t("banners.deleteConfirm")}
          >
            <input type="hidden" name="id" value={b.id} />
            <button
              type="submit"
              className={`${buttonVariants({ variant: "ghost", size: "sm" })} justify-self-start text-destructive`}
            >
              {t("banners.delete")}
            </button>
          </ActionForm>
        </Section>
      ))}
    </>
  );
}
