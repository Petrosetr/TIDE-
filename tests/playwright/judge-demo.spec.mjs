import { expect, test } from "@playwright/test";

const ROUTES = [
  {
    label: "Harbor",
    url: "/setup?judge=1",
    resultUrl: "/results?judge=1",
    resultPattern: /\/results\?judge=1$/,
    setupMarker: "Judge demo mode",
    readoutMarker: "Overflow Judge Harbor",
    frameMarker: "Harbor starter",
    guardMarker: "No guard fired",
    manualSubmit: true,
  },
  {
    label: "stress",
    url: "/setup?judge=stress",
    resultUrl: "/results?judge=stress",
    resultPattern: /\/results\?judge=stress$/,
    setupMarker: "Stress rehearsal",
    readoutMarker: "Overflow Judge Stress",
    frameMarker: "Crisis path",
    guardMarker: "EmergencyDeRisk",
  },
  {
    label: "revoke",
    url: "/setup?judge=revoke",
    resultUrl: "/results?judge=revoke",
    resultPattern: /\/results\?judge=revoke$/,
    setupMarker: "Revoked rail defence",
    readoutMarker: "Overflow Judge Revoked Rail",
    frameMarker: "Rail guard",
    guardMarker: "N2 · E_RAIL_NOT_ALLOWED",
  },
  {
    label: "oracle-stale",
    url: "/setup?judge=oracle-stale",
    resultUrl: "/results?judge=oracle-stale",
    resultPattern: /\/results\?judge=oracle-stale$/,
    setupMarker: "Oracle confidence rehearsal",
    readoutMarker: "Overflow Judge Oracle Stale",
    frameMarker: "Oracle guard",
    guardMarker: "stale-forecast · Forecast is stale",
  },
];

function actionableBrowserErrors(messages) {
  return messages.filter((message) => {
    if (/Transition was skipped/i.test(message)) return false;
    if (/extension has not been configured/i.test(message)) return false;
    return true;
  });
}

async function expectAnyVisible(candidates) {
  await expect.poll(async () => {
    for (const locator of candidates) {
      if (await locator.first().isVisible().catch(() => false)) {
        return true;
      }
    }
    return false;
  }, {
    message: "expected one judge receipt path CTA to be visible",
  }).toBe(true);
}

test.describe("judge demo golden flow", () => {
  for (const route of ROUTES) {
    test(`runs ${route.label} judge route through Readout`, async ({ page }) => {
      const browserErrors = [];
      page.on("pageerror", (error) => {
        browserErrors.push(error.message);
      });

      await page.goto(route.url, { waitUntil: "domcontentloaded" });
      await expect(page.locator("body")).toHaveAttribute("data-page", "setup");
      await expect(page.getByText(route.setupMarker)).toBeVisible();
      await expect(page.getByText("Polymarket")).toBeVisible();
      await expect(page.getByText("Kalshi")).toBeVisible();

      if (route.manualSubmit) {
        await page.getByRole("button", { name: /Run rehearsal|Run simulation/i }).click();
      }

      await page.waitForURL(route.resultPattern, { timeout: 15_000 });

      await expect(page.locator("body")).toHaveAttribute("data-page", "results");
      await expect(page.getByRole("heading", { name: /Readout|Autopilot|Live policy readout/i })).toBeVisible();
      await expect(page.getByText(route.readoutMarker).first()).toBeVisible();
      await expect(page.getByText(route.frameMarker).first()).toBeVisible();
      await expect(page.getByText(route.guardMarker).first()).toBeVisible();
      await expect(page.getByText(/Policy verdict|Decision engine|Ready to save|Run this draft again/i).first()).toBeVisible();
      await expectAnyVisible([
        page.getByRole("button", { name: /Mint receipt/i }),
        page.getByRole("button", { name: /Connect Wallet/i }),
        page.getByRole("link", { name: /Verify latest receipt/i }),
        page.getByText(/Refresh rail data in Create|Verified market data required|Open testnet proof|Arm Testnet proof/i),
      ]);

      expect(actionableBrowserErrors(browserErrors)).toEqual([]);
    });

    test(`hydrates direct ${route.label} judge Readout`, async ({ page }) => {
      const browserErrors = [];
      page.on("pageerror", (error) => {
        browserErrors.push(error.message);
      });

      await page.goto(route.resultUrl, { waitUntil: "domcontentloaded" });

      await expect(page.locator("body")).toHaveAttribute("data-page", "results");
      await expect(page.getByText(route.readoutMarker).first()).toBeVisible();
      await expect(page.getByText(route.frameMarker).first()).toBeVisible();
      await expect(page.getByText(route.guardMarker).first()).toBeVisible();
      expect(actionableBrowserErrors(browserErrors)).toEqual([]);
    });
  }

  test("hydrates direct oracle-stale Readout with the stale forecast guard", async ({ page }) => {
    const browserErrors = [];
    page.on("pageerror", (error) => {
      browserErrors.push(error.message);
    });

    await page.goto("/results?judge=oracle-stale", { waitUntil: "domcontentloaded" });

    await expect(page.locator("body")).toHaveAttribute("data-page", "results");
    await expect(page.getByText("Overflow Judge Oracle Stale").first()).toBeVisible();
    await expect(page.getByText("Oracle guard").first()).toBeVisible();
    await expect(page.getByText("stale-forecast · Forecast is stale").first()).toBeVisible();
    expect(actionableBrowserErrors(browserErrors)).toEqual([]);
  });

  test("connects first screen simulation to the testnet receipt verifier", async ({ page }) => {
    const browserErrors = [];
    page.on("pageerror", (error) => {
      browserErrors.push(error.message);
    });

    await page.goto("/setup?judge=1", { waitUntil: "domcontentloaded" });
    await expect(page.locator('body[data-page="setup"][data-app-ready="true"]')).toHaveCount(1);
    await expect(page.getByText("Judge demo mode")).toBeVisible();

    await page.getByRole("button", { name: /Run rehearsal|Run simulation/i }).click();
    await page.waitForURL(/\/results\?judge=1$/, { timeout: 15_000 });

    await expect(page.locator("body")).toHaveAttribute("data-page", "results");
    await expect(page.getByText("Overflow Judge Harbor").first()).toBeVisible();

    const receiptId = await page.evaluate(() => window.TIDE_CONFIG?.proof?.receiptMint?.objectId || "");
    expect(receiptId).toMatch(/^0x[0-9a-fA-F]{64}$/);

    const link = page.getByRole("link", { name: /Verify latest receipt/i });
    await expect(link).toBeVisible({ timeout: 10_000 });
    await expect(link).toHaveAttribute("href", `/r/${receiptId}`);
    expect(actionableBrowserErrors(browserErrors)).toEqual([]);
  });

  test("direct Readout exposes latest testnet receipt verifier when proof summary is configured", async ({ page }) => {
    await page.goto("/results?judge=1", { waitUntil: "domcontentloaded" });

    const receiptId = await page.evaluate(() => window.TIDE_CONFIG?.proof?.receiptMint?.objectId || "");
    expect(receiptId).toMatch(/^0x[0-9a-fA-F]{64}$/);

    const link = page.getByRole("link", { name: /Verify latest receipt/i });
    await expect(link).toBeVisible({ timeout: 10_000 });
    await expect(link).toHaveAttribute("href", `/r/${receiptId}`);
  });
});
