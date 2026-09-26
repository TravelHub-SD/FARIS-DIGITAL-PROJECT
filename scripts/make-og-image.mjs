// Renders public/og.png (1200×630), the link-preview image used when a page
// has no image of its own. Uses the site's own font and colours, rendered by
// Chromium so Arabic is shaped correctly. Re-run after a brand change:
//   next build && next start -p 3200   (then)   node scripts/make-og-image.mjs
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3200";
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(`${base}/ar`); // loads the site's CSS and self-hosted font
await page.evaluate(() => {
  document.documentElement.classList.remove("dark");
  document.body.innerHTML = `
    <div style="position:fixed;inset:0;background:#005CFF;color:#fff;display:flex;flex-direction:column;justify-content:center;gap:28px;padding:0 96px" dir="rtl">
      <div style="display:flex;align-items:center;gap:28px">
        <svg width="112" height="112" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#fff"/><path d="M22 16h22v8H31v6h11v8H31v10h-9z" fill="#005CFF"/><circle cx="46" cy="44" r="5" fill="#FF7A00"/></svg>
        <div style="font-size:96px;font-weight:700;line-height:1.1">فارس ديجيتال</div>
      </div>
      <div style="font-size:44px;line-height:1.4;opacity:.95">منتجات وخدمات رقمية، بسهولة وأمان</div>
      <div style="display:flex;align-items:center;gap:20px;font-size:34px" dir="ltr">
        <span style="display:inline-block;width:72px;height:10px;border-radius:5px;background:#FF7A00"></span>
        <span style="font-weight:700">Faris Digital</span>
      </div>
    </div>`;
});
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: "public/og.png" });
await browser.close();
console.log("public/og.png written");
