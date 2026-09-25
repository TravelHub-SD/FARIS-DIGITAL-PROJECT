"use server";

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { actionAdmin } from "@/server/auth/session";
import { PUBLIC_IMAGE_PROFILES } from "@/server/files/image";

import {
  type ActionResult,
  affected,
  dbError,
  fields,
  INVALID,
  NOT_ALLOWED,
  revalidatePublic,
} from "./common";
import { removePublicImage, uploadPublicImage } from "./public-images";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);
const optionalUrl = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === "" || /^https:\/\/[^\s]+$/.test(v))
  .transform((v) => v || null);
const checkbox = z
  .string()
  .optional()
  .transform((v) => v === "on");
const decimal = (scale: number) =>
  z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{1,10}(\\.\\d{1,${scale}})?$`))
    .transform(Number);

const businessName = z.string().trim().min(1).max(120);

const generalSchema = z.object({
  business_name_ar: businessName,
  business_name_en: businessName,
  usd_sdg_rate: decimal(4).refine((n) => n > 0),
  kyc_threshold_usd: decimal(2),
  contact_phone: optionalText(32),
  contact_whatsapp: optionalText(32),
  contact_email: z
    .string()
    .trim()
    .max(254)
    .refine((v) => v === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v))
    .transform((v) => v || null),
  address_ar: optionalText(300),
  address_en: optionalText(300),
  facebook: optionalUrl,
  instagram: optionalUrl,
  x: optionalUrl,
  telegram: optionalUrl,
});

/** Business name (new invoices), rate, KYC threshold, contacts, social links. */
export async function saveGeneralSettings(
  formData: FormData,
): Promise<ActionResult> {
  if (!(await actionAdmin("settings"))) return NOT_ALLOWED;
  const input = generalSchema.safeParse(fields(formData));
  if (!input.success) return INVALID;
  const { facebook, instagram, x, telegram, ...rest } = input.data;
  const social = Object.fromEntries(
    Object.entries({ facebook, instagram, x, telegram }).filter(([, v]) => v),
  );
  const supabase = await createClient();
  const res = await supabase
    .from("app_settings")
    .update({ ...rest, social_links: social })
    .eq("id", true)
    .select("id");
  const result = affected(res);
  if (result.ok) revalidatePublic();
  return result;
}

const bannerSchema = z.object({
  banner_title_ar: optionalText(200),
  banner_title_en: optionalText(200),
  banner_link: z
    .string()
    .trim()
    .max(300)
    .refine((v) => v === "" || /^(\/[^\s]*|https:\/\/[^\s]+)$/.test(v))
    .transform((v) => v || null),
  banner_is_active: checkbox,
});

export async function saveBanner(formData: FormData): Promise<ActionResult> {
  if (!(await actionAdmin("settings"))) return NOT_ALLOWED;
  const input = bannerSchema.safeParse(fields(formData));
  if (!input.success) return INVALID;
  const supabase = await createClient();
  const res = await supabase
    .from("app_settings")
    .update(input.data)
    .eq("id", true)
    .select("id");
  const result = affected(res);
  if (result.ok) revalidatePublic();
  return result;
}

const imageKind = z.enum(["banner", "logo"]);
const COLUMN = { banner: "banner_image_path", logo: "logo_path" } as const;

/** Banner or logo: validated, re-encoded to WebP, stored under site/. */
export async function uploadSiteImage(
  formData: FormData,
): Promise<ActionResult> {
  if (!(await actionAdmin("settings"))) return NOT_ALLOWED;
  const kind = imageKind.safeParse(formData.get("kind"));
  const file = formData.get("file");
  if (!kind.success) return INVALID;
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, error: "empty" };

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("app_settings")
    .select("banner_image_path, logo_path")
    .maybeSingle();
  const uploaded = await uploadPublicImage(
    file,
    PUBLIC_IMAGE_PROFILES[kind.data],
    `site/${kind.data}`,
  );
  if (!uploaded.ok) return { ok: false, error: uploaded.error };
  const res = await supabase
    .from("app_settings")
    .update({ [COLUMN[kind.data]]: uploaded.path })
    .eq("id", true)
    .select("id");
  const result = affected(res);
  if (!result.ok) {
    await removePublicImage(uploaded.path);
    return result;
  }
  await removePublicImage(current?.[COLUMN[kind.data]] as string | null);
  revalidatePublic();
  return { ok: true };
}

export async function removeSiteImage(
  formData: FormData,
): Promise<ActionResult> {
  if (!(await actionAdmin("settings"))) return NOT_ALLOWED;
  const kind = imageKind.safeParse(formData.get("kind"));
  if (!kind.success) return INVALID;
  const supabase = await createClient();
  const { data: current } = await supabase
    .from("app_settings")
    .select("banner_image_path, logo_path")
    .maybeSingle();
  const res = await supabase
    .from("app_settings")
    .update({ [COLUMN[kind.data]]: null })
    .eq("id", true)
    .select("id");
  const result = affected(res);
  if (result.ok) {
    await removePublicImage(current?.[COLUMN[kind.data]] as string | null);
    revalidatePublic();
  }
  return result;
}

const limitsSchema = z.object({
  order_rate_limit_per_hour: z.coerce.number().int().min(1).max(1000),
  receipts_per_order_limit: z.coerce.number().int().min(1).max(50),
  comment_rate_limit_per_hour: z.coerce.number().int().min(1).max(100),
  otp_daily_budget: z.coerce.number().int().min(0).max(100000),
  otp_login_policy: z.enum(["never", "always"]),
});

/** Abuse limits (decision 2026-09-27): editable without a deploy. */
export async function saveLimits(formData: FormData): Promise<ActionResult> {
  if (!(await actionAdmin("settings"))) return NOT_ALLOWED;
  const input = limitsSchema.safeParse(fields(formData));
  if (!input.success) return INVALID;
  const supabase = await createClient();
  const res = await supabase
    .from("security_settings")
    .update(input.data)
    .eq("id", true)
    .select("id");
  return affected(res);
}

const bankSchema = z.object({
  id: z.guid().optional(),
  bank_name_ar: z.string().trim().min(1).max(120),
  bank_name_en: z.string().trim().min(1).max(120),
  account_number: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z-]{3,40}$/),
  account_holder: z.string().trim().min(1).max(120),
  branch_ar: optionalText(120),
  branch_en: optionalText(120),
  sort_order: z.coerce.number().int().min(-1000).max(1000).default(0),
  is_active: checkbox,
});

/** Receiving accounts shown to customers on every unpaid order. */
export async function saveBankAccount(
  formData: FormData,
): Promise<ActionResult> {
  if (!(await actionAdmin("settings"))) return NOT_ALLOWED;
  const input = bankSchema.safeParse(fields(formData));
  if (!input.success) return INVALID;
  const { id, ...row } = input.data;
  const supabase = await createClient();
  if (id) {
    return affected(
      await supabase
        .from("bank_accounts")
        .update(row)
        .eq("id", id)
        .select("id"),
    );
  }
  const { error } = await supabase.from("bank_accounts").insert(row);
  return error ? dbError(error) : { ok: true };
}

const faqSchema = z
  .object({
    id: z.guid().optional(),
    question_ar: optionalText(300),
    question_en: optionalText(300),
    answer_ar: optionalText(4000),
    answer_en: optionalText(4000),
    sort_order: z.coerce.number().int().min(-1000).max(1000).default(0),
    is_published: checkbox,
  })
  .refine(
    (f) => (f.question_ar || f.question_en) && (f.answer_ar || f.answer_en),
  );

export async function saveFaq(formData: FormData): Promise<ActionResult> {
  if (!(await actionAdmin("settings"))) return NOT_ALLOWED;
  const input = faqSchema.safeParse(fields(formData));
  if (!input.success) return INVALID;
  const { id, ...row } = input.data;
  const supabase = await createClient();
  const result = id
    ? affected(
        await supabase.from("faqs").update(row).eq("id", id).select("id"),
      )
    : await supabase
        .from("faqs")
        .insert(row)
        .then(({ error }) =>
          error ? dbError(error) : ({ ok: true } as const),
        );
  if (result.ok) revalidatePublic();
  return result;
}

export async function deleteFaq(formData: FormData): Promise<ActionResult> {
  if (!(await actionAdmin("settings"))) return NOT_ALLOWED;
  const id = z.guid().safeParse(formData.get("id"));
  if (!id.success) return INVALID;
  const supabase = await createClient();
  const result = affected(
    await supabase.from("faqs").delete().eq("id", id.data).select("id"),
  );
  if (result.ok) revalidatePublic();
  return result;
}

const rate = z
  .string()
  .trim()
  .refine((v) => v === "" || /^\d{1,4}(\.\d{1,5})?$/.test(v))
  .transform((v) => (v === "" ? null : Number(v)));
const ratesSchema = z.object({
  authentication: rate,
  utility: rate,
  marketing: rate,
  service: rate,
});

/** WhatsApp price per delivered message, copied from Meta's rate card. */
export async function saveWhatsAppRates(
  formData: FormData,
): Promise<ActionResult> {
  if (!(await actionAdmin("settings"))) return NOT_ALLOWED;
  const input = ratesSchema.safeParse(fields(formData));
  if (!input.success) return INVALID;
  const supabase = await createClient();
  for (const [category, usd] of Object.entries(input.data)) {
    const result = affected(
      await supabase
        .from("whatsapp_rates")
        .update({ usd_per_message: usd })
        .eq("category", category)
        .select("category"),
    );
    if (!result.ok) return result;
  }
  return { ok: true };
}
