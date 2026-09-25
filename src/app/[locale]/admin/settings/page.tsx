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
import { inputClasses, selectClasses } from "@/components/ui/styles";
import type { Locale } from "@/i18n/routing";
import { publicAssetUrl } from "@/lib/assets";
import {
  removeSiteImage,
  saveBankAccount,
  saveBanner,
  saveGeneralSettings,
  saveLimits,
  uploadSiteImage,
} from "@/server/admin/settings";
import { getSettings } from "@/server/admin/settings-queries";
import { PUBLIC_UPLOAD_MAX_BYTES } from "@/server/admin/public-images";
import { requireAdmin } from "@/server/auth/session";

export const metadata: Metadata = { robots: { index: false } };

type Bank = Awaited<ReturnType<typeof getSettings>>["banks"][number];

async function BankForm({ bank }: { bank?: Bank }) {
  const t = await getTranslations("Admin");
  const p = bank?.id ?? "new";
  return (
    <ActionForm
      action={saveBankAccount}
      resetOnSuccess={!bank}
      testId={bank ? "bank-form" : "new-bank-form"}
    >
      {bank && <input type="hidden" name="id" value={bank.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={`${t("settings.bankName")} — ${t("lang.ar")}`}
          htmlFor={`bn-ar-${p}`}
        >
          <input
            id={`bn-ar-${p}`}
            name="bank_name_ar"
            required
            defaultValue={bank?.bank_name_ar}
            maxLength={120}
            dir="rtl"
            className={inputClasses}
          />
        </Field>
        <Field
          label={`${t("settings.bankName")} — ${t("lang.en")}`}
          htmlFor={`bn-en-${p}`}
        >
          <input
            id={`bn-en-${p}`}
            name="bank_name_en"
            required
            defaultValue={bank?.bank_name_en}
            maxLength={120}
            dir="ltr"
            className={inputClasses}
          />
        </Field>
        <Field label={t("settings.accountNumber")} htmlFor={`an-${p}`}>
          <input
            id={`an-${p}`}
            name="account_number"
            required
            defaultValue={bank?.account_number}
            pattern="[0-9A-Za-z\-]{3,40}"
            dir="ltr"
            className={inputClasses}
          />
        </Field>
        <Field label={t("settings.accountHolder")} htmlFor={`ah-${p}`}>
          <input
            id={`ah-${p}`}
            name="account_holder"
            required
            defaultValue={bank?.account_holder}
            maxLength={120}
            className={inputClasses}
          />
        </Field>
        <Field
          label={`${t("settings.branch")} — ${t("lang.ar")}`}
          htmlFor={`br-ar-${p}`}
        >
          <input
            id={`br-ar-${p}`}
            name="branch_ar"
            defaultValue={bank?.branch_ar ?? ""}
            maxLength={120}
            dir="rtl"
            className={inputClasses}
          />
        </Field>
        <Field
          label={`${t("settings.branch")} — ${t("lang.en")}`}
          htmlFor={`br-en-${p}`}
        >
          <input
            id={`br-en-${p}`}
            name="branch_en"
            defaultValue={bank?.branch_en ?? ""}
            maxLength={120}
            dir="ltr"
            className={inputClasses}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <Field label={t("catalog.sortOrder")} htmlFor={`bs-${p}`}>
          <input
            id={`bs-${p}`}
            name="sort_order"
            type="number"
            defaultValue={bank?.sort_order ?? 0}
            className={`${inputClasses} w-28`}
          />
        </Field>
        <CheckboxField
          id={`ba-${p}`}
          name="is_active"
          label={t("settings.bankActive")}
          defaultChecked={bank?.is_active ?? true}
        />
      </div>
      <button
        type="submit"
        className={`${buttonVariants({ variant: bank ? "outline" : "default" })} justify-self-start`}
      >
        {bank ? t("save") : t("settings.addBank")}
      </button>
    </ActionForm>
  );
}

async function SiteImage({
  kind,
  path,
}: {
  kind: "banner" | "logo";
  path: string | null;
}) {
  const t = await getTranslations("Admin");
  return (
    <div className="grid gap-3" data-testid={`site-image-${kind}`}>
      {path ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={publicAssetUrl(path)}
          alt=""
          className="max-h-40 w-auto justify-self-start rounded-md border object-contain"
        />
      ) : (
        <p className="text-sm text-muted-foreground">{t("settings.noImage")}</p>
      )}
      <ActionForm
        action={uploadSiteImage}
        resetOnSuccess
        successMessage={t("catalog.imageSaved")}
      >
        <input type="hidden" name="kind" value={kind} />
        <Field
          label={t(`settings.${kind}Image`)}
          htmlFor={`${kind}-file`}
          hint={t(`settings.${kind}ImageHint`)}
        >
          <input
            id={`${kind}-file`}
            name="file"
            type="file"
            data-max-bytes={PUBLIC_UPLOAD_MAX_BYTES}
            accept="image/jpeg,image/png,image/webp"
            required
            className={inputClasses}
          />
        </Field>
        <button
          type="submit"
          className={`${buttonVariants({ variant: "outline", size: "sm" })} justify-self-start`}
        >
          {t("catalog.uploadImage")}
        </button>
      </ActionForm>
      {path && (
        <ActionForm
          action={removeSiteImage}
          confirmMessage={t("catalog.removeImageConfirm")}
        >
          <input type="hidden" name="kind" value={kind} />
          <button
            type="submit"
            className={`${buttonVariants({ variant: "ghost", size: "sm" })} justify-self-start text-destructive`}
          >
            {t("catalog.removeImage")}
          </button>
        </ActionForm>
      )}
    </div>
  );
}

export default async function SettingsPage({
  params,
}: PageProps<"/[locale]/admin/settings">) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  await requireAdmin(locale, "settings");
  const [t, { app, security, banks }] = await Promise.all([
    getTranslations("Admin"),
    getSettings(),
  ]);
  const s = (k: string) =>
    (app[k] as string | number | null | undefined)?.toString() ?? "";
  const social = app.social_links ?? {};

  return (
    <>
      <PageHeader
        title={t("settings.title")}
        description={t("settings.intro")}
      />

      <Section
        title={t("settings.pricing")}
        description={t("settings.pricingHint")}
        testId="general-settings"
      >
        <ActionForm
          action={saveGeneralSettings}
          confirmMessage={t("settings.saveConfirm")}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t("settings.rate")}
              htmlFor="usd_sdg_rate"
              hint={t("settings.rateHint")}
            >
              <input
                id="usd_sdg_rate"
                name="usd_sdg_rate"
                required
                inputMode="decimal"
                pattern="\d{1,10}(\.\d{1,4})?"
                defaultValue={s("usd_sdg_rate")}
                dir="ltr"
                className={inputClasses}
              />
            </Field>
            <Field
              label={t("settings.kycThreshold")}
              htmlFor="kyc_threshold_usd"
              hint={t("settings.kycThresholdHint")}
            >
              <input
                id="kyc_threshold_usd"
                name="kyc_threshold_usd"
                required
                inputMode="decimal"
                pattern="\d{1,10}(\.\d{1,2})?"
                defaultValue={s("kyc_threshold_usd")}
                dir="ltr"
                className={inputClasses}
              />
            </Field>
          </div>
          <h3 className="font-bold">{t("settings.contacts")}</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("settings.phone")} htmlFor="contact_phone">
              <input
                id="contact_phone"
                name="contact_phone"
                defaultValue={s("contact_phone")}
                maxLength={32}
                dir="ltr"
                className={inputClasses}
              />
            </Field>
            <Field label={t("settings.whatsapp")} htmlFor="contact_whatsapp">
              <input
                id="contact_whatsapp"
                name="contact_whatsapp"
                defaultValue={s("contact_whatsapp")}
                maxLength={32}
                dir="ltr"
                className={inputClasses}
              />
            </Field>
            <Field label={t("settings.email")} htmlFor="contact_email">
              <input
                id="contact_email"
                name="contact_email"
                type="email"
                defaultValue={s("contact_email")}
                maxLength={254}
                dir="ltr"
                className={inputClasses}
              />
            </Field>
            <Field
              label={`${t("settings.address")} — ${t("lang.ar")}`}
              htmlFor="address_ar"
              className="sm:col-span-3"
            >
              <input
                id="address_ar"
                name="address_ar"
                defaultValue={s("address_ar")}
                maxLength={300}
                dir="rtl"
                className={inputClasses}
              />
            </Field>
            <Field
              label={`${t("settings.address")} — ${t("lang.en")}`}
              htmlFor="address_en"
              className="sm:col-span-3"
            >
              <input
                id="address_en"
                name="address_en"
                defaultValue={s("address_en")}
                maxLength={300}
                dir="ltr"
                className={inputClasses}
              />
            </Field>
          </div>
          <h3 className="font-bold">{t("settings.social")}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {(["facebook", "instagram", "x", "telegram"] as const).map((k) => (
              <Field key={k} label={t(`settings.networks.${k}`)} htmlFor={k}>
                <input
                  id={k}
                  name={k}
                  type="url"
                  defaultValue={social[k] ?? ""}
                  placeholder="https://"
                  maxLength={300}
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
            {t("save")}
          </button>
        </ActionForm>
      </Section>

      <Section
        title={t("settings.banner")}
        description={t("settings.bannerHint")}
        testId="banner-settings"
      >
        <ActionForm action={saveBanner}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={`${t("settings.bannerTitle")} — ${t("lang.ar")}`}
              htmlFor="banner_title_ar"
            >
              <input
                id="banner_title_ar"
                name="banner_title_ar"
                defaultValue={s("banner_title_ar")}
                maxLength={200}
                dir="rtl"
                className={inputClasses}
              />
            </Field>
            <Field
              label={`${t("settings.bannerTitle")} — ${t("lang.en")}`}
              htmlFor="banner_title_en"
            >
              <input
                id="banner_title_en"
                name="banner_title_en"
                defaultValue={s("banner_title_en")}
                maxLength={200}
                dir="ltr"
                className={inputClasses}
              />
            </Field>
            <Field
              label={t("settings.bannerLink")}
              htmlFor="banner_link"
              hint={t("settings.bannerLinkHint")}
              className="sm:col-span-2"
            >
              <input
                id="banner_link"
                name="banner_link"
                defaultValue={s("banner_link")}
                maxLength={300}
                dir="ltr"
                className={inputClasses}
              />
            </Field>
          </div>
          <CheckboxField
            name="banner_is_active"
            label={t("settings.bannerActive")}
            defaultChecked={!!app.banner_is_active}
          />
          <button
            type="submit"
            className={`${buttonVariants()} justify-self-start`}
          >
            {t("save")}
          </button>
        </ActionForm>
        <SiteImage
          kind="banner"
          path={(app.banner_image_path as string | null) ?? null}
        />
      </Section>

      <Section title={t("settings.logo")} description={t("settings.logoHint")}>
        <SiteImage
          kind="logo"
          path={(app.logo_path as string | null) ?? null}
        />
      </Section>

      <Section
        title={t("settings.banks")}
        description={t("settings.banksHint")}
        testId="bank-settings"
      >
        {banks.map((b) => (
          <div key={b.id} className="grid gap-2 rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <span className="font-medium">
                {locale === "ar" ? b.bank_name_ar : b.bank_name_en}
              </span>
              {!b.is_active && <Badge>{t("settings.bankInactive")}</Badge>}
            </div>
            <BankForm bank={b} />
          </div>
        ))}
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer font-medium">
            {t("settings.addBank")}
          </summary>
          <div className="pt-4">
            <BankForm />
          </div>
        </details>
      </Section>

      {security && (
        <Section
          title={t("settings.limits")}
          description={t("settings.limitsHint")}
          testId="limits-settings"
        >
          <ActionForm action={saveLimits}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field
                label={t("settings.orderLimit")}
                htmlFor="order_rate_limit_per_hour"
                hint={t("settings.orderLimitHint")}
              >
                <input
                  id="order_rate_limit_per_hour"
                  name="order_rate_limit_per_hour"
                  type="number"
                  min={1}
                  max={1000}
                  required
                  defaultValue={security.order_rate_limit_per_hour}
                  className={inputClasses}
                />
              </Field>
              <Field
                label={t("settings.receiptLimit")}
                htmlFor="receipts_per_order_limit"
                hint={t("settings.receiptLimitHint")}
              >
                <input
                  id="receipts_per_order_limit"
                  name="receipts_per_order_limit"
                  type="number"
                  min={1}
                  max={50}
                  required
                  defaultValue={security.receipts_per_order_limit}
                  className={inputClasses}
                />
              </Field>
              <Field
                label={t("settings.commentLimit")}
                htmlFor="comment_rate_limit_per_hour"
                hint={t("settings.commentLimitHint")}
              >
                <input
                  id="comment_rate_limit_per_hour"
                  name="comment_rate_limit_per_hour"
                  type="number"
                  min={1}
                  max={100}
                  required
                  defaultValue={security.comment_rate_limit_per_hour}
                  className={inputClasses}
                />
              </Field>
              <Field
                label={t("settings.otpBudget")}
                htmlFor="otp_daily_budget"
                hint={t("settings.otpBudgetHint")}
              >
                <input
                  id="otp_daily_budget"
                  name="otp_daily_budget"
                  type="number"
                  min={0}
                  max={100000}
                  required
                  defaultValue={security.otp_daily_budget}
                  className={inputClasses}
                />
              </Field>
              <Field
                label={t("settings.otpLogin")}
                htmlFor="otp_login_policy"
                hint={t("settings.otpLoginHint")}
              >
                <select
                  id="otp_login_policy"
                  name="otp_login_policy"
                  defaultValue={security.otp_login_policy}
                  className={selectClasses}
                >
                  <option value="never">{t("settings.otpNever")}</option>
                  <option value="always">{t("settings.otpAlways")}</option>
                </select>
              </Field>
            </div>
            <button
              type="submit"
              className={`${buttonVariants()} justify-self-start`}
            >
              {t("save")}
            </button>
          </ActionForm>
        </Section>
      )}
    </>
  );
}
