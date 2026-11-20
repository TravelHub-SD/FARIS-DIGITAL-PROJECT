import { devices, expect, type Page, test } from "@playwright/test";

import { createUser, localNumber, signInCookies, sql } from "./helpers";

// The sign-in screens fill a phone's width, so on phones the WhatsApp button
// is not floating there: it sits under the card and never covers the card,
// a field or a button, wherever the page is scrolled (2026-11-20). Elsewhere,
// and on wide screens where the card leaves room, it still floats.

const PHONE = {
  ...devices["Pixel 7"],
  viewport: { width: 360, height: 780 },
  baseURL: "http://localhost:3100",
};

/** Every visible WhatsApp control vs the card and every control, at the top,
 *  middle and bottom of the page. Returns the overlaps found. */
async function overlaps(page: Page) {
  const found: string[] = [];
  const max = await page.evaluate(
    () => document.documentElement.scrollHeight - innerHeight,
  );
  for (const y of [0, Math.round(max / 2), max]) {
    await page.evaluate((top) => scrollTo(0, top), y);
    found.push(
      ...(await page.evaluate((top) => {
        const visible = (el: Element) => {
          const r = el.getBoundingClientRect();
          return (
            r.width > 0 &&
            r.height > 0 &&
            getComputedStyle(el).visibility !== "hidden"
          );
        };
        const chats = [
          ...document.querySelectorAll(
            "[data-testid=whatsapp-button], [data-testid=whatsapp-inline]",
          ),
        ].filter(visible);
        const targets = [
          ...document.querySelectorAll(
            "[data-auth-shell] section, [data-auth-shell] button, [data-auth-shell] input, [data-auth-shell] a",
          ),
        ].filter((el) => visible(el) && !el.closest("[data-testid^=whatsapp]"));
        const out: string[] = [];
        for (const c of chats) {
          const a = c.getBoundingClientRect();
          for (const t of targets) {
            const b = t.getBoundingClientRect();
            if (
              a.left < b.right &&
              b.left < a.right &&
              a.top < b.bottom &&
              b.top < a.bottom
            )
              out.push(
                `scroll ${top}: ${c.getAttribute("data-testid")} over <${t.tagName.toLowerCase()}> "${(t.textContent ?? "").trim().slice(0, 30)}"`,
              );
          }
        }
        return out;
      }, y)),
    );
  }
  return found;
}

async function checkPhone(page: Page, label: string) {
  await expect(page.locator("[data-auth-shell]"), label).toBeVisible();
  await expect(page.getByTestId("whatsapp-button"), label).toBeHidden();
  const inline = page.getByTestId("whatsapp-inline");
  await expect(inline, label).toBeVisible();
  await expect(inline).toHaveAttribute("href", /^https:\/\/wa\.me\/\d+$/);
  const card = await page.locator("[data-auth-shell] section").boundingBox();
  const chat = await inline.boundingBox();
  expect(chat!.y, label).toBeGreaterThanOrEqual(card!.y + card!.height);
  expect(await overlaps(page), label).toEqual([]);
}

test("sign-in screens on a phone: the WhatsApp button never covers the card, a field or a button", async ({
  browser,
}) => {
  const checked: string[] = [];
  const guest = await browser.newContext(PHONE);
  const page = await guest.newPage();
  for (const path of [
    "/ar/login",
    "/en/login",
    "/ar/register",
    "/en/reset-password",
  ]) {
    await page.goto(path);
    await checkPhone(page, path);
    checked.push(path);
  }
  // Register, step 2: the tallest card (code, name, password, two links).
  await page.goto("/ar/register");
  await page.fill("#phone", localNumber());
  await page.getByRole("button", { name: "إرسال الرمز" }).click();
  await expect(page.locator("#code")).toBeVisible();
  await checkPhone(page, "/ar/register step 2");
  checked.push("/ar/register step 2");
  await guest.close();

  // Two-step sign-in: staff signed in with a password only.
  const staff = await createUser({
    admin: { permissions: ["orders"] },
    mfa: false,
  });
  const s = await browser.newContext(PHONE);
  await signInCookies(s, staff.phone, staff.password, { mfa: false });
  const sp = await s.newPage();
  await sp.goto("/ar/two-factor");
  await checkPhone(sp, "/ar/two-factor");
  checked.push("/ar/two-factor");
  await s.close();

  // Complete account: signed in, then left in the state a Google sign-in leaves.
  const half = await createUser();
  const c = await browser.newContext(PHONE);
  await signInCookies(c, half.phone, half.password);
  sql(`update auth.users set phone = null, phone_confirmed_at = null,
         raw_app_meta_data = '{"provider":"google","providers":["google"]}' where id = '${half.id}'`);
  const cp = await c.newPage();
  await cp.goto("/en/complete-account");
  await checkPhone(cp, "/en/complete-account");
  checked.push("/en/complete-account");
  await c.close();

  // Unchanged elsewhere: the storefront keeps the floating button on phones,
  // and wide screens keep it floating beside the card.
  const shop = await browser.newContext(PHONE);
  const shopPage = await shop.newPage();
  await shopPage.goto("/ar");
  await expect(shopPage.getByTestId("whatsapp-button")).toBeVisible();
  await expect(shopPage.getByTestId("whatsapp-inline")).toHaveCount(0);
  await shop.close();
  const wide = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    baseURL: "http://localhost:3100",
  });
  const widePage = await wide.newPage();
  await widePage.goto("/en/login");
  await expect(widePage.getByTestId("whatsapp-button")).toBeVisible();
  await expect(widePage.getByTestId("whatsapp-inline")).toBeHidden();
  expect(await overlaps(widePage)).toEqual([]);
  await wide.close();

  console.log(
    `[demo] WhatsApp on sign-in screens at 360 px: under the card, no overlap at top/middle/bottom on ${checked.length} screens (${checked.join(", ")}); floating on the storefront and on wide screens`,
  );
});
