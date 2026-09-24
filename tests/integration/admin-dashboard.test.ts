import { randomBytes, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  anonKey,
  createKycSubmission,
  createOrder,
  createReceipt,
  createUser,
  ownerUser,
  service,
  sql,
  type TestUser,
  url,
  VARIANT_CHEAP,
} from "./helpers";

// Phase 6 at the database/API layer: what each admin can do through the
// public API with their own session, whatever the dashboard shows or hides.

const WEBP = Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ", "binary");

type Role =
  | "customer"
  | "none"
  | "orders"
  | "products"
  | "customers"
  | "comments"
  | "settings"
  | "kyc"
  | "owner";
const ROLES: Role[] = [
  "customer",
  "none",
  "orders",
  "products",
  "customers",
  "comments",
  "settings",
  "kyc",
  "owner",
];
const users = {} as Record<Role, TestUser>;

beforeAll(async () => {
  users.customer = await createUser({ name: "Plain Customer" });
  users.none = await createUser({
    admin: {},
    name: "Admin Without Permissions",
  });
  for (const p of [
    "orders",
    "products",
    "customers",
    "comments",
    "settings",
    "kyc",
  ] as const) {
    users[p] = await createUser({
      admin: { permissions: [p] },
      name: `Admin ${p}`,
    });
  }
  users.owner = await ownerUser();
});

