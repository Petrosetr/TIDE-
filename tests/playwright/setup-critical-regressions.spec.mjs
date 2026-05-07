import { expect, test } from "@playwright/test";

const E2E_WALLET_ADDRESS = `0x${"6".repeat(64)}`;
const E2E_WALLET_NAME = "TIDE Setup Critical Wallet";
const LBTC_COIN_TYPE = "0x3e8e9423d80e1774a7ca128fccd8bf5f1f7753be658c5e645929037f7c819040::lbtc::LBTC";

function actionableBrowserErrors(messages) {
  return messages.filter((message) => {
    if (/Transition was skipped/i.test(message)) return false;
    if (/extension has not been configured/i.test(message)) return false;
    if (/The Content Security Policy directive 'frame-ancestors'/i.test(message)) return false;
    return true;
  });
}

async function chartPathD(page, stroke) {
  const chartPath = page.locator(`.guardrails-chart__svg path[stroke="${stroke}"]`).first();
  await expect(chartPath).toBeVisible();
  const d = await chartPath.getAttribute("d");
  expect(d || "").toMatch(/[MLCQ]/);
  expect((d || "").length).toBeGreaterThan(20);
  await expect(chartPath).not.toHaveAttribute("stroke-dasharray", /.+/);
  return d;
}

async function installMockWallet(page) {
  await page.addInitScript(({ address, walletName }) => {
    const account = {
      address,
      chains: ["sui:testnet", "sui:mainnet"],
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
      chains: ["sui:testnet", "sui:mainnet"],
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

async function mockSuiRpcBalances(page, balances) {
  const handler = async (route) => {
    const request = route.request();
    let method = "";
    try {
      const body = JSON.parse(request.postData() || "{}");
      method = String(body.method || "");
    } catch (_) {}

    if (method === "suix_getAllBalances") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: balances }),
      });
      return;
    }

    if (method === "suix_getOwnedObjects" || method === "suix_queryObjects") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { data: [], hasNextPage: false, nextCursor: null } }),
      });
      return;
    }

    if (method === "sui_getObject") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: null }),
      });
      return;
    }

    await route.fallback();
  };

  await page.route("https://fullnode.mainnet.sui.io/**", handler);
  await page.route("https://fullnode.testnet.sui.io/**", handler);
  await page.route("https://sui-mainnet-rpc.publicnode.com/**", handler);
  await page.route("https://sui-testnet-rpc.publicnode.com/**", handler);
}

