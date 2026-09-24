// Catalog visibility (direct PostgREST), fulfillment validation at the
// database, field-definition CHECK, search, and TS/SQL validator parity.
import { randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { validateFulfillment } from "@/lib/fulfillment";

import { createFixtures, FIELDS, type Fixtures } from "./catalog-fixtures";
import { anon, createUser, service, sql, type TestUser } from "./helpers";

const tag = randomUUID().slice(0, 8);

let fx: Fixtures;
let customer: TestUser;
let catalogAdmin: TestUser;

beforeAll(async () => {
  fx = await createFixtures(tag);
  customer = await createUser();
  catalogAdmin = await createUser({ admin: { permissions: ["products"] } });
});

describe("Hidden/inactive/archived catalog rows are unreachable via direct PostgREST", () => {
  const who = () => ({ anon: anon(), customer: customer.client });

  for (const label of ["anon", "customer"] as const) {
    it(`${label}: hidden category and products are absent (by slug)`, async () => {
      const db = who()[label];
      const cats = await db
        .from("categories")
        .select("slug")
        .in("slug", [fx.slugs.visibleCat, fx.slugs.hiddenCat]);
      expect(cats.data?.map((r) => r.slug)).toEqual([fx.slugs.visibleCat]);
      const hiddenSlugs = [
        fx.slugs.inHiddenCat,
        fx.slugs.inactive,
        fx.slugs.archived,
      ];
      const prods = await db
        .from("products")
        .select("slug")
        .in("slug", [fx.slugs.ok, ...hiddenSlugs]);
      const visible = prods.data?.map((r) => r.slug) ?? [];
      expect(visible).toContain(fx.slugs.ok);
      for (const s of hiddenSlugs) expect(visible, s).not.toContain(s);
    });

    it(`${label}: hidden and archived variants are absent, even by id and inside embeds`, async () => {
      const db = who()[label];
      const ids = Object.values(fx.ids);
      const direct = await db
        .from("product_variants")
        .select("id, price_sdg")
        .in("id", ids);
      expect(direct.data?.map((r) => r.id)).toEqual([fx.ids.okVariant]);
      const embed = await db
        .from("products")
        .select("slug, product_variants(id, name_en)")
        .eq("slug", fx.slugs.ok)
        .single();
      expect(embed.data?.product_variants.map((v) => v.id)).toEqual([
        fx.ids.okVariant,
      ]);
    });

    it(`${label}: search_products never returns hidden items (and skips products without visible variants)`, async () => {
      const db = who()[label];
      const res = await db.rpc("search_products", {
        p_query: `product`,
        p_limit: 48,
      });
      const slugs = (res.data ?? []).map((r: { slug: string }) => r.slug);
      expect(slugs).toContain(fx.slugs.ok);
      for (const s of [
        fx.slugs.inHiddenCat,
        fx.slugs.inactive,
        fx.slugs.archived,
        fx.slugs.noVariants,
      ]) {
        expect(slugs, s).not.toContain(s);
      }
      const inHidden = await db.rpc("search_products", {
        p_category: fx.slugs.hiddenCat,
      });
      expect(inHidden.data).toEqual([]);
    });
  }

  it("control: a catalog admin (products permission) DOES see hidden rows via PostgREST", async () => {
    const variantIds = [
      fx.ids.okVariant,
      fx.ids.hiddenVariant,
      fx.ids.archivedVariant,
      fx.ids.inHiddenCatVariant,
      fx.ids.inactiveVariant,
    ];
    const res = await catalogAdmin.client
      .from("product_variants")
      .select("id")
      .in("id", variantIds);
    expect(res.data?.length).toBe(variantIds.length);
  });

  it("an order for a hidden variant is refused by the database", async () => {
    const res = await service()
      .from("orders")
      .insert({
        user_id: customer.id,
        variant_id: fx.ids.hiddenVariant,
        quantity: 1,
        idempotency_key: randomUUID(),
        fulfillment_data: { player_id: "123456", server: "mena" },
      });
    expect(res.error?.message).toMatch(/VARIANT_UNAVAILABLE/);
  });
});

describe("Forged fulfillment data is rejected by the database (any insert path)", () => {
  const order = (data: unknown) =>
    service()
      .from("orders")
      .insert({
        user_id: customer.id,
        variant_id: fx.ids.okVariant,
        quantity: 1,
        idempotency_key: randomUUID(),
        fulfillment_data: data,
      })
      .select("id")
      .single();

  it.each([
    ["missing required", { server: "mena" }, "missing:player_id"],
    [
      "extra key",
      { player_id: "123456", server: "mena", evil: "x" },
      "unknown:evil",
    ],
    [
      "number instead of string",
      { player_id: 123456, server: "mena" },
      "type:player_id",
    ],
    ["boolean", { player_id: "123456", server: true }, "type:server"],
    ["array", { player_id: ["123456"], server: "mena" }, "type:player_id"],
    ["object", { player_id: { v: 1 }, server: "mena" }, "type:player_id"],
    [
      "letters in digits",
      { player_id: "12a456", server: "mena" },
      "format:player_id",
    ],
    ["untrimmed", { player_id: " 123456", server: "mena" }, "format:player_id"],
    ["too short", { player_id: "1234", server: "mena" }, "length:player_id"],
    [
      "unknown option",
      { player_id: "123456", server: "asia" },
      "option:server",
    ],
    ["not an object", ["player_id"], "data:not_object"],
  ])("%s → FULFILLMENT_INVALID (%s)", async (_label, data, code) => {
    const res = await order(data);
    console.log(`[demo] ${JSON.stringify(data)} -> ${res.error?.message}`);
    expect(res.error?.message).toContain("FULFILLMENT_INVALID");
    expect(res.error?.message).toContain(code as string);
  });

  it("control: valid normalised data is accepted", async () => {
    const res = await order({ player_id: "123456", server: "eu" });
    expect(res.error).toBeNull();
  });
});

describe("Field definitions are validated by a CHECK constraint", () => {
  const set = (fields: unknown) =>
    catalogAdmin.client
      .from("product_variants")
      .update({ required_fields: fields })
      .eq("id", fx.ids.okVariant)
      .select("id");

  it.each([
    [
      "regex type",
      [{ key: "a", type: "regex", label_en: "A", required: true }],
    ],
    [
      "unknown property",
      [
        {
          key: "a",
          type: "text",
          label_en: "A",
          required: true,
          pattern: ".*",
        },
      ],
    ],
    [
      "duplicate keys",
      [
        { key: "a", type: "text", label_en: "A", required: true },
        { key: "a", type: "digits", label_en: "B", required: true },
      ],
    ],
    [
      "select without options",
      [{ key: "a", type: "select", label_en: "A", required: true }],
    ],
    ["no label", [{ key: "a", type: "text", required: true }]],
    ["not an array", { key: "a" }],
  ])("admin cannot save %s", async (_label, fields) => {
    const res = await set(fields);
    expect(res.error?.message ?? "", JSON.stringify(res.error)).toMatch(
      /product_variants_required_fields_valid|required_fields/,
    );
  });

  it("control: admin can save valid definitions", async () => {
    const res = await set(FIELDS);
    expect(res.error, JSON.stringify(res.error)).toBeNull();
    expect(res.data).toHaveLength(1);
  });
});

describe("Search", () => {
  it("Arabic search is normalised (hamza/taa marbuta/diacritics) and English is case-insensitive", async () => {
    const q = (p_query: string) =>
      anon()
        .rpc("search_products", { p_query })
        .then((r) => (r.data ?? []).map((x: { slug: string }) => x.slug));
    expect(await q("ببجي")).toContain("pubg-uc");
    expect(await q("شَدّات بُبجي")).toContain("pubg-uc"); // with tashkeel
    expect(await q("PUBG")).toContain("pubg-uc");
    expect(await q("جواهر فرى فاير")).toContain("free-fire-diamonds"); // ى for ي
  });

  it("LIKE wildcards in the query are literal (no match-everything)", async () => {
    for (const p_query of ["%", "_", "\\"]) {
      const res = await anon().rpc("search_products", { p_query });
      expect(res.data, p_query).toEqual([]);
    }
  });

  it("price filters and sorting work on SDG prices", async () => {
    const res = await anon().rpc("search_products", {
      p_min_sdg: 3000,
      p_max_sdg: 80000,
      p_sort: "price_asc",
    });
    const prices = (res.data ?? []).map((r: { min_price_sdg: number }) =>
      Number(r.min_price_sdg),
    );
    expect(prices.length).toBeGreaterThan(0);
    expect(prices.every((p: number) => p >= 3000 && p <= 80000)).toBe(true);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });

  it("the displayed price equals what an order is charged (same formula)", async () => {
    const shown = await anon()
      .from("product_variants")
      .select("price_sdg")
      .eq("id", fx.ids.okVariant)
      .single();
    const placed = await service()
      .from("orders")
      .insert({
        user_id: customer.id,
        variant_id: fx.ids.okVariant,
        quantity: 1,
        idempotency_key: randomUUID(),
        fulfillment_data: { player_id: "123456", server: "mena" },
      })
      .select("total_sdg")
      .single();
    expect(Number(placed.data?.total_sdg)).toBe(Number(shown.data?.price_sdg));
  });
});

describe("TypeScript and SQL validators agree", () => {
  const cases: Record<string, unknown>[] = [
    { player_id: "123456", server: "mena" },
    { server: "mena" },
    { player_id: "123456", server: "mena", x: "1" },
    { player_id: 123456, server: "mena" },
    { player_id: "12a456", server: "mena" },
    { player_id: "1234", server: "eu" },
    { player_id: "1234567890123", server: "eu" },
    { player_id: "123456", server: "asia" },
    { player_id: "123456", server: null },
  ];
  it.each(cases.map((c) => [JSON.stringify(c), c]))("%s", (_label, input) => {
    const ts = validateFulfillment(FIELDS, input as Record<string, unknown>);
    const sqlErrors = sql(
      `select array_to_string(private.fulfillment_errors('${JSON.stringify(FIELDS)}'::jsonb, '${JSON.stringify(input)}'::jsonb), ',')`,
    );
    const tsErrors = ts.ok
      ? ""
      : Object.entries(ts.errors)
          .map(([k, v]) => `${v}:${k}`)
          .sort()
          .join(",");
    expect(tsErrors).toBe(
      sqlErrors.split(",").filter(Boolean).sort().join(","),
    );
  });
});
