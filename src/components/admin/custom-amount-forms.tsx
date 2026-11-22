import { getTranslations } from "next-intl/server";

import { buttonVariants } from "@/components/ui/button-variants";
import { inputClasses, selectClasses } from "@/components/ui/styles";
import type { Locale } from "@/i18n/routing";
import { formatAmount, formatDecimal, quote } from "@/lib/custom-amount";
import { formatDateTime, formatSdg } from "@/lib/format";
import {
  removeAmountCurrency,
  saveAmountCurrency,
  saveCurrency,
  saveCustomAmountSettings,
} from "@/server/admin/custom-amount";
import type {
  AdminCurrency,
  CustomAmountSettings,
} from "@/server/admin/custom-amount-queries";

import { ActionForm } from "./action-form";
import { FieldsEditor } from "./fields-editor";
import { Badge, CheckboxField, Empty, Field, TableWrap } from "./ui";

// Dashboard forms for custom-amount products and currencies (settings
// permission; decisions.md 2026-11-21). Server-rendered; every value is
// checked again by the action and by the database.

const amountPattern = "\\d{1,11}(\\.\\d{1,3})?";

/** Example price shown next to the settings, from the same formula. */
function example(
  settings: CustomAmountSettings,
  currency: AdminCurrency,
  min: string,
  locale: Locale,
) {
  const q = quote({
    amount: min,
    rate: currency.sdg_rate,
    feePercent: settings.fee_percent,
    feeFixedSdg: settings.fee_fixed_sdg,
  });
  return formatSdg(q.totalSdg, locale);
}

