"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, isComplete } from "@/server/auth/session";

export type CommentError =
  | "sign_in"
  | "incomplete_account"
  | "not_allowed"
  | "rate_limited"
  | "invalid_input"
  | "server_error";
export type CommentResult = { ok: true } | { ok: false; error: CommentError };

const schema = z.object({
  productId: z.guid(),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(80),
  body: z.string().trim().min(1).max(1000),
});

/**
 * Customer comment on a product page. Written with the customer's own
 * session: RLS requires a verified, unblocked account and a visible product;
 * the database stamps the author and applies the hourly limit (Settings).
 */
export async function postComment(formData: FormData): Promise<CommentResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "sign_in" };
  if (!isComplete(user)) return { ok: false, error: "incomplete_account" };
  const input = schema.safeParse({
    productId: formData.get("productId"),
    slug: formData.get("slug"),
    body: formData.get("body"),
  });
  if (!input.success) return { ok: false, error: "invalid_input" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("comments")
    .insert({ product_id: input.data.productId, body: input.data.body });
  if (error) {
    if (/COMMENT_RATE_LIMIT/.test(error.message))
      return { ok: false, error: "rate_limited" };
    if (/row-level security|permission denied/i.test(error.message))
      return { ok: false, error: "not_allowed" };
    return { ok: false, error: "server_error" };
  }
  for (const locale of routing.locales)
    revalidatePath(`/${locale}/p/${input.data.slug}`);
  return { ok: true };
}
