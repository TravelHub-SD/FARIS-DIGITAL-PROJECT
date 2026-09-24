"use client";

import { useActionState, useState } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import {
  alertClasses,
  inputClasses,
  labelClasses,
  selectClasses,
} from "@/components/ui/styles";
import type { FieldType } from "@/lib/fulfillment";
import type { LocalizedText } from "@/lib/localized";
import {
  checkOrderDetails,
  type OrderDetailsState,
} from "@/server/catalog/actions";

// The only client component on public catalog pages. Everything it shows is
// resolved on the server (labels, fallbacks, formatted prices) and passed in
// as props, so no translation files or formatting libraries ship to the
// browser. Validation shown here comes from the Server Action.
// Native elements + plain class strings (no tailwind-merge/Radix) keep this
// component around 2 KB gzipped.

export type FormField = {
  key: string;
  type: FieldType;
  label: LocalizedText | null;
  required: boolean;
  minLength?: number;
  maxLength?: number;
  options?: { value: string; label: LocalizedText | null }[];
};

export type FormVariant = {
  id: string;
  name: LocalizedText | null;
  price: string | null;
  fields: FormField[];
};

type Strings = {
  chooseOption: string;
  details: string;
  continue: string;
  detailsValid: string;
  orderingSoon: string;
  required: string;
  optional: string;
  select: string;
  priceUnavailable: string;
  errors: Record<string, string>;
};

function Alert({
  tone,
  children,
  ...rest
}: {
  tone: "error" | "success";
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      data-tone={tone}
      className={`${alertClasses.base} ${alertClasses[tone]}`}
      {...rest}
    >
      {children}
    </div>
  );
}

function Text({ value }: { value: LocalizedText | null }) {
  if (!value) return null;
  return value.fallback ? (
    <span lang={value.lang} dir={value.lang === "ar" ? "rtl" : "ltr"}>
      {value.text}
    </span>
  ) : (
    <>{value.text}</>
  );
}

export function OrderDetailsForm({
  variants,
  strings,
}: {
  variants: FormVariant[];
  strings: Strings;
}) {
  const [selected, setSelected] = useState(variants[0].id);
  const [state, action, pending] = useActionState<OrderDetailsState, FormData>(
    checkOrderDetails,
    { status: "idle" },
  );
  const variant = variants.find((v) => v.id === selected) ?? variants[0];
  const errors = state.status === "invalid" ? state.errors : {};
  // Errors for keys this variant does not declare (a forged extra field).
  const unexpected = Object.keys(errors).some(
    (k) => k !== "_form" && !variant.fields.some((f) => f.key === k),
  );

  return (
    <form
      action={action}
      className="grid gap-6"
      data-testid="order-details-form"
    >
      <fieldset className="grid gap-2">
        <legend className="mb-2 font-bold">{strings.chooseOption}</legend>
        {variants.map((v) => (
          <label
            key={v.id}
            className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
          >
            <span className="flex items-center gap-3">
              <input
                type="radio"
                name="variantId"
                value={v.id}
                checked={v.id === selected}
                onChange={() => setSelected(v.id)}
                className="size-4 accent-primary"
              />
              <Text value={v.name} />
            </span>
            <span className="text-sm font-medium" dir="auto">
              {v.price ?? strings.priceUnavailable}
            </span>
          </label>
        ))}
      </fieldset>

      {variant.fields.length > 0 && (
        <fieldset className="grid gap-4" key={variant.id}>
          <legend className="mb-2 font-bold">{strings.details}</legend>
          {variant.fields.map((f) => {
            const id = `f-${f.key}`;
            const error = errors[f.key];
            const common = {
              id,
              name: `f.${f.key}`,
              required: f.required,
              "aria-invalid": !!error,
              "aria-describedby": `${id}-help`,
            };
            return (
              <div key={f.key} className="grid gap-2">
                <label htmlFor={id} className={labelClasses}>
                  <Text value={f.label} />{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    ({f.required ? strings.required : strings.optional})
                  </span>
                </label>
                {f.type === "select" ? (
                  <select {...common} defaultValue="" className={selectClasses}>
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
                    className={inputClasses}
                    type={
                      f.type === "email"
                        ? "email"
                        : f.type === "phone"
                          ? "tel"
                          : "text"
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
                  className="text-sm text-destructive"
                  data-field-error={f.key}
                >
                  {error
                    ? (strings.errors[error] ?? strings.errors.type)
                    : null}
                </p>
              </div>
            );
          })}
        </fieldset>
      )}

      {state.status === "invalid" && state.errors._form && (
        <Alert tone="error">{strings.errors[state.errors._form]}</Alert>
      )}
      {unexpected && <Alert tone="error">{strings.errors.unknown}</Alert>}
      {state.status === "valid" && state.variantId === variant.id && (
        <Alert tone="success" data-testid="details-valid">
          {strings.detailsValid} {strings.orderingSoon}
        </Alert>
      )}
      <button
        type="submit"
        disabled={pending}
        className={`${buttonVariants()} justify-self-start`}
      >
        {strings.continue}
      </button>
    </form>
  );
}
