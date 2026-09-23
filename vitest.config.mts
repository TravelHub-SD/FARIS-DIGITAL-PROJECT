import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Tests share one local database; run files sequentially for clear output.
    fileParallelism: false,
  },
});
