import { devices, expect, test } from "@playwright/test";

import {
  completeOrderWithInvoice,
  createOrder,
  createUser,
  signInCookies,
  sql,
} from "./helpers";

// Every customer page outside the storefront starts with a "back to store"
// link (2026-11-20). Its arrow sits on the reading-start side and points that
// way (left in English, right in Arabic), and on a phone it scrolls with the
// page, clear of the fixed bottom bar. Storefront pages do not have it.

test("back to store: on every customer page, arrow toward the reading start, clear of the bottom bar", async ({
  browser,
}) => {
  const customer = await createUser();
  const awaiting = await createOrder(customer.id);
  const done = await createOrder(customer.id);
  const { invoice } = await completeOrderWithInvoice(done);
  // A cart line, so /checkout renders instead of redirecting to the cart.
  sql(`insert into cart_items (user_id, variant_id, quantity, fulfillment_data)
         values ('${customer.id}', '00000000-0000-4000-c000-000000000001', 1, '{"player_id":"123456"}')`);
  const ref = sql(`select reference from orders where id = '${awaiting.id}'`);
  const pages = [
    "/account",
    "/account/orders",
    `/account/orders/${ref}`,
    "/account/invoices",
    `/account/invoices/${invoice.invoice_number}`,
    "/account/kyc",
    "/cart",
    "/checkout",
  ];

  for (const locale of ["ar", "en"] as const) {
    const ctx = await browser.newContext({
      ...devices["Pixel 7"],
      viewport: { width: 360, height: 780 },
      baseURL: "http://localhost:3100",
    });
    await signInCookies(ctx, customer.phone, customer.password);
    const page = await ctx.newPage();
    for (const path of pages) {
      await page.goto(`/${locale}${path}`);
      const link = page.getByTestId("back-to-store");
      await expect(link, path).toBeVisible();
      await expect(link).toHaveAttribute("href", `/${locale}`);
      await expect(link).toHaveText(
        locale === "ar" ? "العودة إلى المتجر" : "Back to store",
      );
      const geometry = await link.evaluate((el) => {
        const arrow = el.querySelector("svg")!.getBoundingClientRect();
        const box = el.getBoundingClientRect();
        const bar = document
          .querySelector("[data-testid=bottom-nav]")!
          .getBoundingClientRect();
        return {
          arrowCenter: arrow.x + arrow.width / 2,
          linkCenter: box.x + box.width / 2,
          rotate: getComputedStyle(el.querySelector("svg")!).rotate,
          linkBottom: box.bottom,
          barTop: bar.top,
        };
      });
      // The drawn arrow points left; Arabic turns it half a turn.
      if (locale === "ar") {
        expect(geometry.arrowCenter, path).toBeGreaterThan(geometry.linkCenter);
        expect(geometry.rotate, path).toBe("180deg");
      } else {
        expect(geometry.arrowCenter, path).toBeLessThan(geometry.linkCenter);
        expect(geometry.rotate, path).toBe("none");
      }
      expect(geometry.linkBottom, path).toBeLessThan(geometry.barTop);
    }
    console.log(
      `[demo] back to store (${locale}): ${pages.length} pages, arrow ${locale === "ar" ? "right, pointing right" : "left, pointing left"}, above the bottom bar`,
    );

    // The storefront itself has no such link.
    for (const path of ["", "/categories", "/p/pubg-uc"]) {
      await page.goto(`/${locale}${path}`);
      await expect(page.getByTestId("back-to-store"), path).toHaveCount(0);
    }
    await ctx.close();
  }
});
