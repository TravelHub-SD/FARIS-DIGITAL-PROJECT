import { getLocale, getTranslations } from "next-intl/server";

import { buttonVariants } from "@/components/ui/button-variants";
import { inputClasses, selectClasses } from "@/components/ui/styles";
import {
  saveCategory,
  saveProduct,
  saveVariant,
  setCategoryArchived,
  setProductArchived,
  setVariantArchived,
} from "@/server/admin/catalog";
import type { ActionResult } from "@/server/admin/common";

import { ActionForm } from "./action-form";
import { type FieldInput, FieldsEditor } from "./fields-editor";
import { CheckboxField, Field } from "./ui";

// Server-rendered forms for the catalog area. Names and descriptions come in
// both languages; the site falls back to the other language when one is empty.

const textarea = `${inputClasses} h-auto min-h-24`;

function BilingualText({
  name,
  label,
  defaults,
  multiline,
  max,
  labels,
}: {
  name: string;
  label: string;
  defaults: { ar?: string | null; en?: string | null };
  multiline?: boolean;
  max: number;
  labels: { ar: string; en: string };
}) {
  const Control = multiline ? "textarea" : "input";
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={`${label} — ${labels.ar}`} htmlFor={`${name}_ar`}>
        <Control
          id={`${name}_ar`}
          name={`${name}_ar`}
          defaultValue={defaults.ar ?? ""}
          maxLength={max}
          dir="rtl"
          lang="ar"
          className={multiline ? textarea : inputClasses}
        />
      </Field>
      <Field label={`${label} — ${labels.en}`} htmlFor={`${name}_en`}>
        <Control
          id={`${name}_en`}
          name={`${name}_en`}
          defaultValue={defaults.en ?? ""}
          maxLength={max}
          dir="ltr"
          lang="en"
          className={multiline ? textarea : inputClasses}
        />
      </Field>
    </div>
  );
}

export async function CategoryForm({
  category,
}: {
  category?: {
    id: string;
    slug: string;
    name_ar: string | null;
    name_en: string | null;
    description_ar: string | null;
    description_en: string | null;
    sort_order: number;
    is_active: boolean;
  };
}) {
  const t = await getTranslations("Admin");
  const locale = await getLocale();
  const langs = { ar: t("lang.ar"), en: t("lang.en") };
  return (
    <ActionForm action={saveCategory} testId="category-form">
      <input type="hidden" name="locale" value={locale} />
      {category && <input type="hidden" name="id" value={category.id} />}
      <BilingualText
        name="name"
        label={t("catalog.name")}
        defaults={{ ar: category?.name_ar, en: category?.name_en }}
        max={120}
        labels={langs}
      />
      <BilingualText
        name="description"
        label={t("catalog.description")}
        defaults={{
          ar: category?.description_ar,
          en: category?.description_en,
        }}
        max={2000}
        multiline
        labels={langs}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t("catalog.slug")}
          htmlFor="slug"
          hint={t("catalog.slugHint")}
        >
          <input
            id="slug"
            name="slug"
            required
            defaultValue={category?.slug}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={80}
            dir="ltr"
            className={inputClasses}
          />
        </Field>
        <Field
          label={t("catalog.sortOrder")}
          htmlFor="sort_order"
          hint={t("catalog.sortHint")}
        >
          <input
            id="sort_order"
            name="sort_order"
            type="number"
            defaultValue={category?.sort_order ?? 0}
            className={inputClasses}
          />
        </Field>
      </div>
      <CheckboxField
        name="is_active"
        label={t("catalog.visible")}
        defaultChecked={category?.is_active ?? true}
      />
      <button
        type="submit"
        className={`${buttonVariants()} justify-self-start`}
      >
        {category ? t("save") : t("create")}
      </button>
    </ActionForm>
  );
}

