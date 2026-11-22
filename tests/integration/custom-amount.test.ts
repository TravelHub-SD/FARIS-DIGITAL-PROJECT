import { randomBytes, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { quote } from "@/lib/custom-amount";

import {
  anon,
  CHEAP_FIELDS,
  completeOrderWithInvoice,
  createUser,
  service,
  sql,
  type TestUser,
  VARIANT_CHEAP,
} from "./helpers";

// Custom-amount products (item 6, decisions.md 2026-11-21). Customers act
// with their own JWT through the public API, like the browser or curl; the
// browser's calculator is never trusted. Seed: USD rate 2600, KYC threshold
// 100 USD, window 24 h. Test currencies XTA / XTB (ISO "X" codes are never
// real currencies) so the seeded EUR/GBP rates stay untouched.

const CATEGORY = "00000000-0000-4000-a000-000000000001"; // seed: games
const FIELDS = [
  {
    key: "bill_link",
    type: "text",
    label_en: "Invoice link",
    required: true,
    min_length: 5,
    max_length: 200,
  },
];
const DATA = { bill_link: "https://pay.example/inv/77" };

let product: string;
let owner: TestUser; // a staff member with the settings permission
let catalogStaff: TestUser; // products permission only
let a: TestUser;
let b: TestUser;

type Cart = {
  lines: {
    id: string;
    kind: string;
    available: boolean;
    line_total_sdg: number | null;
    amount: string | null;
    rate: string | null;
    fee_sdg: string | null;
    issue: string | null;
  }[];
  total_sdg: number;
  unavailable: number;
  kyc_needed: boolean;
};
type Checkout = {
  status: "created" | "price_changed" | "error";
  id?: string;
  reference?: string;
  total_sdg?: number;
  reason?: string;
  lines?: string[];
};

const rate = (code: string, value: string) =>
  sql(
    `update public.currencies set sdg_rate = ${value}, is_active = true where code = '${code}'`,
  );
const settings = (decimals: number, pct: string, fixed: string) =>
  sql(
    `update public.custom_amount_products set amount_decimals = ${decimals}, fee_percent = ${pct}, fee_fixed_sdg = ${fixed} where product_id = '${product}'`,
  );
const limits = (code: string, min: string, max: string) =>
  sql(
    `update public.custom_amount_currencies set min_amount = ${min}, max_amount = ${max} where product_id = '${product}' and currency_code = '${code}'`,
  );

async function addAmount(
  client: SupabaseClient,
  currency: string,
  amount: string | number,
  data: Record<string, string> = DATA,
  productId = product,
) {
  return client
    .from("cart_items")
    .insert({
      product_id: productId,
      currency_code: currency,
      amount,
      fulfillment_data: data,
    })
    .select("id")
    .single();
}

async function myCart(client: SupabaseClient): Promise<Cart> {
  const { data, error } = await client.rpc("my_cart");
  if (error) throw new Error(`my_cart: ${error.message}`);
  return data as Cart;
}

async function checkout(
  client: SupabaseClient,
  expected: number | string,
  key = randomUUID(),
): Promise<Checkout> {
  const { data, error } = await client.rpc("checkout_cart", {
    p_idempotency_key: key,
    p_expected_total_sdg: expected,
  });
  if (error) throw new Error(`checkout_cart: ${error.message}`);
  return data as Checkout;
}

const clearCart = (u: TestUser) =>
  sql(`delete from public.cart_items where user_id = '${u.id}'`);
const orderCount = (u: TestUser) =>
  Number(sql(`select count(*) from public.orders where user_id = '${u.id}'`));

beforeAll(async () => {
  owner = await createUser({
    admin: { permissions: ["settings", "products"] },
  });
  catalogStaff = await createUser({ admin: { permissions: ["products"] } });
  a = await createUser();
  b = await createUser();
  sql(`insert into public.currencies (code, name_ar, name_en, symbol, sdg_rate, sort_order)
       values ('XTA', 'عملة أ', 'Test A', 'A$', 3050, 90), ('XTB', 'عملة ب', 'Test B', 'B$', 800, 91)
       on conflict (code) do update set sdg_rate = excluded.sdg_rate, is_active = true`);
  const slug = `visa-bill-${randomBytes(3).toString("hex")}`;
  product =
    sql(`insert into public.products (category_id, slug, name_ar, name_en, kind)
                 values ('${CATEGORY}', '${slug}', 'ادفع فاتورة بالفيزا', 'Pay a bill with Visa', 'custom_amount')
                 returning id`).split("\n")[0];
  sql(`update public.custom_amount_products set required_fields = '${JSON.stringify(FIELDS)}'
        where product_id = '${product}'`);
  sql(`insert into public.custom_amount_currencies (product_id, currency_code, min_amount, max_amount, sort_order)
       values ('${product}', 'XTA', 1, 500, 1), ('${product}', 'XTB', 10, 2000, 2)`);
  // The baseline every test starts from (afterEach restores it): 200 SDG
  // fixed fee, no percentage, two decimals.
  settings(2, "0", "200");
});

afterEach(() => {
  rate("XTA", "3050");
  rate("XTB", "800");
  settings(2, "0", "200");
  limits("XTA", "1", "500");
  limits("XTB", "10", "2000");
  sql(`update public.products set is_active = true where id = '${product}'`);
  sql(
    "update public.app_settings set usd_sdg_rate = 2600, kyc_threshold_usd = 100",
  );
  sql("update public.security_settings set kyc_window_hours = 24");
  for (const u of [a, b]) clearCart(u);
});

describe("settings: settings staff only, audited", () => {
  it("currencies: settings staff add and edit; others cannot; disabled ones are hidden", async () => {
    const letter = () => String.fromCharCode(67 + (randomBytes(1)[0] % 23)); // C..Y
    const code = `X${letter()}${letter()}`;
    const ins = await owner.client
      .from("currencies")
      .insert({
        code,
        name_ar: "تجربة",
        name_en: "Trial",
        symbol: "T",
        sdg_rate: "123.4567",
      })
      .select("id, rate_updated_at")
      .single();
    expect(ins.error).toBeNull();
    const before = ins.data!.rate_updated_at;
    await new Promise((r) => setTimeout(r, 20));
    const upd = await owner.client
      .from("currencies")
      .update({ sdg_rate: "130" })
      .eq("code", code)
      .select("sdg_rate, rate_updated_at");
    expect(upd.data?.[0]?.sdg_rate).toBe(130);
    expect(new Date(upd.data![0].rate_updated_at) > new Date(before)).toBe(
      true,
    );
    // A name change does not move "last updated" of the rate.
    const renamed = await owner.client
      .from("currencies")
      .update({ name_en: "Trial 2" })
      .eq("code", code)
      .select("rate_updated_at");
    expect(renamed.data?.[0]?.rate_updated_at).toBe(
      upd.data![0].rate_updated_at,
    );

    for (const who of [catalogStaff, a]) {
      const w = await who.client
        .from("currencies")
        .update({ sdg_rate: "1" })
        .eq("code", code)
        .select("id");
      expect(w.data ?? []).toEqual([]);
      const i = await who.client.from("currencies").insert({
        code: "XQQ",
        name_ar: "x",
        name_en: "x",
        symbol: "x",
        sdg_rate: 1,
      });
      expect(i.error?.code).toBe("42501");
    }
    const del = await owner.client.from("currencies").delete().eq("code", code);
    expect(del.error?.code).toBe("42501"); // disable, never delete
    const codeChange = await owner.client
      .from("currencies")
      .update({ code: "XZZ" })
      .eq("code", code);
    expect(codeChange.error?.code).toBe("42501"); // no grant on code

    await owner.client
      .from("currencies")
      .update({ is_active: false })
      .eq("code", code);
    const pub = await anon().from("currencies").select("code").eq("code", code);
    expect(pub.data).toEqual([]);
    const audit = sql(
      `select string_agg(action || ':' || coalesce(actor_id::text, '-'), ',' order by created_at)
         from public.audit_logs where entity_type = 'currencies' and entity_id = '${ins.data!.id}'`,
    );
    expect(audit).toBe(
      [
        `currencies.insert:${owner.id}`,
        `currencies.update:${owner.id}`,
        `currencies.update:${owner.id}`,
        `currencies.update:${owner.id}`,
      ].join(","),
    );
    console.log(
      `[demo] currency ${code}: audit ${audit.split(",").length} rows by the settings admin`,
    );
  });

  it("USD is the store's USD rate: what is sent is ignored, a store rate change follows", async () => {
    const r = await owner.client
      .from("currencies")
      .update({ sdg_rate: "1" })
      .eq("code", "USD")
      .select("sdg_rate");
    expect(r.data?.[0]?.sdg_rate).toBe(2600);
    sql("update public.app_settings set usd_sdg_rate = 2700 where id");
    expect(
      sql("select sdg_rate from public.currencies where code = 'USD'"),
    ).toBe("2700.0000");
  });

  it("product settings: settings staff only; product staff and customers cannot", async () => {
    for (const who of [catalogStaff, a]) {
      const u = await who.client
        .from("custom_amount_products")
        .update({ fee_percent: 0, fee_fixed_sdg: 0 })
        .eq("product_id", product)
        .select("id");
      expect(u.data ?? []).toEqual([]);
      const l = await who.client
        .from("custom_amount_currencies")
        .update({ max_amount: 999999 })
        .eq("product_id", product)
        .select("id");
      expect(l.data ?? []).toEqual([]);
      const i = await who.client.from("custom_amount_currencies").insert({
        product_id: product,
        currency_code: "USD",
        min_amount: 1,
        max_amount: 10,
      });
      expect(i.error?.code).toBe("42501");
    }
    const ok = await owner.client
      .from("custom_amount_products")
      .update({ fee_percent: 1.5 })
      .eq("product_id", product)
      .select("fee_percent");
    expect(ok.data?.[0]?.fee_percent).toBe(1.5);
    expect(
      sql(
        `select count(*) from public.audit_logs where entity_type = 'custom_amount_products' and actor_id = '${owner.id}'`,
      ),
    ).toBe("1");
  });

  it("a product is packages or custom amount, never both, and never changes", async () => {
    const v = await service().from("product_variants").insert({
      product_id: product,
      name_en: "Sneaky package",
      price_usd: 1,
    });
    expect(v.error?.message).toContain("PRODUCT_KIND_MISMATCH");
    const k = await service()
      .from("products")
      .update({ kind: "package" })
      .eq("id", product);
    expect(k.error?.message).toContain("PRODUCT_KIND_IMMUTABLE");
    const staffKind = await catalogStaff.client
      .from("products")
      .update({ kind: "package" })
      .eq("id", product);
    expect(staffKind.error?.code).toBe("42501"); // no column grant
    const cfg = await service()
      .from("custom_amount_products")
      .insert({ product_id: "00000000-0000-4000-b000-000000000001" }); // a package product
    expect(cfg.error?.message).toContain("PRODUCT_KIND_MISMATCH");
  });
});

describe("pricing: the database computes it, and the calculator shows the same number", () => {
  it("random amounts, rates and fees: private.custom_amount_quote = lib/custom-amount quote()", () => {
    const rnd = (n: number) => Math.floor(Math.random() * n);
    const dec = (int: number, scale: number) => {
      const i = String(rnd(int));
      const f = String(rnd(10 ** scale)).padStart(scale, "0");
      return scale ? `${i}.${f}` : i;
    };
    const rows: string[] = [];
    for (let k = 0; k < 60; k++) {
      const scale = rnd(4); // 0..3 decimals
      let amount = dec(5000, scale)
        .replace(/(\.\d*?)0+$/, "$1")
        .replace(/\.$/, "");
      if (Number(amount) === 0) amount = "1";
      const r = dec(10000, 4);
      const pct = dec(10, 2);
      const fixed = dec(1000, 2);
      const js = quote({
        amount,
        rate: r === "0.0000" ? "1" : r,
        feePercent: pct,
        feeFixedSdg: fixed,
      });
      const db = sql(
        `select round(${amount} * ${r === "0.0000" ? "1" : r} * ${pct} / 100, 2) + ${fixed} || '|' ||
                ceil(${amount} * ${r === "0.0000" ? "1" : r} + round(${amount} * ${r === "0.0000" ? "1" : r} * ${pct} / 100, 2) + ${fixed})`,
      );
      rows.push(`${amount}×${r}+${pct}%+${fixed}`);
      expect(`${js.feeSdg}|${js.totalSdg}`, rows.at(-1)).toBe(db);
    }
    // And the function itself, end to end, for the product's own settings.
    settings(3, "2.75", "150.5");
    rate("XTA", "3050.5555");
    const q = JSON.parse(
      sql(`select private.custom_amount_quote('${product}', 'XTA', 123.456)`),
    );
    const js = quote({
      amount: "123.456",
      rate: "3050.5555",
      feePercent: "2.75",
      feeFixedSdg: "150.5",
    });
    expect([q.fee_sdg.toFixed(2), q.total_sdg]).toEqual([
      js.feeSdg,
      js.totalSdg,
    ]);
    console.log(
      `[demo] 60 random quotes + the product quote: database = calculator (e.g. 123.456 XTA → ${js.totalSdg} SDG)`,
    );
  });
});

describe("amounts the database refuses (direct API, not the page)", () => {
  it("zero, negative, too many decimals, below the minimum, above the maximum", async () => {
    settings(2, "0", "200");
    const cases: [string | number, string][] = [
      [0, "AMOUNT_INVALID"],
      [-5, "AMOUNT_INVALID"],
      ["56.123", "AMOUNT_DECIMALS"],
      ["0.5", "AMOUNT_BELOW_MIN"],
      ["500.01", "AMOUNT_ABOVE_MAX"],
      [100000, "AMOUNT_ABOVE_MAX"],
    ];
    for (const [amount, error] of cases) {
      const r = await addAmount(a.client, "XTA", amount);
      expect(r.error?.message, String(amount)).toContain(error);
    }
    const malformed = await addAmount(a.client, "XTA", "12,5");
    expect(malformed.error?.code).toBe("22P02"); // not a number at all
    const max = await addAmount(a.client, "XTA", "500");
    expect(max.error).toBeNull(); // the maximum itself is allowed
    expect((await myCart(a.client)).lines).toHaveLength(1);
  });

  it("a disabled currency, a currency not allowed for the product, a hidden product", async () => {
    sql("update public.currencies set is_active = false where code = 'XTB'");
    const disabled = await addAmount(a.client, "XTB", 50);
    expect(disabled.error?.message).toContain("CURRENCY_UNAVAILABLE");
    const notAllowed = await addAmount(a.client, "GBP", 50);
    expect(notAllowed.error?.message).toContain("CURRENCY_UNAVAILABLE");
    sql(`update public.products set is_active = false where id = '${product}'`);
    const hidden = await addAmount(a.client, "XTA", 50);
    expect(hidden.error?.message).toContain("PRODUCT_UNAVAILABLE");
    const pkg = await addAmount(
      a.client,
      "XTA",
      50,
      DATA,
      "00000000-0000-4000-b000-000000000001",
    );
    expect(pkg.error?.message).toContain("PRODUCT_UNAVAILABLE");
    // Missing details are refused too.
    sql(`update public.products set is_active = true where id = '${product}'`);
    const noDetails = await addAmount(a.client, "XTA", 50, {});
    expect(noDetails.error?.message).toContain("FULFILLMENT_INVALID");
  });

  it("a price, a rate or a fee cannot be written into the cart at all", async () => {
    const forged = await a.client.from("cart_items").insert({
      product_id: product,
      currency_code: "XTA",
      amount: 56,
      fulfillment_data: DATA,
      line_total_sdg: 1,
    } as never);
    expect(forged.error).not.toBeNull(); // no such column
    const line = (await addAmount(a.client, "XTA", 56)).data!.id as string;
    const change = await a.client
      .from("cart_items")
      .update({ amount: 1, currency_code: "XTB" } as never)
      .eq("id", line);
    expect(change.error?.code).toBe("42501"); // amount/currency fixed once added
    const qty = await a.client
      .from("cart_items")
      .update({ quantity: 3 })
      .eq("id", line);
    expect(qty.error?.message).toMatch(
      /INVALID_QUANTITY|cart_items_kind_shape/,
    );
  });
});

describe("checkout: re-priced on the server, consent for the whole cart", () => {
  it("a forged total is refused; the order is charged the database's price", async () => {
    const a = await createUser();
    // 56 × 3,050 = 170,800 + 200 fixed fee = 171,000; plus a package line
    // 1.10 USD × 2600 = 2,860.
    await addAmount(a.client, "XTA", "56.00");
    await a.client.from("cart_items").insert({
      variant_id: VARIANT_CHEAP,
      quantity: 1,
      fulfillment_data: CHEAP_FIELDS,
    });
    const cart = await myCart(a.client);
    const custom = cart.lines.find((l) => l.kind === "custom_amount")!;
    expect(custom).toMatchObject({
      amount: "56",
      rate: "3050.0000",
      fee_sdg: "200.00",
      line_total_sdg: 171000,
    });
    expect(cart.total_sdg).toBe(171000 + 2860);

    const before = orderCount(a);
    for (const forged of [1000, 170800, 0, -1, 171000]) {
      const r = await checkout(a.client, forged);
      expect(r, `forged ${forged}`).toEqual({
        status: "price_changed",
        total_sdg: 173860,
      });
    }
    expect(orderCount(a)).toBe(before);
    expect((await myCart(a.client)).lines).toHaveLength(2); // cart intact

    const ok = await checkout(a.client, 173860);
    expect(ok.status).toBe("created");
    const line = JSON.parse(
      sql(`select row_to_json(i) from (select kind, amount, currency_code, currency_rate_sdg, fee_percent,
             fee_fixed_sdg, fee_sdg, line_total_sdg, line_total_usd, usd_sdg_rate, quantity, variant_id
             from public.order_items where order_id = '${ok.id}' and kind = 'custom_amount') i`),
    );
    expect(line).toEqual({
      kind: "custom_amount",
      amount: 56,
      currency_code: "XTA",
      currency_rate_sdg: 3050,
      fee_percent: 0,
      fee_fixed_sdg: 200,
      fee_sdg: 200,
      line_total_sdg: 171000,
      line_total_usd: 65.77, // ceil(171000 / 2600, cents), for KYC
      usd_sdg_rate: 2600,
      quantity: 1,
      variant_id: null,
    });
    expect(
      sql(`select total_sdg from public.orders where id = '${ok.id}'`),
    ).toBe("173860.00");
    console.log(
      `[demo] forged totals 1000/170800/0/-1/171000 → price_changed 173860; order ${ok.reference} charged 173860 (56.00 XTA × 3,050 + 200 = 171,000 + 2,860)`,
    );
  });

  it("a rate changed since the page showed the price → price_changed; the order uses the new rate; later changes never touch it", async () => {
    const a = await createUser();
    await addAmount(a.client, "XTA", 56);
    const shown = (await myCart(a.client)).total_sdg; // what the checkout page shows
    expect(shown).toBe(171000);
    rate("XTA", "3100"); // the owner updates the rate meanwhile
    const stale = await checkout(a.client, shown);
    expect(stale).toEqual({
      status: "price_changed",
      total_sdg: 56 * 3100 + 200,
    });
    expect(orderCount(a)).toBe(0);
    // A fee change is the same.
    settings(2, "1", "200"); // + 1% of 173,600 = 1,736
    const fee = await checkout(a.client, 173800);
    expect(fee).toEqual({ status: "price_changed", total_sdg: 173800 + 1736 });
    const ok = await checkout(a.client, 175536);
    expect(ok.status).toBe("created");

    const snapshot = () =>
      sql(`select currency_rate_sdg || '|' || fee_percent || '|' || fee_sdg || '|' || line_total_sdg
             from public.order_items where order_id = '${ok.id}'`);
    expect(snapshot()).toBe("3100.0000|1.00|1936.00|175536.00");
    const { invoice } = await completeOrderWithInvoice({
      id: ok.id!,
      user_id: a.id,
    });
    const item = (invoice.snapshot as { items: Record<string, unknown>[] })
      .items[0];
    expect(item).toMatchObject({
      kind: "custom_amount",
      amount: "56",
      currency_code: "XTA",
      currency_rate_sdg: 3100,
      fee_sdg: 1936,
      line_total_sdg: 175536,
    });
    rate("XTA", "9999");
    settings(2, "50", "5000");
    expect(snapshot()).toBe("3100.0000|1.00|1936.00|175536.00");
    expect(
      sql(
        `select snapshot -> 'items' -> 0 ->> 'currency_rate_sdg' || '|' || total_sdg from public.invoices where id = '${invoice.id}'`,
      ),
    ).toBe("3100.0000|175536.00");
    // Not even the database owner can rewrite the snapshot.
    expect(() =>
      sql(
        `update public.order_items set currency_rate_sdg = 1 where order_id = '${ok.id}'`,
      ),
    ).toThrow(/ORDER_SNAPSHOT_IMMUTABLE/);
    expect(snapshot()).toBe("3100.0000|1.00|1936.00|175536.00");
    console.log(
      `[demo] stale rate 3050→3100: price_changed 173800; fee 0→1%: price_changed 175536; order ${ok.reference} keeps 3100 / 1936 after rate 9999 and fee 50%`,
    );
  });

  it("limits or a currency changed after adding: that line is refused at checkout", async () => {
    const a = await createUser();
    const big = (await addAmount(a.client, "XTA", 400)).data!.id as string;
    const eur = (await addAmount(a.client, "XTB", 100)).data!.id as string;
    limits("XTA", "1", "300");
    sql("update public.currencies set is_active = false where code = 'XTB'");
    const cart = await myCart(a.client);
    expect(cart.lines.map((l) => [l.id, l.available, l.issue])).toEqual([
      [big, false, "AMOUNT_ABOVE_MAX"],
      [eur, false, "CURRENCY_UNAVAILABLE"],
    ]);
    expect(cart.unavailable).toBe(2);
    const r = await checkout(a.client, 0);
    expect(r).toEqual({
      status: "error",
      reason: "variant_unavailable",
      lines: [big, eur],
    });
    expect(orderCount(a)).toBe(0);
  });

  it("the trusted service path ignores a price, a rate or a fee in its input", async () => {
    const { data, error } = await service().rpc("service_create_order", {
      p_user_id: b.id,
      p_items: [
        {
          product_id: product,
          currency_code: "XTA",
          amount: "10",
          fulfillment_data: DATA,
          line_total_sdg: 1,
          currency_rate_sdg: 1,
          fee_sdg: 0,
          unit_price_usd: 0.01,
        },
      ],
      p_idempotency_key: randomUUID(),
    });
    expect(error).toBeNull();
    expect(Number((data as { total_sdg: number }).total_sdg)).toBe(
      10 * 3050 + 200,
    );
    const above = await service().rpc("service_create_order", {
      p_user_id: b.id,
      p_items: [
        {
          product_id: product,
          currency_code: "XTA",
          amount: "501",
          fulfillment_data: DATA,
        },
      ],
      p_idempotency_key: randomUUID(),
    });
    expect(above.error?.message).toContain("AMOUNT_ABOVE_MAX");
  });
});

describe("KYC: custom lines count in USD at the store's rate, with the rolling window", () => {
  it("one line under the threshold; two lines over it need verification", async () => {
    const a = await createUser();
    // 56 XTA = 171,000 SDG = 65.77 USD < 100.
    await addAmount(a.client, "XTA", 56);
    expect((await myCart(a.client)).kyc_needed).toBe(false);
    // + 20 XTA = 61,200 SDG = 23.54 USD → 89.31 < 100.
    await addAmount(a.client, "XTA", 20);
    expect((await myCart(a.client)).kyc_needed).toBe(false);
    // The store's USD rate drops: the same pounds are more dollars.
    sql("update public.app_settings set usd_sdg_rate = 2000 where id");
    const cart = await myCart(a.client);
    expect(cart.kyc_needed).toBe(true); // (171,000 + 61,200) / 2000 = 116.10
    const r = await checkout(a.client, cart.total_sdg);
    expect(r).toMatchObject({ status: "error", reason: "kyc_required" });
    expect(orderCount(a)).toBe(0);
  });

  it("the rolling window adds earlier orders, custom or not", async () => {
    const b = await createUser();
    await addAmount(b.client, "XTA", 56); // 65.77 USD
    const first = await checkout(b.client, 171000);
    expect(first.status).toBe("created");
    await addAmount(b.client, "XTA", 20); // 23.54 → 89.31 in 24 h: fine
    expect((await myCart(b.client)).kyc_needed).toBe(false);
    clearCart(b);
    await addAmount(b.client, "XTA", 40); // 40 × 3050 + 200 = 122,200 = 47.00 → 112.77
    expect((await myCart(b.client)).kyc_needed).toBe(true);
    sql("update public.security_settings set kyc_window_hours = 0");
    expect((await myCart(b.client)).kyc_needed).toBe(false);
  });
});
