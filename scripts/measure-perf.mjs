// Mobile page-load numbers under a throttled network, like Lighthouse's
// mobile profile: Slow 4G (150 ms RTT, 1.6 Mbps down, 750 Kbps up) and a CPU
// 4× slower than this machine. Each page is loaded N times in a fresh
// browser context (empty cache); the median of each metric is reported.
// Measure against `next build && next start`, never `next dev`.
//   node scripts/measure-perf.mjs http://localhost:3200 3 /ar /ar/p/pubg-uc /ar/login
import { chromium, devices } from "@playwright/test";

const [base, runsArg, ...paths] = process.argv.slice(2);
const runs = Number(runsArg) || 3;
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
});

async function once(path) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.addInitScript(() => {
    window.__lcp = 0;
    window.__cls = 0;
    window.__tbt = 0;
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__lcp = e.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries())
        if (!e.hadRecentInput) window.__cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries())
        window.__tbt += Math.max(0, e.duration - 50);
    }).observe({ type: "longtask", buffered: true });
  });
  const started = Date.now();
  await page.goto(new URL(path, base).toString(), { waitUntil: "load" });
  const loadMs = Date.now() - started;
  await page.waitForTimeout(3000); // let LCP settle and hydration finish
  const m = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    // Resource Timing: files requested before the load event are the page's
    // own cost; later ones are Next prefetching linked pages in the background.
    const kb = (list) => list.reduce((n, r) => n + r.transferSize, 0) / 1024;
    const res = performance.getEntriesByType("resource");
    const own = res.filter((r) => r.startTime <= nav.loadEventEnd);
    return {
      kb: kb([nav, ...own]),
      jsKb: kb(own.filter((r) => r.initiatorType === "script")),
      bgKb: kb(res.filter((r) => r.startTime > nav.loadEventEnd)),
      ttfb: nav.responseStart,
      fcp: fcp?.startTime ?? NaN,
      lcp: window.__lcp,
      cls: window.__cls,
      tbt: window.__tbt,
    };
  });
  await ctx.close();
  return { ...m, load: loadMs };
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
console.log(
  `Slow 4G + 4× CPU, Pixel 7, ${runs} cold loads each, median\n` +
    "page                  TTFB    FCP     LCP     TBT   CLS    load   page bytes (JS)   background prefetch",
);
for (const path of paths) {
  const samples = [];
  for (let i = 0; i < runs; i++) samples.push(await once(path));
  const k = (key) => median(samples.map((s) => s[key]));
  const ms = (v) => `${Math.round(v)} ms`.padStart(7);
  console.log(
    `${path.padEnd(20)} ${ms(k("ttfb"))} ${ms(k("fcp"))} ${ms(k("lcp"))} ${ms(k("tbt"))} ${k("cls").toFixed(3).padStart(5)} ${ms(k("load"))}  ${`${Math.round(k("kb"))} KB (${Math.round(k("jsKb"))} KB)`.padEnd(16)}  ${Math.round(k("bgKb"))} KB`,
  );
}
await browser.close();