test.describe("setup critical regressions", () => {
  test("keeps setup trailing-slash navigation on root app routes", async ({ page }) => {
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await page.goto("/setup/?judge=1", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-page", "setup");
    await page.locator("#run-sim-toolbar").click();
    await expect(page).toHaveURL(/\/results\/?\?judge=1$/);
    await expect(page.url()).not.toContain("/setup/results");
    await expect(page.locator("body")).toHaveAttribute("data-page", "results");
    await expect(page.getByText("Overflow Judge Harbor").first()).toBeVisible();
    expect(actionableBrowserErrors(browserErrors)).toEqual([]);
  });

  test("keeps the setup action rail usable without covering mobile form fields", async ({ page }) => {
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await page.setViewportSize({ width: 1440, height: 920 });
    await page.goto("/setup?judge=1", { waitUntil: "domcontentloaded" });

    const footer = page.locator("[data-setup-footer]");
    await expect(page.locator("body")).toHaveAttribute("data-page", "setup");
    await expect(footer).toBeVisible();
    await expect(page.locator("#run-sim-toolbar")).toBeVisible();
    await expect(page.locator("#run-sim-toolbar")).toBeEnabled();
    await expect(page.locator("#save-policy-toolbar")).toBeHidden();

    const desktopMetrics = await footer.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const stackStyle = getComputedStyle(document.querySelector(".page-stack"));
      return {
        position: getComputedStyle(node).position,
        bottom: Math.round(window.innerHeight - rect.bottom),
        height: Math.round(rect.height),
        zIndex: Number(getComputedStyle(node).zIndex),
        stackPaddingBottom: parseFloat(stackStyle.paddingBottom),
      };
    });
    expect(desktopMetrics.position).toBe("fixed");
    expect(desktopMetrics.bottom).toBeGreaterThanOrEqual(0);
    expect(desktopMetrics.zIndex).toBeGreaterThanOrEqual(70);
    expect(desktopMetrics.stackPaddingBottom).toBeGreaterThanOrEqual(desktopMetrics.height * 0.65);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const scrolledBottom = await footer.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return Math.round(window.innerHeight - rect.bottom);
    });
    expect(scrolledBottom).toBeGreaterThanOrEqual(0);
    expect(scrolledBottom).toBeLessThanOrEqual(64);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(footer).toBeVisible();
    const mobileMetrics = await page.evaluate(() => {
      const footerNode = document.querySelector("[data-setup-footer]");
      const primary = document.querySelector("#run-sim-toolbar");
      const footerRect = footerNode.getBoundingClientRect();
      const primaryRect = primary.getBoundingClientRect();
      return {
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        footerPosition: getComputedStyle(footerNode).position,
        footerBottom: Math.round(window.innerHeight - footerRect.bottom),
        primaryHeight: Math.round(primaryRect.height),
      };
    });
    expect(mobileMetrics.footerPosition).toBe("static");
    expect(mobileMetrics.overflowX).toBeLessThanOrEqual(2);
    expect(mobileMetrics.primaryHeight).toBeGreaterThanOrEqual(44);
    expect(actionableBrowserErrors(browserErrors)).toEqual([]);
  });

  test("keeps the setup header compact by keeping trust chips out of the header", async ({ page }) => {
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/setup?judge=1", { waitUntil: "domcontentloaded" });
    const header = page.locator(".page-header.page-header--product");
    await expect(header).toBeVisible();
    await expect(header.locator(".trust-strip--in-header")).toHaveCount(0);
    await expect(header).not.toContainText(/Rail pack stale/i);

    const height = await header.evaluate((node) => Math.round(node.getBoundingClientRect().height));
    expect(height).toBeLessThanOrEqual(155);
    expect(actionableBrowserErrors(browserErrors)).toEqual([]);
  });

  test("keeps cashflow target cards aligned with the Goal block on desktop", async ({ page }) => {
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/setup?judge=1", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".setup-layout")).toBeVisible();
    await expect(page.locator(".setup-aside .swap-stat")).toHaveCount(3);

    const metrics = await page.evaluate(() => {
      const visible = (selector) => [...document.querySelectorAll(selector)].filter((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      });
      const rectOf = (node) => {
        const rect = node.getBoundingClientRect();
        return {
          bottom: Math.round(rect.bottom),
          height: Math.round(rect.height),
          top: Math.round(rect.top),
        };
      };
      const goalBlock = document.querySelector(".strategy-goal-main")?.closest(".surface")
        || visible(".setup-main > *")[1];
      const cashflow = visible(".setup-aside .policy-cashflow--inline")[0];
      const cards = visible(".setup-aside .swap-stat");
      return {
        cardHeights: cards.map((node) => Math.round(node.getBoundingClientRect().height)),
        cashflow: rectOf(cashflow),
        goalBlock: rectOf(goalBlock),
        metaDisplay: cards.map((node) => getComputedStyle(node.querySelector(".swap-stat__meta")).display),
      };
    });

    expect(metrics.cardHeights).toHaveLength(3);
    for (const height of metrics.cardHeights) {
      expect(height).toBeLessThanOrEqual(150);
      expect(height).toBeGreaterThanOrEqual(88);
    }
    expect(metrics.cashflow.bottom).toBeLessThanOrEqual(metrics.goalBlock.bottom + 16);
    expect(metrics.cashflow.bottom).toBeGreaterThanOrEqual(metrics.goalBlock.bottom - 96);
    expect(metrics.metaDisplay.every((value) => value !== "none")).toBe(true);
    expect(actionableBrowserErrors(browserErrors)).toEqual([]);
  });

  test("keeps the mobile topbar to one row without the network badge", async ({ page }) => {
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await installMockWallet(page);
    await mockSuiRpcBalances(page, []);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/setup?judge=1", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".app-topbar")).toBeVisible();
    await expect.poll(async () => page.evaluate(() => Boolean(window.__tideDebug?.wallet?.connected))).toBe(true);
    await expect(page.locator(".wallet-pill__trigger")).toBeVisible();

    await page.evaluate(() => {
      const badge = document.querySelector(".app-topbar__actions > .network-badge");
      if (!(badge instanceof HTMLElement)) throw new Error("topbar network badge missing");
      badge.hidden = false;
      badge.className = "network-badge network-badge--mainnet";
      badge.textContent = "Mainnet · Read-only";
    });

    const metrics = await page.evaluate(() => {
      const topbar = document.querySelector(".app-topbar");
      const brand = document.querySelector(".app-topbar__brand");
      const actions = document.querySelector(".app-topbar__actions");
      const badge = document.querySelector(".app-topbar__actions > .network-badge");
      const wallet = document.querySelector(".wallet-pill__trigger");
      if (!topbar || !brand || !actions || !badge || !wallet) {
        throw new Error("topbar measurement target missing");
      }
      const topbarRect = topbar.getBoundingClientRect();
      const brandRect = brand.getBoundingClientRect();
      const actionsRect = actions.getBoundingClientRect();
      const walletRect = wallet.getBoundingClientRect();
      return {
        badgeDisplay: getComputedStyle(badge).display,
        topbarHeight: Math.round(topbarRect.height),
        brandCenterY: Math.round(brandRect.top + brandRect.height / 2),
        actionsCenterY: Math.round(actionsRect.top + actionsRect.height / 2),
        walletTop: Math.round(walletRect.top),
        walletBottom: Math.round(walletRect.bottom),
        topbarTop: Math.round(topbarRect.top),
        topbarBottom: Math.round(topbarRect.bottom),
      };
    });

    expect(metrics.badgeDisplay).toBe("none");
    expect(metrics.topbarHeight).toBeLessThanOrEqual(76);
    expect(Math.abs(metrics.brandCenterY - metrics.actionsCenterY)).toBeLessThanOrEqual(4);
    expect(metrics.walletTop).toBeGreaterThanOrEqual(metrics.topbarTop);
    expect(metrics.walletBottom).toBeLessThanOrEqual(metrics.topbarBottom);
    expect(actionableBrowserErrors(browserErrors)).toEqual([]);
  });

  test("renders Polymarket and Kalshi forecast overlays as real chart paths", async ({ page }) => {
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await page.goto("/setup?judge=1", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".guardrails-chart")).toBeVisible();

    await page
      .locator('[data-guardrail-group="overlay"][data-guardrail-value="polymarket"]')
      .click();
    await expect(page.locator(".guardrails-chart__note")).toContainText(/Polymarket/);
    await expect(page.locator(".guardrails-chart__note")).not.toContainText(/unavailable|could not be mapped/i);
    await expect(page.locator(".guardrails-chart__note")).not.toContainText(/no execution/i);
    await chartPathD(page, "var(--chart-accent)");

    await page
      .locator('[data-guardrail-group="period"][data-guardrail-value="1Y"]')
      .click();
    await expect(page.locator('[data-guardrail-group="period"][data-guardrail-value="1Y"]'))
      .toHaveAttribute("aria-checked", "true");

    await page
      .locator('[data-guardrail-group="overlay"][data-guardrail-value="kalshi"]')
      .click();
    await expect(page.locator(".guardrails-chart__note")).toContainText(/Kalshi/);
    await expect(page.locator(".guardrails-chart__note")).toContainText(/period locked/);
    await expect(page.locator(".guardrails-chart__note")).not.toContainText(/unavailable|could not be mapped/i);
    await expect(page.locator(".guardrails-chart__note")).not.toContainText(/no execution/i);
    await chartPathD(page, "var(--chart-cyan)");

    const periodButtons = page.locator('.guardrails-chart__chips--period [data-guardrail-group="period"]');
    await expect(periodButtons).toHaveCount(1);
    await expect(periodButtons.first()).toBeDisabled();
    await expect(periodButtons.first()).toHaveAttribute("aria-disabled", "true");
    expect(actionableBrowserErrors(browserErrors)).toEqual([]);
  });

  test("keeps judge fixture identity and canonical rail in the setup draft", async ({ page }) => {
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await page.goto("/setup?judge=revoke", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-page", "setup");
    await expect(page.getByText("Revoked rail defence")).toBeVisible();

    const draft = await page.evaluate(() => window.__tideDebug?.appState?.draft);
    expect(draft.scenarioOrigin).toBe("testnet-rehearsal:revoke");
    expect(draft.selectedRail).toBe("scallop-sui");
    expect(draft.railId).toBe("scallop-sui");
    expect(draft.debtUsd).toBe(28_000);
    expect(actionableBrowserErrors(browserErrors)).toEqual([]);
  });

  test("updates the visible stress envelope when stress sliders change", async ({ page }) => {
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await page.goto("/setup?judge=1", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".guardrails-chart")).toBeVisible();
    await expect(page.locator('[data-guardrail-group="overlay"][data-guardrail-value="your-stress"]'))
      .toHaveAttribute("aria-checked", "true");
    await expect(page.locator(".guardrails-chart__note")).toContainText(/Your stress/);

    const before = await page.locator('path[stroke="var(--chart-amber)"]').first().getAttribute("d");
    await page.evaluate(() => {
      const input = document.querySelector('[name="marketWeeklyDrawdownPct"]');
      if (!(input instanceof HTMLInputElement)) throw new Error("marketWeeklyDrawdownPct input missing");
      input.value = "35";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await expect(page.locator(".guardrails-chart__note")).toContainText(/35% weekly drawdown/);
    await expect.poll(async () => (
      page.locator('path[stroke="var(--chart-amber)"]').first().getAttribute("d")
    )).not.toBe(before);
    await expect(page.locator(".guardrails-chart__stress-envelope")).toBeVisible();
    expect(actionableBrowserErrors(browserErrors)).toEqual([]);
  });

  test("renders historical overlays without shifting operator trigger levels", async ({ page }) => {
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await page.goto("/setup?judge=1", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".guardrails-chart")).toBeVisible();
    await page.evaluate(() => {
      const values = {
        targetLtvLowPct: "11.5",
        targetLtvHighPct: "18.5",
        autoRepayLtvPct: "24.5",
        emergencyLtvPct: "33.5",
      };
      for (const [name, value] of Object.entries(values)) {
        const input = document.querySelector(`[name="${name}"]`);
        if (!(input instanceof HTMLInputElement)) throw new Error(`${name} input missing`);
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    const currentThresholds = page.locator(".guardrails-chart__svg [data-guardrail-threshold]");
    await expect(currentThresholds).toHaveCount(4);
    const currentTriggerPrices = await currentThresholds.evaluateAll((nodes) => (
      nodes.map((node) => node.getAttribute("data-price-usd"))
    ));

    await page
      .locator('[data-guardrail-group="overlay"][data-guardrail-value="crash-2022-11"]')
      .click();

    const note = page.locator(".guardrails-chart__note");
    await expect(note).toContainText(/Nov 2022/);
    await expect(note).toContainText(/relative BTC path replayed from current spot/);
    await expect(note).not.toContainText(/nominal BTC path/);
    await expect(note).not.toContainText(/anchor \$21,200/);
    await expect(note).not.toContainText(/no execution/i);

    const chart = page.locator(".guardrails-chart").first();
    const referencePrice = Number(await chart.getAttribute("data-series-reference-price-usd"));
    const minPrice = Number(await chart.getAttribute("data-series-min-price-usd"));
    expect(referencePrice).toBeGreaterThan(70000);
    expect(minPrice).toBeGreaterThan(50000);

    const svgLabels = await page.locator(".guardrails-chart__svg text").allTextContents();
    expect(svgLabels.some((label) => /event [+-]\d+d/.test(label))).toBe(true);
    expect(svgLabels).not.toContain("now");

    const thresholds = page.locator(".guardrails-chart__svg [data-guardrail-threshold]");
    await expect(thresholds).toHaveCount(4);
    const historicalTriggerPrices = await thresholds.evaluateAll((nodes) => (
      nodes.map((node) => node.getAttribute("data-price-usd"))
    ));
    expect(historicalTriggerPrices).toEqual(currentTriggerPrices);
    await expect(page.locator('[data-guardrail-threshold="targetLtvLowPct"]')).toContainText("11.5%");
    await expect(page.locator('[data-guardrail-threshold="targetLtvHighPct"]')).toContainText("18.5%");
    await expect(page.locator('[data-guardrail-threshold="autoRepayLtvPct"]')).toContainText("24.5%");
    await expect(page.locator('[data-guardrail-threshold="emergencyLtvPct"]')).toContainText("33.5%");
    expect(actionableBrowserErrors(browserErrors)).toEqual([]);
  });

  test("guardrail strip sliders support keyboard adjustment", async ({ page }) => {
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await page.goto("/setup?judge=1", { waitUntil: "domcontentloaded" });
    const thumb = page.locator('[data-guardrail-strip="autoRepayLtvPct"]').first();
    await expect(thumb).toBeVisible();
    await thumb.focus();
    const before = await thumb.getAttribute("aria-valuenow");
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => thumb.getAttribute("aria-valuenow")).not.toBe(before);
    const inputValue = await page.locator('[name="autoRepayLtvPct"]').inputValue();
    expect(Number(inputValue)).toBeGreaterThan(Number(before));
    expect(actionableBrowserErrors(browserErrors)).toEqual([]);
  });

  test("does not ask for a wallet when Live is disabled by the read-only mainnet build", async ({ page }) => {
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await installMockWallet(page);
    await page.goto("/setup?judge=1", { waitUntil: "domcontentloaded" });
    const network = await page.evaluate(() => String(window.TIDE_CONFIG?.sui?.network || "").toLowerCase());
    test.skip(network !== "mainnet", "mainnet read-only copy is specific to the dev build");

    await expect.poll(async () => page.evaluate(() => Boolean(window.__tideDebug?.wallet?.connected))).toBe(true);
    await expect(page.locator("[data-mode-card]")).toHaveAttribute("data-bound", "1");

    const liveMode = page.locator('.mode-card__opt[data-scope="live"]');
    await expect(liveMode).toHaveAttribute("aria-disabled", "true");
    await liveMode.click({ force: true });
    const status = page.locator("#status-note");
    await expect(status).toBeVisible();
    await expect(status).toContainText(/mainnet read-only/i);
    await expect(status).not.toContainText(/connect wallet to enable live/i);
    expect(actionableBrowserErrors(browserErrors)).toEqual([]);
  });

  test("keeps LBTC wallet balances labeled as LBTC in the setup composer", async ({ page }) => {
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await installMockWallet(page);
    await mockSuiRpcBalances(page, [{
      coinType: LBTC_COIN_TYPE,
      totalBalance: "200",
    }]);

    await page.goto("/setup?judge=1", { waitUntil: "domcontentloaded" });
    await expect.poll(async () => page.evaluate(() => (
      window.__tideDebug?.wallet?.connected === true
        && Array.isArray(window.__tideDebug?.wallet?.btcBalances)
    ))).toBe(true);

    const walletBalances = await page.evaluate(() => window.__tideDebug?.wallet?.btcBalances || []);
    expect(walletBalances[0]?.symbol).toBe("LBTC");
    await expect(page.locator('input[name="collateralAssetSymbol"]')).toHaveValue("LBTC");
    await expect(page.locator('input[name="collateralCoinType"]')).toHaveValue(LBTC_COIN_TYPE);
    await expect(page.locator("[data-collateral-trigger-symbol]")).toHaveText("LBTC");
    await expect(page.locator(".create-composer__spot > span")).toHaveText("LBTC Spot");
    await expect(page.locator("[data-collateral-trigger-symbol]")).not.toHaveText("BTC");
    expect(actionableBrowserErrors(browserErrors)).toEqual([]);
  });

  test("blocks Live CTA when a connected wallet only has a read-only BTC wrapper", async ({ page }) => {
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await installMockWallet(page);
    await mockSuiRpcBalances(page, [{
      coinType: LBTC_COIN_TYPE,
      totalBalance: "200",
    }]);

    await page.goto("/setup?judge=1", { waitUntil: "domcontentloaded" });
    const liveEnabled = await page.evaluate(() => window.TIDE_CONFIG?.liveEnabled === true);
    test.skip(!liveEnabled, "Live-blocked CTA copy is specific to live-enabled testnet builds");

    await expect.poll(async () => page.evaluate(() => Boolean(window.__tideDebug?.wallet?.connected))).toBe(true);
    await page.locator('.mode-card__opt[data-scope="live"]').click();
    await expect(page.locator("[data-create-preview-scope]")).toHaveText("Live blocked");

    const runButton = page.locator("#run-sim-toolbar");
    await expect(runButton).toBeDisabled();
    await expect(runButton).toHaveText("Fix Live inputs");
    await expect(runButton).toHaveAttribute("title", /observed read-only|support wBTC and xBTC/i);
    expect(actionableBrowserErrors(browserErrors)).toEqual([]);
  });
});