export async function ProductForm({
  product,
  categories,
}: {
  product?: {
    id: string;
    category_id: string;
    slug: string;
    name_ar: string | null;
    name_en: string | null;
    description_ar: string | null;
    description_en: string | null;
    sort_order: number;
    is_active: boolean;
  };
  categories: { id: string; name: string }[];
}) {
  const t = await getTranslations("Admin");
  const locale = await getLocale();
  const langs = { ar: t("lang.ar"), en: t("lang.en") };
  return (
    <ActionForm action={saveProduct} testId="product-form">
      <input type="hidden" name="locale" value={locale} />
      {product && <input type="hidden" name="id" value={product.id} />}
      <BilingualText
        name="name"
        label={t("catalog.name")}
        defaults={{ ar: product?.name_ar, en: product?.name_en }}
        max={160}
        labels={langs}
      />
      <BilingualText
        name="description"
        label={t("catalog.description")}
        defaults={{ ar: product?.description_ar, en: product?.description_en }}
        max={8000}
        multiline
        labels={langs}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("catalog.category")} htmlFor="category_id">
          <select
            id="category_id"
            name="category_id"
            required
            defaultValue={product?.category_id}
            className={selectClasses}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={t("catalog.slug")}
          htmlFor="slug"
          hint={t("catalog.slugHint")}
        >
          <input
            id="slug"
            name="slug"
            required
            defaultValue={product?.slug}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={80}
            dir="ltr"
            className={inputClasses}
          />
        </Field>
        <Field
          label={t("catalog.sortOrder")}
          htmlFor="sort_order"
          hint={t("catalog.sortHint")}
        >
          <input
            id="sort_order"
            name="sort_order"
            type="number"
            defaultValue={product?.sort_order ?? 0}
            className={inputClasses}
          />
        </Field>
      </div>
      <CheckboxField
        name="is_active"
        label={t("catalog.visible")}
        defaultChecked={product?.is_active ?? true}
      />
      <button
        type="submit"
        className={`${buttonVariants()} justify-self-start`}
      >
        {product ? t("save") : t("create")}
      </button>
    </ActionForm>
  );
}

export async function VariantForm({
  productId,
  variant,
  rate,
}: {
  productId: string;
  variant?: {
    id: string;
    name_ar: string | null;
    name_en: string | null;
    price_usd: number;
    max_quantity: number;
    sort_order: number;
    is_active: boolean;
    required_fields: FieldInput[];
  };
  rate: number | null;
}) {
  const t = await getTranslations("Admin");
  const locale = await getLocale();
  const langs = { ar: t("lang.ar"), en: t("lang.en") };
  return (
    <ActionForm action={saveVariant} testId="variant-form">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="product_id" value={productId} />
      {variant && <input type="hidden" name="id" value={variant.id} />}
      <BilingualText
        name="name"
        label={t("catalog.variantName")}
        defaults={{ ar: variant?.name_ar, en: variant?.name_en }}
        max={120}
        labels={langs}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label={t("catalog.priceUsd")}
          htmlFor="price_usd"
          hint={
            rate
              ? t("catalog.priceHint", { rate: String(rate) })
              : t("catalog.noRate")
          }
        >
          <input
            id="price_usd"
            name="price_usd"
            required
            inputMode="decimal"
            pattern="\d{1,8}(\.\d{1,2})?"
            defaultValue={variant ? variant.price_usd.toFixed(2) : ""}
            dir="ltr"
            className={inputClasses}
          />
        </Field>
        <Field label={t("catalog.maxQuantity")} htmlFor="max_quantity">
          <input
            id="max_quantity"
            name="max_quantity"
            type="number"
            min={1}
            max={10}
            required
            defaultValue={variant?.max_quantity ?? 1}
            className={inputClasses}
          />
        </Field>
        <Field label={t("catalog.sortOrder")} htmlFor="sort_order">
          <input
            id="sort_order"
            name="sort_order"
            type="number"
            defaultValue={variant?.sort_order ?? 0}
            className={inputClasses}
          />
        </Field>
      </div>
      <CheckboxField
        name="is_active"
        label={t("catalog.visible")}
        defaultChecked={variant?.is_active ?? true}
      />
      <div className="grid gap-2">
        <h3 className="font-bold">{t("catalog.requiredFields")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("catalog.requiredFieldsHint")}
        </p>
        <FieldsEditor initial={variant?.required_fields ?? []} />
      </div>
      <button
        type="submit"
        className={`${buttonVariants()} justify-self-start`}
      >
        {variant ? t("save") : t("create")}
      </button>
    </ActionForm>
  );
}

const ARCHIVE_ACTIONS: Record<
  "category" | "product" | "variant",
  (formData: FormData) => Promise<ActionResult>
> = {
  category: setCategoryArchived,
  product: setProductArchived,
  variant: setVariantArchived,
};

export async function ArchiveForm({
  kind,
  id,
  archived,
}: {
  kind: "category" | "product" | "variant";
  id: string;
  archived: boolean;
}) {
  const t = await getTranslations("Admin");
  return (
    <ActionForm
      action={ARCHIVE_ACTIONS[kind]}
      confirmMessage={archived ? undefined : t("catalog.archiveConfirm")}
      testId="archive-form"
    >
      <input type="hidden" name="id" value={id} />
      <input
        type="hidden"
        name="archived"
        value={archived ? "false" : "true"}
      />
      <p className="text-sm text-muted-foreground">
        {archived ? t("catalog.archivedNote") : t("catalog.archiveHint")}
      </p>
      <button
        type="submit"
        className={`${buttonVariants({ variant: archived ? "outline" : "destructive", size: "sm" })} justify-self-start`}
      >
        {archived ? t("catalog.restore") : t("catalog.archive")}
      </button>
    </ActionForm>
  );
}
