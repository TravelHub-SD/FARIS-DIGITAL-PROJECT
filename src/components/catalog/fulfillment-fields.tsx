import {
  inputClasses,
  labelClasses,
  selectClasses,
} from "@/components/ui/styles";
import type {
  FieldDefinition,
  FieldErrorCode,
  FieldType,
} from "@/lib/fulfillment";
import { type LocalizedText, localized } from "@/lib/localized";
import type { Locale } from "@/i18n/routing";

// The "details needed to fulfil your order" inputs, shared by the product
// page (add to cart) and the cart (edit a line). Labels are resolved on the
// server and passed in, so no translation library ships to the browser. The
// server validates the values again (readFulfillmentForm + the cart trigger).

export type FormField = {
  key: string;
  type: FieldType;
  label: LocalizedText | null;
  required: boolean;
  minLength?: number;
  maxLength?: number;
  options?: { value: string; label: LocalizedText | null }[];
};

export type FieldStrings = {
  required: string;
  optional: string;
  select: string;
  errors: Record<string, string>;
};

export function toFormFields(
  defs: FieldDefinition[],
  locale: Locale,
): FormField[] {
  return defs.map((f) => ({
    key: f.key,
    type: f.type,
    label: localized(f.label_ar, f.label_en, locale),
    required: f.required,
    minLength: f.min_length,
    maxLength: f.max_length,
    options: f.options?.map((o) => ({
      value: o.value,
      label: localized(o.label_ar, o.label_en, locale),
    })),
  }));
}

export function Text({ value }: { value: LocalizedText | null }) {
  if (!value) return null;
  return value.fallback ? (
    <span lang={value.lang} dir={value.lang === "ar" ? "rtl" : "ltr"}>
      {value.text}
    </span>
  ) : (
    <>{value.text}</>
  );
}

export function FulfillmentFields({
  fields,
  errors,
  strings,
  defaults,
  idPrefix = "f",
}: {
  fields: FormField[];
  errors: Record<string, FieldErrorCode>;
  strings: FieldStrings;
  defaults?: Record<string, string>;
  idPrefix?: string;
}) {
  return fields.map((f) => {
    const id = `${idPrefix}-${f.key}`;
    const error = errors[f.key];
    const common = {
      id,
      name: `f.${f.key}`,
      required: f.required,
      "aria-invalid": !!error,
      "aria-describedby": `${id}-help`,
    };
    return (
      <div key={f.key} className="grid gap-1.5">
        <label htmlFor={id} className={labelClasses}>
          <Text value={f.label} />{" "}
          <span className="text-xs font-normal text-muted-foreground">
            ({f.required ? strings.required : strings.optional})
          </span>
        </label>
        {f.type === "select" ? (
          <select
            {...common}
            defaultValue={defaults?.[f.key] ?? ""}
            className={`${selectClasses} h-12`}
          >
            <option value="" disabled>
              {strings.select}
            </option>
            {f.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label?.text ?? o.value}
              </option>
            ))}
          </select>
        ) : (
          <input
            {...common}
            defaultValue={defaults?.[f.key]}
            className={`${inputClasses} h-12 text-base`}
            type={
              f.type === "email" ? "email" : f.type === "phone" ? "tel" : "text"
            }
            inputMode={
              f.type === "digits"
                ? "numeric"
                : f.type === "phone"
                  ? "tel"
                  : undefined
            }
            dir={f.type === "text" ? undefined : "ltr"}
            minLength={f.minLength}
            maxLength={f.maxLength}
            autoComplete="off"
          />
        )}
        <p
          id={`${id}-help`}
          className="text-sm text-destructive empty:hidden"
          data-field-error={f.key}
        >
          {error ? (strings.errors[error] ?? strings.errors.type) : null}
        </p>
      </div>
    );
  });
}
