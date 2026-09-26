import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { createFixtures, type Fixtures } from "../integration/catalog-fixtures";

let fx: Fixtures;
test.beforeAll(async () => {
  fx = await createFixtures(`e2e${randomUUID().slice(0, 6)}`);
});

test("hidden, inactive and archived items are unreachable by direct URL, search and sitemap", async ({
  request,
}) => {
  const hidden = [
    `/c/${fx.slugs.hiddenCat}`,
    `/p/${fx.slugs.inHiddenCat}`,
    `/p/${fx.slugs.inactive}`,
    `/p/${fx.slugs.archived}`,
    `/p/${fx.slugs.noVariants}`,
  ];
  for (const locale of ["ar", "en"]) {
    for (const path of hidden) {
      const res = await request.get(`/${locale}${path}`);
      console.log(`[demo] GET /${locale}${path} -> ${res.status()}`);
      expect(res.status(), path).toBe(404);
    }
  }

  const page = await request.get(`/en/p/${fx.slugs.ok}`);
  expect(page.status()).toBe(200);
  const html = await page.text();
  expect(html).toContain(fx.ids.okVariant);
  for (const secret of [
    fx.ids.hiddenVariant,
    fx.ids.archivedVariant,
    `hidden-variant-${fx.t}`,
    `archived-variant-${fx.t}`,
  ]) {
    expect(html, secret).not.toContain(secret);
  }

  for (const slug of [
    fx.slugs.inHiddenCat,
    fx.slugs.inactive,
    fx.slugs.archived,
  ]) {
    const search = await request.get(
      `/en/search?q=${encodeURIComponent(`Product ${slug}`)}`,
    );
    expect(await search.text(), slug).toContain(
      "No products match your search.",
    );
  }

  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain(`/p/${fx.slugs.ok}`);
  for (const slug of [
    fx.slugs.hiddenCat,
    fx.slugs.inHiddenCat,
    fx.slugs.inactive,
    fx.slugs.archived,
    fx.slugs.noVariants,
  ]) {
    expect(sitemap, slug).not.toContain(slug);
  }
});

