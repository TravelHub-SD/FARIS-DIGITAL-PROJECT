"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { profileSchema } from "@/lib/validation/auth";
import { actionCompleteUser } from "@/server/auth/session";

// Runs with the customer's own session: column grants allow only
// full_name and locale, so nothing else on the profile can change here.
export async function updateProfile(input: unknown): Promise<{ ok: boolean }> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  const user = await actionCompleteUser();
  if (!user) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: parsed.data.fullName, locale: parsed.data.locale })
    .eq("id", user.id);
  if (error) return { ok: false };
  revalidatePath(`/${parsed.data.locale}/account`);
  return { ok: true };
}
