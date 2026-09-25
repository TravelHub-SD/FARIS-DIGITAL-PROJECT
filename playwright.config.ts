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
      command: "mkdir -p .e2e && exec npx next dev -p 3100 > .e2e/dev.log 2>&1",
      url: "http://localhost:3100/ar",
      reuseExistingServer: false,
      timeout: 120_000,
      // Real process env wins over .env.local (WHATSAPP_DRIVER=dev there).
      env: E2E_WHATSAPP,
    },
  ],
});
