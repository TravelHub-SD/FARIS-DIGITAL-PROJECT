import { devices, expect, type Page, test } from "@playwright/test";

// Promo slider autoplay (client feedback round 1): every 5 s, held while
// touched/hovered/focused, a pause/play button, none with reduced motion,
// swipe still works. The seed has two slides. Time is the page's fake clock
// (paused, advanced with runFor), so "no change for 15 s" is exact.

const PHONE = {
  ...devices["Pixel 7"],
  viewport: { width: 360, height: 780 },
  baseURL: "http://localhost:3100",
};

/** Index of the slide whose start edge sits at the track's snap line. */
const current = (page: Page) =>
  page.locator("[data-slider-track]").evaluate((track) => {
    const box = track.getBoundingClientRect();
    const rtl = getComputedStyle(track).direction === "rtl";
    const pad =
      parseFloat(getComputedStyle(track).scrollPaddingInlineStart) || 0;
    const slides = [...track.children].map((el) => {
      const r = el.getBoundingClientRect();
      return Math.abs(
        rtl ? r.right - (box.right - pad) : r.left - (box.left + pad),
      );
    });
    return slides.indexOf(Math.min(...slides));
  });

/** Waits until the (smooth) scroll has stopped, in real time. */
async function settle(page: Page) {
  const left = () =>
    page.locator("[data-slider-track]").evaluate((t) => t.scrollLeft);
  await expect
    .poll(async () => {
      const a = await left();
      await page.waitForTimeout(200);
      return a === (await left());
    })
    .toBe(true);
}

async function open(page: Page, path: string) {
  await page.clock.install();
  await page.goto(path);
  await expect(page.getByTestId("slider-toggle")).toBeVisible(); // hydrated
  await page.clock.pauseAt(Date.now() + 1000);
  expect(await current(page)).toBe(0);
}

for (const locale of ["ar", "en"] as const) {
  test(`slider autoplay (${locale}): every 5 s, held on focus, pause/play button`, async ({
    browser,
  }) => {
    const ctx = await browser.newContext(PHONE);
    const page = await ctx.newPage();
    await open(page, `/${locale}`);
    const toggle = page.getByTestId("slider-toggle");
    const pause = locale === "ar" ? "إيقاف تقليب العروض" : "Pause the slides";
    const play = locale === "ar" ? "تشغيل تقليب العروض" : "Play the slides";
    await expect(toggle).toHaveAttribute("aria-label", pause);

    // However many slides there are (other tests add some): one step every
    // 5 s, to the last and back to the first.
    const n = await page.locator("[data-slider-track] > li").count();
    expect(n).toBeGreaterThanOrEqual(2);
    const step = async (to: number, label?: string) => {
      await expect.poll(() => current(page), label).toBe(to);
      await settle(page);
    };
    await page.clock.runFor(4000);
    expect(await current(page), "not before 5 s").toBe(0);
    await page.clock.runFor(1500);
    await step(1);
    for (let i = 2; i <= n; i++) {
      await page.clock.runFor(5500);
      await step(i % n, i === n ? "wraps to the first" : undefined);
    }

    // Focus (keyboard) holds it; leaving starts the 5 s again.
    await page.locator("[data-slider-track]").focus();
    await page.clock.runFor(15_000);
    expect(await current(page), "held while focused").toBe(0);
    await toggle.focus();
    await page.clock.runFor(5500);
    await step(1);

    // The button pauses until Play.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-label", play);
    await page.clock.runFor(20_000);
    expect(await current(page), "paused by the button").toBe(1);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-label", pause);
    await page.clock.runFor(5500);
    await step(2 % n);

    // A swipe still moves it (CSS scroll-snap): towards the end, or back
    // from the last slide.
    const from = await current(page);
    const forward = from < n - 1;
    await page.locator("[data-slider-track]").evaluate((t, fwd) => {
      const rtl = getComputedStyle(t).direction === "rtl";
      t.scrollBy({ left: (fwd ? 300 : -300) * (rtl ? -1 : 1) });
    }, forward);
    await step(forward ? from + 1 : from - 1, "swiped");
    await ctx.close();
  });
}

test("slider autoplay: none with prefers-reduced-motion; Play still offered", async ({
  browser,
}) => {
  const ctx = await browser.newContext({ ...PHONE, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await open(page, "/en");
  const toggle = page.getByTestId("slider-toggle");
  await expect(toggle).toHaveAttribute("aria-label", "Play the slides");
  await page.clock.runFor(20_000);
  expect(await current(page), "no autoplay").toBe(0);
  await toggle.click(); // an explicit choice
  await page.clock.runFor(5500);
  await expect.poll(() => current(page)).toBe(1);
  await settle(page);
  await ctx.close();
  console.log(
    "[demo] slider: 5 s steps (ar, en), held on focus, paused by the button, none with reduced motion",
  );
});
