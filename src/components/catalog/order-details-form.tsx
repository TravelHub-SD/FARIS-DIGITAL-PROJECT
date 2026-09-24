"use client";

import { startTransition, useActionState, useRef, useState } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import {
  alertClasses,
  inputClasses,
  labelClasses,
  selectClasses,
} from "@/components/ui/styles";
import type { Locale } from "@/i18n/routing";
import { formatSdg } from "@/lib/format";
import { useHydrated } from "@/lib/use-hydrated";
import type { FieldType } from "@/lib/fulfillment";
import type { LocalizedText } from "@/lib/localized";
import { placeOrder, type PlaceOrderState } from "@/server/orders/actions";

// The only client component on public catalog pages. Everything it shows is
// resolved on the server (labels, fallbacks, formatted prices) and passed in
// as props, so no translation files or formatting libraries ship to the
// browser. Validation shown here comes from the Server Action.
// Native elements + plain class strings (no tailwind-merge/Radix) keep this
// component small.
//
// Price: the page shows the database's totals (per quantity) and the form
// sends the chosen one back as the amount the customer agreed to. The server
// never uses it as the price; it only refuses when it differs from the
// current price, and this form then shows the new total for confirmation.

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
  /** SDG totals for quantity 1..n, from the database. Null: not orderable. */
  totals: number[] | null;
  fields: FormField[];
};

type Strings = {
  chooseOption: string;
  details: string;
  placeOrder: string;
  quantity: string;
  total: string;
  priceChanged: string;
  signInAction: string;
  kycAction: string;
  completeAction: string;
  required: string;
  optional: string;
  select: string;
  priceUnavailable: string;
  errors: Record<string, string>;
  reasons: Record<string, string>;
};

/** RFC 4122 v4. getRandomValues works on plain http too (randomUUID does not). */
function newKey() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function Alert({
  tone,
  children,
  ...rest
}: {
  tone: "error" | "success" | "warning";
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
  locale,
  loginHref,
}: {
  variants: FormVariant[];
  strings: Strings;
  locale: Locale;
  loginHref: string;
}) {
  const [selected, setSelected] = useState(variants[0].id);
  const [quantity, setQuantity] = useState(1);
  const [state, action, pending] = useActionState<PlaceOrderState, FormData>(
    placeOrder,
    { status: "idle" },
  );
  // One key per order attempt: a double submit or a retry after a timeout
  // returns the same order instead of creating a second one.
  const idempotencyKey = useRef<string | null>(null);
  const hydrated = useHydrated();
  const variant = variants.find((v) => v.id === selected) ?? variants[0];
  const maxQuantity = variant.totals?.length ?? 1;
  const changed =
    state.status === "price_changed" &&
    state.variantId === variant.id &&
    state.quantity === quantity
      ? state.totalSdg
      : null;
  const expectedTotal = changed ?? variant.totals?.[quantity - 1] ?? null;
  const errors = state.status === "invalid" ? state.errors : {};
  const reason = state.status === "error" ? state.reason : null;
  // Errors for keys this variant does not declare (a forged extra field).
  const unexpected = Object.keys(errors).some(
    (k) => k !== "_form" && !variant.fields.some((f) => f.key === k),
  );

  return (
    <form
      method="post"
      // onSubmit rather than a form action: React resets uncontrolled fields
      // after a form action, which would wipe what the customer typed when the
      // server answers "price changed" or with a field error.
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        idempotencyKey.current ??= newKey();
        formData.set("idempotencyKey", idempotencyKey.current);
        startTransition(() => action(formData));
      }}
      className="grid gap-6"
      data-testid="order-details-form"
    >
      {/* Disabled until hydrated: controlled fields (option, quantity) would
          be reset by hydration, and the form cannot submit without JS. */}
      <fieldset disabled={!hydrated} className="contents">
        <input type="hidden" name="locale" value={locale} />
        <input
          type="hidden"
          name="expectedTotalSdg"
          value={expectedTotal ?? ""}
        />
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
                  onChange={() => {
                    setSelected(v.id);
                    setQuantity(1);
                  }}
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

        {maxQuantity > 1 ? (
          <div className="grid gap-2">
            <label htmlFor="quantity" className={labelClasses}>
              {strings.quantity}
            </label>
            <select
              id="quantity"
              name="quantity"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              className={`${selectClasses} max-w-24`}
            >
              {Array.from({ length: maxQuantity }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <input type="hidden" name="quantity" value="1" />
        )}

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
                    <select
                      {...common}
                      defaultValue=""
                      className={selectClasses}
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
        {changed !== null && (
          <Alert tone="warning" data-testid="price-changed">
            {strings.priceChanged.replace(
              "{price}",
              formatSdg(changed, locale) ?? "",
            )}
          </Alert>
        )}
        {reason && (
          <Alert tone="error" data-testid="order-error" data-reason={reason}>
            {strings.reasons[reason] ?? strings.reasons.server_error}{" "}
            {reason === "sign_in" && (
              <a href={loginHref} className="font-medium underline">
                {strings.signInAction}
              </a>
            )}
            {reason === "kyc_required" && (
              <a
                href={`/${locale}/account/kyc`}
                className="font-medium underline"
              >
                {strings.kycAction}
              </a>
            )}
            {reason === "incomplete_account" && (
              <a
                href={`/${locale}/complete-account`}
                className="font-medium underline"
              >
                {strings.completeAction}
              </a>
            )}
          </Alert>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="font-bold" dir="auto" data-testid="order-total">
            {strings.total}:{" "}
            {expectedTotal === null
              ? strings.priceUnavailable
              : formatSdg(expectedTotal, locale)}
          </p>
          <button
            type="submit"
            disabled={pending || !hydrated || expectedTotal === null}
            className={buttonVariants()}
          >
            {strings.placeOrder}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
