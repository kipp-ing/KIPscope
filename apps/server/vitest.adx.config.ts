import { defineConfig } from "vitest/config";

/** The tests that need the Kusto emulator (`docker compose --profile adx up -d`, `seed:adx`). */
export default defineConfig({
  test: {
    globalSetup: ["test/adxGlobalSetup.ts"],
    setupFiles: ["test/setup.ts"],
    include: ["test/**/*.adx.test.ts", "test/**/adx.conformance.test.ts", "test/adx.test.ts"],
    testTimeout: 60_000,
  },
});
