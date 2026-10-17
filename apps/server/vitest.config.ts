import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["test/globalSetup.ts"],
    setupFiles: ["test/setup.ts"],
    testTimeout: 30_000,
    // The ADX tests need the Kusto emulator (`pnpm test:adx`, vitest.adx.config.ts), not the everyday run.
    exclude: [
      ...configDefaults.exclude,
      "**/*.adx.test.ts",
      "**/adx.conformance.test.ts",
      "test/adx.test.ts",
    ],
  },
});
