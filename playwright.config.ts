import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against `next dev` on the LOCAL Supabase stack. The app
// runs its REAL Meta WhatsApp driver against a fake Graph API
// (tests/fakes/meta-graph.mjs); tests read delivered messages (OTP codes)
// from the fake's inbox. Never run against a deployed environment.
// Test-only credentials shared with the fake.
export const E2E_WHATSAPP = {
  WHATSAPP_DRIVER: "meta",
  WHATSAPP_API_BASE_URL: "http://127.0.0.1:3199",
  WHATSAPP_API_VERSION: "v23.0",
  WHATSAPP_ACCESS_TOKEN: "e2e-fake-access-token-0000000000",
  WHATSAPP_PHONE_NUMBER_ID: "100000000000001",
  WHATSAPP_APP_SECRET: "e2e-app-secret-0123456789abcdef",
  WHATSAPP_VERIFY_TOKEN: "e2e-verify-token-0123456789abcdef",
  WHATSAPP_DISPATCH_SECRET: "e2e-dispatch-secret-0123456789abcdef0123",
  WHATSAPP_API_TIMEOUT_MS: "2000",
};

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3100",
    ...devices["Pixel 7"],
    locale: "ar-SD",
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: [
    {
      // Fake Meta Graph API (tests/fakes): the app's REAL Meta driver talks
      // to it, and tests read delivered messages (OTP codes) from its inbox.
      command: "exec node tests/fakes/meta-graph.mjs > .e2e/fake-meta.log 2>&1",
      url: "http://127.0.0.1:3199/__health",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      // E2E_SERVER=prod runs the same suite on `next start` (run `next build`
      // first): the mode that is deployed, with no dev-only CSP allowances.
      // The suite writes catalog rows with SQL and reads them back, so the
      // shared catalog cache is off here; catalog-cache.spec.ts checks the
      // cache itself against the second server below.
      command:
        process.env.E2E_SERVER === "prod"
          ? "mkdir -p .e2e && exec npx next start -p 3100 > .e2e/prod.log 2>&1"
          : "mkdir -p .e2e && exec npx next dev -p 3100 > .e2e/dev.log 2>&1",
      url: "http://localhost:3100/ar",
      reuseExistingServer: false,
      timeout: 120_000,
      // Real process env wins over .env.local (WHATSAPP_DRIVER=dev there).
      env:
        process.env.E2E_SERVER === "prod"
          ? { ...E2E_WHATSAPP, CATALOG_CACHE: "off" }
          : E2E_WHATSAPP,
    },
    // Production mode only: the same build with the catalog cache on.
    ...(process.env.E2E_SERVER === "prod"
      ? [
          {
            command: "exec npx next start -p 3101 > .e2e/prod-cache.log 2>&1",
            url: "http://localhost:3101/ar",
            reuseExistingServer: false,
            timeout: 120_000,
            env: E2E_WHATSAPP,
          },
        ]
      : []),
  ],
});
