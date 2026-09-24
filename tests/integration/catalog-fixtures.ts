import type { FieldDefinition } from "@/lib/fulfillment";

import { service } from "./helpers";

export const FIELDS: FieldDefinition[] = [
  {
    key: "player_id",
    type: "digits",
    label_en: "Player ID",
    required: true,
    min_length: 5,
    max_length: 12,
  },
  {
    key: "server",
    type: "select",
    label_en: "Server",
    required: true,
    options: [
      { value: "mena", label_en: "MENA" },
      { value: "eu", label_en: "EU" },
    ],
  },
];

export type Fixtures = Awaited<ReturnType<typeof createFixtures>>;

/** Visible and hidden catalog rows in every combination (also used by E2E). */
export async function createFixtures(t: string) {
  const db = service();
  const one = async (table: string, row: Record<string, unknown>) => {
    const { data, error } = await db
      .from(table)
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(`${table}: ${error.message}`);
    return data.id as string;
  };
  const visibleCat = await one("categories", {
    slug: `vis-${t}`,
    name_en: `Visible cat ${t}`,
  });
  const hiddenCat = await one("categories", {
    slug: `hidcat-${t}`,
    name_en: `Hidden cat ${t}`,
    is_active: false,
  });
  const product = (
    slug: string,
    category: string,
    extra: Record<string, unknown> = {},
  ) =>
    one("products", {
      slug,
      category_id: category,
      name_en: `Product ${slug}`,
      name_ar: `منتج ${t}`,
      ...extra,
    });
  const variant = (
    productId: string,
    name: string,
    extra: Record<string, unknown> = {},
  ) =>
    one("product_variants", {
      product_id: productId,
      name_en: name,
      price_usd: 3,
      max_quantity: 2,
      required_fields: FIELDS,
      ...extra,
    });

  const ok = await product(`ok-${t}`, visibleCat);
  const okVariant = await variant(ok, `visible-variant-${t}`);
  const hiddenVariant = await variant(ok, `hidden-variant-${t}`, {
    is_active: false,
  });
  const archivedVariant = await variant(ok, `archived-variant-${t}`, {
    archived_at: new Date().toISOString(),
  });

  const inHiddenCat = await product(`inhidcat-${t}`, hiddenCat);
  const inHiddenCatVariant = await variant(inHiddenCat, `v-inhidcat-${t}`);
  const inactive = await product(`inactive-${t}`, visibleCat, {
    is_active: false,
  });
  const inactiveVariant = await variant(inactive, `v-inactive-${t}`);
  const archived = await product(`archived-${t}`, visibleCat, {
    archived_at: new Date().toISOString(),
  });
  await variant(archived, `v-archived-${t}`);
  const noVariants = await product(`novariants-${t}`, visibleCat);
  await variant(noVariants, `v-novariants-${t}`, { is_active: false });

  return {
    t,
    slugs: {
      visibleCat: `vis-${t}`,
      hiddenCat: `hidcat-${t}`,
      ok: `ok-${t}`,
      inHiddenCat: `inhidcat-${t}`,
      inactive: `inactive-${t}`,
      archived: `archived-${t}`,
      noVariants: `novariants-${t}`,
    },
    ids: {
      okVariant,
      hiddenVariant,
      archivedVariant,
      inHiddenCatVariant,
      inactiveVariant,
      hiddenCat,
      inactive,
      inHiddenCat,
    },
  };
}