async function newComment(productSlug = "pubg-uc") {
  const author = await createUser({ name: "Commenter Person" });
  const product = sql(
    `select id from public.products where slug = '${productSlug}'`,
  );
  const { data, error } = await service()
    .from("comments")
    .insert({
      product_id: product,
      user_id: author.id,
      body: `nice ${randomUUID()}`,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

// Each operation returns true when the database let it through.
type Op = {
  area: Role;
  name: string;
  run: (c: SupabaseClient, me: TestUser) => Promise<boolean>;
};
const OPS: Op[] = [
  {
    area: "orders",
    name: "search all orders (admin_orders)",
    run: async (c) => !(await c.rpc("admin_orders", {})).error,
  },
  {
    area: "orders",
    name: "change an order's status",
    run: async (c) => {
      const o = await createOrder((await createUser()).id);
      return !(
        await c.rpc("change_order_status", {
          p_order_id: o.id,
          p_to_status: "cancelled",
        })
      ).error;
    },
  },
  {
    area: "orders",
    name: "review a payment receipt",
    run: async (c) => {
      const o = await createOrder((await createUser()).id);
      const r = await createReceipt(o);
      return !(
        await c.rpc("review_receipt", {
          p_receipt_id: r.id,
          p_accept: false,
          p_reason: "matrix",
        })
      ).error;
    },
  },
  {
    area: "orders",
    name: "add an internal note",
    run: async (c) => {
      const o = await createOrder((await createUser()).id);
      return !(
        await c
          .from("order_internal_notes")
          .insert({ order_id: o.id, body: "matrix" })
      ).error;
    },
  },
  {
    area: "orders",
    name: "open a receipt image",
    run: async (c) => {
      const o = await createOrder((await createUser()).id);
      const r = await createReceipt(o);
      return !(
        await c.storage.from("payment-receipts").download(r.storage_path)
      ).error;
    },
  },
  {
    area: "products",
    name: "create a category",
    run: async (c) =>
      !(
        await c.from("categories").insert({
          slug: `m-${randomBytes(4).toString("hex")}`,
          name_en: "Matrix",
          is_active: false,
        })
      ).error,
  },
  {
    area: "products",
    name: "change a price",
    run: async (c) => {
      const r = await c
        .from("product_variants")
        .update({ price_usd: 1.1 })
        .eq("id", VARIANT_CHEAP)
        .select("id");
      return !r.error && (r.data?.length ?? 0) > 0;
    },
  },
  {
    area: "products",
    name: "upload a product image",
    run: async (c) =>
      !(
        await c.storage
          .from("public-assets")
          .upload(`products/${randomUUID()}/${randomUUID()}.webp`, WEBP, {
            contentType: "image/webp",
          })
      ).error,
  },
  {
    area: "customers",
    name: "block a customer",
    run: async (c) => {
      const target = await createUser();
      return !(
        await c.rpc("set_customer_blocked", {
          p_user_id: target.id,
          p_blocked: true,
        })
      ).error;
    },
  },
  {
    area: "comments",
    name: "list comments for moderation",
    run: async (c) => !(await c.rpc("admin_comments", {})).error,
  },
  {
    area: "comments",
    name: "hide a comment",
    run: async (c) => {
      const id = await newComment();
      const r = await c
        .from("comments")
        .update({ status: "hidden" })
        .eq("id", id)
        .select("id");
      return !r.error && (r.data?.length ?? 0) > 0;
    },
  },
  {
    area: "comments",
    name: "delete a comment",
    run: async (c) => {
      const id = await newComment();
      const r = await c.from("comments").delete().eq("id", id).select("id");
      return !r.error && (r.data?.length ?? 0) > 0;
    },
  },
  {
    area: "settings",
    name: "change the exchange rate",
    run: async (c) => {
      const rate = sql("select usd_sdg_rate from public.app_settings");
      const r = await c
        .from("app_settings")
        .update({ usd_sdg_rate: Number(rate) })
        .eq("id", true)
        .select("id");
      return !r.error && (r.data?.length ?? 0) > 0;
    },
  },
  {
    area: "settings",
    name: "change abuse limits",
    run: async (c) => {
      const r = await c
        .from("security_settings")
        .update({ order_rate_limit_per_hour: 10 })
        .eq("id", true)
        .select("id");
      return !r.error && (r.data?.length ?? 0) > 0;
    },
  },
  {
    area: "settings",
    name: "add a FAQ",
    run: async (c) =>
      !(
        await c.from("faqs").insert({
          question_en: "Matrix?",
          answer_en: "Yes.",
          is_published: false,
        })
      ).error,
  },
  {
    area: "settings",
    name: "add a bank account",
    run: async (c) =>
      !(
        await c.from("bank_accounts").insert({
          bank_name_ar: "بنك",
          bank_name_en: "Matrix Bank",
          account_number: randomBytes(4).toString("hex"),
          account_holder: "X",
          is_active: false,
        })
      ).error,
  },
  {
    area: "settings",
    name: "upload a banner image",
    run: async (c) =>
      !(
        await c.storage
          .from("public-assets")
          .upload(`site/banner/${randomUUID()}.webp`, WEBP, {
            contentType: "image/webp",
          })
      ).error,
  },
  {
    area: "kyc",
    name: "read the KYC queue",
    run: async (c) => {
      const k = await createKycSubmission((await createUser()).id);
      const r = await c.from("kyc_submissions").select("id").eq("id", k.id);
      return (r.data?.length ?? 0) > 0;
    },
  },
  {
    area: "owner",
    name: "make someone an admin",
    run: async (c) =>
      !(await c.from("admins").insert({ user_id: (await createUser()).id }))
        .error,
  },
  {
    area: "owner",
    name: "grant a permission",
    run: async (c, me) => {
      const target = me.id === users.owner.id ? users.none.id : me.id; // non-owners try to grant themselves
      const r = await c
        .from("admin_permissions")
        .insert({ admin_id: target, permission: "invoices" });
      if (!r.error && target === users.none.id)
        await service()
          .from("admin_permissions")
          .delete()
          .eq("admin_id", target)
          .eq("permission", "invoices");
      return !r.error;
    },
  },
  {
    area: "owner",
    name: "read the audit log",
    run: async (c) =>
      ((await c.from("audit_logs").select("id").limit(1)).data?.length ?? 0) >
      0,
  },
];

describe("permission matrix: every admin area is enforced by the database", () => {
  it("each operation succeeds only for its permission (and the owner)", async () => {
    const lines: string[] = [];
    const header = [
      "operation".padEnd(34),
      ...ROLES.map((r) => r.padEnd(9)),
    ].join(" ");
    lines.push(header);
    const mismatches: string[] = [];
    for (const op of OPS) {
      const cells: string[] = [];
      for (const role of ROLES) {
        const allowed = await op.run(users[role].client, users[role]);
        const expected = role === "owner" || role === op.area;
        if (allowed !== expected)
          mismatches.push(
            `${op.name} as ${role}: ${allowed ? "ALLOWED" : "refused"}`,
          );
        cells.push((allowed ? "✓" : "·").padEnd(9));
      }
      lines.push([op.name.padEnd(34), ...cells].join(" "));
    }
    console.log(
      `[demo] permission matrix (✓ = the database allowed it)\n${lines.join("\n")}`,
    );
    expect(mismatches).toEqual([]);
  }, 300_000);
});

describe("internal notes are never readable by the customer, through any route", () => {
  let order: { id: string; reference: string; user_id: string };
  let customer: TestUser;
  const secret = `internal-${randomUUID()}`;
  beforeAll(async () => {
    customer = await createUser();
    order = await createOrder(customer.id);
    const note = await users.orders.client.from("order_internal_notes").insert({
      order_id: order.id,
      body: `Customer seems suspicious ${secret}`,
    });
    if (note.error) throw new Error(note.error.message);
  });

  it("control: orders staff can read the note", async () => {
    const { data } = await users.orders.client
      .from("order_internal_notes")
      .select("body")
      .eq("order_id", order.id);
    expect(JSON.stringify(data)).toContain(secret);
  });

  it("REST: direct select, by id and unfiltered", async () => {
    const c = customer.client;
    expect(
      (
        await c
          .from("order_internal_notes")
          .select("*")
          .eq("order_id", order.id)
      ).data,
    ).toEqual([]);
    expect((await c.from("order_internal_notes").select("*")).data).toEqual([]);
  });

  it("REST: embedded under the customer's own order", async () => {
    const { data, error } = await customer.client
      .from("orders")
      .select("id, order_internal_notes(*)")
      .eq("id", order.id)
      .single();
    expect(error).toBeNull();
    expect(data!.order_internal_notes).toEqual([]);
    expect(JSON.stringify(data)).not.toContain(secret);
  });

  it("the audit log (which records notes) is not readable by customers", async () => {
    const { data } = await customer.client
      .from("audit_logs")
      .select("*")
      .eq("entity_type", "order_internal_notes");
    expect(data ?? []).toEqual([]);
  });

  it("the orders RPC is refused; no public function returns notes", async () => {
    expect(
      (await customer.client.rpc("admin_orders", { p_q: order.reference }))
        .error?.message,
    ).toBe("FORBIDDEN");
    const fns =
      sql(`select coalesce(string_agg(p.proname, ','), '') from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and has_function_privilege('authenticated', p.oid, 'execute')
        and pg_get_functiondef(p.oid) ilike '%order_internal_notes%'`);
    expect(fns).toBe("");
  });

  it("anon, with the public key only: nothing", async () => {
    const anon = (await import("./helpers")).anon();
    expect(
      (await anon.from("order_internal_notes").select("*")).data ?? [],
    ).toEqual([]);
  });

  it("GraphQL is disabled; and if someone re-enables it, RLS still hides the note", async () => {
    const gql = (token: string, query: string) =>
      fetch(`${url()}/graphql/v1`, {
        method: "POST",
        headers: {
          apikey: anonKey(),
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      }).then((r) => r.json());
    const disabled = await gql(customer.accessToken, "{ __typename }");
    console.log(`[demo] GraphQL as shipped: ${JSON.stringify(disabled)}`);
    expect(JSON.stringify(disabled)).toContain(
      "pg_graphql extension is not enabled",
    );

    sql("create extension if not exists pg_graphql");
    try {
      const query = `{ order_internal_notesCollection { edges { node { body } } } }`;
      const asCustomer = await gql(customer.accessToken, query);
      const asStaff = await gql(users.orders.accessToken, query);
      console.log(
        `[demo] GraphQL re-enabled, customer: ${JSON.stringify(asCustomer).slice(0, 160)}`,
      );
      expect(JSON.stringify(asCustomer)).not.toContain(secret);
      expect(JSON.stringify(asStaff)).toContain(secret); // control: the query itself works
    } finally {
      sql("drop extension if exists pg_graphql");
    }
  });
});

describe("a non-owner admin cannot grant themselves permissions or touch the owner", () => {
  let almighty: TestUser;
  beforeAll(async () => {
    almighty = await createUser({
      admin: {
        // Everything except invoices, so there is something left to try granting.
        permissions: [
          "orders",
          "products",
          "kyc",
          "customers",
          "comments",
          "settings",
        ],
      },
      name: "Every Permission But Owner",
    });
  });

  it("cannot add a permission to itself, nor make itself owner", async () => {
    const c = almighty.client;
    const self = await c
      .from("admin_permissions")
      .insert({ admin_id: almighty.id, permission: "invoices" });
    expect(self.error?.message).toMatch(/row-level security/);
    const other = await c
      .from("admin_permissions")
      .insert({ admin_id: users.none.id, permission: "orders" });
    expect(other.error?.message).toMatch(/row-level security/);
    expect(
      sql(
        `select count(*) from public.admin_permissions where (admin_id = '${almighty.id}' and permission = 'invoices') or (admin_id = '${users.none.id}' and permission = 'orders')`,
      ),
    ).toBe("0");
    const owner = await c
      .from("admins")
      .update({ is_owner: true })
      .eq("user_id", almighty.id)
      .select("user_id");
    expect(owner.data ?? []).toEqual([]);
    expect(
      sql(
        `select is_owner from public.admins where user_id = '${almighty.id}'`,
      ),
    ).toBe("f");
  });

  it("cannot create admins, nor promote another user", async () => {
    const target = await createUser();
    const r = await almighty.client
      .from("admins")
      .insert({ user_id: target.id });
    expect(r.error?.message).toMatch(/row-level security/);
  });

  it("cannot deactivate, delete, block or edit the owner", async () => {
    const c = almighty.client;
    const ownerId = users.owner.id;
    expect(
      (
        await c
          .from("admins")
          .update({ is_active: false })
          .eq("user_id", ownerId)
          .select("user_id")
      ).data ?? [],
    ).toEqual([]);
    expect(
      (await c.from("admins").delete().eq("user_id", ownerId).select("user_id"))
        .data ?? [],
    ).toEqual([]);
    expect(
      (
        await c
          .from("admin_permissions")
          .delete()
          .eq("admin_id", ownerId)
          .select("admin_id")
      ).data ?? [],
    ).toEqual([]);
    expect(
      (
        await c.rpc("set_customer_blocked", {
          p_user_id: ownerId,
          p_blocked: true,
        })
      ).error?.message,
    ).toBe("OWNER_PROTECTED");
    expect(
      (
        await c
          .from("profiles")
          .update({ full_name: "Hacked" })
          .eq("id", ownerId)
          .select("id")
      ).data ?? [],
    ).toEqual([]);
    expect(
      sql(
        `select is_active::text || ',' || (select is_blocked from public.profiles where id = '${ownerId}')::text from public.admins where user_id = '${ownerId}'`,
      ),
    ).toBe("true,false");
  });

  it("cannot block another admin or itself; can block a customer (control)", async () => {
    const c = almighty.client;
    expect(
      (
        await c.rpc("set_customer_blocked", {
          p_user_id: users.orders.id,
          p_blocked: true,
        })
      ).error?.message,
    ).toBe("ADMIN_PROTECTED");
    expect(
      (
        await c.rpc("set_customer_blocked", {
          p_user_id: almighty.id,
          p_blocked: true,
        })
      ).error?.message,
    ).toBe("CANNOT_BLOCK_SELF");
    const customer = await createUser();
    expect(
      (
        await c.rpc("set_customer_blocked", {
          p_user_id: customer.id,
          p_blocked: true,
        })
      ).error,
    ).toBeNull();
  });

  it("the owner cannot demote or deactivate itself either; the owner can block an admin (control)", async () => {
    const c = users.owner.client;
    expect(
      (
        await c
          .from("admins")
          .update({ is_owner: false })
          .eq("user_id", users.owner.id)
      ).error?.message,
    ).toMatch(/OWNER_PROTECTED/);
    expect(
      (
        await c
          .from("admins")
          .update({ is_active: false })
          .eq("user_id", users.owner.id)
      ).error?.message,
    ).toMatch(/OWNER_PROTECTED/);
    const staff = await createUser({ admin: { permissions: ["comments"] } });
    expect(
      (
        await c.rpc("set_customer_blocked", {
          p_user_id: staff.id,
          p_blocked: true,
        })
      ).error,
    ).toBeNull();
  });

  it("only complete, unblocked accounts can become admins; the granter is recorded by the database", async () => {
    const c = users.owner.client;
    const blocked = await createUser();
    sql(
      `update public.profiles set is_blocked = true where id = '${blocked.id}'`,
    );
    expect(
      (await c.from("admins").insert({ user_id: blocked.id })).error?.message,
    ).toMatch(/ADMIN_TARGET_INVALID/);

    const ok = await createUser();
    const forged = await c
      .from("admins")
      .insert({ user_id: ok.id, created_by: users.customer.id });
    expect(forged.error).toBeNull();
    const perm = await c.from("admin_permissions").insert({
      admin_id: ok.id,
      permission: "comments",
      granted_by: users.customer.id,
    });
    expect(perm.error).toBeNull();
    expect(
      sql(`select created_by from public.admins where user_id = '${ok.id}'`),
    ).toBe(users.owner.id);
    expect(
      sql(
        `select granted_by from public.admin_permissions where admin_id = '${ok.id}'`,
      ),
    ).toBe(users.owner.id);
  });
});

describe("the audit log is read-only for everyone, the owner included", () => {
  it("the owner (its only reader) cannot insert, update or delete a row", async () => {
    const c = users.owner.client;
    const before = sql(
      "select id || '|' || action || '|' || coalesce(actor_id::text, '') from public.audit_logs order by id limit 1",
    );
    const [id] = before.split("|");
    const upd = await c
      .from("audit_logs")
      .update({ action: "tampered" })
      .eq("id", Number(id))
      .select("id");
    const del = await c
      .from("audit_logs")
      .delete()
      .eq("id", Number(id))
      .select("id");
    const ins = await c
      .from("audit_logs")
      .insert({ action: "forged", entity_type: "orders" });
    console.log(
      `[demo] owner UPDATE: ${upd.error?.message} | DELETE: ${del.error?.message} | INSERT: ${ins.error?.message}`,
    );
    expect(upd.error?.message).toMatch(/permission denied/);
    expect(del.error?.message).toMatch(/permission denied/);
    expect(ins.error?.message).toMatch(/permission denied/);
    expect(
      sql(
        `select id || '|' || action || '|' || coalesce(actor_id::text, '') from public.audit_logs where id = ${id}`,
      ),
    ).toBe(before);
  });

  it("dashboard actions are recorded with the acting admin", async () => {
    const products = users.products.client;
    await products
      .from("product_variants")
      .update({ price_usd: 1.15 })
      .eq("id", VARIANT_CHEAP);
    await products
      .from("product_variants")
      .update({ price_usd: 1.1 })
      .eq("id", VARIANT_CHEAP);
    const target = await createUser();
    await users.customers.client.rpc("set_customer_blocked", {
      p_user_id: target.id,
      p_blocked: true,
    });
    const comment = await newComment();
    await users.comments.client
      .from("comments")
      .update({ status: "hidden", hidden_reason: "spam" })
      .eq("id", comment);
    const faq = await users.settings.client
      .from("faqs")
      .insert({ question_en: "Audited?", answer_en: "Yes" })
      .select("id")
      .single();

    const actor = (entity: string, id: string) =>
      sql(
        `select actor_id from public.audit_logs where entity_type = '${entity}' and entity_id = '${id}' order by id desc limit 1`,
      );
    expect(actor("product_variants", VARIANT_CHEAP)).toBe(users.products.id);
    expect(actor("profiles", target.id)).toBe(users.customers.id);
    expect(actor("comments", comment)).toBe(users.comments.id);
    expect(actor("faqs", faq.data!.id)).toBe(users.settings.id);
    expect(
      sql(`select hidden_by from public.comments where id = '${comment}'`),
    ).toBe(users.comments.id);
  });
});

describe("abuse limits are settings (decision 2026-09-27), enforced by the database", () => {
  let saved: string;
  beforeAll(() => {
    saved = sql(
      "select order_rate_limit_per_hour || ',' || receipts_per_order_limit || ',' || comment_rate_limit_per_hour from public.security_settings",
    );
  });
  afterAll(() => {
    const [o, r, c] = saved.split(",");
    sql(
      `update public.security_settings set order_rate_limit_per_hour = ${o}, receipts_per_order_limit = ${r}, comment_rate_limit_per_hour = ${c}`,
    );
  });

  it("orders per hour follows the setting", async () => {
    const buyer = await createUser();
    const create = () =>
      buyer.client.rpc("create_order", {
        p_variant_id: VARIANT_CHEAP,
        p_quantity: 1,
        p_fulfillment: { player_id: "123456" },
        p_idempotency_key: randomUUID(),
        p_expected_total_sdg: 2860,
      });
    const set = await users.settings.client
      .from("security_settings")
      .update({ order_rate_limit_per_hour: 2 })
      .eq("id", true)
      .select("id");
    expect(set.data).toHaveLength(1);
    expect((await create()).data.status).toBe("created");
    expect((await create()).data.status).toBe("created");
    expect((await create()).data).toEqual({
      status: "error",
      reason: "rate_limited",
    });
    // Busy season: raise it, no deploy.
    await users.settings.client
      .from("security_settings")
      .update({ order_rate_limit_per_hour: 3 })
      .eq("id", true);
    expect((await create()).data.status).toBe("created");
  });

  it("comments per hour follows the setting", async () => {
    await users.settings.client
      .from("security_settings")
      .update({ comment_rate_limit_per_hour: 1 })
      .eq("id", true);
    const author = await createUser();
    const product = sql(
      "select id from public.products where slug = 'pubg-uc'",
    );
    expect(
      (
        await author.client
          .from("comments")
          .insert({ product_id: product, body: "first" })
      ).error,
    ).toBeNull();
    expect(
      (
        await author.client
          .from("comments")
          .insert({ product_id: product, body: "second" })
      ).error?.message,
    ).toBe("COMMENT_RATE_LIMIT");
  });

  it("only settings staff can change limits; others are refused", async () => {
    for (const role of [
      "customer",
      "orders",
      "products",
      "customers",
      "comments",
      "kyc",
      "none",
    ] as Role[]) {
      const r = await users[role].client
        .from("security_settings")
        .update({ order_rate_limit_per_hour: 1000 })
        .eq("id", true)
        .select("id");
      expect(r.data ?? [], role).toEqual([]);
    }
    expect(
      sql("select order_rate_limit_per_hour from public.security_settings"),
    ).not.toBe("1000");
  });

  it("limits are not publicly readable", async () => {
    const anon = (await import("./helpers")).anon();
    expect(
      (await anon.from("security_settings").select("*")).data ?? [],
    ).toEqual([]);
    expect(
      (await users.customer.client.from("security_settings").select("*"))
        .data ?? [],
    ).toEqual([]);
  });
});

describe("public images: staff write only under their own paths", () => {
  const put = (c: SupabaseClient, path: string) =>
    c.storage
      .from("public-assets")
      .upload(path, WEBP, { contentType: "image/webp" })
      .then((r) => !r.error);
  it("products staff: products/ and categories/ only; settings staff: site/ only; nobody at the root", async () => {
    const id = randomUUID();
    const rows = [
      ["products", `products/${id}/a.webp`, true],
      ["products", `categories/${id}/a.webp`, true],
      ["products", `site/banner/${id}.webp`, false],
      ["products", `${id}.webp`, false],
      ["settings", `site/logo/${id}.webp`, true],
      ["settings", `products/${id}/b.webp`, false],
      ["customer", `products/${id}/c.webp`, false],
      ["customer", `site/banner/${id}c.webp`, false],
      ["orders", `products/${id}/d.webp`, false],
    ] as const;
    for (const [role, path, expected] of rows) {
      expect(await put(users[role].client, path), `${role} → ${path}`).toBe(
        expected,
      );
    }
  });
});

describe("comments: public view shows first names only, never hidden comments", () => {
  it("product_comments exposes no ids or phones, and drops hidden comments", async () => {
    const author = await createUser({ name: "Salma Ahmed Osman" });
    const product = sql(
      "select id from public.products where slug = 'pubg-uc'",
    );
    const visible = await author.client
      .from("comments")
      .insert({ product_id: product, body: "Fast delivery" })
      .select("id")
      .single();
    const hidden = await author.client
      .from("comments")
      .insert({ product_id: product, body: "Spam link" })
      .select("id")
      .single();
    await users.comments.client
      .from("comments")
      .update({ status: "hidden" })
      .eq("id", hidden.data!.id);

    const anon = (await import("./helpers")).anon();
    const { data } = await anon.rpc("product_comments", {
      p_product_id: product,
    });
    const mine = (
      data as { id: string; author: string; body: string }[]
    ).filter((c) => [visible.data!.id, hidden.data!.id].includes(c.id));
    expect(mine).toEqual([
      expect.objectContaining({ body: "Fast delivery", author: "Salma" }),
    ]);
    expect(Object.keys(mine[0]).sort()).toEqual([
      "author",
      "body",
      "created_at",
      "id",
    ]);
    expect(JSON.stringify(data)).not.toContain(author.phone.slice(1));
  });

  it("a customer cannot post as someone else, nor while blocked", async () => {
    const author = await createUser();
    const product = sql(
      "select id from public.products where slug = 'pubg-uc'",
    );
    const spoof = await author.client
      .from("comments")
      .insert({ product_id: product, body: "hi", user_id: users.owner.id });
    expect(spoof.error?.message).toMatch(/permission denied/);
    sql(
      `update public.profiles set is_blocked = true where id = '${author.id}'`,
    );
    const blocked = await author.client
      .from("comments")
      .insert({ product_id: product, body: "hi" });
    expect(blocked.error?.message).toMatch(/row-level security/);
  });
});
