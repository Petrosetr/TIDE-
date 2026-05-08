import { expect, test } from "@playwright/test";

const E2E_WALLET_ADDRESS = `0x${"2".repeat(64)}`;
const E2E_WALLET_NAME = "TIDE Setup ID Wallet";

async function installMockWallet(page) {
  await page.addInitScript(({ address, walletName }) => {
    const account = {
      address,
      chains: ["sui:testnet"],
      features: [
        "standard:connect",
        "standard:disconnect",
        "sui:signPersonalMessage",
      ],
    };
    const wallet = {
      version: "1.0.0",
      name: walletName,
      icon: "",
      chains: ["sui:testnet"],
      accounts: [account],
      features: {
        "standard:connect": {
          version: "1.0.0",
          connect: async () => ({ accounts: [account] }),
        },
        "standard:disconnect": {
          version: "1.0.0",
          disconnect: async () => {},
        },
        "sui:signPersonalMessage": {
          version: "2.0.0",
          signPersonalMessage: async () => ({ signature: "e2e-signature" }),
        },
      },
    };

    window.addEventListener("wallet-standard:app-ready", (event) => {
      event.detail?.register?.(wallet);
    });
    window.localStorage.setItem(
      "tide.shadow-mode.wallet.v1",
      JSON.stringify({ walletName, address }),
    );
  }, { address: E2E_WALLET_ADDRESS, walletName: E2E_WALLET_NAME });
}

function makeValidDraft(overrides = {}) {
  return {
    scenarioName: "Draft Promote",
    strategyPreset: "starter",
    createScope: "shadow",
    scenarioOrigin: "",
    mode: "Income",
    priority: "Stability",
    btcUnits: 0.5,
    collateralAssetSymbol: "wBTC",
    btcPriceUsd: 82500,
    debtUsd: 7500,
    stableAssetSymbol: "suiUSDT",
    stableBufferUsd: 4800,
    monthlyPayoutTargetUsd: 1200,
    desiredRunwayMonths: 4,
    minStableBufferUsd: 3600,
    maxLtvPct: 34,
    targetLtvLowPct: 18,
    targetLtvHighPct: 24,
    autoRepayLtvPct: 27,
    emergencyLtvPct: 31,
    maxSingleVenueExposurePct: 65,
    maxWrapperExposurePct: 78,
    venueExposurePct: 58,
    wrapperExposurePct: 63,
    allowPayoutPauseInStress: true,
    allowNewBorrowInStress: false,
    allowNewBorrowInCrisis: false,
    marketRealizedVolPct: 78,
    marketDailyMovePct: 2.8,
    marketWeeklyDrawdownPct: 6,
    marketTrendStrengthPct: 48,
    venueName: "Harbor Rail",
    oracleConfidencePct: 95,
    liquidityScorePct: 84,
    venueHealthScorePct: 88,
    minOracleConfidencePct: 90,
    minLiquidityScorePct: 78,
    venueHealthy: true,
    ...overrides,
  };
}

function encodeDraftHandoff(draft) {
  return Buffer.from(JSON.stringify({ v: 1, draft }), "utf8").toString("base64url");
}

