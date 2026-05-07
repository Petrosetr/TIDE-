import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "dist/**",
      "playwright-report/**",
      "test-results/**",
      "tests/playwright/**",
    ],
    testTimeout: 10_000,
  },
});