export async function CustomAmountSettingsSection({
  productId,
  settings,
  currencies,
  canEdit,
  locale,
}: {
  productId: string;
  settings: CustomAmountSettings;
  currencies: AdminCurrency[];
  canEdit: boolean;
  locale: Locale;
}) {
  const t = await getTranslations("Admin.customAmount");
  const ta = await getTranslations("Admin");
  const byCode = new Map(currencies.map((c) => [c.code, c]));
  const unused = currencies.filter(
    (c) =>
      c.is_active && !settings.limits.some((l) => l.currency_code === c.code),
  );
  const d = settings.amount_decimals;

  return (
    <div className="grid gap-6" data-testid="custom-amount-settings">
      {!canEdit && (
        <p
          className="rounded-md bg-muted p-3 text-sm"
          data-testid="custom-amount-readonly"
        >
          {t("readOnly")}
        </p>
      )}

      <div className="grid gap-3">
        <h3 className="font-bold">{t("currencies")}</h3>
        <p className="text-sm text-muted-foreground">{t("currenciesHint")}</p>
        {settings.limits.length === 0 ? (
          <Empty>{t("noCurrencies")}</Empty>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th>{t("currency")}</th>
                <th>{t("rate")}</th>
                <th>{t("min")}</th>
                <th>{t("max")}</th>
                <th>{t("example")}</th>
                {canEdit && <th />}
              </tr>
            </thead>
            <tbody data-testid="amount-currencies">
              {settings.limits.map((l) => {
                const c = byCode.get(l.currency_code);
                return (
                  <tr key={l.id} data-currency={l.currency_code}>
                    <td>
                      <span className="font-medium" dir="ltr">
                        {l.currency_code}
                      </span>{" "}
                      {c && !c.is_active && (
                        <Badge tone="warning">{t("disabled")}</Badge>
                      )}
                    </td>
                    <td dir="ltr">{c ? formatDecimal(c.sdg_rate) : "—"}</td>
                    {canEdit ? (
                      <td colSpan={2}>
                        <ActionForm
                          action={saveAmountCurrency}
                          className="flex flex-wrap items-end gap-2"
                          testId={`limits-${l.currency_code}`}
                        >
                          <input
                            type="hidden"
                            name="product_id"
                            value={productId}
                          />
                          <input
                            type="hidden"
                            name="currency_code"
                            value={l.currency_code}
                          />
                          <input
                            type="hidden"
                            name="sort_order"
                            value={l.sort_order}
                          />
                          <input
                            name="min_amount"
                            aria-label={`${t("min")} ${l.currency_code}`}
                            defaultValue={l.min_amount}
                            required
                            inputMode="decimal"
                            pattern={amountPattern}
                            dir="ltr"
                            className={`${inputClasses} w-28`}
                          />
                          <input
                            name="max_amount"
                            aria-label={`${t("max")} ${l.currency_code}`}
                            defaultValue={l.max_amount}
                            required
                            inputMode="decimal"
                            pattern={amountPattern}
                            dir="ltr"
                            className={`${inputClasses} w-28`}
                          />
                          <button
                            type="submit"
                            className={buttonVariants({
                              variant: "outline",
                              size: "sm",
                            })}
                          >
                            {ta("save")}
                          </button>
                        </ActionForm>
                      </td>
                    ) : (
                      <>
                        <td dir="ltr">{formatAmount(l.min_amount, d)}</td>
                        <td dir="ltr">{formatAmount(l.max_amount, d)}</td>
                      </>
                    )}
                    <td dir="auto" className="whitespace-nowrap">
                      {c
                        ? `${formatAmount(l.min_amount, d)} ${l.currency_code} = ${example(settings, c, l.min_amount, locale)}`
                        : "—"}
                    </td>
                    {canEdit && (
                      <td>
                        <ActionForm
                          action={removeAmountCurrency}
                          confirmMessage={t("removeConfirm", {
                            code: l.currency_code,
                          })}
                        >
                          <input type="hidden" name="id" value={l.id} />
                          <button
                            type="submit"
                            className={`${buttonVariants({ variant: "ghost", size: "sm" })} text-destructive`}
                          >
                            {t("remove")}
                          </button>
                        </ActionForm>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
        {canEdit &&
          (unused.length > 0 ? (
            <ActionForm
              action={saveAmountCurrency}
              resetOnSuccess
              className="grid gap-3 rounded-lg border p-3 sm:grid-cols-4 sm:items-end"
              testId="add-amount-currency"
              successMessage={t("added")}
            >
              <input type="hidden" name="product_id" value={productId} />
              <Field label={t("currency")} htmlFor="new-currency">
                <select
                  id="new-currency"
                  name="currency_code"
                  required
                  className={selectClasses}
                >
                  {unused.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} · {locale === "ar" ? c.name_ar : c.name_en}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("min")} htmlFor="new-min">
                <input
                  id="new-min"
                  name="min_amount"
                  required
                  defaultValue="1"
                  inputMode="decimal"
                  pattern={amountPattern}
                  dir="ltr"
                  className={inputClasses}
                />
              </Field>
              <Field label={t("max")} htmlFor="new-max">
                <input
                  id="new-max"
                  name="max_amount"
                  required
                  defaultValue="1000"
                  inputMode="decimal"
                  pattern={amountPattern}
                  dir="ltr"
                  className={inputClasses}
                />
              </Field>
              <input
                type="hidden"
                name="sort_order"
                value={settings.limits.length + 1}
              />
              <button type="submit" className={buttonVariants()}>
                {t("add")}
              </button>
            </ActionForm>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("allCurrenciesUsed")}
            </p>
          ))}
      </div>

      {canEdit ? (
        <ActionForm
          action={saveCustomAmountSettings}
          testId="custom-amount-settings-form"
        >
          <input type="hidden" name="product_id" value={productId} />
          <h3 className="font-bold">{t("pricing")}</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label={t("decimals")}
              htmlFor="amount_decimals"
              hint={t("decimalsHint")}
            >
              <select
                id="amount_decimals"
                name="amount_decimals"
                defaultValue={String(d)}
                className={selectClasses}
              >
                {[0, 1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={t("feePercent")}
              htmlFor="fee_percent"
              hint={t("feePercentHint")}
            >
              <input
                id="fee_percent"
                name="fee_percent"
                required
                inputMode="decimal"
                pattern="\d{1,3}(\.\d{1,2})?"
                defaultValue={settings.fee_percent}
                dir="ltr"
                className={inputClasses}
              />
            </Field>
            <Field
              label={t("feeFixed")}
              htmlFor="fee_fixed_sdg"
              hint={t("feeFixedHint")}
            >
              <input
                id="fee_fixed_sdg"
                name="fee_fixed_sdg"
                required
                inputMode="decimal"
                pattern="\d{1,9}(\.\d{1,2})?"
                defaultValue={settings.fee_fixed_sdg}
                dir="ltr"
                className={inputClasses}
              />
            </Field>
          </div>
          <div className="grid gap-2">
            <h3 className="font-bold">{ta("catalog.requiredFields")}</h3>
            <p className="text-sm text-muted-foreground">{t("fieldsHint")}</p>
            <FieldsEditor initial={settings.required_fields} />
          </div>
          <button
            type="submit"
            className={`${buttonVariants()} justify-self-start`}
          >
            {ta("save")}
          </button>
        </ActionForm>
      ) : (
        <dl className="grid gap-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{t("decimals")}:</dt>
            <dd>{d}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{t("feePercent")}:</dt>
            <dd dir="ltr">{formatDecimal(settings.fee_percent)}%</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{t("feeFixed")}:</dt>
            <dd dir="ltr">{formatDecimal(settings.fee_fixed_sdg)} SDG</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">
              {ta("catalog.requiredFields")}:
            </dt>
            <dd>{settings.required_fields.length}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

/** One currency: name, symbol, rate (by hand), order, enabled. */
export async function CurrencyForm({
  currency,
  locale,
}: {
  currency?: AdminCurrency;
  locale: Locale;
}) {
  const t = await getTranslations("Admin.currencies");
  const ta = await getTranslations("Admin");
  const usd = currency?.code === "USD";
  const id = currency?.code ?? "new";
  return (
    <ActionForm
      action={saveCurrency}
      resetOnSuccess={!currency}
      testId={`currency-form-${id}`}
      className="grid gap-3"
    >
      {currency && <input type="hidden" name="id" value={currency.id} />}
      <div className="grid gap-3 sm:grid-cols-6">
        <Field
          label={t("code")}
          htmlFor={`code-${id}`}
          hint={currency ? undefined : t("codeHint")}
        >
          <input
            id={`code-${id}`}
            name={currency ? undefined : "code"}
            defaultValue={currency?.code}
            readOnly={!!currency}
            required
            pattern="[A-Za-z]{3}"
            maxLength={3}
            dir="ltr"
            className={`${inputClasses} uppercase`}
          />
        </Field>
        <Field label={t("nameAr")} htmlFor={`name_ar-${id}`}>
          <input
            id={`name_ar-${id}`}
            name="name_ar"
            defaultValue={currency?.name_ar}
            required
            maxLength={40}
            dir="rtl"
            lang="ar"
            className={inputClasses}
          />
        </Field>
        <Field label={t("nameEn")} htmlFor={`name_en-${id}`}>
          <input
            id={`name_en-${id}`}
            name="name_en"
            defaultValue={currency?.name_en}
            required
            maxLength={40}
            dir="ltr"
            lang="en"
            className={inputClasses}
          />
        </Field>
        <Field label={t("symbol")} htmlFor={`symbol-${id}`}>
          <input
            id={`symbol-${id}`}
            name="symbol"
            defaultValue={currency?.symbol}
            required
            maxLength={8}
            dir="auto"
            className={inputClasses}
          />
        </Field>
        <Field
          label={t("rate")}
          htmlFor={`rate-${id}`}
          hint={
            usd
              ? t("usdHint")
              : currency
                ? t("updated", {
                    date: formatDateTime(currency.rate_updated_at, locale),
                  })
                : t("rateHint")
          }
        >
          <input
            id={`rate-${id}`}
            name={usd ? undefined : "sdg_rate"}
            defaultValue={currency?.sdg_rate}
            readOnly={usd}
            required={!usd}
            inputMode="decimal"
            pattern="\d{1,10}(\.\d{1,4})?"
            dir="ltr"
            className={inputClasses}
            data-testid={`rate-${id}`}
          />
        </Field>
        <Field label={ta("catalog.sortOrder")} htmlFor={`sort-${id}`}>
          <input
            id={`sort-${id}`}
            name="sort_order"
            type="number"
            defaultValue={currency?.sort_order ?? 0}
            className={inputClasses}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <CheckboxField
          name="is_active"
          label={t("active")}
          defaultChecked={currency?.is_active ?? true}
        />
        <button type="submit" className={buttonVariants({ size: "sm" })}>
          {currency ? ta("save") : t("add")}
        </button>
      </div>
    </ActionForm>
  );
}
