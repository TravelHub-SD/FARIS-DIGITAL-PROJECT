"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { inputClasses, selectClasses } from "@/components/ui/styles";

// Editor for a variant's fulfillment fields (product_variants.required_fields).
// It only builds the JSON; the server validates it with fieldDefinitionsSchema
// and the database CHECK validates it again. No Zod in the browser.

const TYPES = ["text", "digits", "phone", "email", "select"] as const;
type FieldType = (typeof TYPES)[number];

type Option = { value: string; label_ar: string; label_en: string };
type Draft = {
  key: string;
  type: FieldType;
  label_ar: string;
  label_en: string;
  required: boolean;
  sensitive: boolean;
  min_length: string;
  max_length: string;
  options: Option[];
};

export type FieldInput = {
  key: string;
  type: FieldType;
  label_ar?: string;
  label_en?: string;
  required: boolean;
  sensitive?: boolean;
  min_length?: number;
  max_length?: number;
  options?: { value: string; label_ar?: string; label_en?: string }[];
};

const toDraft = (f: FieldInput): Draft => ({
  key: f.key,
  type: f.type,
  label_ar: f.label_ar ?? "",
  label_en: f.label_en ?? "",
  required: f.required,
  sensitive: !!f.sensitive,
  min_length: f.min_length?.toString() ?? "",
  max_length: f.max_length?.toString() ?? "",
  options: (f.options ?? []).map((o) => ({
    value: o.value,
    label_ar: o.label_ar ?? "",
    label_en: o.label_en ?? "",
  })),
});

function serialize(drafts: Draft[]): string {
  return JSON.stringify(
    drafts.map((d) => {
      const out: Record<string, unknown> = {
        key: d.key.trim(),
        type: d.type,
        required: d.required,
      };
      if (d.label_ar.trim()) out.label_ar = d.label_ar.trim();
      if (d.label_en.trim()) out.label_en = d.label_en.trim();
      if (d.sensitive) out.sensitive = true;
      if (d.type === "text" || d.type === "digits") {
        if (d.min_length) out.min_length = Number(d.min_length);
        if (d.max_length) out.max_length = Number(d.max_length);
      }
      if (d.type === "select") {
        out.options = d.options.map((o) => {
          const opt: Record<string, string> = { value: o.value.trim() };
          if (o.label_ar.trim()) opt.label_ar = o.label_ar.trim();
          if (o.label_en.trim()) opt.label_en = o.label_en.trim();
          return opt;
        });
      }
      return out;
    }),
  );
}

