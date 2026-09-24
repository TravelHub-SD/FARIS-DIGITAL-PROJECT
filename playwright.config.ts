import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against `next dev` on the LOCAL Supabase stack, with the
// WhatsApp dev driver. The dev server's console output is the "WhatsApp
// inbox": tests read OTP codes from .e2e/dev.log. Never run against a
// deployed environment (the dev driver cannot run there anyway).
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
  webServer: {
    command: "mkdir -p .e2e && exec npx next dev -p 3100 > .e2e/dev.log 2>&1",
    url: "http://localhost:3100/ar",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
