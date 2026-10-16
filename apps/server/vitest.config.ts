import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["test/globalSetup.ts"],
    setupFiles: ["test/setup.ts"],
    testTimeout: 30_000,
  },
});