test.describe("setup id routing", () => {
  test("opens a saved draft by id and saves rename edits in place", async ({ page }) => {
    await installMockWallet(page);
    await page.addInitScript(({ address }) => {
      window.localStorage.setItem(`tide.shadow-mode.drafts.v1:${address}`, JSON.stringify([{
        id: "draft-1",
        name: "Draft One",
        createdAt: "2026-05-01T12:00:00.000Z",
        draft: {
          scenarioName: "Draft One",
          btcUnits: 2,
          btcPriceUsd: 90000,
          debtUsd: 15000,
        },
      }]));
    }, { address: E2E_WALLET_ADDRESS });

    await page.goto("/setup?id=draft-1", { waitUntil: "domcontentloaded" });

    await expect.poll(async () => page.evaluate(() => (
      window.__tideDebug?.appState?.activeDraftId || ""
    ))).toBe("draft-1");
    await expect(page.locator("[data-header-name]")).toHaveValue("Draft One");

    await page.locator("[data-header-name]").fill("Renamed Draft One");
    await page.locator("#save-as-draft-footer").click();

    await expect(page).toHaveURL(/\/setup\?id=draft-1$/);
    await expect.poll(async () => page.evaluate((walletAddress) => {
      const drafts = JSON.parse(window.localStorage.getItem(`tide.shadow-mode.drafts.v1:${walletAddress}`) || "[]");
      return {
        count: drafts.length,
        id: drafts[0]?.id || "",
        name: drafts[0]?.name || "",
        draftName: drafts[0]?.draft?.scenarioName || "",
      };
    }, E2E_WALLET_ADDRESS)).toEqual({
      count: 1,
      id: "draft-1",
      name: "Renamed Draft One",
      draftName: "Renamed Draft One",
    });
  });

  test("promotes a saved draft into a simulation with the same position id", async ({ page }) => {
    await installMockWallet(page);
    await page.addInitScript(({ address, draft }) => {
      window.localStorage.setItem(`tide.shadow-mode.drafts.v1:${address}`, JSON.stringify([{
        id: "draft-promote",
        name: "Draft Promote",
        createdAt: "2026-05-01T12:00:00.000Z",
        draft,
      }]));
    }, { address: E2E_WALLET_ADDRESS, draft: makeValidDraft() });

    await page.goto("/setup?id=draft-promote", { waitUntil: "domcontentloaded" });
    await expect.poll(async () => page.evaluate(() => (
      window.__tideDebug?.wallet?.connected === true
    ))).toBe(true);
    await expect(page.locator("[data-header-name]")).toHaveValue("Draft Promote");

    await page.locator("#run-sim-toolbar").click();

    await expect(page).toHaveURL(/\/results\?id=draft-promote$/);
    await expect.poll(async () => page.evaluate((walletAddress) => {
      const drafts = JSON.parse(window.localStorage.getItem(`tide.shadow-mode.drafts.v1:${walletAddress}`) || "[]");
      const saved = JSON.parse(window.localStorage.getItem(`tide.shadow-mode.saved.v2:${walletAddress}`) || "[]");
      return {
        activeDraftId: window.__tideDebug?.appState?.activeDraftId || "",
        appDraftCount: window.__tideDebug?.appState?.drafts?.length ?? -1,
        appWalletAddress: window.__tideDebug?.wallet?.address || "",
        currentSourceScenarioId: window.__tideDebug?.appState?.current?.sourceScenarioId || "",
        draftCount: drafts.length,
        draftId: drafts[0]?.id || "",
        appDraftId: window.__tideDebug?.appState?.drafts?.[0]?.id || "",
        savedCount: saved.length,
        savedId: saved[0]?.id || "",
        savedName: saved[0]?.name || "",
        draftName: saved[0]?.draft?.scenarioName || "",
      };
    }, E2E_WALLET_ADDRESS)).toEqual({
      activeDraftId: "",
      appDraftCount: 0,
      appWalletAddress: E2E_WALLET_ADDRESS,
      currentSourceScenarioId: "draft-promote",
      draftCount: 0,
      draftId: "",
      appDraftId: "",
      savedCount: 1,
      savedId: "draft-promote",
      savedName: "Draft Promote",
      draftName: "Draft Promote",
    });
  });

  test("opens a saved run by id and reruns into the same id after rename", async ({ page }) => {
    await installMockWallet(page);
    await page.goto("/results?judge=1", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Overflow Judge Harbor").first()).toBeVisible();

    await expect.poll(async () => page.evaluate(() => (
      window.__tideDebug?.wallet?.connected === true
    ))).toBe(true);

    await page.evaluate(({ address }) => {
      const cloneJson = (value) => JSON.parse(JSON.stringify(value));
      const current = cloneJson(window.__tideDebug.appState.current);
      current.sourceScenarioId = "run-1";
      current.draft.scenarioName = "Run One";
      const saved = {
        id: "run-1",
        name: "Run One",
        createdAt: "2026-05-01T12:00:00.000Z",
        updatedAt: "2026-05-01T12:00:00.000Z",
        draft: cloneJson(current.draft),
        report: cloneJson(current.report),
        input: cloneJson(current.input),
        marketBand: cloneJson(current.marketBand),
        judge: cloneJson(current.judge),
        operatorReview: cloneJson(current.operatorReview),
      };
      window.localStorage.setItem(`tide.shadow-mode.saved.v2:${address}`, JSON.stringify([saved]));
      window.localStorage.setItem(`tide.shadow-mode.current.v6:${address}`, JSON.stringify(current));
    }, { address: E2E_WALLET_ADDRESS });

    await page.goto("/setup?id=run-1", { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-header-name]")).toHaveValue("Run One");

    await page.locator("[data-header-name]").fill("Renamed Run One");
    await page.locator("#run-sim-toolbar").click();

    await expect(page).toHaveURL(/\/results\?id=run-1$/);
    await expect.poll(async () => page.evaluate((walletAddress) => {
      const saved = JSON.parse(window.localStorage.getItem(`tide.shadow-mode.saved.v2:${walletAddress}`) || "[]");
      return {
        count: saved.length,
        id: saved[0]?.id || "",
        name: saved[0]?.name || "",
        draftName: saved[0]?.draft?.scenarioName || "",
      };
    }, E2E_WALLET_ADDRESS)).toEqual({
      count: 1,
      id: "run-1",
      name: "Renamed Run One",
      draftName: "Renamed Run One",
    });
  });

  test("opens a saved on-chain run in Create with policy and run id still bound", async ({ page }) => {
    await installMockWallet(page);
    await page.goto("/results?judge=1", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Overflow Judge Harbor").first()).toBeVisible();

    await expect.poll(async () => page.evaluate(() => (
      window.__tideDebug?.wallet?.connected === true
    ))).toBe(true);

    const seed = await page.evaluate(({ address }) => {
      const cloneJson = (value) => JSON.parse(JSON.stringify(value));
      const current = cloneJson(window.__tideDebug.appState.current);
      const policyId = `0x${"7".repeat(64)}`;
      current.sourceScenarioId = "saved-run-1";
      current.draft.scenarioName = "Saved Run One";
      current.draft.createScope = "live";
      current.onChainPolicy = {
        id: policyId,
        network: "testnet",
        policyName: "Saved Run One",
        selectedRail: "navi-sui",
        version: 2,
      };
      const saved = {
        id: current.sourceScenarioId,
        name: "Saved Run One",
        createdAt: "2026-05-01T12:45:00.000Z",
        updatedAt: "2026-05-01T12:45:00.000Z",
        draft: cloneJson(current.draft),
        report: cloneJson(current.report),
        input: cloneJson(current.input),
        marketBand: cloneJson(current.marketBand),
        judge: cloneJson(current.judge),
        operatorReview: cloneJson(current.operatorReview),
        onChainPolicy: cloneJson(current.onChainPolicy),
      };
      window.localStorage.setItem(`tide.shadow-mode.saved.v2:${address}`, JSON.stringify([saved]));
      window.localStorage.setItem(`tide.shadow-mode.current.v6:${address}`, JSON.stringify(current));
      return { policyId, runId: current.sourceScenarioId };
    }, { address: E2E_WALLET_ADDRESS });

    await page.goto(`/setup?policy=${encodeURIComponent(seed.policyId)}&id=${encodeURIComponent(seed.runId)}`, { waitUntil: "domcontentloaded" });

    await expect(page.locator("[data-header-name]")).toHaveValue("Saved Run One");
    await expect.poll(async () => page.evaluate(() => ({
      sourceScenarioId: window.__tideDebug?.appState?.current?.sourceScenarioId || "",
      policyId: window.__tideDebug?.appState?.current?.onChainPolicy?.id || "",
    }))).toEqual({
      sourceScenarioId: seed.runId,
      policyId: seed.policyId,
    });
    await expect(page.locator("#save-policy-toolbar")).toHaveText("Update testnet policy");
  });

  test("keeps missing setup id warning after wallet auto-connect", async ({ page }) => {
    await installMockWallet(page);

    await page.goto("/setup?id=private-a", { waitUntil: "domcontentloaded" });

    await expect.poll(async () => page.evaluate(() => (
      window.__tideDebug?.wallet?.connected === true
    ))).toBe(true);
    await expect(page.locator("[data-header-name]")).toHaveValue("New scenario");
    await expect(page.getByText("This position link was not found in the current wallet workspace.")).toBeVisible();
    await expect.poll(async () => page.evaluate(() => ({
      activeDraftId: window.__tideDebug?.appState?.activeDraftId || "",
      current: window.__tideDebug?.appState?.current || null,
    }))).toEqual({
      activeDraftId: "",
      current: null,
    });
  });

  test("opens draft handoff payload as an armed testnet proof candidate", async ({ page }) => {
    await page.route("**/runtime-config.js*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: `
          window.TIDE_ENV = "testnet";
          window.TIDE_CONFIG = {
            buildId: "handoff-proof-test",
            liveEnabled: true,
            liveRailPack: { autoLoad: false, allowUnsignedForecast: true },
            sui: { network: "testnet", rpcUrl: "", explorerBase: "" },
            executionProof: { enabled: true, allowSigning: true },
            policyRegistry: { packageId: "0x${"1".repeat(64)}", railAllowlistId: "0x${"2".repeat(64)}" },
            executionReceipts: { packageId: "0x${"1".repeat(64)}" },
            walrus: {},
            oracle: {}
          };
        `,
      });
    });

    const draft = makeValidDraft({
      scenarioName: "Cross-origin proof candidate",
      createScope: "shadow",
      btcUnits: 0.42,
      collateralAssetSymbol: "xBTC",
    });
    const encoded = encodeDraftHandoff(draft);
    await page.goto(`/setup?proof=1&draft=${encoded}`, { waitUntil: "domcontentloaded" });

    await expect(page.locator("[data-header-name]")).toHaveValue("Cross-origin proof candidate");
    await expect(page.locator('input[name="createScope"][value="live"]')).toBeChecked();
    await expect(page.getByText("This position link was not found in the current wallet workspace.")).toHaveCount(0);
    await expect.poll(async () => page.evaluate(() => ({
      scope: window.__tideDebug?.appState?.draft?.createScope || "",
      activeDraftId: window.__tideDebug?.appState?.activeDraftId || "",
    }))).toEqual({
      scope: "live",
      activeDraftId: "",
    });
  });
});
