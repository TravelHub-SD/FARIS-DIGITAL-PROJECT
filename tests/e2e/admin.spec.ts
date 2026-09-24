import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

import {
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import sharp from "sharp";

import {
  createOrder,
  createUser,
  ownerUser,
  service,
  signInCookies,
  sql,
  type TestUser,
} from "./helpers";

// Phase 6 in the browser. Permissions are demonstrated on three layers:
//   1. direct URL → 404 for admins without the permission;
//   2. the Server Action itself → the exact request the owner's browser sent
//      is replayed with another user's cookies and must be refused;
//   3. the database (tests/integration/admin-dashboard.test.ts).

const BASE = "http://localhost:3100";
type Perm =
  "orders" | "products" | "customers" | "comments" | "settings" | "kyc";

async function contextFor(browser: Browser, user: TestUser | null) {
  const ctx = await browser.newContext({ baseURL: BASE });
  if (user) await signInCookies(ctx, user.phone, user.password);
  return ctx;
}

const staff = {} as Record<Perm | "almighty", TestUser>;
let owner: TestUser;
let customer: TestUser;

test.beforeAll(async () => {
  owner = await ownerUser();
  customer = await createUser({ name: "عميل التجربة" });
  for (const p of [
    "orders",
    "products",
    "customers",
    "comments",
    "settings",
    "kyc",
  ] as Perm[]) {
    staff[p] = await createUser({
      admin: { permissions: [p] },
      name: `Staff ${p}`,
    });
  }
  staff.almighty = await createUser({
    admin: {
      permissions: [
        "orders",
        "products",
        "kyc",
        "customers",
        "invoices",
        "comments",
        "settings",
      ],
    },
    name: "Every Permission But Owner",
  });
});

test("direct URL: every admin page answers 404 without its permission", async ({
  browser,
}) => {
  const order = await createOrder(customer.id);
  const product = sql("select id from public.products where slug = 'pubg-uc'");
  const pages: [string, Perm | "owner" | "any"][] = [
    ["/admin", "any"],
    ["/admin/orders", "orders"],
    [`/admin/orders/${order.reference}`, "orders"],
    ["/admin/catalog", "products"],
    [`/admin/catalog/products/${product}`, "products"],
    [
      "/admin/catalog/variants/00000000-0000-4000-c000-000000000001",
      "products",
    ],
    ["/admin/customers", "customers"],
    [`/admin/customers/${customer.id}`, "customers"],
    ["/admin/kyc", "kyc"],
    ["/admin/comments", "comments"],
    ["/admin/faqs", "settings"],
    ["/admin/settings", "settings"],
    ["/admin/admins", "owner"],
    ["/admin/audit", "owner"],
  ];
  const roles: [string, TestUser, (need: Perm | "owner" | "any") => boolean][] =
    [
      ["customer", customer, () => false],
      ...(
        [
          "orders",
          "products",
          "customers",
          "comments",
          "settings",
          "kyc",
        ] as Perm[]
      ).map(
        (p) =>
          [p, staff[p], (need: string) => need === "any" || need === p] as [
            string,
            TestUser,
            (n: string) => boolean,
          ],
      ),
      ["almighty", staff.almighty, (need) => need !== "owner"],
      ["owner", owner, () => true],
    ];

  const lines = [
    ["page".padEnd(52), ...roles.map(([r]) => r.slice(0, 8).padEnd(9))].join(
      " ",
    ),
  ];
  const wrong: string[] = [];
  for (const [path] of pages) lines.push(path.padEnd(52));
  for (const [name, user, allowed] of roles) {
    const ctx = await contextFor(browser, user);
    for (const [i, [path, need]] of pages.entries()) {
      const res = await ctx.request.get(`/ar${path}`, { maxRedirects: 0 });
      const expected = allowed(need) ? 200 : 404;
      if (res.status() !== expected)
        wrong.push(`${name} ${path}: ${res.status()} (expected ${expected})`);
      lines[i + 1] += ` ${String(res.status()).padEnd(9)}`;
    }
    await ctx.close();
  }
  console.log(`[demo] GET /ar/admin/... status by role\n${lines.join("\n")}`);
  expect(wrong).toEqual([]);

  // Signed out: sent to login, never shown the page.
  const anon = await contextFor(browser, null);
  const res = await anon.request.get("/ar/admin/orders", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  expect(res.headers().location).toContain("/ar/login");
});

type Captured = { url: string; headers: Record<string, string>; body: Buffer };

/** Records the Server Action request the page sends when `click` runs. */
async function capture(
  page: Page,
  click: () => Promise<void>,
): Promise<Captured> {
  const req = page.waitForRequest(
    (r) => r.method() === "POST" && !!r.headers()["next-action"],
  );
  await click();
  const r = await req;
  const h = r.headers();
  return {
    url: r.url(),
    headers: {
      "next-action": h["next-action"],
      "content-type": h["content-type"],
      accept: "text/x-component",
      ...(h["next-router-state-tree"]
        ? { "next-router-state-tree": h["next-router-state-tree"] }
        : {}),
    },
    body: r.postDataBuffer()!,
  };
}

async function replay(ctx: BrowserContext, cap: Captured) {
  const res = await ctx.request.post(cap.url, {
    headers: cap.headers,
    data: cap.body,
    maxRedirects: 0,
  });
  return { status: res.status(), body: await res.text() };
}

test("the Server Actions refuse a replayed request from anyone without the permission", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const ownerCtx = await contextFor(browser, owner);
  const page = await ownerCtx.newPage();
  const ok = page.locator('[data-result="ok"]');

  // Targets.
  const order = await createOrder(customer.id);
  const victim = await createUser({ name: "Block Target" });
  const product = sql("select id from public.products where slug = 'pubg-uc'");
  const comment = (
    await service()
      .from("comments")
      .insert({
        product_id: product,
        user_id: victim.id,
        body: `hello ${randomBytes(3).toString("hex")}`,
      })
      .select("id")
      .single()
  ).data!.id as string;
  const candidate = await createUser({ name: "Future Admin" });

  const captured: {
    name: string;
    cap: Captured;
    reset: () => void;
    state: () => string;
    needs: Perm | "owner";
  }[] = [];

  // orders: add an internal note
  await page.goto(`/en/admin/orders/${order.reference}`);
  await page.fill("#note-body", "owner note");
  const noteCap = await capture(page, () =>
    page.getByTestId("add-note").getByRole("button").click(),
  );
  await expect(page.getByTestId("add-note").locator(ok)).toBeVisible();
  captured.push({
    name: "add internal note",
    cap: noteCap,
    needs: "orders",
    reset: () => sql(`select 1`),
    state: () =>
      sql(
        `select count(*) from public.order_internal_notes where order_id = '${order.id}'`,
      ),
  });

  // products: change a price
  await page.goto(
    "/en/admin/catalog/variants/00000000-0000-4000-c000-000000000001",
  );
  await page.fill("#price_usd", "1.35");
  const priceCap = await capture(page, () =>
    page
      .getByTestId("variant-form")
      .getByRole("button", { name: "Save" })
      .click(),
  );
  await expect(page.getByTestId("variant-form").locator(ok)).toBeVisible();
  captured.push({
    name: "change a price",
    cap: priceCap,
    needs: "products",
    reset: () =>
      sql(
        "update public.product_variants set price_usd = 1.10 where id = '00000000-0000-4000-c000-000000000001'",
      ),
    state: () =>
      sql(
        "select price_usd from public.product_variants where id = '00000000-0000-4000-c000-000000000001'",
      ),
  });

  // customers: block
  await page.goto(`/en/admin/customers/${victim.id}`);
  page.once("dialog", (d) => d.accept());
  const blockCap = await capture(page, () =>
    page.getByTestId("block-form").getByRole("button").click(),
  );
  await expect(page.getByTestId("block-form").locator(ok)).toBeVisible();
  captured.push({
    name: "block a customer",
    cap: blockCap,
    needs: "customers",
    reset: () =>
      sql(
        `update public.profiles set is_blocked = false where id = '${victim.id}'`,
      ),
    state: () =>
      sql(`select is_blocked from public.profiles where id = '${victim.id}'`),
  });

  // comments: hide
  await page.goto("/en/admin/comments?status=visible");
  const row = page
    .locator(`[data-comment-status="visible"]`)
    .filter({ hasText: "hello" })
    .first();
  const hideCap = await capture(page, () =>
    row.getByTestId("hide-comment").getByRole("button").click(),
  );
  await expect(page.locator('[data-result="ok"]').first()).toBeVisible();
  captured.push({
    name: "hide a comment",
    cap: hideCap,
    needs: "comments",
    reset: () =>
      sql(
        `update public.comments set status = 'visible' where id = '${comment}'`,
      ),
    state: () =>
      sql(`select status from public.comments where id = '${comment}'`),
  });

  // settings: abuse limits
  await page.goto("/en/admin/settings");
  await page.fill("#order_rate_limit_per_hour", "11");
  const limitsCap = await capture(page, () =>
    page
      .getByTestId("limits-settings")
      .getByRole("button", { name: "Save" })
      .click(),
  );
  await expect(page.getByTestId("limits-settings").locator(ok)).toBeVisible();
  captured.push({
    name: "change abuse limits",
    cap: limitsCap,
    needs: "settings",
    reset: () =>
      sql("update public.security_settings set order_rate_limit_per_hour = 10"),
    state: () =>
      sql("select order_rate_limit_per_hour from public.security_settings"),
  });

  // owner: add an admin, grant a permission
  await page.goto("/en/admin/admins");
  await page.fill("#admin-phone", "0" + candidate.phone.slice(4));
  const addCap = await capture(page, () =>
    page.getByTestId("add-admin").getByRole("button").click(),
  );
  await expect(page.getByTestId("add-admin").locator(ok)).toBeVisible();
  const entry = page
    .getByTestId("admin-entry")
    .filter({ hasText: "Future Admin" });
  const grantCap = await capture(page, () =>
    entry.getByTestId("perm-kyc").getByRole("button").click(),
  );
  await expect(entry.getByTestId("perm-kyc").locator(ok)).toBeVisible();
  captured.push({
    name: "grant a permission (owner)",
    cap: grantCap,
    needs: "owner",
    reset: () =>
      sql(
        `delete from public.admin_permissions where admin_id = '${candidate.id}'`,
      ),
    state: () =>
      sql(
        `select count(*) from public.admin_permissions where admin_id = '${candidate.id}'`,
      ),
  });
  captured.push({
    name: "add an admin (owner)",
    cap: addCap,
    needs: "owner",
    reset: () =>
      sql(`delete from public.admins where user_id = '${candidate.id}'`),
    state: () =>
      sql(
        `select count(*) from public.admins where user_id = '${candidate.id}'`,
      ),
  });

  // Replay each captured request as users who lack that permission.
  const attackers: [
    string,
    TestUser | null,
    (need: Perm | "owner") => boolean,
  ][] = [
    ["anonymous", null, () => false],
    ["customer", customer, () => false],
    ["orders staff", staff.orders, (n) => n === "orders"],
    ["kyc staff", staff.kyc, (n) => n === "kyc"],
    ["every permission but owner", staff.almighty, (n) => n !== "owner"],
  ];
  const report: string[] = [];
  for (const c of captured) {
    c.reset();
    const before = c.state();
    for (const [who, user, has] of attackers) {
      if (has(c.needs)) continue;
      const ctx = await contextFor(browser, user);
      const res = await replay(ctx, c.cap);
      await ctx.close();
      const refused = res.body.includes('"not_allowed"');
      report.push(
        `${c.name.padEnd(28)} replayed by ${who.padEnd(28)} → HTTP ${res.status}, ${refused ? "not_allowed" : "!! " + res.body.slice(0, 80)}`,
      );
      expect(refused, `${c.name} as ${who}`).toBe(true);
      expect(c.state(), `${c.name} changed state when replayed by ${who}`).toBe(
        before,
      );
    }
  }
  // Control: the same captured request still works for the owner.
  const control = captured.find((c) => c.name === "change abuse limits")!;
  const res = await replay(ownerCtx, control.cap);
  expect(res.body).toContain('"ok":true');
  expect(control.state()).toBe("11");
  control.reset();
  console.log(
    `[demo] replayed Server Action requests\n${report.join("\n")}\ncontrol: owner replay → ok, limit = 11`,
  );
  await ownerCtx.close();
});

test("a stale tab: permission revoked after the page loaded → the save is refused", async ({
  browser,
}) => {
  const editor = await createUser({
    admin: { permissions: ["products"] },
    name: "Soon Revoked",
  });
  const ctx = await contextFor(browser, editor);
  const page = await ctx.newPage();
  await page.goto(
    "/en/admin/catalog/variants/00000000-0000-4000-c000-000000000003",
  );
  await page.fill("#price_usd", "0.01");
  await service().from("admin_permissions").delete().eq("admin_id", editor.id); // owner revokes meanwhile
  await page
    .getByTestId("variant-form")
    .getByRole("button", { name: "Save" })
    .click();
  await expect(page.locator('[data-result="not_allowed"]')).toHaveText(
    "You do not have permission for this.",
  );
  expect(
    sql(
      "select price_usd from public.product_variants where id = '00000000-0000-4000-c000-000000000003'",
    ),
  ).toBe("5.20");
  expect((await page.goto("/en/admin/catalog"))!.status()).toBe(404);
});

async function receiptPng(name: string) {
  const png = await sharp({
    create: {
      width: 720,
      height: 1280,
      channels: 3,
      background: `#${randomBytes(3).toString("hex")}`,
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="720" height="200"><text x="40" y="120" font-size="64">TX ${name}</text></svg>`,
        ),
        top: 400,
        left: 0,
      },
    ])
    .png()
    .toBuffer();
  const path = `.e2e/${name}.png`;
  writeFileSync(path, png);
  return path;
}

test("orders (Arabic UI): find → view receipt → reject with reason → accept → internal note never reaches the customer", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const buyer = await createUser({ name: "سارة عثمان" });
  const order = await createOrder(buyer.id);
  const buyerCtx = await contextFor(browser, buyer);
  const buyerPage = await buyerCtx.newPage();
  const upload = async (ref: string) => {
    await buyerPage.goto(`/ar/account/orders/${order.reference}`);
    await buyerPage.fill("#transactionRef", ref);
    await buyerPage.setInputFiles("#file", await receiptPng(ref));
    await buyerPage.getByRole("button", { name: "إرسال الإشعار" }).click();
    await expect(buyerPage.getByTestId("order-status")).toHaveText(
      "الدفع قيد المراجعة",
    );
  };
  await upload(`AR${randomBytes(4).toString("hex")}`);

  const adminCtx = await contextFor(browser, staff.orders);
  const page = await adminCtx.newPage();
  await page.goto(`/ar/admin/orders?review=1&q=${order.reference}`);
  await expect(page.getByTestId("admin-orders").locator("tr")).toHaveCount(1);
  await page.getByRole("link", { name: order.reference }).click();
  await expect(page.getByTestId("admin-order-reference")).toHaveText(
    order.reference,
  );
  const img = page.getByTestId("receipt-image").first();
  await expect(img).toBeVisible();
  expect(
    await img.evaluate((el: HTMLImageElement) => el.naturalWidth),
  ).toBeGreaterThan(0);

  const review = page.getByTestId("review-receipt");
  await review.getByRole("button", { name: "رفض الإشعار" }).click();
  await expect(review.locator('[data-result="reason_required"]')).toHaveText(
    "اكتب سبب الرفض أولاً.",
  );
  await review
    .locator("input[name=reason]")
    .fill("المبلغ في الإشعار لا يطابق إجمالي الطلب");
  await review.getByRole("button", { name: "رفض الإشعار" }).click();
  await expect(page.locator('[data-receipt="rejected"]')).toHaveCount(1);

  await buyerPage.goto(`/ar/account/orders/${order.reference}`);
  await expect(
    buyerPage.getByText("المبلغ في الإشعار لا يطابق إجمالي الطلب"),
  ).toBeVisible();
  await upload(`AR${randomBytes(4).toString("hex")}`);

  await page.reload();
  await page
    .getByTestId("review-receipt")
    .getByRole("button", { name: "قبول الدفع" })
    .click();
  await expect(page.getByTestId("admin-order-status")).toHaveText(
    "قيد التنفيذ",
  );

  const secret = `ملاحظة داخلية ${randomBytes(4).toString("hex")}`;
  await page.fill("#note-body", secret);
  await page.getByTestId("add-note").getByRole("button").click();
  await expect(page.getByTestId("internal-notes")).toContainText(secret);

  await page.selectOption("#to", "completed");
  await page.fill("#customerNote", "تم الشحن إلى حسابك");
  await page.getByTestId("change-status").getByRole("button").click();
  await expect(page.getByTestId("admin-order-status")).toHaveText("مكتمل");
  await page.screenshot({ path: ".e2e/admin-order-ar.png", fullPage: true });

  // The customer sees the status and the note meant for them, never the internal one.
  const res = await buyerPage.goto(`/ar/account/orders/${order.reference}`);
  await expect(buyerPage.getByTestId("order-status")).toHaveText("مكتمل");
  await expect(buyerPage.getByText("تم الشحن إلى حسابك")).toBeVisible();
  const html = await res!.text();
  expect(html).not.toContain(secret);
  expect(await buyerPage.content()).not.toContain(secret);
  console.log(
    `[demo] customer order page (${html.length} bytes of HTML + RSC) contains the internal note: ${html.includes(secret)}`,
  );
});

test("catalog: create → upload image (bad files refused, good one re-encoded) → options with fields → live on the site → price edit → archive", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const ctx = await contextFor(browser, staff.products);
  const page = await ctx.newPage();
  const t = randomBytes(3).toString("hex");

  await page.goto("/en/admin/catalog/categories/new");
  await page.fill("#name_ar", `قسم ${t}`);
  await page.fill("#name_en", `Category ${t}`);
  await page.fill("#slug", `cat-${t}`);
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL("**/en/admin/catalog");

  await page.goto("/en/admin/catalog/products/new");
  await page.fill("#name_ar", `بطاقة ${t}`);
  await page.fill("#name_en", `Gift card ${t}`);
  await page.fill("#description_ar", "وصف المنتج بالعربية");
  await page.fill("#slug", `gift-${t}`);
  await page.selectOption("#category_id", { label: `Category ${t}` });
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/\/en\/admin\/catalog\/products\/[0-9a-f-]{36}$/);
  const productId = page.url().split("/").pop()!;

  // Bad files first.
  writeFileSync(".e2e/not-an-image.png", "<?php system($_GET['c']); ?>");
  writeFileSync(
    ".e2e/tiny.png",
    await sharp({
      create: { width: 120, height: 120, channels: 3, background: "#f00" },
    })
      .png()
      .toBuffer(),
  );
  writeFileSync(
    ".e2e/banner-shaped.png",
    await sharp({
      create: { width: 2400, height: 400, channels: 3, background: "#0f0" },
    })
      .png()
      .toBuffer(),
  );
  const up = page.getByTestId("upload-image");
  for (const [file, error] of [
    [".e2e/not-an-image.png", "not_an_image"],
    [".e2e/tiny.png", "too_small"],
    [".e2e/banner-shaped.png", "bad_dimensions"],
  ] as const) {
    await up.locator("#file").setInputFiles(file);
    await up.getByRole("button", { name: "Upload" }).click();
    await expect(up.locator(`[data-result="${error}"]`)).toBeVisible();
    console.log(
      `[demo] upload ${file} → ${await up.locator("[data-result]").textContent()}`,
    );
  }
  expect(
    sql(
      `select coalesce(image_path, 'none') from public.products where id = '${productId}'`,
    ),
  ).toBe("none");

  const good = await sharp({
    create: { width: 1600, height: 1200, channels: 3, background: "#005CFF" },
  })
    .withExif({ IFD0: { Model: "Secret-Camera" } })
    .jpeg()
    .toBuffer();
  writeFileSync(".e2e/product.jpg", good);
  await up.locator("#file").setInputFiles(".e2e/product.jpg");
  await up.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByTestId("product-image-preview")).toBeVisible();
  const path = sql(
    `select image_path from public.products where id = '${productId}'`,
  );
  const stored = await (
    await fetch(
      `${process.env.TEST_SUPABASE_URL}/storage/v1/object/public/public-assets/${path}`,
    )
  ).arrayBuffer();
  const meta = await sharp(Buffer.from(stored)).metadata();
  console.log(
    `[demo] stored ${path}: ${meta.format} ${meta.width}x${meta.height}, exif: ${meta.exif ? "present" : "none"}`,
  );
  expect([meta.format, meta.width, meta.height, meta.exif]).toEqual([
    "webp",
    1000,
    750,
    undefined,
  ]);

  // An option with two customer fields, built in the editor.
  await page.getByRole("link", { name: "New option" }).click();
  // Same field ids exist on the product page: wait for the new page first.
  await page.waitForURL(/\/variants\/new$/);
  await page.fill("#name_ar", "بطاقة 10 دولار");
  await page.fill("#name_en", "$10 card");
  await page.fill("#price_usd", "3.25");
  await page.fill("#max_quantity", "3");
  const editor = page.getByTestId("fields-editor");
  await editor.getByTestId("add-field").click();
  const f0 = editor.locator("[data-field-index='0']");
  await f0.getByTestId("field-key").fill("account_email");
  await f0.getByTestId("field-type").selectOption("email");
  await f0.getByTestId("field-label-ar").fill("بريد الحساب");
  await f0.getByTestId("field-label-en").fill("Account email");
  await editor.getByTestId("add-field").click();
  const f1 = editor.locator("[data-field-index='1']");
  await f1.getByTestId("field-key").fill("region");
  await f1.getByTestId("field-type").selectOption("select");
  await f1.getByTestId("field-label-en").fill("Region");
  await f1.getByRole("button", { name: "Add choice" }).click();
  await f1.getByLabel("Value (Latin)").fill("sd");
  await f1.getByLabel("Label (Arabic)").last().fill("السودان");
  await page
    .getByTestId("variant-form")
    .getByRole("button", { name: "Create" })
    .click();
  await page.waitForURL(`**/en/admin/catalog/products/${productId}`);
  await expect(page.getByTestId("admin-variants")).toContainText("$10 card");

  // Live on the public site, in Arabic, with image, price and fields.
  const pub = await (await contextFor(browser, null)).newPage();
  await pub.goto(`/ar/p/gift-${t}`);
  await expect(pub.locator("h1")).toHaveText(`بطاقة ${t}`);
  await expect(pub.getByTestId("product-image")).toBeVisible();
  await expect(pub.getByTestId("order-total")).toContainText("8,450"); // ceil(3.25 × 2600)
  await expect(pub.getByText("بريد الحساب")).toBeVisible();
  await expect(pub.locator("#f-region option[value=sd]")).toHaveText("السودان");
  await pub.screenshot({ path: ".e2e/new-product-ar.png", fullPage: true });

  // Price edit shows up on the public page (revalidated).
  const variantId = sql(
    `select id from public.product_variants where product_id = '${productId}'`,
  );
  await page.goto(`/en/admin/catalog/variants/${variantId}`);
  await page.fill("#price_usd", "4.00");
  await page
    .getByTestId("variant-form")
    .getByRole("button", { name: "Save" })
    .click();
  await expect(
    page.getByTestId("variant-form").locator('[data-result="ok"]'),
  ).toBeVisible();
  await pub.reload();
  await expect(pub.getByTestId("order-total")).toContainText("10,400");

  // Archive → gone from the site.
  await page.goto(`/en/admin/catalog/products/${productId}`);
  page.once("dialog", (d) => d.accept());
  await page
    .getByTestId("archive-form")
    .getByRole("button", { name: "Archive" })
    .click();
  await expect(
    page.getByTestId("archive-form").locator('[data-result="ok"]'),
  ).toBeVisible();
  expect((await pub.goto(`/ar/p/gift-${t}`))!.status()).toBe(404);
});

test("content: FAQ and banner appear on the home page; a comment is moderated off the product page", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const t = randomBytes(3).toString("hex");
  const settingsCtx = await contextFor(browser, staff.settings);
  const page = await settingsCtx.newPage();
  await page.goto("/ar/admin/faqs");
  const form = page.getByTestId("new-faq-form");
  await form.locator("input[name=question_ar]").fill(`كم يستغرق التنفيذ؟ ${t}`);
  await form
    .locator("textarea[name=answer_ar]")
    .fill("عادة خلال ساعة بعد تأكيد الدفع.");
  await form
    .locator("input[name=question_en]")
    .fill(`How long does delivery take? ${t}`);
  await form
    .locator("textarea[name=answer_en]")
    .fill("Usually within an hour of payment.");
  await form.getByRole("button").click();
  await expect(form.locator('[data-result="ok"]')).toBeVisible();

  await page.goto("/ar/admin/settings");
  await page.fill("#banner_title_ar", `عرض خاص ${t}`);
  await page.fill("#banner_title_en", `Special offer ${t}`);
  await page.fill("#banner_link", "/c/games");
  await page.getByTestId("banner-settings").getByLabel("إظهار البانر").check();
  await page
    .getByTestId("banner-settings")
    .getByRole("button", { name: "حفظ" })
    .first()
    .click();
  await expect(
    page.getByTestId("banner-settings").locator('[data-result="ok"]'),
  ).toBeVisible();
  await page.screenshot({ path: ".e2e/admin-settings-ar.png", fullPage: true });

  const visitor = await (await contextFor(browser, null)).newPage();
  await visitor.goto("/ar");
  await expect(visitor.getByTestId("promo-banner")).toContainText(
    `عرض خاص ${t}`,
  );
  await expect(
    visitor.getByTestId("promo-banner").locator("a"),
  ).toHaveAttribute("href", "/ar/c/games");
  await expect(visitor.getByTestId("faq-section")).toContainText(
    `كم يستغرق التنفيذ؟ ${t}`,
  );
  await visitor.goto("/en");
  await expect(visitor.getByTestId("faq-section")).toContainText(
    `How long does delivery take? ${t}`,
  );
  await visitor.goto("/ar");
  await visitor.screenshot({
    path: ".e2e/home-banner-faq-ar.png",
    fullPage: true,
  });

  // Comment: posted by a customer, hidden by a moderator, shown again.
  const author = await createUser({ name: "خالد الطيب" });
  const authorPage = await (await contextFor(browser, author)).newPage();
  await authorPage.goto("/ar/p/pubg-uc");
  const body = `خدمة سريعة وممتازة ${t}`;
  await authorPage.fill("#comment-body", body);
  await authorPage.getByTestId("comment-form").getByRole("button").click();
  await expect(
    authorPage.getByTestId("comment-form").locator('[data-result="ok"]'),
  ).toBeVisible();
  await expect(authorPage.getByTestId("comment-list")).toContainText(body);
  await expect(authorPage.getByTestId("comment-list")).toContainText("خالد");

  const mod = await (await contextFor(browser, staff.comments)).newPage();
  await mod.goto(`/ar/admin/comments?q=${encodeURIComponent(t)}`);
  const item = mod
    .getByTestId("admin-comments")
    .locator("li")
    .filter({ hasText: body });
  await item.locator("input[name=reason]").fill("اختبار الإخفاء");
  await item.getByTestId("hide-comment").getByRole("button").click();
  await expect(
    mod.getByTestId("admin-comments").locator("li").filter({ hasText: body }),
  ).toHaveAttribute("data-comment-status", "hidden");
  await visitor.goto("/ar/p/pubg-uc");
  await expect(visitor.getByText(body)).toHaveCount(0);

  await mod
    .getByTestId("admin-comments")
    .locator("li")
    .filter({ hasText: body })
    .getByTestId("show-comment")
    .getByRole("button")
    .click();
  await expect(
    mod.getByTestId("admin-comments").locator("li").filter({ hasText: body }),
  ).toHaveAttribute("data-comment-status", "visible");
  await visitor.reload();
  await expect(visitor.getByText(body)).toBeVisible();

  // Signed-out visitor trying to comment is asked to sign in.
  await visitor.fill("#comment-body", "anon");
  await visitor.getByTestId("comment-form").getByRole("button").click();
  await expect(
    visitor.getByTestId("comment-form").locator('[data-result="sign_in"]'),
  ).toBeVisible();
});

test("admins: the owner adds an admin and grants one area; the audit log shows who did what, read-only", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const person = await createUser({ name: "مشرف جديد" });
  const ownerPage = await (await contextFor(browser, owner)).newPage();
  await ownerPage.goto("/ar/admin/admins");
  await ownerPage.fill("#admin-phone", "0" + person.phone.slice(4));
  await ownerPage.getByTestId("add-admin").getByRole("button").click();
  await expect(
    ownerPage.getByTestId("add-admin").locator('[data-result="ok"]'),
  ).toBeVisible();
  const entry = ownerPage
    .getByTestId("admin-entry")
    .filter({ hasText: "مشرف جديد" });
  await entry.getByTestId("perm-comments").getByRole("button").click();
  await expect(
    entry.getByTestId("perm-comments").getByRole("button"),
  ).toHaveAttribute("aria-pressed", "true");
  await ownerPage.screenshot({
    path: ".e2e/admin-admins-ar.png",
    fullPage: true,
  });

  const newAdmin = await (await contextFor(browser, person)).newPage();
  await newAdmin.goto("/ar/admin");
  const nav = newAdmin.getByRole("navigation", { name: "أقسام لوحة التحكم" });
  await expect(nav.getByRole("link")).toHaveText(["نظرة عامة", "التعليقات"]);
  expect((await newAdmin.goto("/ar/admin/comments"))!.status()).toBe(200);
  expect((await newAdmin.goto("/ar/admin/orders"))!.status()).toBe(404);

  // Revoke → the page is gone.
  await entry.getByTestId("perm-comments").getByRole("button").click();
  await expect(
    entry.getByTestId("perm-comments").getByRole("button"),
  ).toHaveAttribute("aria-pressed", "false");
  expect((await newAdmin.goto("/ar/admin/comments"))!.status()).toBe(404);

  // Audit log: the grant and the revoke, attributed to the owner. No write controls.
  await ownerPage.goto("/ar/admin/audit?entity=admin_permissions");
  const rows = ownerPage.getByTestId("audit-rows").locator("li");
  await expect(rows.first()).toContainText("Test Owner");
  await expect(rows.filter({ hasText: "حذف" }).first()).toBeVisible();
  await expect(rows.filter({ hasText: "إنشاء" }).first()).toBeVisible();
  expect(await ownerPage.locator("form").count()).toBe(1); // the GET filter form only
  expect(await ownerPage.locator("form").getAttribute("method")).toBe("get");
  await rows.first().locator("summary").click();
  await ownerPage.screenshot({
    path: ".e2e/admin-audit-ar.png",
    fullPage: true,
  });
});
