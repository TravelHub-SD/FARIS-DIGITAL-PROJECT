"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import {
  alertClasses,
  inputClasses,
  labelClasses,
} from "@/components/ui/styles";
import { useHydrated } from "@/lib/use-hydrated";
import {
  type CommentResult,
  postComment,
} from "@/server/catalog/comment-actions";

// Public page: strings come from the server as props (no client i18n runtime).
export function CommentForm({
  productId,
  slug,
  loginHref,
  strings,
}: {
  productId: string;
  slug: string;
  loginHref: string;
  strings: {
    label: string;
    placeholder: string;
    submit: string;
    posted: string;
    signIn: string;
    errors: Record<string, string>;
  };
}) {
  const router = useRouter();
  const [result, setResult] = useState<CommentResult | null>(null);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();

  return (
    <form
      method="post"
      className="grid gap-3"
      data-testid="comment-form"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        startTransition(async () => {
          const res = await postComment(data);
          setResult(res);
          if (res.ok) {
            form.reset();
            router.refresh();
          }
        });
      }}
    >
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="slug" value={slug} />
      <label htmlFor="comment-body" className={labelClasses}>
        {strings.label}
      </label>
      <textarea
        id="comment-body"
        name="body"
        required
        maxLength={1000}
        rows={3}
        placeholder={strings.placeholder}
        className={`${inputClasses} h-auto`}
      />
      {result && (
        <div
          role={result.ok ? "status" : "alert"}
          data-tone={result.ok ? "success" : "error"}
          data-result={result.ok ? "ok" : result.error}
          className={`${alertClasses.base} ${result.ok ? alertClasses.success : alertClasses.error}`}
        >
          {result.ok
            ? strings.posted
            : (strings.errors[result.error] ??
              strings.errors.server_error)}{" "}
          {!result.ok && result.error === "sign_in" && (
            <a href={loginHref} className="font-medium underline">
              {strings.signIn}
            </a>
          )}
        </div>
      )}
      <button
        type="submit"
        disabled={pending || !hydrated}
        className={`${buttonVariants({ variant: "outline" })} justify-self-start`}
      >
        {strings.submit}
      </button>
    </form>
  );
}
