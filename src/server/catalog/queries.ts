import "server-only";

import { unstable_cache } from "next/cache";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { cache } from "react";

import {
  type FieldDefinition,
  fieldDefinitionsSchema,
} from "@/lib/fulfillment";
import { createPublicClient } from "@/lib/supabase/public";

// Public catalog reads. All go through the anon client (RLS): hidden,
// inactive and archived rows are invisible here by construction.

export type Category = {
  id: string;
  slug: string;
  name_ar: string | null;
  name_en: string | null;
  description_ar: string | null;
  description_en: string | null;
};

export type ProductSummary = {
  id: string;
  slug: string;
  category_slug: string;
  category_name_ar: string | null;
  category_name_en: string | null;
  name_ar: string | null;
  name_en: string | null;
  image_path: string | null;
  min_price_usd: number;
  min_price_sdg: number | null;
  total_count: number;
};

export type Variant = {
  id: string;
  name_ar: string | null;
  name_en: string | null;
  price_usd: number;
  price_sdg: number | null;
  /** SDG total for quantity 1..max_quantity, computed by the database. */
  totals_sdg: number[] | null;
  max_quantity: number;
  fields: FieldDefinition[];
};

export type ProductDetail = {
  id: string;
  slug: string;
  name_ar: string | null;
  name_en: string | null;
  description_ar: string | null;
  description_en: string | null;
  image_path: string | null;
  updated_at: string;
  category: Category;
  variants: Variant[];
};

export type SearchParams = {
  query?: string;
  category?: string;
  minSdg?: number;
  maxSdg?: number;
  sort?: "popular" | "price_asc" | "price_desc" | "newest";
  limit?: number;
  offset?: number;
};

export const CATALOG_TAG = "catalog";

/**
 * Pages render per request (the CSP nonce), so the catalog data is what gets
 * cached: shared by all visitors for 5 minutes. Safe to share because every
 * query here runs as anon with no cookies. Dashboard edits expire it at once
 * (updateTag in revalidatePublic). When an entry is stale and the database
 * does not answer, Next keeps serving the last good value, as ISR did.
 * Not in development or tests, which write rows with SQL and read them back;
 * `CATALOG_CACHE=off` does the same on `next start` (the production-mode e2e
 * run; never needed on Vercel). Errors are never cached (they propagate).
 */
export function catalogCache<A extends unknown[], T>(
  name: string,
  run: (...args: A) => Promise<T>,
  tags: (...args: A) => string[] = () => [],
): (...args: A) => Promise<T> {
  if (
    process.env.NODE_ENV !== "production" ||
    process.env.CATALOG_CACHE === "off"
  )
    return run;
  return (...args: A) =>
    unstable_cache(run, ["catalog", name], {
      revalidate: 300,
      tags: [CATALOG_TAG, ...tags(...args)],
    })(...args);
}

// During `next build` the database may be unreachable (CI, paused free-tier
// project). Nothing public is prerendered any more (every page and the
// sitemap render per request), so this fallback is a safety net only. At
// runtime errors propagate, so nothing empty is cached.
export async function buildSafe<T>(
  fallback: T,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) {
      console.warn("catalog unavailable during build; rendering empty section");
      return fallback;
    }
    throw error;
  }
}

export function orThrow<T>(res: {
  data: T | null;
  error: { message: string } | null;
}): T {
  if (res.error) throw new Error(`catalog query failed: ${res.error.message}`);
  return res.data as T;
}

export const listCategories = cache(
  catalogCache("categories", () =>
    buildSafe<Category[]>([], async () =>
      orThrow(
        await createPublicClient()
          .from("categories")
          .select("id, slug, name_ar, name_en, description_ar, description_en")
          .order("sort_order")
          .order("slug"),
      ),
    ),
  ),
);

export const getCategory = cache(
  catalogCache("category", async (slug: string): Promise<Category | null> => {
    const res = await createPublicClient()
      .from("categories")
      .select("id, slug, name_ar, name_en, description_ar, description_en")
      .eq("slug", slug)
      .maybeSingle();
    return orThrow(res);
  }),
);