test.describe("forged order-details submissions are rejected by the server", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/en/p/${fx.slugs.ok}`);
    await expect(page.getByTestId("order-details-form")).toBeVisible();
    // Disable every browser-side check: from here on only the server decides.
    await page.evaluate(() => {
      const form = document.querySelector(
        "form[data-testid=order-details-form]",
      ) as HTMLFormElement;
      form.noValidate = true;
      form
        .querySelectorAll("[required],[minlength],[maxlength]")
        .forEach((el) => {
          el.removeAttribute("required");
          el.removeAttribute("minlength");
          el.removeAttribute("maxlength");
        });
    });
  });
  const submit = (page: import("@playwright/test").Page) =>
    page.getByRole("button", { name: "Place order" }).click();
  const fieldError = (page: import("@playwright/test").Page, key: string) =>
    page.locator(`[data-field-error="${key}"]`);

  test("missing required fields", async ({ page }) => {
    await submit(page);
    await expect(fieldError(page, "player_id")).toHaveText(
      "This field is required.",
    );
    await expect(fieldError(page, "server")).toHaveText(
      "This field is required.",
    );
    await expect(page.getByTestId("order-error")).toHaveCount(0);
  });

  test("an extra field injected into the form", async ({ page }) => {
    await page.fill("#f-player_id", "123456");
    await page.selectOption("#f-server", "mena");
    await page.evaluate(() => {
      const input = document.createElement("input");
      Object.assign(input, {
        type: "hidden",
        name: "f.evil",
        value: "<script>",
      });
      document
        .querySelector("form[data-testid=order-details-form]")!
        .appendChild(input);
    });
    await submit(page);
    await expect(page.locator("[data-tone=error]")).toHaveText(
      "Unexpected field.",
    );
    await expect(page.getByTestId("order-error")).toHaveCount(0);
  });

  test("wrong-typed values: letters in a digits field, an option that does not exist", async ({
    page,
  }) => {
    await page.fill("#f-player_id", "12a456");
    await page.evaluate(() => {
      const select = document.querySelector("#f-server") as HTMLSelectElement;
      select.options[1].value = "asia"; // forge a value outside the declared options
      select.selectedIndex = 1;
    });
    await submit(page);
    await expect(fieldError(page, "player_id")).toHaveText("Invalid format.");
    await expect(fieldError(page, "server")).toHaveText(
      "Choose one of the options.",
    );
  });

  test("a hidden variant id forged into the radio", async ({ page }) => {
    await page.fill("#f-player_id", "123456");
    await page.selectOption("#f-server", "mena");
    await page.evaluate((id) => {
      (
        document.querySelector("input[name=variantId]") as HTMLInputElement
      ).value = id;
    }, fx.ids.hiddenVariant);
    await submit(page);
    await expect(page.locator("[data-tone=error]")).toHaveText(
      "This option is no longer available.",
    );
  });

  test("control: a valid submission (Arabic-Indic digits) passes validation and only asks to sign in", async ({
    page,
  }) => {
    await page.fill("#f-player_id", "١٢٣٤٥٦");
    await page.selectOption("#f-server", "eu");
    await submit(page);
    await expect(page.getByTestId("order-error")).toHaveAttribute(
      "data-reason",
      "sign_in",
    );
    await expect(page.locator("[data-field-error]:not(:empty)")).toHaveCount(0);
  });
});

test("Arabic and English render correctly, with language fallback", async ({
  page,
}) => {
  // English site, Arabic-only product: content falls back to Arabic, marked rtl.
  await page.goto("/en/p/zain-airtime");
  expect(await page.getAttribute("html", "lang")).toBe("en");
  expect(await page.getAttribute("html", "dir")).toBe("ltr");
  const h1 = page.locator("h1");
  await expect(h1).toHaveText("رصيد زين");
  expect(await h1.getAttribute("lang")).toBe("ar");
  expect(await h1.getAttribute("dir")).toBe("rtl");
  await expect(
    page.getByText("Details needed to fulfil your order"),
  ).toBeVisible(); // UI stays English
  await page.screenshot({
    path: ".e2e/fallback-en-page-ar-content.png",
    fullPage: true,
  });

  // Arabic site, English-only product: falls back to English, marked ltr.
  await page.goto("/ar/p/netflix-gift");
  expect(await page.getAttribute("html", "dir")).toBe("rtl");
  await expect(page.locator("h1")).toHaveText("Netflix gift card");
  expect(await page.locator("h1").getAttribute("lang")).toBe("en");
  expect(await page.locator("h1").getAttribute("dir")).toBe("ltr");
  await expect(page.getByText("البيانات المطلوبة لتنفيذ طلبك")).toBeVisible();
  await page.screenshot({
    path: ".e2e/fallback-ar-page-en-content.png",
    fullPage: true,
  });

  // Both languages present: no fallback marker.
  await page.goto("/ar/p/pubg-uc");
  await expect(page.locator("h1")).toHaveText("شدات ببجي");
  expect(await page.locator("h1").getAttribute("lang")).toBeNull();
  await page.screenshot({ path: ".e2e/product-ar.png", fullPage: true });
  await page.goto("/en/p/pubg-uc");
  await expect(page.locator("h1")).toHaveText("PUBG UC");
  await page.screenshot({ path: ".e2e/product-en.png", fullPage: true });
});

test("SEO basics: canonical, hreflang, Open Graph, JSON-LD with SDG price", async ({
  request,
}) => {
  const html = await (await request.get("/ar/p/pubg-uc")).text();
  expect(html).toMatch(/<link rel="canonical" href="[^"]*\/ar\/p\/pubg-uc"/);
  expect(html).toMatch(/hrefLang="en" href="[^"]*\/en\/p\/pubg-uc"/);
  expect(html).toMatch(/hrefLang="x-default" href="[^"]*\/ar\/p\/pubg-uc"/);
  expect(html).toMatch(/<meta property="og:title" content="شدات ببجي"/);
  const ld = JSON.parse(
    html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)![1],
  );
  console.log(`[demo] JSON-LD offers: ${JSON.stringify(ld[0].offers)}`);
  expect(ld[0]).toMatchObject({
    "@type": "Product",
    name: "شدات ببجي",
    offers: { priceCurrency: "SDG", lowPrice: 2860 },
  });
  // robots.txt: closed outside production (seo.spec.ts); the production rules
  // are unit-tested (tests/unit/seo.test.ts).
});
