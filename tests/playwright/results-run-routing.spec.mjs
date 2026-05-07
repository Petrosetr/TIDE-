import { expect, test } from "@playwright/test";

const E2E_WALLET_ADDRESS = `0x${"1".repeat(64)}`;
const E2E_WALLET_NAME = "TIDE E2E Wallet";

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

test.describe("saved run readout routing", () => {
  test("hydrates Results from the pinned saved run instead of current", async ({ page }) => {
    await installMockWallet(page);
    await page.goto("/results?judge=1", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Overflow Judge Harbor").first()).toBeVisible();

    await expect.poll(async () => page.evaluate(() => (
      window.__tideDebug?.wallet?.connected === true
    ))).toBe(true);

    const seed = await page.evaluate(({ address }) => {
      const cloneJson = (value) => JSON.parse(JSON.stringify(value));
      const base = cloneJson(window.__tideDebug.appState.current);
      const makeRun = (id, name, generatedAt) => {
        const run = cloneJson(base);
        run.sourceScenarioId = id;
        run.draft.scenarioName = name;
        run.report.generatedAt = generatedAt;
        return {
          id,
          name,
          createdAt: generatedAt,
          updatedAt: generatedAt,
          draft: cloneJson(run.draft),
          report: cloneJson(run.report),
          input: cloneJson(run.input),
          marketBand: cloneJson(run.marketBand),
          judge: cloneJson(run.judge),
          operatorReview: cloneJson(run.operatorReview),
          onChainPolicy: null,
          onChainReceipt: null,
          current: run,
        };
      };

      const savedA = makeRun("run-a", "Pinned run A", "2026-05-01T10:00:00.000Z");
      const savedB = makeRun("run-b", "Current run B", "2026-05-01T11:00:00.000Z");
      window.localStorage.setItem(`tide.shadow-mode.saved.v2:${address}`, JSON.stringify([savedB, savedA]));
      window.localStorage.setItem(`tide.shadow-mode.current.v6:${address}`, JSON.stringify(savedB.current));
      return { runA: savedA.id, runB: savedB.id };
    }, { address: E2E_WALLET_ADDRESS });

    await page.goto(`/results?id=${encodeURIComponent(seed.runA)}`, { waitUntil: "domcontentloaded" });

    await expect.poll(async () => page.evaluate(() => (
      window.__tideDebug?.appState?.current?.sourceScenarioId || ""
    ))).toBe(seed.runA);
    await expect(page.getByText("Pinned run A").first()).toBeVisible();
    await expect(page.getByText("Current run B")).toHaveCount(0);
  });

  test("keeps legacy run= readout links working", async ({ page }) => {
    await installMockWallet(page);
    await page.goto("/results?judge=1", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Overflow Judge Harbor").first()).toBeVisible();

    await expect.poll(async () => page.evaluate(() => (
      window.__tideDebug?.wallet?.connected === true
    ))).toBe(true);

    const seed = await page.evaluate(({ address }) => {
      const cloneJson = (value) => JSON.parse(JSON.stringify(value));
      const base = cloneJson(window.__tideDebug.appState.current);
      base.sourceScenarioId = "legacy-run";
      base.draft.scenarioName = "Legacy run link";
      window.localStorage.setItem(`tide.shadow-mode.saved.v2:${address}`, JSON.stringify([{
        id: "legacy-run",
        name: "Legacy run link",
        createdAt: "2026-05-01T12:00:00.000Z",
        updatedAt: "2026-05-01T12:00:00.000Z",
        draft: cloneJson(base.draft),
        report: cloneJson(base.report),
        input: cloneJson(base.input),
        marketBand: cloneJson(base.marketBand),
        judge: cloneJson(base.judge),
        operatorReview: cloneJson(base.operatorReview),
      }]));
      return { runId: "legacy-run" };
    }, { address: E2E_WALLET_ADDRESS });

    await page.goto(`/results?run=${encodeURIComponent(seed.runId)}`, { waitUntil: "domcontentloaded" });

    await expect.poll(async () => page.evaluate(() => (
      window.__tideDebug?.appState?.current?.sourceScenarioId || ""
    ))).toBe(seed.runId);
    await expect(page.getByText("Legacy run link").first()).toBeVisible();
  });

  test("does not fall back to current when a pinned saved run is missing", async ({ page }) => {
    await installMockWallet(page);
    await page.goto("/results?judge=1", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Overflow Judge Harbor").first()).toBeVisible();

    await expect.poll(async () => page.evaluate(() => (
      window.__tideDebug?.wallet?.connected === true
    ))).toBe(true);

    await page.evaluate(({ address }) => {
      const cloneJson = (value) => JSON.parse(JSON.stringify(value));
      const current = cloneJson(window.__tideDebug.appState.current);
      current.sourceScenarioId = "run-current";
      current.draft.scenarioName = "Fallback current should stay hidden";
      window.localStorage.setItem(`tide.shadow-mode.current.v6:${address}`, JSON.stringify(current));
      window.localStorage.setItem(`tide.shadow-mode.saved.v2:${address}`, JSON.stringify([]));
    }, { address: E2E_WALLET_ADDRESS });

    await page.goto("/results?id=missing-run", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Saved run not found" })).toBeVisible();
    await expect(page.getByText("Fallback current should stay hidden")).toHaveCount(0);
    await expect.poll(async () => page.evaluate(() => (
      window.__tideDebug?.appState?.current || null
    ))).toBeNull();
  });

  test("repairs a saved run that was not linked after policy anchor", async ({ page }) => {
    await installMockWallet(page);
    await page.goto("/results?judge=1", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Overflow Judge Harbor").first()).toBeVisible();

    await expect.poll(async () => page.evaluate(() => (
      window.__tideDebug?.wallet?.connected === true
    ))).toBe(true);

    const seed = await page.evaluate(({ address }) => {
      const cloneJson = (value) => JSON.parse(JSON.stringify(value));
      const current = cloneJson(window.__tideDebug.appState.current);
      const policyId = `0x${"c".repeat(64)}`;
      current.sourceScenarioId = "run-new-anchor";
      current.draft.scenarioName = "Newly anchored policy";
      current.onChainPolicy = { id: policyId, network: "testnet", policyName: "Newly anchored policy" };
      const staleSaved = {
        id: current.sourceScenarioId,
        name: "Newly anchored policy",
        createdAt: "2026-05-01T12:30:00.000Z",
        updatedAt: "2026-05-01T12:30:00.000Z",
        draft: cloneJson(current.draft),
        report: cloneJson(current.report),
        input: cloneJson(current.input),
        marketBand: cloneJson(current.marketBand),
        judge: cloneJson(current.judge),
        operatorReview: cloneJson(current.operatorReview),
        onChainPolicy: null,
        onChainReceipt: null,
      };
      window.localStorage.setItem(`tide.shadow-mode.saved.v2:${address}`, JSON.stringify([staleSaved]));
      window.localStorage.setItem(`tide.shadow-mode.current.v6:${address}`, JSON.stringify(current));
      return { policyId, runId: current.sourceScenarioId };
    }, { address: E2E_WALLET_ADDRESS });

    await page.goto(`/live?policy=${encodeURIComponent(seed.policyId)}&id=${encodeURIComponent(seed.runId)}`, { waitUntil: "domcontentloaded" });

    await expect(page.locator("body")).toHaveAttribute("data-page", "live");
    await expect(page.getByText("Policy/run link mismatch")).toHaveCount(0);
    await expect(page.getByText("Newly anchored policy").first()).toBeVisible();
    await expect(page.locator("#readout-action").getByText("Re-run before anchoring")).toHaveCount(0);
    await expect(page.locator("#readout-action").getByText("Draft state")).toHaveCount(0);
    await expect.poll(async () => page.evaluate(({ address, runId }) => {
      const saved = JSON.parse(window.localStorage.getItem(`tide.shadow-mode.saved.v2:${address}`) || "[]");
      return saved.find((entry) => entry?.id === runId)?.onChainPolicy?.id || "";
    }, { address: E2E_WALLET_ADDRESS, runId: seed.runId })).toBe(seed.policyId);
  });

  test("does not bind a policy route to an unrelated saved run id", async ({ page }) => {
    await installMockWallet(page);
    await page.goto("/results?judge=1", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Overflow Judge Harbor").first()).toBeVisible();

    await expect.poll(async () => page.evaluate(() => (
      window.__tideDebug?.wallet?.connected === true
    ))).toBe(true);

    const seed = await page.evaluate(({ address }) => {
      const cloneJson = (value) => JSON.parse(JSON.stringify(value));
      const base = cloneJson(window.__tideDebug.appState.current);
      const policyA = `0x${"a".repeat(64)}`;
      const policyB = `0x${"b".repeat(64)}`;
      const makeRun = (id, name, policyId, generatedAt) => {
        const run = cloneJson(base);
        run.sourceScenarioId = id;
        run.draft.scenarioName = name;
        run.report.generatedAt = generatedAt;
        run.onChainPolicy = { id: policyId, network: "testnet", policyName: name };
        return {
          id,
          name,
          createdAt: generatedAt,
          updatedAt: generatedAt,
          draft: cloneJson(run.draft),
          report: cloneJson(run.report),
          input: cloneJson(run.input),
          marketBand: cloneJson(run.marketBand),
          judge: cloneJson(run.judge),
          operatorReview: cloneJson(run.operatorReview),
          onChainPolicy: cloneJson(run.onChainPolicy),
          onChainReceipt: null,
          current: run,
        };
      };

      const savedA = makeRun("run-policy-a", "Run for policy A", policyA, "2026-05-01T10:00:00.000Z");
      const savedB = makeRun("run-policy-b", "Run for policy B", policyB, "2026-05-01T11:00:00.000Z");
      window.localStorage.setItem(`tide.shadow-mode.saved.v2:${address}`, JSON.stringify([savedB, savedA]));
      window.localStorage.setItem(`tide.shadow-mode.current.v6:${address}`, JSON.stringify(savedA.current));
      return { policyB, runA: savedA.id };
    }, { address: E2E_WALLET_ADDRESS });

    await page.goto(`/live?policy=${encodeURIComponent(seed.policyB)}&id=${encodeURIComponent(seed.runA)}`, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Policy/run link mismatch" })).toBeVisible();
    await expect(page.getByText("Run for policy A")).toHaveCount(0);
    await expect.poll(async () => page.evaluate(() => (
      window.__tideDebug?.appState?.current || null
    ))).toBeNull();
  });

  test("does not repair an unbound saved run into a route policy", async ({ page }) => {
    await installMockWallet(page);
    await page.goto("/results?judge=1", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Overflow Judge Harbor").first()).toBeVisible();

    await expect.poll(async () => page.evaluate(() => (
      window.__tideDebug?.wallet?.connected === true
    ))).toBe(true);

    const seed = await page.evaluate(({ address }) => {
      const cloneJson = (value) => JSON.parse(JSON.stringify(value));
      const base = cloneJson(window.__tideDebug.appState.current);
      const policyId = `0x${"d".repeat(64)}`;

      const current = cloneJson(base);
      current.sourceScenarioId = "current-policy-d";
      current.draft.scenarioName = "Current policy D";
      current.onChainPolicy = { id: policyId, network: "testnet", policyName: "Current policy D" };

      const unboundSaved = cloneJson(base);
      unboundSaved.sourceScenarioId = "unbound-saved-run";
      unboundSaved.draft.scenarioName = "Unbound saved run";
      unboundSaved.onChainPolicy = null;

      window.localStorage.setItem(`tide.shadow-mode.current.v6:${address}`, JSON.stringify(current));
      window.localStorage.setItem(`tide.shadow-mode.saved.v2:${address}`, JSON.stringify([{
        id: unboundSaved.sourceScenarioId,
        name: "Unbound saved run",
        createdAt: "2026-05-01T12:45:00.000Z",
        updatedAt: "2026-05-01T12:45:00.000Z",
        draft: cloneJson(unboundSaved.draft),
        report: cloneJson(unboundSaved.report),
        input: cloneJson(unboundSaved.input),
        marketBand: cloneJson(unboundSaved.marketBand),
        judge: cloneJson(unboundSaved.judge),
        operatorReview: cloneJson(unboundSaved.operatorReview),
        onChainPolicy: null,
        onChainReceipt: null,
      }]));
      return { policyId, runId: unboundSaved.sourceScenarioId };
    }, { address: E2E_WALLET_ADDRESS });

    await page.goto(`/live?policy=${encodeURIComponent(seed.policyId)}&id=${encodeURIComponent(seed.runId)}`, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Policy/run link mismatch" })).toBeVisible();
    await expect(page.getByText("Unbound saved run")).toHaveCount(0);
    await expect.poll(async () => page.evaluate(() => (
      window.__tideDebug?.appState?.current || null
    ))).toBeNull();
  });
});