/** Visitor-driven search: not cached (unbounded keys). */
export const searchProducts = cache((params: SearchParams) =>
  buildSafe<ProductSummary[]>([], async () =>
    orThrow(
      await createPublicClient().rpc("search_products", {
        p_query: params.query ?? null,
        p_category: params.category ?? null,
        p_min_sdg: params.minSdg ?? null,
        p_max_sdg: params.maxSdg ?? null,
        p_sort: params.sort ?? "popular",
        p_limit: params.limit ?? 24,
        p_offset: params.offset ?? 0,
      }),
    ),
  ),
);

/** Fixed listings (home, category pages): cached. */
export const browseProducts = catalogCache(
  "browse",
  (params: { category?: string; limit: number }) =>
    searchProducts({ ...params, sort: "popular" }),
);

/**
 * A product is reachable only if it, its category and at least one variant
 * are visible. Anything else is a 404, never a partial page.
 */
export const getProduct = cache(
  catalogCache(
    "product",
    async (slug: string): Promise<ProductDetail | null> => {
      const res = await createPublicClient()
        .from("products")
        .select(
          `id, slug, name_ar, name_en, description_ar, description_en, image_path, updated_at,
       category:categories!inner(id, slug, name_ar, name_en, description_ar, description_en),
       variants:product_variants(id, name_ar, name_en, price_usd, price_sdg, price_sdg_totals, max_quantity, required_fields, sort_order)`,
        )
        .eq("slug", slug)
        .order("sort_order", { referencedTable: "variants" })
        .maybeSingle();
      // Untyped client (no generated DB types): a many-to-one embed is an object
      // at runtime, which the inferred type does not know.
      const row = orThrow(res) as unknown as
        | (Omit<ProductDetail, "variants" | "category"> & {
            category: Category | null;
            variants: (Omit<Variant, "fields" | "totals_sdg"> & {
              required_fields: unknown;
              price_sdg_totals: (number | string)[] | null;
            })[];
          })
        | null;
      if (!row || !row.category || row.variants.length === 0) return null;

      const variants: Variant[] = [];
      for (const v of row.variants) {
        const fields = fieldDefinitionsSchema.safeParse(v.required_fields);
        // The DB CHECK guarantees the shape; a mismatch here means code and
        // schema drifted, so the variant is hidden rather than rendered wrongly.
        if (!fields.success) continue;
        variants.push({
          id: v.id,
          name_ar: v.name_ar,
          name_en: v.name_en,
          price_usd: Number(v.price_usd),
          price_sdg: v.price_sdg === null ? null : Number(v.price_sdg),
          totals_sdg: v.price_sdg_totals?.map(Number) ?? null,
          max_quantity: v.max_quantity,
          fields: fields.data,
        });
      }
      if (variants.length === 0) return null;
      return { ...row, category: row.category, variants };
    },
  ),
);

export const getVisibleVariant = async (variantId: string) => {
  const res = await createPublicClient()
    .from("product_variants")
    .select(
      "id, name_ar, name_en, price_usd, price_sdg, required_fields, product:products!inner(slug, name_ar, name_en)",
    )
    .eq("id", variantId)
    .maybeSingle();
  return orThrow(res);
};

/**
 * Sitemap: every visible category and every product with at least one
 * visible variant (RLS already hides products of hidden categories).
 */
export const listSitemapEntries = catalogCache("sitemap", () =>
  buildSafe(
    {
      categories: [] as { slug: string }[],
      products: [] as { slug: string; updated_at: string }[],
    },
    async () => {
      const db = createPublicClient();
      const [categories, products] = await Promise.all([
        db.from("categories").select("slug").order("sort_order"),
        db
          .from("products")
          .select("slug, updated_at, product_variants!inner(id)")
          .order("slug")
          .limit(5000),
      ]);
      return {
        categories: orThrow(categories) as { slug: string }[],
        products: (
          orThrow(products) as { slug: string; updated_at: string }[]
        ).map(({ slug, updated_at }) => ({
          slug,
          updated_at,
        })),
      };
    },
  ),
);
