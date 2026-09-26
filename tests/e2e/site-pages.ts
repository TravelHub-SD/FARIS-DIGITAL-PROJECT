import { devices, type Browser } from "@playwright/test";

import {
  completeOrderWithInvoice,
  createKycSubmission,
  createOrder,
  createPaidOrder,
  createUser,
  ownerUser,
  signInCookies,
  sql,
  type TestUser,
} from "./helpers";

// Every page of the site with real data behind each dynamic route, for the
// Phase 9 sweeps (360 px overflow, accessibility). Seed catalog ids come from
// supabase/seed.sql.

export type Role = "guest" | "incomplete" | "customer" | "fresh" | "owner";
export type SitePage = { role: Role; path: string; main?: boolean };

const SEED = {
  category: "00000000-0000-4000-a000-000000000001",
  product: "00000000-0000-4000-b000-000000000001",
  variant: "00000000-0000-4000-c000-000000000001",
};

export async function buildSite() {
  const customer = await createUser({ name: "عميلة الاختبار الطويل اسمها" });
  const done = await createOrder(customer.id);
  const { invoice } = await completeOrderWithInvoice(done);
  const paid = await createPaidOrder(customer.id);
  await createOrder(customer.id); // awaiting payment
  const fresh = await createUser({ name: "New Customer" });
  const applicant = await createUser({ name: "صاحب الطلب" });
  const kyc = await createKycSubmission(applicant.id);
  const owner = await ownerUser();
  // Worst-case user input: the longest transaction number the form accepts
  // (60 characters, no break point) and a comment that is one long word.
  sql(`update payment_receipts set transaction_ref = 'TX' || rpad(replace(id::text, '-', ''), 58, '7')
         where order_id in (select id from orders where user_id = '${customer.id}')`);
  sql(`insert into comments (product_id, user_id, body)
         values ('${SEED.product}', '${customer.id}', repeat('ش', 300))`);
  const incomplete = await createUser();
  const users: Record<Exclude<Role, "guest">, TestUser> = {
    customer,
    fresh,
    owner,
    incomplete,
  };
  const ref = (o: { id: string }) =>
    sql(`select reference from orders where id = '${o.id}'`);

  const pages: SitePage[] = [
    { role: "guest", path: "", main: true },
    { role: "guest", path: "/c/games", main: true },
    { role: "guest", path: "/p/pubg-uc", main: true },
    { role: "guest", path: "/search?q=pubg", main: true },
    { role: "guest", path: "/search?q=zzzzzz" },
    { role: "guest", path: "/login", main: true },
    { role: "guest", path: "/register", main: true },
    { role: "guest", path: "/reset-password" },
    { role: "guest", path: "/no-such-page" },
    { role: "incomplete", path: "/complete-account" },
    { role: "customer", path: "/account", main: true },
    { role: "customer", path: "/account/orders", main: true },
    { role: "customer", path: `/account/orders/${ref(done)}`, main: true },
    { role: "customer", path: `/account/orders/${ref(paid)}` },
    { role: "customer", path: "/account/kyc", main: true },
    { role: "customer", path: "/account/invoices", main: true },
    {
      role: "customer",
      path: `/account/invoices/${invoice.invoice_number}`,
      main: true,
    },
    { role: "fresh", path: "/account/orders" },
    { role: "fresh", path: "/account/invoices" },
    { role: "owner", path: "/admin", main: true },
    { role: "owner", path: "/admin/orders", main: true },
    { role: "owner", path: `/admin/orders/${ref(done)}`, main: true },
    { role: "owner", path: "/admin/orders?status=completed&q=zzzz" },
    { role: "owner", path: "/admin/catalog", main: true },
    { role: "owner", path: "/admin/catalog/categories/new" },
    { role: "owner", path: `/admin/catalog/categories/${SEED.category}` },
    { role: "owner", path: "/admin/catalog/products/new" },
    { role: "owner", path: `/admin/catalog/products/${SEED.product}` },
    {
      role: "owner",
      path: `/admin/catalog/products/${SEED.product}/variants/new`,
    },
    { role: "owner", path: `/admin/catalog/variants/${SEED.variant}` },
    { role: "owner", path: "/admin/customers", main: true },
    { role: "owner", path: `/admin/customers/${customer.id}` },
    { role: "owner", path: "/admin/kyc", main: true },
    { role: "owner", path: `/admin/kyc/${kyc.id}` },
    { role: "owner", path: "/admin/comments" },
    { role: "owner", path: "/admin/invoices", main: true },
    { role: "owner", path: `/admin/invoices/${invoice.invoice_number}` },
    { role: "owner", path: "/admin/messages", main: true },
    { role: "owner", path: "/admin/faqs" },
    { role: "owner", path: "/admin/settings", main: true },
    { role: "owner", path: "/admin/admins" },
    { role: "owner", path: "/admin/audit" },
  ];

  // Signed in first, then put in the state a Google sign-in leaves.
  const incompleteReady = async (browser: Browser) => {
    const ctx = await browser.newContext();
    await signInCookies(ctx, incomplete.phone, incomplete.password);
    const cookies = await ctx.cookies();
    await ctx.close();
    sql(`update auth.users set phone = null, phone_confirmed_at = null,
           raw_app_meta_data = '{"provider":"google","providers":["google"]}' where id = '${incomplete.id}'`);
    return cookies;
  };

  return { pages, users, incompleteReady };
}

export type Site = Awaited<ReturnType<typeof buildSite>>;

/** A phone-sized browser (360 px wide) signed in as `role`. */
export async function roleContext(
  browser: Browser,
  site: Site,
  role: Role,
  theme: "light" | "dark",
  incompleteCookies: Awaited<ReturnType<Site["incompleteReady"]>>,
) {
  const ctx = await browser.newContext({
    ...devices["Pixel 7"],
    viewport: { width: 360, height: 780 },
    colorScheme: theme,
    baseURL: "http://localhost:3100",
  });
  if (role === "incomplete") await ctx.addCookies(incompleteCookies);
  else if (role !== "guest") {
    const u = site.users[role];
    await signInCookies(ctx, u.phone, u.password);
  }
  return ctx;
}
