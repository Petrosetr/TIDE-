import {
  canBuildSignableTransaction,
  getProtocolExecutionCapability,
  resolveProtocolKey,
} from "./execution.mjs";

const EXECUTABLE_ACTION_TYPES = new Set([
  "BorrowForBuffer",
  "PartialRepay",
  "EmergencyDeRisk",
]);

const WALLET_BALANCE_EPSILON = 1e-8;
const LIVE_SUPPORTED_WRAPPER_SYMBOLS = new Set(["WBTC", "XBTC"]);

function hasAddress(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function asFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeCoinType(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeSymbol(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function isLiveSupportedWrapper(symbol) {
  return LIVE_SUPPORTED_WRAPPER_SYMBOLS.has(normalizeSymbol(symbol));
}

function normalizeProofContext(proofContext = {}) {
  return {
    allowMockCollateral: proofContext?.allowMockCollateral === true,
    modeLabel: typeof proofContext?.modeLabel === "string" && proofContext.modeLabel.trim()
      ? proofContext.modeLabel.trim()
      : "Testnet proof",
  };
}

function draftsMatch(left = null, right = null) {
  try {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  } catch {
    return false;
  }
}

function findWalletCollateralBalance(draft = {}, walletState = {}) {
  const balances = Array.isArray(walletState?.btcBalances) ? walletState.btcBalances : [];
  const requestedCoinType = normalizeCoinType(draft?.collateralCoinType);
  const requestedSymbol = normalizeSymbol(draft?.collateralAssetSymbol || "BTC");

  let match = null;

  if (requestedCoinType) {
    match = balances.find((entry) => normalizeCoinType(entry?.coinType) === requestedCoinType) || null;
  }

  if (!match && requestedSymbol) {
    match = balances.find((entry) => normalizeSymbol(entry?.symbol) === requestedSymbol) || null;
  }

  return {
    requestedCoinType,
    requestedSymbol,
    balance: match,
    available: asFiniteNumber(match?.display),
  };
}

function hasWalletSession(walletState = {}) {
  return Boolean(walletState?.connected && hasAddress(walletState?.address));
}

export function getAccountDataState(walletState = {}) {
  const connected = hasWalletSession(walletState);
  return {
    connected,
    canViewWorkspaceScenarios: connected,
    canViewLibraryScenarios: connected,
    canSaveScenario: connected,
    reason: connected ? "" : "wallet-required",
  };
}

export function getResultsActionState({
  current = null,
  walletState = {},
  draft = null,
  liveEnabled = true,
  liveScopeState = null,
  liveDataVerified = false,
  proofContext = null,
} = {}) {
  const hasCurrentRun = Boolean(current?.report);
  const connected = hasWalletSession(walletState);
  const activeDraft = draft || current?.draft || null;
  const runIsFresh = hasCurrentRun && draftsMatch(current?.draft || null, activeDraft);
  const scopeState = liveScopeState || (hasCurrentRun
    ? getCreateScopeState({ draft: activeDraft || {}, walletState, proofContext })
    : null);

  let liveReason = "";
  const canOpenLive = liveEnabled && hasCurrentRun;
  let canExecuteLive = false;

  if (!liveEnabled) {
    liveReason = "live-disabled";
  } else if (!hasCurrentRun) {
    liveReason = "simulation-required";
  } else if (!runIsFresh) {
    liveReason = "rerun-required";
  } else if (!scopeState || scopeState.scope !== "live") {
    liveReason = "live-scope-required";
  } else if (!connected) {
    liveReason = "wallet-required";
  } else if (!scopeState.canOpenLive) {
    liveReason = scopeState.reason || "live-not-ready";
  } else if (!liveDataVerified) {
    liveReason = "verified-live-data-required";
  } else {
    canExecuteLive = true;
  }

  return {
    hasCurrentRun,
    connected,
    canExportJson: hasCurrentRun,
    canOpenLive,
    canExecuteLive,
    canSaveScenario: hasCurrentRun && connected,
    runIsFresh,
    liveReason,
    liveScopeState: scopeState,
    saveReason: !hasCurrentRun
      ? "simulation-required"
      : connected
        ? ""
        : "wallet-required",
  };
}

export function getCreateScopeState({ draft = {}, walletState = {}, proofContext = null } = {}) {
  const scope = String(draft?.createScope || "shadow").trim().toLowerCase() === "live" ? "live" : "shadow";
  const requestedBtcUnits = asFiniteNumber(draft?.btcUnits);
  const proof = normalizeProofContext(proofContext);

  if (scope !== "live") {
    return {
      scope: "shadow",
      canRunSimulation: requestedBtcUnits > 0,
      canOpenLive: false,
      requiresWallet: false,
      reason: "shadow-manual",
      available: null,
      requested: requestedBtcUnits,
      walletBacked: false,
      mockCollateral: false,
      message: "Rehearsal allows manual assumptions. Switch to Testnet proof to require connected-wallet collateral.",
    };
  }

  if (!hasWalletSession(walletState)) {
    return {
      scope: "live",
      canRunSimulation: false,
      canOpenLive: false,
      requiresWallet: true,
      reason: "wallet-required",
      available: null,
      requested: requestedBtcUnits,
      walletBacked: false,
      mockCollateral: false,
      message: "Connect wallet to use Testnet proof.",
    };
  }

  if (!String(draft?.collateralCoinType || "").trim()) {
    return {
      scope: "live",
      canRunSimulation: false,
      canOpenLive: false,
      requiresWallet: true,
      reason: "wrapper-required",
      available: null,
      requested: requestedBtcUnits,
      walletBacked: false,
      mockCollateral: false,
      message: "Select a wallet BTC wrapper before using Testnet proof.",
    };
  }

  const requestedSymbol = normalizeSymbol(draft?.collateralAssetSymbol) || "BTC";
  if (!isLiveSupportedWrapper(requestedSymbol)) {
    return {
      scope: "live",
      canRunSimulation: false,
      canOpenLive: false,
      requiresWallet: true,
      reason: "unsupported-wrapper",
      available: null,
      requested: requestedBtcUnits,
      symbol: requestedSymbol,
      walletBacked: false,
      mockCollateral: false,
      message: `${requestedSymbol} is observed read-only, but current Testnet proof rails support wBTC and xBTC only.`,
    };
  }

  if (requestedBtcUnits <= 0) {
    return {
      scope: "live",
      canRunSimulation: false,
      canOpenLive: false,
      requiresWallet: true,
      reason: "amount-required",
      available: null,
      requested: requestedBtcUnits,
      symbol: normalizeSymbol(draft?.collateralAssetSymbol) || "BTC",
      walletBacked: false,
      mockCollateral: false,
      message: "Enter a positive collateral amount for Testnet proof.",
    };
  }

  const balancesLoaded = Array.isArray(walletState?.btcBalances);
  const { balance, available, requestedSymbol: resolvedRequestedSymbol } = balancesLoaded
    ? findWalletCollateralBalance(draft, walletState)
    : {
        balance: null,
        available: 0,
        requestedSymbol,
      };

  if (proof.allowMockCollateral && (!balancesLoaded || !balance || requestedBtcUnits > available + WALLET_BALANCE_EPSILON)) {
    const symbol = resolvedRequestedSymbol || requestedSymbol || "BTC";
    let reasonDetail = "wallet balance sync is still loading";
    if (balancesLoaded && !balance) {
      reasonDetail = `the connected wallet does not hold ${symbol}`;
    } else if (balancesLoaded && requestedBtcUnits > available + WALLET_BALANCE_EPSILON) {
      reasonDetail = `requested ${requestedBtcUnits} ${symbol} exceeds wallet balance ${available}`;
    }

    return {
      scope: "live",
      canRunSimulation: true,
      canOpenLive: false,
      requiresWallet: true,
      reason: "proof-collateral-mock",
      available: balancesLoaded ? available : null,
      requested: requestedBtcUnits,
      symbol,
      walletBacked: false,
      mockCollateral: true,
      message: `${proof.modeLabel} is using mock ${symbol} collateral because ${reasonDetail}. Run the rehearsal locally; saving policy and minting receipts require wallet-backed collateral.`,
    };
  }

  if (!balancesLoaded) {
    return {
      scope: "live",
      canRunSimulation: false,
      canOpenLive: false,
      requiresWallet: true,
      reason: "balance-loading",
      available: null,
      requested: requestedBtcUnits,
      walletBacked: false,
      mockCollateral: false,
      message: "Wallet balances are still loading.",
    };
  }

  if (!balance) {
    return {
      scope: "live",
      canRunSimulation: false,
      canOpenLive: false,
      requiresWallet: true,
      reason: "wrapper-not-owned",
      available: 0,
      requested: requestedBtcUnits,
      symbol: resolvedRequestedSymbol || requestedSymbol || "BTC",
      walletBacked: false,
      mockCollateral: false,
      message: `Selected ${resolvedRequestedSymbol || requestedSymbol || "BTC"} is not available on the connected wallet.`,
    };
  }

  if (requestedBtcUnits > available + WALLET_BALANCE_EPSILON) {
    return {
      scope: "live",
      canRunSimulation: false,
      canOpenLive: false,
      requiresWallet: true,
      reason: "insufficient-balance",
      available,
      requested: requestedBtcUnits,
      symbol: normalizeSymbol(balance?.symbol) || requestedSymbol || "BTC",
      walletBacked: false,
      mockCollateral: false,
      message: "Testnet proof only accepts collateral that is available on the connected wallet.",
    };
  }

  return {
    scope: "live",
    canRunSimulation: true,
    canOpenLive: true,
    requiresWallet: true,
    reason: "live-ready",
    available,
    requested: requestedBtcUnits,
    symbol: normalizeSymbol(balance?.symbol) || resolvedRequestedSymbol || requestedSymbol || "BTC",
    walletBacked: true,
    mockCollateral: false,
    message: "Wallet-backed collateral is ready for Testnet proof.",
  };
}

export function getLiveExecutionState({
  walletState = {},
  current = null,
  action = null,
  railName = "",
  draft = null,
  isCurrentDraftFresh = true,
  liveDataMode = "",
  livePackVerified = false,
  allowProtocolExecution = false,
} = {}) {
  const chosen = action || current?.report?.baseline?.result?.decision?.chosen || null;
  const resolvedRailName = railName || current?.report?.summary?.primaryRailName || "";
  const resolvedDraft = draft || current?.draft || {};
  const connected = hasWalletSession(walletState);
  const resolvedDataMode = String(liveDataMode || current?.report?.summary?.railDataMode || "").trim().toLowerCase();
  const capability = resolvedRailName ? getProtocolExecutionCapability(resolvedRailName) : null;
  const actionType = String(chosen?.type || "");

  if (!chosen && !current?.report) {
    return {
      state: "decision-required",
      connected,
      canExecute: false,
      canSign: false,
      canMonitor: true,
      chosen: null,
      railName: resolvedRailName,
      capability,
    };
  }

  if (chosen && !EXECUTABLE_ACTION_TYPES.has(actionType)) {
    return {
      state: "monitoring-only",
      connected,
      canExecute: false,
      canSign: false,
      canMonitor: true,
      chosen,
      railName: resolvedRailName,
      actionType,
      capability,
    };
  }

  if (current?.report) {
    if (!isCurrentDraftFresh) {
      return {
        state: "stale-run",
        connected,
        canExecute: false,
        canSign: false,
        canMonitor: true,
        chosen,
        railName: resolvedRailName,
        capability,
      };
    }

    if (resolvedDataMode !== "live") {
      return {
        state: "fixture-data",
        connected,
        canExecute: false,
        canSign: false,
        canMonitor: true,
        chosen,
        railName: resolvedRailName,
        capability,
      };
    }

    if (!livePackVerified) {
      return {
        state: "unverified-data",
        connected,
        canExecute: false,
        canSign: false,
        canMonitor: true,
        chosen,
        railName: resolvedRailName,
        capability,
      };
    }
  }

  if (!connected) {
    return {
      state: "wallet-required",
      connected: false,
      canExecute: false,
      canSign: false,
      canMonitor: true,
      chosen,
      railName: resolvedRailName,
      capability,
    };
  }

  if (!chosen) {
    return {
      state: "decision-required",
      connected: true,
      canExecute: false,
      canSign: false,
      canMonitor: true,
      chosen: null,
      railName: resolvedRailName,
      capability,
    };
  }

  if (!capability) {
    return {
      state: "unsupported-rail",
      connected: true,
      canExecute: false,
      canSign: false,
      canMonitor: true,
      chosen,
      railName: resolvedRailName,
      actionType,
      capability: null,
    };
  }

  const protocolKey = resolveProtocolKey(resolvedRailName);
  if (protocolKey === "bucket" && !String(resolvedDraft.collateralCoinType || "").trim()) {
    return {
      state: "collateral-required",
      connected: true,
      canExecute: false,
      canSign: false,
      canMonitor: true,
      chosen,
      railName: resolvedRailName,
      actionType,
      capability,
    };
  }

  const protocolExecutionGated = Boolean(capability?.signable && capability?.overflowGated);
  const canSign = canBuildSignableTransaction(chosen, resolvedRailName, resolvedDraft);
  if (!canSign) {
    return {
      state: "preview-only",
      connected: true,
      canExecute: false,
      canSign: false,
      canMonitor: true,
      chosen,
      railName: resolvedRailName,
      actionType,
      capability,
      ...(protocolExecutionGated ? { reason: "protocol-execution-gated" } : {}),
    };
  }

  if (!allowProtocolExecution) {
    return {
      state: "preview-only",
      connected: true,
      canExecute: false,
      canSign: false,
      canMonitor: true,
      chosen,
      railName: resolvedRailName,
      actionType,
      capability,
      reason: "protocol-execution-gated",
    };
  }

  return {
    state: "signable",
    connected: true,
    canExecute: true,
    canSign: true,
    canMonitor: true,
    chosen,
    railName: resolvedRailName,
    actionType,
    capability,
  };
}