export function FieldsEditor({ initial }: { initial: FieldInput[] }) {
  const t = useTranslations("Admin.fields");
  const [drafts, setDrafts] = useState<Draft[]>(() => initial.map(toDraft));
  const update = (i: number, patch: Partial<Draft>) =>
    setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const move = (i: number, by: number) =>
    setDrafts((ds) => {
      const next = [...ds];
      const [item] = next.splice(i, 1);
      next.splice(i + by, 0, item);
      return next;
    });

  return (
    <div className="grid gap-3" data-testid="fields-editor">
      <input type="hidden" name="required_fields" value={serialize(drafts)} />
      {drafts.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      )}
      {drafts.map((d, i) => (
        <fieldset
          key={i}
          className="grid gap-3 rounded-lg border p-3"
          data-field-index={i}
        >
          <legend className="px-1 text-sm font-medium">
            {t("field", { n: i + 1 })}
          </legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="grid gap-1 text-xs text-muted-foreground">
              {t("key")}
              <input
                value={d.key}
                onChange={(e) => update(i, { key: e.target.value })}
                pattern="[a-z][a-z0-9_]{0,39}"
                required
                dir="ltr"
                className={inputClasses}
                aria-label={t("key")}
                data-testid="field-key"
              />
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              {t("type")}
              <select
                value={d.type}
                onChange={(e) =>
                  update(i, { type: e.target.value as FieldType })
                }
                className={selectClasses}
                data-testid="field-type"
              >
                {TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`types.${type}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              {t("labelAr")}
              <input
                value={d.label_ar}
                onChange={(e) => update(i, { label_ar: e.target.value })}
                maxLength={80}
                dir="rtl"
                className={inputClasses}
                data-testid="field-label-ar"
              />
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              {t("labelEn")}
              <input
                value={d.label_en}
                onChange={(e) => update(i, { label_en: e.target.value })}
                maxLength={80}
                dir="ltr"
                className={inputClasses}
                data-testid="field-label-en"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={d.required}
                onChange={(e) => update(i, { required: e.target.checked })}
                className="size-4 accent-primary"
              />
              {t("required")}
            </label>
            <label
              className="flex items-center gap-2 text-sm"
              title={t("sensitiveHint")}
            >
              <input
                type="checkbox"
                checked={d.sensitive}
                onChange={(e) => update(i, { sensitive: e.target.checked })}
                className="size-4 accent-primary"
              />
              {t("sensitive")}
            </label>
            {(d.type === "text" || d.type === "digits") && (
              <>
                <label className="grid gap-1 text-xs text-muted-foreground">
                  {t("minLength")}
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={d.min_length}
                    onChange={(e) => update(i, { min_length: e.target.value })}
                    className={`${inputClasses} w-24`}
                  />
                </label>
                <label className="grid gap-1 text-xs text-muted-foreground">
                  {t("maxLength")}
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={d.max_length}
                    onChange={(e) => update(i, { max_length: e.target.value })}
                    className={`${inputClasses} w-24`}
                  />
                </label>
              </>
            )}
          </div>
          {d.type === "select" && (
            <div className="grid gap-2 rounded-md bg-muted/40 p-3">
              <p className="text-xs font-medium">{t("options")}</p>
              {d.options.map((o, k) => (
                <div
                  key={k}
                  className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]"
                >
                  <input
                    value={o.value}
                    onChange={(e) =>
                      update(i, {
                        options: d.options.map((x, m) =>
                          m === k ? { ...x, value: e.target.value } : x,
                        ),
                      })
                    }
                    placeholder={t("optionValue")}
                    aria-label={t("optionValue")}
                    pattern="[A-Za-z0-9_\-]{1,40}"
                    required
                    dir="ltr"
                    className={inputClasses}
                  />
                  <input
                    value={o.label_ar}
                    onChange={(e) =>
                      update(i, {
                        options: d.options.map((x, m) =>
                          m === k ? { ...x, label_ar: e.target.value } : x,
                        ),
                      })
                    }
                    placeholder={t("labelAr")}
                    aria-label={t("labelAr")}
                    dir="rtl"
                    className={inputClasses}
                  />
                  <input
                    value={o.label_en}
                    onChange={(e) =>
                      update(i, {
                        options: d.options.map((x, m) =>
                          m === k ? { ...x, label_en: e.target.value } : x,
                        ),
                      })
                    }
                    placeholder={t("labelEn")}
                    aria-label={t("labelEn")}
                    dir="ltr"
                    className={inputClasses}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      update(i, {
                        options: d.options.filter((_, m) => m !== k),
                      })
                    }
                    className={buttonVariants({ variant: "ghost", size: "sm" })}
                  >
                    {t("removeOption")}
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  update(i, {
                    options: [
                      ...d.options,
                      { value: "", label_ar: "", label_en: "" },
                    ],
                  })
                }
                className={`${buttonVariants({ variant: "outline", size: "sm" })} justify-self-start`}
              >
                {t("addOption")}
              </button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={i === 0}
              onClick={() => move(i, -1)}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              {t("up")}
            </button>
            <button
              type="button"
              disabled={i === drafts.length - 1}
              onClick={() => move(i, 1)}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              {t("down")}
            </button>
            <button
              type="button"
              onClick={() => setDrafts((ds) => ds.filter((_, j) => j !== i))}
              className={
                buttonVariants({ variant: "ghost", size: "sm" }) +
                " text-destructive"
              }
            >
              {t("remove")}
            </button>
          </div>
        </fieldset>
      ))}
      <button
        type="button"
        disabled={drafts.length >= 10}
        onClick={() =>
          setDrafts((ds) => [
            ...ds,
            {
              key: "",
              type: "text",
              label_ar: "",
              label_en: "",
              required: true,
              sensitive: false,
              min_length: "",
              max_length: "",
              options: [],
            },
          ])
        }
        className={`${buttonVariants({ variant: "outline", size: "sm" })} justify-self-start`}
        data-testid="add-field"
      >
        {t("add")}
      </button>
      <p className="text-xs text-muted-foreground">{t("hint")}</p>
    </div>
  );
}
