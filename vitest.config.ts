import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    clearMocks: true,
    include: ["apps/**/*.test.{ts,tsx}", "packages/**/*.test.{ts,tsx}", "tooling/**/*.test.ts"],
    passWithNoTests: false,
    restoreMocks: true,
    setupFiles: ["./vitest.setup.ts"],
  },
});
