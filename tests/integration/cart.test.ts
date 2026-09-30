import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  anon,
  CHEAP_FIELDS,
  createUser,
  service,
  sql,
  type TestUser,
  VARIANT_CHEAP,
} from "./helpers";

// Stage 2 (cart + line items). Every customer action goes through their own
// JWT and the public API, like the browser or someone with curl. Seed: rate
// 2600 SDG/USD, KYC threshold 100 USD, window 24 h.

const VARIANT_5_20 = "00000000-0000-4000-c000-000000000003"; // 5.20 USD, max 5, player_id
const VARIANT_FF = "00000000-0000-4000-c000-000000000004"; // 1.00 USD, max 5, player_id + server
const FF_FIELDS = { player_id: "1234567", server: "mena" };

type Cart = {
  lines: {
    id: string;
    available: boolean;
    line_total_sdg: number | null;
    quantity: number;
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

async function add(
  client: SupabaseClient,
  variant: string,
  quantity: number,
  data: Record<string, string>,
) {
  const { data: row, error } = await client
    .from("cart_items")
    .insert({ variant_id: variant, quantity, fulfillment_data: data })
    .select("id")
    .single();
  if (error) throw new Error(`add: ${error.message}`);
  return row.id as string;
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

const orderCount = (userId: string) =>
  Number(sql(`select count(*) from public.orders where user_id = '${userId}'`));

afterEach(() => {
  sql(
    "update public.app_settings set usd_sdg_rate = 2600, kyc_threshold_usd = 100",
  );
  sql("update public.security_settings set kyc_window_hours = 24");
  sql(
    `update public.product_variants set is_active = true, price_usd = 1.10 where id = '${VARIANT_CHEAP}'`,
  );
});

describe("cart: a customer's own lines, validated when written", () => {
  let a: TestUser;
  let b: TestUser;
  beforeAll(async () => {
    a = await createUser();
    b = await createUser();
  });

  it("customers add lines; nobody else can see or change them", async () => {
    const line = await add(a.client, VARIANT_CHEAP, 2, CHEAP_FIELDS);
    expect((await b.client.from("cart_items").select("id")).data).toEqual([]);
    const upd = await b.client
      .from("cart_items")
      .update({ quantity: 5 })
      .eq("id", line)
      .select("id");
    expect(upd.data).toEqual([]);
    const del = await b.client
      .from("cart_items")
      .delete()
      .eq("id", line)
      .select("id");
    expect(del.data).toEqual([]);
    const intoA = await b.client.from("cart_items").insert({
      user_id: a.id,
      variant_id: VARIANT_CHEAP,
      quantity: 1,
      fulfillment_data: CHEAP_FIELDS,
    });
    expect(intoA.error?.code).toBe("42501");
    const anonRead = await anon().from("cart_items").select("id");
    expect(anonRead.error?.code).toBe("42501");
    expect(
      sql(`select quantity from public.cart_items where id = '${line}'`),
    ).toBe("2");
  });

  it("a hidden variant, a too-high quantity or bad details are refused", async () => {
    sql(
      `update public.product_variants set is_active = false where id = '${VARIANT_CHEAP}'`,
    );
    const hidden = await a.client.from("cart_items").insert({
      variant_id: VARIANT_CHEAP,
      quantity: 1,
      fulfillment_data: CHEAP_FIELDS,
    });
    expect(hidden.error?.message).toContain("VARIANT_UNAVAILABLE");
    sql(
      `update public.product_variants set is_active = true where id = '${VARIANT_CHEAP}'`,
    );
    const tooMany = await a.client.from("cart_items").insert({
      variant_id: VARIANT_CHEAP,
      quantity: 6,
      fulfillment_data: CHEAP_FIELDS,
    });
    expect(tooMany.error?.message).toContain("INVALID_QUANTITY");
    const bad = await a.client.from("cart_items").insert({
      variant_id: VARIANT_CHEAP,
      quantity: 1,
      fulfillment_data: { player_id: "12" },
    });
    expect(bad.error?.message).toContain("FULFILLMENT_INVALID");
  });

  it("a cart line carries no price: sending one is rejected, not stored", async () => {
    const res = await a.client.from("cart_items").insert({
      variant_id: VARIANT_CHEAP,
      quantity: 1,
      fulfillment_data: CHEAP_FIELDS,
      price_usd: 0.01,
    });
    expect(res.error).not.toBeNull();
  });
});

describe("checkout: the whole cart becomes ONE order, priced by the database", () => {
  let buyer: TestUser;
  beforeAll(async () => {
    buyer = await createUser();
  });

  it("one order, one reference, one line per cart line, per-line rounding", async () => {
    await add(buyer.client, VARIANT_CHEAP, 3, CHEAP_FIELDS); // 3.30 USD
    await add(buyer.client, VARIANT_FF, 2, FF_FIELDS); // 2.00 USD
    sql("update public.app_settings set usd_sdg_rate = 2600.3333");
    const cart = await myCart(buyer.client);
    // ceil(3.30 × 2600.3333) + ceil(2.00 × 2600.3333) = 8582 + 5201
    expect(cart.lines.map((l) => Number(l.line_total_sdg))).toEqual([
      8582, 5201,
    ]);
    expect(Number(cart.total_sdg)).toBe(13783);

    const before = orderCount(buyer.id);
    const res = await checkout(buyer.client, 13783);
    expect(res.status).toBe("created");
    expect(res.reference).toMatch(/^FD-\d{7}$/);
    expect(orderCount(buyer.id)).toBe(before + 1);

    const order = await buyer.client
      .from("orders")
      .select(
        "reference, total_sdg, total_usd, items:order_items(line_no, quantity, unit_price_usd, line_total_sdg, fulfillment_data)",
      )
      .eq("id", res.id!)
      .single();
    expect(order.error).toBeNull();
    const items = [...order.data!.items].sort((x, y) => x.line_no - y.line_no);
    expect(
      items.map((i) => [
        i.quantity,
        Number(i.unit_price_usd),
        Number(i.line_total_sdg),
      ]),
    ).toEqual([
      [3, 1.1, 8582],
      [2, 1, 5201],
    ]);
    expect(items[1].fulfillment_data).toEqual(FF_FIELDS);
    expect(Number(order.data!.total_sdg)).toBe(13783);
    expect((await myCart(buyer.client)).lines).toEqual([]);
  });

  it("price tampering: a forged lower total creates nothing and returns the real one", async () => {
    await add(buyer.client, VARIANT_5_20, 2, CHEAP_FIELDS);
    const before = orderCount(buyer.id);
    const res = await checkout(buyer.client, 1);
    expect(res).toMatchObject({ status: "price_changed", total_sdg: 27040 });
    expect(orderCount(buyer.id)).toBe(before);
    // A price change after the page was shown: the shown total no longer matches.
    sql(
      `update public.product_variants set price_usd = 5.30 where id = '${VARIANT_5_20}'`,
    );
    const stale = await checkout(buyer.client, 27040);
    expect(stale).toMatchObject({ status: "price_changed", total_sdg: 27560 });
    sql(
      `update public.product_variants set price_usd = 5.20 where id = '${VARIANT_5_20}'`,
    );
    const ok = await checkout(buyer.client, 27040);
    expect(ok.status).toBe("created");
  });

  it("idempotent: the same checkout key returns the same order", async () => {
    await add(buyer.client, VARIANT_CHEAP, 1, CHEAP_FIELDS);
    const key = randomUUID();
    const first = await checkout(buyer.client, 2860, key);
    const again = await checkout(buyer.client, 2860, key);
    expect(again.reference).toBe(first.reference);
  });

  it("a hidden variant in the cart: refused with the line named, nothing created", async () => {
    const line = await add(buyer.client, VARIANT_CHEAP, 1, CHEAP_FIELDS);
    await add(buyer.client, VARIANT_FF, 1, FF_FIELDS);
    sql(
      `update public.product_variants set is_active = false where id = '${VARIANT_CHEAP}'`,
    );
    const cart = await myCart(buyer.client);
    expect(cart.unavailable).toBe(1);
    expect(Number(cart.total_sdg)).toBe(2600);
    const before = orderCount(buyer.id);
    const res = await checkout(buyer.client, 2600);
    expect(res).toMatchObject({
      status: "error",
      reason: "variant_unavailable",
      lines: [line],
    });
    expect(orderCount(buyer.id)).toBe(before);
    await buyer.client.from("cart_items").delete().eq("id", line);
  });
});

describe("KYC applies to the cart total and to recent orders", () => {
  it("a KYC split inside one cart: each line below the threshold, the total above → refused", async () => {
    const c = await createUser();
    sql("update public.app_settings set kyc_threshold_usd = 5");
    await add(c.client, VARIANT_CHEAP, 3, CHEAP_FIELDS); // 3.30
    await add(c.client, VARIANT_CHEAP, 2, { player_id: "654321" }); // 2.20
    expect((await myCart(c.client)).kyc_needed).toBe(true);
    const res = await checkout(c.client, 14300);
    expect(res).toMatchObject({ status: "error", reason: "kyc_required" });
    expect(orderCount(c.id)).toBe(0);
  });

  it("a split across orders within the window is refused; window 0 judges each order alone", async () => {
    const c = await createUser();
    sql("update public.app_settings set kyc_threshold_usd = 5");
    await add(c.client, VARIANT_CHEAP, 3, CHEAP_FIELDS);
    expect((await checkout(c.client, 8580)).status).toBe("created"); // 3.30
    await add(c.client, VARIANT_CHEAP, 2, CHEAP_FIELDS);
    expect((await myCart(c.client)).kyc_needed).toBe(true);
    const second = await checkout(c.client, 5720); // 3.30 + 2.20 in 24 h
    expect(second).toMatchObject({ status: "error", reason: "kyc_required" });
    expect(orderCount(c.id)).toBe(1);

    sql("update public.security_settings set kyc_window_hours = 0");
    expect((await myCart(c.client)).kyc_needed).toBe(false);
    expect((await checkout(c.client, 5720)).status).toBe("created");
  });
});

describe("order lines are private like orders", () => {
  it("a customer reads their own lines, not another customer's", async () => {
    const owner = await createUser();
    const other = await createUser();
    await add(owner.client, VARIANT_CHEAP, 1, CHEAP_FIELDS);
    const res = await checkout(owner.client, 2860);
    const own = await owner.client
      .from("order_items")
      .select("order_id")
      .eq("order_id", res.id!);
    expect(own.data).toHaveLength(1);
    const theirs = await other.client
      .from("order_items")
      .select("order_id, fulfillment_data")
      .eq("order_id", res.id!);
    expect(theirs.data).toEqual([]);
    const anonRead = await anon().from("order_items").select("id");
    expect(anonRead.error?.code).toBe("42501");
  });

  it("customers cannot write order lines or call the trusted order path", async () => {
    const c = await createUser();
    await add(c.client, VARIANT_CHEAP, 1, CHEAP_FIELDS);
    const res = await checkout(c.client, 2860);
    const ins = await c.client.from("order_items").insert({
      order_id: res.id,
      variant_id: VARIANT_CHEAP,
      quantity: 1,
      fulfillment_data: CHEAP_FIELDS,
    });
    expect(ins.error?.code).toBe("42501");
    const upd = await c.client
      .from("order_items")
      .update({ quantity: 5 })
      .eq("order_id", res.id!);
    expect(upd.error?.code).toBe("42501");
    const trusted = await c.client.rpc("service_create_order", {
      p_user_id: c.id,
      p_items: [
        {
          variant_id: VARIANT_CHEAP,
          quantity: 1,
          fulfillment_data: CHEAP_FIELDS,
        },
      ],
      p_idempotency_key: randomUUID(),
    });
    expect(trusted.error?.code).toBe("42501");
  });
});

describe("the service role cannot bypass the order rules either", () => {
  it("a header without lines is refused at commit (deferred check)", async () => {
    const c = await createUser();
    const res = await service()
      .from("orders")
      .insert({ user_id: c.id, idempotency_key: randomUUID() });
    expect(res.error?.message).toContain("ORDER_HAS_NO_ITEMS");
    expect(orderCount(c.id)).toBe(0);
  });

  it("forged prices in the trusted path's items are ignored", async () => {
    const c = await createUser();
    const { data, error } = await service().rpc("service_create_order", {
      p_user_id: c.id,
      p_items: [
        {
          variant_id: VARIANT_5_20,
          quantity: 2,
          fulfillment_data: CHEAP_FIELDS,
          unit_price_usd: 0.01,
          line_total_sdg: 1,
        },
      ],
      p_idempotency_key: randomUUID(),
    });
    expect(error).toBeNull();
    expect(Number(data.total_sdg)).toBe(27040);
    expect(
      sql(
        `select unit_price_usd || '|' || line_total_sdg from public.order_items where order_id = '${data.id}'`,
      ),
    ).toBe("5.20|27040.00");
  });
});
