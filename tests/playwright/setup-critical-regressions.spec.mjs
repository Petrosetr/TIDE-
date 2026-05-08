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

async function gotoSetup(page, path = "/setup?judge=1") {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.locator('body[data-page="setup"][data-app-ready="true"]')).toHaveCount(1);
  await expect(page.locator(".setup-boot-skeleton")).toBeHidden();
}

test.describe("setup critical regressions", () => {
  test("keeps setup trailing-slash navigation on root app routes", async ({ page }) => {
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await gotoSetup(page, "/setup/?judge=1");
    await expect(page.locator("body")).toHaveAttribute("data-page", "setup");
    await page.locator("#run-sim-toolbar").click();
    await expect(page).toHaveURL(/\/results\/?\?judge=1$/);
    await expect(page.url()).not.toContain("/setup/results");
    await expect(page.locator("body")).toHaveAttribute("data-page", "results");
    await expect(page.getByText("Overflow Judge Harbor").first()).toBeVisible();
    expect(actionableBrowserErrors(browserErrors)).toEqual([]);
  });

  test("keeps the setup action rail docked to the viewport", async ({ page }) => {
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await page.setViewportSize({ width: 1440, height: 920 });
    await gotoSetup(page);

    const footer = page.locator("[data-setup-footer]");
    await expect(page.locator("body")).toHaveAttribute("data-page", "setup");
    await expect(footer).toBeVisible();
    await expect(page.locator("#run-sim-toolbar")).toBeVisible();
    await expect(page.locator("#run-sim-toolbar")).toBeEnabled();
    await expect(page.locator("#save-policy-toolbar")).toBeHidden();

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const desktopMetrics = await footer.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const stackStyle = getComputedStyle(document.querySelector(".page-stack"));
      return {
        position: getComputedStyle(node).position,
        height: Math.round(rect.height),
        bottomGap: Math.round(window.innerHeight - rect.bottom),
        stackPaddingBottom: parseFloat(stackStyle.paddingBottom),
        disabledHints: node.querySelectorAll(".action-disabled-hint").length,
      };
    });
    expect(desktopMetrics.position).toBe("sticky");
    expect(desktopMetrics.height).toBeLessThanOrEqual(100);
    expect(desktopMetrics.bottomGap).toBeGreaterThanOrEqual(8);
    expect(desktopMetrics.bottomGap).toBeLessThanOrEqual(32);
    expect(desktopMetrics.stackPaddingBottom).toBeGreaterThanOrEqual(desktopMetrics.height * 0.75);
    expect(desktopMetrics.disabledHints).toBe(0);

    await page.setViewportSize({ width: 1024, height: 820 });
    await expect(footer).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const tabletMetrics = await page.evaluate(() => {
      const footerNode = document.querySelector("[data-setup-footer]");
      const stackStyle = getComputedStyle(document.querySelector(".page-stack"));
      const footerRect = footerNode.getBoundingClientRect();
      return {
        gridColumns: getComputedStyle(footerNode).gridTemplateColumns.trim().split(/\s+/).length,
        position: getComputedStyle(footerNode).position,
        height: Math.round(footerRect.height),
        bottomGap: Math.round(window.innerHeight - footerRect.bottom),
        stackPaddingBottom: parseFloat(stackStyle.paddingBottom),
      };
    });
    expect(tabletMetrics.gridColumns).toBe(1);
    expect(tabletMetrics.position).toBe("sticky");
    expect(tabletMetrics.bottomGap).toBeGreaterThanOrEqual(8);
    expect(tabletMetrics.bottomGap).toBeLessThanOrEqual(32);
    expect(tabletMetrics.stackPaddingBottom).toBeGreaterThanOrEqual(tabletMetrics.height * 0.75);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(footer).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(async () => page.evaluate(() => (
      getComputedStyle(document.querySelector("[data-setup-footer]")).position
    ))).toBe("sticky");
    const mobileMetrics = await page.evaluate(() => {
      const footerNode = document.querySelector("[data-setup-footer]");
      const primary = document.querySelector("#run-sim-toolbar");
      const spot = document.querySelector(".create-composer__spot");
      const footerRect = footerNode.getBoundingClientRect();
      const primaryRect = primary.getBoundingClientRect();
      const spotRect = spot.getBoundingClientRect();
      return {
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        footerPosition: getComputedStyle(footerNode).position,
        footerTop: Math.round(footerRect.top),
        footerBottom: Math.round(footerRect.bottom),
        bottomGap: Math.round(window.innerHeight - footerRect.bottom),
        spotBottom: Math.round(spotRect.bottom),
        primaryHeight: Math.round(primaryRect.height),
      };
    });
    expect(mobileMetrics.footerPosition).toBe("sticky");
    expect(mobileMetrics.footerTop).toBeGreaterThanOrEqual(0);
    expect(mobileMetrics.footerBottom).toBeLessThanOrEqual(844);
    expect(mobileMetrics.bottomGap).toBeGreaterThanOrEqual(8);
    expect(mobileMetrics.bottomGap).toBeLessThanOrEqual(24);
    expect(mobileMetrics.overflowX).toBeLessThanOrEqual(2);
    expect(mobileMetrics.primaryHeight).toBeGreaterThanOrEqual(44);
    expect(actionableBrowserErrors(browserErrors)).toEqual([]);
  });

  test("keeps the setup header compact by keeping trust chips out of the header", async ({ page }) => {
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoSetup(page);
    const header = page.locator(".page-header.page-header--product");
    await expect(header).toBeVisible();
    await expect(header.locator(".trust-strip--in-header")).toHaveCount(0);
    await expect(header).not.toContainText(/Rail pack stale/i);

    const height = await header.evaluate((node) => Math.round(node.getBoundingClientRect().height));
    expect(height).toBeLessThanOrEqual(155);
    expect(actionableBrowserErrors(browserErrors)).toEqual([]);
  });

  test("keeps the Readout header compact when actions are disabled", async ({ page }) => {
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await installMockWallet(page);
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto("/results?judge=1", { waitUntil: "domcontentloaded" });
    await expect(page.locator('body[data-page="results"][data-app-ready="true"]')).toHaveCount(1);

    const header = page.locator(".page-header.page-header--product");
    await expect(header).toBeVisible();
    await expect(header.locator("#readout-actions .action-disabled-hint")).toHaveCount(0);

    const metrics = await header.evaluate((node) => {
      const box = (el) => {
        const rect = el?.getBoundingClientRect?.();
        return rect ? {
          width: rect.width,
          height: rect.height,
          top: rect.top,
          left: rect.left,
          right: rect.right,
          bottom: rect.bottom,
        } : null;
      };
      const actions = node.querySelector("#readout-actions");
      const heading = node.querySelector(".page-heading");
      const title = node.querySelector(".page-heading h1");
      const status = node.querySelector(".status-line");
      return {
        header: box(node),
        heading: box(heading),
        title: box(title),
        actions: box(actions),
        status: box(status),
        visibleDisabledHints: Array.from(node.querySelectorAll(".action-disabled-hint"))
          .filter((el) => {
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && rect.height > 0;
          }).length,
      };
    });

    expect(metrics.visibleDisabledHints).toBe(0);
    expect(metrics.actions.height).toBeLessThanOrEqual(56);
    expect(metrics.actions.left).toBeGreaterThanOrEqual(metrics.title.right + 24);
    expect(Math.abs(metrics.actions.top - metrics.heading.top)).toBeLessThanOrEqual(12);
    if (metrics.status.height > 0) {
      expect(metrics.status.top).toBeGreaterThanOrEqual(metrics.actions.bottom - 1);
      expect(metrics.status.left).toBeGreaterThanOrEqual(metrics.heading.right);
    }
    expect(metrics.header.height).toBeLessThanOrEqual(126);
    expect(actionableBrowserErrors(browserErrors)).toEqual([]);
  });

  test("keeps the Policy Monitor header from overlapping action buttons", async ({ page }) => {
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await installMockWallet(page);
    await page.setViewportSize({ width: 2048, height: 900 });
    await page.goto("/results?judge=1", { waitUntil: "domcontentloaded" });
    await expect(page.locator('body[data-page="results"][data-app-ready="true"]')).toHaveCount(1);

    const seed = await page.evaluate(({ address }) => {
      const cloneJson = (value) => JSON.parse(JSON.stringify(value));
      const current = cloneJson(window.__tideDebug.appState.current);
      const policyId = `0x${"402".padEnd(64, "a")}`;
      current.sourceScenarioId = "policy-monitor-run";
      current.draft.scenarioName = "TIDE xBTC policy";
      current.draft.createScope = "live";
      current.onChainPolicy = {
        id: policyId,
        network: "testnet",
        policyName: "TIDE xBTC policy",
        selectedRail: "navi-sui",
        version: 2,
      };
      const saved = {
        id: current.sourceScenarioId,
        name: "TIDE xBTC policy",
        createdAt: "2026-05-06T16:04:00.000Z",
        updatedAt: "2026-05-06T16:04:00.000Z",
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

    await page.goto(`/live?policy=${encodeURIComponent(seed.policyId)}&id=${encodeURIComponent(seed.runId)}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator('body[data-page="live"][data-app-ready="true"]')).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Policy Monitor" })).toBeVisible();

    const metrics = await page.locator(".page-header.page-header--product").evaluate((node) => {
      const rectOf = (el) => {
        const rect = el?.getBoundingClientRect?.();
        return rect ? {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height,
        } : null;
      };
      const title = node.querySelector(".page-heading h1");
      const actions = node.querySelector("#readout-actions");
      const status = node.querySelector(".status-line");
      return {
        header: rectOf(node),
        title: rectOf(title),
        actions: rectOf(actions),
        status: rectOf(status),
      };
    });

    expect(metrics.actions.left).toBeGreaterThanOrEqual(metrics.title.right + 24);
    expect(Math.abs(metrics.actions.top - metrics.title.top)).toBeLessThanOrEqual(16);
    if (metrics.status.height > 0) {
      expect(metrics.status.top).toBeGreaterThanOrEqual(metrics.actions.bottom - 1);
      expect(metrics.status.left).toBeGreaterThanOrEqual(metrics.title.right + 24);
    }
    expect(metrics.header.height).toBeLessThanOrEqual(126);
    expect(actionableBrowserErrors(browserErrors)).toEqual([]);
  });

  test("keeps cashflow target cards aligned with the Goal block on desktop", async ({ page }) => {
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoSetup(page);
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

  test("keeps mobile cashflow compact without horizontal page overflow", async ({ page }) => {
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await page.setViewportSize({ width: 390, height: 844 });
    await gotoSetup(page);
    await expect(page.locator(".setup-aside .swap-stat")).toHaveCount(3);

    const metrics = await page.evaluate(() => ({
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      cashflowHeight: Math.round(document.querySelector(".setup-aside .policy-cashflow--inline")?.getBoundingClientRect().height || 0),
      cardHeights: [...document.querySelectorAll(".setup-aside .swap-stat")]
        .map((node) => Math.round(node.getBoundingClientRect().height)),
      stepperHeights: [...document.querySelectorAll(".setup-aside .swap-stepper__btn")]
        .map((node) => Math.round(node.getBoundingClientRect().height)),
      footerTop: Math.round(document.querySelector("[data-setup-footer]")?.getBoundingClientRect().top || 0),
      collateralBottom: Math.round(document.querySelector("[data-collateral-trigger]")?.getBoundingClientRect().bottom || 0),
      spotBottom: Math.round(document.querySelector(".create-composer__spot")?.getBoundingClientRect().bottom || 0),
    }));

    expect(metrics.overflowX).toBeLessThanOrEqual(1);
    expect(metrics.cashflowHeight).toBeLessThanOrEqual(430);
    expect(metrics.cardHeights).toHaveLength(3);
    for (const height of metrics.cardHeights) {
      expect(height).toBeLessThanOrEqual(125);
    }
    expect(metrics.footerTop).toBeGreaterThan(Math.max(metrics.collateralBottom, metrics.spotBottom) + 8);
    expect(metrics.stepperHeights.every((height) => height <= 32)).toBe(true);
    expect(actionableBrowserErrors(browserErrors)).toEqual([]);
  });

  test("keeps the first Create path in user-facing treasury language", async ({ page }) => {
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoSetup(page);
    await expect(page.locator(".setup-layout")).toBeVisible();

    await expect(page.locator("[data-mode-card]")).toContainText("Run mode");
    await expect(page.locator(".strategy-presets--profiles")).toHaveAttribute("role", "group");
    await expect(page.locator('.mode-card__opt[data-scope="shadow"]')).toContainText("Rehearsal");
    await expect(page.locator('.mode-card__opt[data-scope="shadow"]')).toContainText("Local");
    await expect(page.locator(".strategy-presets--profiles")).toContainText("Debt pressure");
    await page.locator('input[name="btcUnits"]').fill("0.5");
    const profileMetricLabels = await page.locator("[data-preset-stat-label]").evaluateAll((nodes) =>
      nodes.map((node) => (node.textContent || "").trim())
    );
    expect(profileMetricLabels).toEqual(["Monthly draw", "Monthly draw", "Monthly draw"]);
    await expect(page.locator('.strategy-presets--profiles .strategy-preset[data-preset="drift"]')).toContainText("Drift");
    await expect(page.locator('.strategy-presets--profiles .strategy-preset[data-preset="drift"]')).toBeEnabled();
    await expect(page.locator('.strategy-presets--profiles .strategy-preset[data-preset="drift"]')).toContainText("Accumulate");
    await expect(page.locator('.strategy-presets--profiles .strategy-preset[data-preset="drift"]')).not.toContainText("Roadmap");
    await expect(page.locator(".strategy-presets--profiles")).not.toContainText("Future mode");
    await page.locator('.strategy-presets--profiles .strategy-preset[data-preset="drift"]').click();
    await expect(page.locator('input[name="strategyPreset"]')).toHaveValue("drift");
    await expect(page.locator('input[name="desiredRunwayMonths"]')).toHaveValue("8");
    await expect(page.locator("[data-header-name]")).not.toHaveValue(/Future Mode/i);
    await expect(page.locator(".setup-aside .policy-cashflow__head")).toContainText("Monthly draw and runway");
    await expect(page.locator(".create-guardrails-surface > .section-head")).toContainText("Debt pressure (LTV) limits");
    await expect(page.locator(".create-composer__debt")).toContainText("Modeled debt");
    await expect(page.locator('label.field', { has: page.locator('input[name="maxLtvPct"]') })).toContainText("Max debt pressure");
    await expect(page.locator('label.field', { has: page.locator('input[name="targetLtvHighPct"]') })).toContainText("Target ceiling");
    await expect(page.locator(".setup-footer-summary")).toContainText("Rehearsal draft");
    await expect(page.locator(".setup-footer-summary")).not.toContainText("Manual sandbox");
    await expect(page.locator(".setup-footer-summary__mid")).toContainText("Pressure");
    await expect(page.locator("#run-sim-toolbar")).toHaveText("Run rehearsal");
    expect(actionableBrowserErrors(browserErrors)).toEqual([]);
  });

  test("keeps the mobile topbar to one row without the network badge", async ({ page }) => {
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await installMockWallet(page);
    await mockSuiRpcBalances(page, []);
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoSetup(page);
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

    await gotoSetup(page);
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

    await gotoSetup(page, "/setup?judge=revoke");
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

    await gotoSetup(page);
    await expect(page.locator(".guardrails-chart")).toBeVisible();
    await expect(page.locator('[data-guardrail-group="overlay"][data-guardrail-value="your-stress"]'))
      .toHaveAttribute("aria-checked", "true");
    await expect(page.locator(".guardrails-chart__note")).toContainText(/Custom stress/);

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

    await gotoSetup(page);
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

  test("keeps mobile guardrails readable inside its own scroll viewport", async ({ page }) => {
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await page.setViewportSize({ width: 390, height: 844 });
    await gotoSetup(page);
    await page.locator('[data-guardrail-group="overlay"][data-guardrail-value="crash-2022-11"]').click();
    await expect(page.locator(".guardrails-chart__svg")).toBeVisible();

    const metrics = await page.evaluate(() => {
      const chart = document.querySelector(".guardrails-chart");
      const svg = document.querySelector(".guardrails-chart__svg");
      const top = document.querySelector(".guardrails-chart__top");
      const thresholdLabels = [...document.querySelectorAll(".guardrails-chart__svg [data-guardrail-threshold] text")];
      return {
        pageOverflowX: document.documentElement.scrollWidth - window.innerWidth,
        chartScrollable: chart ? chart.scrollWidth > chart.clientWidth + 120 : false,
        svgWidth: Math.round(svg?.getBoundingClientRect().width || 0),
        topHeight: Math.round(top?.getBoundingClientRect().height || 0),
        minThresholdLabelHeight: Math.min(...thresholdLabels.map((node) => node.getBoundingClientRect().height)),
      };
    });

    expect(metrics.pageOverflowX).toBeLessThanOrEqual(1);
    expect(metrics.chartScrollable).toBe(true);
    expect(metrics.svgWidth).toBeGreaterThanOrEqual(680);
    expect(metrics.topHeight).toBeLessThanOrEqual(52);
    expect(metrics.minThresholdLabelHeight).toBeGreaterThanOrEqual(7);
    expect(actionableBrowserErrors(browserErrors)).toEqual([]);
  });

  test("guardrail strip sliders support keyboard adjustment", async ({ page }) => {
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await gotoSetup(page);
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
    await gotoSetup(page);
    const network = await page.evaluate(() => String(window.TIDE_CONFIG?.sui?.network || "").toLowerCase());
    test.skip(network !== "mainnet", "mainnet read-only copy is specific to the dev build");

    await expect.poll(async () => page.evaluate(() => Boolean(window.__tideDebug?.wallet?.connected))).toBe(true);
    await expect(page.locator("[data-mode-card]")).toHaveAttribute("data-bound", "1");

    const liveMode = page.locator('.mode-card__opt[data-scope="live"]');
    await expect(liveMode).toHaveAttribute("aria-disabled", "true");
    await liveMode.click({ force: true });
    const status = page.locator("#status-note");
    await expect(status).toBeVisible();
    await expect(status).toHaveAttribute("role", "status");
    await expect(status).toHaveAttribute("aria-live", "polite");
    await expect(status).toContainText(/mainnet read-only/i);
    await expect(status).not.toContainText(/connect wallet to enable live/i);
    expect(actionableBrowserErrors(browserErrors)).toEqual([]);
  });

  test("allows selecting Testnet proof intent before wallet connect on live-enabled builds", async ({ page }) => {
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await page.route("**/runtime-config.js*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: `
          window.TIDE_ENV = "testnet";
          window.TIDE_CONFIG = {
            buildId: "proof-intent-no-wallet-test",
            liveEnabled: true,
            liveRailPack: { autoLoad: false, preferRemote: false, seedMarket: null, verifyKey: "", allowUnsignedForecast: true },
            sui: { network: "testnet", rpcUrl: "", explorerBase: "" },
            executionProof: { enabled: true, allowSigning: true },
            policyRegistry: {},
            executionReceipts: {},
            walrus: {},
            oracle: {}
          };
        `,
      });
    });

    await gotoSetup(page, "/setup");
    await expect.poll(async () => page.evaluate(() => Boolean(window.__tideDebug?.wallet?.connected))).toBe(false);

    const liveMode = page.locator('.mode-card__opt[data-scope="live"]');
    await expect(liveMode).toHaveAttribute("aria-disabled", "false");
    await page.locator('input[name="btcUnits"]').fill("0.5");
    await liveMode.click();
    await expect(page.locator('input[name="createScope"][value="live"]')).toBeChecked();
    await expect(page.locator('input[name="btcUnits"]')).toHaveValue("0.5");
    await expect(page.locator("[data-create-preview-scope]")).toHaveText("Proof blocked");

    const runButton = page.locator("#run-sim-toolbar");
    await expect(runButton).toBeDisabled();
    await expect(runButton).toHaveText("Fix proof inputs");
    await expect(runButton).toHaveAttribute("title", /Connect wallet to use Testnet proof/i);
    await expect(runButton).toHaveAttribute("aria-describedby", "run-sim-toolbar-reason");
    await expect(page.locator("#run-sim-toolbar-reason.sr-only")).toHaveText(/Connect wallet to use Testnet proof/i);
    await expect(page.locator("[data-setup-footer] .action-disabled-hint")).toHaveCount(0);
    const proofFooter = await page.locator("[data-setup-footer]").evaluate((node) => ({
      height: Math.round(node.getBoundingClientRect().height),
      overflow: getComputedStyle(node).overflow,
      visibleDisabledHints: Array.from(node.querySelectorAll(".action-disabled-hint")).filter((el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.height > 0;
      }).length,
    }));
    expect(proofFooter.height).toBeLessThanOrEqual(100);
    expect(proofFooter.overflow).toBe("visible");
    expect(proofFooter.visibleDisabledHints).toBe(0);
    expect(actionableBrowserErrors(browserErrors)).toEqual([]);
  });

  test("opens the rail data section from deep links", async ({ page }) => {
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await gotoSetup(page, "/setup#rail-data");

    const railData = page.locator("#rail-data");
    await expect(railData).toBeVisible();
    await expect(railData).toHaveAttribute("open", "");
    await expect(railData.getByRole("heading", { name: /Rail & venue/i })).toBeVisible();
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

    await gotoSetup(page);
    await expect.poll(async () => page.evaluate(() => (
      window.__tideDebug?.wallet?.connected === true
        && Array.isArray(window.__tideDebug?.wallet?.btcBalances)
    ))).toBe(true);

    const walletBalances = await page.evaluate(() => window.__tideDebug?.wallet?.btcBalances || []);
    expect(walletBalances[0]?.symbol).toBe("LBTC");
    await expect(page.locator('input[name="collateralAssetSymbol"]')).toHaveValue("LBTC");
    await expect(page.locator('input[name="collateralCoinType"]')).toHaveValue(LBTC_COIN_TYPE);
    await expect(page.locator("[data-collateral-trigger-symbol]")).toHaveText("LBTC");
    await expect(page.locator(".create-composer__spot > span")).toHaveText("LBTC reference");
    await expect(page.locator("[data-collateral-trigger-symbol]")).not.toHaveText("BTC");
    expect(actionableBrowserErrors(browserErrors)).toEqual([]);
  });

  test("loads same-origin configured rail packs without collapsing wrapper prices", async ({ page }) => {
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await page.route("**/runtime-config.js*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: `
          window.TIDE_ENV = "testnet";
          window.TIDE_CONFIG = {
            buildId: "same-origin-pack-test",
            liveEnabled: true,
            liveRailPack: {
              url: "./live-rail-pack.json",
              autoLoad: true,
              preferRemote: false,
              persist: true,
              seedMarket: {
                btcPriceUsd: 82000,
                updatedAt: "2026-05-07T00:00:00.000Z",
                source: "test-seed"
              },
              verifyKey: "",
              allowUnsignedForecast: true
            },
            sui: { network: "testnet", rpcUrl: "", explorerBase: "" },
            executionProof: { enabled: true, allowSigning: true },
            policyRegistry: {},
            executionReceipts: {},
            walrus: {},
            oracle: {}
          };
        `,
      });
    });
    await page.route("**/live-rail-pack.json*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          label: "Same-origin wrapper pack",
          generatedAt: "2026-05-07T00:00:01.000Z",
          market: {
            btcPriceUsd: 82_000,
            updatedAt: "2026-05-07T00:00:01.000Z",
            source: "test-median",
          },
          rails: [
            {
              id: "scallop",
              name: "Scallop",
              wrapper: "sbwBTC",
              stableAsset: "USDC",
              referencePriceUsd: 81_000,
              availableDebtUsd: 1_000_000,
              priceReferences: [
                { wrapper: "wBTC", referencePriceUsd: 81_000, source: "scallop" },
                { wrapper: "suiWBTC", referencePriceUsd: 82_125, source: "scallop" },
              ],
            },
            {
              id: "navi",
              name: "NAVI",
              wrapper: "wBTC",
              stableAsset: "USDC",
              referencePriceUsd: 81_250,
              availableDebtUsd: 1_000_000,
              priceReferences: [
                { wrapper: "xBTC", referencePriceUsd: 83_500, source: "navi" },
                { wrapper: "LBTC", referencePriceUsd: 84_250, source: "navi" },
              ],
            },
          ],
        }),
      });
    });

    await gotoSetup(page);
    await expect.poll(async () => page.evaluate(() => (
      window.__tideDebug?.appState?.railPack?.rails?.length || 0
    ))).toBeGreaterThan(0);

    const prices = await page.evaluate(() => ({
      wBTC: Math.round(Number(window.__tideLiveWrapperPriceUsd?.("wBTC") || 0)),
      suiWBTC: Math.round(Number(window.__tideLiveWrapperPriceUsd?.("suiWBTC") || 0)),
      xBTC: Math.round(Number(window.__tideLiveWrapperPriceUsd?.("xBTC") || 0)),
      LBTC: Math.round(Number(window.__tideLiveWrapperPriceUsd?.("LBTC") || 0)),
      stBTC: Math.round(Number(window.__tideLiveWrapperPriceUsd?.("stBTC") || 0)),
      trustMode: window.__tideDebug?.appState?.railPack?.trustMode || "",
    }));

    expect(prices.trustMode).toBe("same-origin-build");
    expect(prices.wBTC).toBe(81_125);
    expect(prices.suiWBTC).toBe(82_125);
    expect(prices.xBTC).toBe(83_500);
    expect(prices.LBTC).toBe(84_250);
    expect(prices.stBTC).toBe(0);
    expect(new Set([prices.wBTC, prices.suiWBTC, prices.xBTC, prices.LBTC]).size).toBe(4);
    expect(actionableBrowserErrors(browserErrors)).toEqual([]);
  });

  test("keeps proxy-priced suiWBTC explicit without falling back to the global BTC median", async ({ page }) => {
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await page.route("**/runtime-config.js*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: `
          window.TIDE_ENV = "testnet";
          window.TIDE_CONFIG = {
            buildId: "proxy-wrapper-pack-test",
            liveEnabled: true,
            liveRailPack: {
              url: "./live-rail-pack.json",
              autoLoad: true,
              preferRemote: false,
              persist: true,
              seedMarket: {
                btcPriceUsd: 82000,
                updatedAt: "2026-05-07T00:00:00.000Z",
                source: "test-seed"
              },
              verifyKey: "",
              allowUnsignedForecast: true
            },
            sui: { network: "testnet", rpcUrl: "", explorerBase: "" },
            executionProof: { enabled: true, allowSigning: true },
            policyRegistry: {},
            executionReceipts: {},
            walrus: {},
            oracle: {}
          };
        `,
      });
    });
    await page.route("**/live-rail-pack.json*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          label: "Proxy wrapper pack",
          generatedAt: "2026-05-07T00:00:01.000Z",
          market: {
            btcPriceUsd: 82_000,
            updatedAt: "2026-05-07T00:00:01.000Z",
            source: "test-median",
          },
          rails: [
            {
              id: "scallop",
              name: "Scallop",
              wrapper: "sbwBTC",
              stableAsset: "USDC",
              referencePriceUsd: 81_000,
              availableDebtUsd: 1_000_000,
              priceReferences: [
                { wrapper: "sbwBTC", referencePriceUsd: 81_000, source: "scallop" },
                {
                  wrapper: "suiWBTC",
                  referencePriceUsd: 81_000,
                  source: "scallop",
                  quoteKind: "proxy",
                  proxyOf: "sbwBTC",
                  disclosure: "No direct suiWBTC quote; priced from Scallop sbwBTC market quote.",
                },
              ],
            },
            {
              id: "navi",
              name: "NAVI",
              wrapper: "wBTC",
              stableAsset: "USDC",
              referencePriceUsd: 81_250,
              availableDebtUsd: 1_000_000,
              priceReferences: [
                { wrapper: "xBTC", referencePriceUsd: 83_500, source: "navi" },
                { wrapper: "LBTC", referencePriceUsd: 84_250, source: "navi" },
              ],
            },
          ],
        }),
      });
    });

    await gotoSetup(page);
    await expect.poll(async () => page.evaluate(() => (
      window.__tideDebug?.appState?.railPack?.rails?.length || 0
    ))).toBeGreaterThan(0);

    const prices = await page.evaluate(() => {
      const rail = window.__tideDebug?.appState?.railPack?.rails
        ?.find((item) => item.id === "scallop");
      const proxy = rail?.priceReferences
        ?.find((item) => item.wrapper === "suiWBTC");
      return {
        global: Math.round(Number(window.__tideDebug?.appState?.railPack?.market?.btcPriceUsd || 0)),
        suiWBTC: Math.round(Number(window.__tideLiveWrapperPriceUsd?.("suiWBTC") || 0)),
        stBTC: Math.round(Number(window.__tideLiveWrapperPriceUsd?.("stBTC") || 0)),
        proxy,
      };
    });

    expect(prices.global).toBe(82_000);
    expect(prices.suiWBTC).toBe(81_000);
    expect(prices.suiWBTC).not.toBe(prices.global);
    expect(prices.stBTC).toBe(0);
    expect(prices.proxy).toEqual(expect.objectContaining({
      quoteKind: "proxy",
      proxyOf: "sbwBTC",
      disclosure: expect.stringContaining("No direct suiWBTC quote"),
    }));
    expect(actionableBrowserErrors(browserErrors)).toEqual([]);
  });

  test("keeps the composer spot price tied to the selected BTC wrapper", async ({ page }) => {
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await page.addInitScript(() => {
      window.localStorage.setItem("tide.shadow-mode.rail-pack.v3", JSON.stringify({
        label: "Wrapper price regression pack",
        generatedAt: "2026-05-07T00:00:00.000Z",
        market: {
          btcPriceUsd: 82_000,
          updatedAt: "2026-05-07T00:00:00.000Z",
          source: "test",
        },
        rails: [
          {
            id: "scallop",
            name: "Scallop",
            wrapper: "sbwBTC",
            stableAsset: "USDC",
            referencePriceUsd: 81_000,
            availableDebtUsd: 1_000_000,
            priceReferences: [
              {
                wrapper: "suiWBTC",
                referencePriceUsd: 81_000,
                source: "scallop",
                quoteKind: "proxy",
                proxyOf: "sbwBTC",
                updatedAt: "2026-05-07T00:00:00.000Z",
              },
            ],
          },
          {
            id: "navi",
            name: "NAVI",
            wrapper: "wBTC",
            stableAsset: "USDC",
            referencePriceUsd: 81_250,
            availableDebtUsd: 1_000_000,
            priceReferences: [
              {
                wrapper: "xBTC",
                referencePriceUsd: 83_500,
                source: "navi",
                updatedAt: "2026-05-07T00:00:00.000Z",
              },
              {
                wrapper: "LBTC",
                referencePriceUsd: 84_250,
                source: "navi",
                updatedAt: "2026-05-07T00:00:00.000Z",
              },
            ],
          },
        ],
      }));
    });
    await gotoSetup(page);
    await expect.poll(async () => page.evaluate(() => {
      const wbtc = Number(window.__tideLiveWrapperPriceUsd?.("wBTC") || 0);
      const xbtc = Number(window.__tideLiveWrapperPriceUsd?.("xBTC") || 0);
      return wbtc > 1_000 && xbtc > 1_000 && Math.round(wbtc) !== Math.round(xbtc);
    })).toBe(true);

    const prices = await page.evaluate(() => ({
      wBTC: Math.round(Number(window.__tideLiveWrapperPriceUsd?.("wBTC") || 0)),
      suiWBTC: Math.round(Number(window.__tideLiveWrapperPriceUsd?.("suiWBTC") || 0)),
      xBTC: Math.round(Number(window.__tideLiveWrapperPriceUsd?.("xBTC") || 0)),
    }));
    expect(prices.wBTC).toBeGreaterThan(1_000);
    expect(prices.suiWBTC).toBeGreaterThan(1_000);
    expect(prices.xBTC).toBeGreaterThan(1_000);
    expect(prices.wBTC).not.toBe(prices.xBTC);
    expect(prices.suiWBTC).not.toBe(prices.xBTC);

    await page.locator("[data-collateral-trigger]").click();
    await expect(page.locator("[data-collateral-menu]"))
      .toContainText("/ xBTC");
    await expect(page.locator("[data-collateral-menu]"))
      .not.toContainText("$82,000 / xBTC");

    const selectCollateral = async (symbol) => {
      if (!(await page.locator("[data-collateral-menu]").isVisible())) {
        await page.locator("[data-collateral-trigger]").click();
      }
      await page.locator("[data-collateral-menu] .collateral-asset-option")
        .filter({ hasText: symbol })
        .first()
        .click();
      await expect(page.locator("[data-collateral-trigger-symbol]")).toHaveText(symbol);
    };

    const spotInput = page.locator('input[name="btcPriceUsd"]');

    await selectCollateral("xBTC");
    const selectedXbtcPrice = await page.evaluate(() => (
      Math.round(Number(window.__tideLiveWrapperPriceUsd?.("xBTC") || 0))
    ));
    expect(selectedXbtcPrice).toBeGreaterThan(1_000);
    await expect(spotInput).toHaveValue(String(selectedXbtcPrice));
    await expect(page.locator(".create-composer__spot > span")).toHaveText("xBTC reference");

    await spotInput.fill("90000");
    await expect(spotInput).toHaveValue("90000");

    await selectCollateral("wBTC");
    const selectedWbtcPrice = await page.evaluate(() => (
      Math.round(Number(window.__tideLiveWrapperPriceUsd?.("wBTC") || 0))
    ));
    expect(selectedWbtcPrice).toBeGreaterThan(1_000);
    expect(selectedWbtcPrice).not.toBe(selectedXbtcPrice);
    await expect(spotInput).toHaveValue(String(selectedWbtcPrice));
    await expect(page.locator(".create-composer__spot > span")).toHaveText("wBTC reference");
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

    await gotoSetup(page);
    const liveEnabled = await page.evaluate(() => window.TIDE_CONFIG?.liveEnabled === true);
    test.skip(!liveEnabled, "Live-blocked CTA copy is specific to live-enabled testnet builds");

    await expect.poll(async () => page.evaluate(() => Boolean(window.__tideDebug?.wallet?.connected))).toBe(true);
    await page.locator('.mode-card__opt[data-scope="live"]').click();
    await expect(page.locator("[data-create-preview-scope]")).toHaveText("Proof blocked");

    const runButton = page.locator("#run-sim-toolbar");
    await expect(runButton).toBeDisabled();
    await expect(runButton).toHaveText("Fix proof inputs");
    await expect(runButton).toHaveAttribute("title", /observed read-only|support wBTC and xBTC/i);
    await expect(runButton).toHaveAttribute("aria-describedby", "run-sim-toolbar-reason");
    await expect(page.locator("#run-sim-toolbar-reason.sr-only")).toHaveText(/observed read-only|support wBTC and xBTC/i);
    await expect(page.locator("[data-setup-footer] .action-disabled-hint")).toHaveCount(0);
    expect(actionableBrowserErrors(browserErrors)).toEqual([]);
  });
});
