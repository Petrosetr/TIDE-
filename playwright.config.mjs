import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/playwright",
  timeout: 45_000,
  expect: {
    timeout: 8_000,
  },
  fullyParallel: false,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:4177",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
      command: "npm run build:public-alpha:configured && npm run serve:public-alpha -- 4177",
      env: {
        ...process.env,
        TIDE_SUI_NETWORK: process.env.TIDE_SUI_NETWORK || "testnet",
      },
      url: "http://127.0.0.1:4177/healthz",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
});
