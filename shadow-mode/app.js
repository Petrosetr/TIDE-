import {
  DEFAULT_SHADOW_SCENARIOS,
  RiskPriority,
  ShadowModeSimulator,
  SUI_BTCFI_PROTOCOLS,
  UserMode,
  createSnapshotRailAdapters,
  createStarterRailAdapters,
} from "./lib/tide_core.mjs";

import { coerceLegacyDraftFields } from "./lib/draft-migration.mjs";
import { renderCustodyFooterHtml } from "./lib/custody-disclosure.mjs";
import { escapeHtml as sharedEscapeHtml } from "./lib/html-sanitize.mjs";

import {
  getWalletState,
  subscribe as walletSubscribe,
  signAndExecuteTransaction,
  fetchRemoteScenarios,
  pushScenario,
  deleteRemoteScenario,
  refreshSetupCollateralSelector,
} from "./wallet.js";

import {
  SuiExecutionAdapter,
  buildTransactionForAction,
  buildSignableTransactionForAction,
  getProtocolExecutionCapability,
  loadTxHistory,
  saveTxReceipt,
  fetchPortfolioState,
  waitForTransaction,
} from "./lib/execution.mjs";

import {
  buildCreatePolicyTransaction,
  buildDraftFromPolicyObject,
  buildUpdatePolicyTransaction,
  fetchOwnedPolicies,
  fetchPolicyObject,
  getExpectedPolicyObjectType,
  getPolicyRegistryConfig,
  isPolicyRegistryConfigured,
  isPolicyObjectTypeCompatible,
  resolveCanonicalRailId,
  resolvePolicyObjectReference,
} from "./lib/policy-registry.mjs";

import { getAllRailIds, getRailDisplay } from "./lib/policy-ids.mjs";

import {
  buildMintReceiptTransaction,
  buildSelectRailAndMintTransaction,
  fetchOwnedReceipts,
  fetchReceiptObject,
  assertMintReceiptByteBinding,
  isExecutionReceiptsConfigured,
  parseReceiptMintedEvents,
  resolveReceiptObjectReference,
} from "./lib/execution-receipts.mjs";

import {
  buildProofBundleWithDigest,
  canonicalizeRailPackForProof,
  canonicalizeBundle,
  checkFreshness,
  digestBundle,
  publishProofBundle,
  toHexDigest,
  verifyBundleDigest,
} from "./lib/execution-proof.mjs";
import { emitObservation } from "./lib/observation-bus.mjs";
import { verifyReceiptDigest as verifyReceiptBundleSemantics } from "./lib/receipt-resolver.mjs";
import {
  buildReceiptCopyText,
  buildReceiptReadOnlyUrl,
} from "./lib/receipt-share.mjs";
import { buildLiveUnwindBrief, renderLiveUnwindMarkdown } from "./lib/live-unwind-brief.mjs";

import {
  assertProductionSafety,
  assertSuiNetworkCoherent,
  assertSuiNetworkExplicit,
  getSuiNetwork,
  getWalletNetworkStatus,
  buildSuiExplorerUrl,
} from "./lib/sui-network.mjs";
import {
  applyPolicyLiveControlTransition,
  getPolicyLiveControlState,
  normalizeLiveControlStore,
} from "./lib/live-control-state.mjs";
import {
  getLiveUnwindProgressSummary,
  getPolicyLiveUnwindProgress,
  normalizeLiveUnwindProgressStore,
  togglePolicyLiveUnwindStep,
} from "./lib/live-unwind-progress.mjs";
import { buildLivePolicyStatus, canMarkPolicyUnwound } from "./lib/live-policy-status.mjs";
import { buildLiveExitEvidence } from "./lib/live-exit-semantics.mjs";
import { buildLiveReadbackContext } from "./lib/live-readback.mjs";
import {
  buildLiveProtocolCacheKey,
  getLiveProtocolRefreshState,
  pruneLiveProtocolCacheEntries,
  shouldAutoRefreshLiveProtocolReadback,
} from "./lib/live-protocol-cache.mjs";
import {
  buildLiveProtocolReadbackModel,
  fetchLiveProtocolReadback,
} from "./lib/live-protocol-readback.mjs";
import { buildOpsHealthPosture } from "./lib/ops-health-posture.mjs";

import {
  getAccountDataState,
  getCreateScopeState,
  getLiveExecutionState,
  getResultsActionState,
} from "./lib/user-path.mjs";

import {
  buildCdfFromStrikes,
  quantileFromCdf,
} from "./lib/market-scenarios.mjs";
import { buildStressEnvelopeSeries } from "./lib/stress-envelope.mjs";
import {
  buildSimulationInput,
  buildSimulationScenarios,
} from "./lib/simulation-input.mjs";
import {
  buildOperatorReview,
  deriveDraftMetrics,
  getOperatorReviewProgress,
  getOperatorReviewStatus,
} from "./lib/operator-review.mjs";
import {
  buildAutoSavedRunRecord,
  collectOwnedScenarioNames as collectScenarioRegistryNames,
  extractRemoteSavedScenarios,
  makeUniqueScenarioName,
  planDraftSave,
  serializeDraftForCompare,
  splitScenarioNameRoot,
} from "./lib/scenario-registry.mjs";
import { validateScenarioDraft } from "./lib/scenario-validation.mjs";
import {
  applyJudgeMarketBandOverrides,
  buildJudgeDraft,
  buildJudgeRunContext,
  buildJudgeResultsPath,
  getJudgeScenario,
  resolveJudgeDemoMode,
} from "./lib/judge-flow.mjs";

import { fetchMarketForecast, fetchKalshiForecast } from "./lib/market-forecast-client.mjs";
import { fetchPythReadback, buildMissingPythReadback, isReadbackStale } from "./lib/pyth-readback.mjs";
import { allowsUnsignedForecast, resolveOpsBaseUrl } from "./lib/runtime-config.mjs";
import { verifyPackResponse, isRemoteUrl } from "./lib/pack-signature.mjs";
import { preSigningCheck } from "./lib/pre-signing-check.mjs";
import {
  buildSigningErrorTelemetry,
  classifySigningError,
} from "./lib/signing-error-copy.mjs";
import {
  cloneJson as clone,
  createWalletScopedStorage,
} from "./lib/wallet-scoped-storage.mjs";
import {
  LEGACY_STORAGE_SAVED_KEY_V1,
  STORAGE_ACTIVE_DRAFT_KEY,
  STORAGE_COMPARE_KEY,
  STORAGE_DETAILS_KEY,
  STORAGE_DRAFT_KEY,
  STORAGE_DRAFTS_KEY,
  STORAGE_LIVE_CONTROL_KEY,
  STORAGE_LIVE_UNWIND_PROGRESS_KEY,
  STORAGE_RAIL_PACK_KEY,
  STORAGE_SAVED_KEY,
  STORAGE_THEME_KEY,
  createScenarioStateStore,
  isPlainObject,
} from "./lib/scenario-state-store.mjs";

const DEFAULT_WRAPPED_BTC_SYMBOL = "wBTC";
const DEFAULT_WRAPPED_BTC_COIN_TYPE = "0xaafb102dd0902f5055cadecd687fb5b71ca82ef0e0285d90afde828ec58ca96b::btc::BTC";
const MAINNET_READONLY_RPC_URL = "https://fullnode.mainnet.sui.io:443";
const MAINNET_READONLY_RPC_TIMEOUT_MS = 12_000;
const MAINNET_READONLY_DECISION_TYPES = new Set([
  "Hold",
  "BuildBuffer",
  "BorrowForBuffer",
  "PartialRepay",
  "EmergencyDeRisk",
  "ReducePayout",
  "PausePayout",
  "RotateVenue",
]);
const SUILEND_MAINNET_PACKAGE_ID = "0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf";
const SUILEND_MAINNET_MARKET_PACKAGE_ID = "0xe53906c2c058d1e369763114418f3c144d1b74960d29b2785718a782fec09b61";
const SUILEND_MAINNET_REPAY_PACKAGE_IDS = new Set([
  SUILEND_MAINNET_PACKAGE_ID,
  SUILEND_MAINNET_MARKET_PACKAGE_ID,
]);
const ACCOUNT_SCOPED_STORAGE_KEYS = new Set([
  STORAGE_SAVED_KEY,
  LEGACY_STORAGE_SAVED_KEY_V1,
  STORAGE_DRAFT_KEY,
  STORAGE_DRAFTS_KEY,
  STORAGE_COMPARE_KEY,
  STORAGE_ACTIVE_DRAFT_KEY,
  STORAGE_LIVE_CONTROL_KEY,
  STORAGE_LIVE_UNWIND_PROGRESS_KEY,
]);
const walletStorage = createWalletScopedStorage({
  getAddress: () => getWalletState().address,
  accountScopedKeys: ACCOUNT_SCOPED_STORAGE_KEYS,
  clearGlobalKeyOnScopedWrite: STORAGE_DRAFT_KEY,
});
const normalizeWalletAddress = walletStorage.normalizeAddress;
const loadStorage = walletStorage.load;
function saveStorage(key, value, options = {}) {
  const requestedAddress = Object.prototype.hasOwnProperty.call(options, "address")
    ? options.address
    : undefined;
  const address = normalizeWalletAddress(
    requestedAddress === undefined ? getWalletState().address : requestedAddress
  );

  // Scratch Create drafts are allowed before wallet connect. Persist those in
  // the global slot, then migrate into the wallet-scoped slot on connect.
  if (key === STORAGE_DRAFT_KEY && !options.global && !address) {
    return walletStorage.save(key, value, { ...options, global: true });
  }

  return walletStorage.save(key, value, options);
}

let _executionInProgress = false;
let _executionConfirmArmed = false;
let _policySaveInProgress = false;
let _mintReceiptInProgress = false;
let _setupSubmitInProgress = false;
let _setupSubmitPrimed = false;
let _lastPortfolioState = null;
let _liveProtocolReadbacks = {};
let _liveProtocolRefreshState = {};

const MODE_LABELS = {
  [UserMode.Income]: "Income mode",
};

const PRIORITY_LABELS = {
  [RiskPriority.Safety]: "Protection",
  [RiskPriority.Stability]: "Harbor",
  [RiskPriority.Income]: "Income",
  [RiskPriority.BTCPreservation]: "Protection",
};

const GUARDRAIL_MIN_GAP_PCT = 0.5;

const MODE_HINTS = {
  Income: "Stable income while defending BTC collateral. Start here if you want the clearest default policy for a first simulation.",
};

const PRIORITY_HINTS = {
  Safety: "Most conservative modeled debt-pressure posture. Lower targets and faster de-risk prompts.",
  Stability: "Harbor default. Steady risk controls for most first runs while you learn the operating envelope.",
  Income: "Maximise stablecoin income. Higher debt-pressure tolerance and fuller use of borrowing capacity once you know your limits.",
};

function isLiveEnabled() {
  return Boolean(window.TIDE_CONFIG && window.TIDE_CONFIG.liveEnabled === true);
}

const WRAPPER_STABLE_ASSET_FALLBACKS = {
  WBTC: ["suiUSDT", "USDC"],
  SUIWBTC: ["suiUSDT", "USDC"],
  XBTC: ["USDC"],
  BTC: ["USDB"],
};

function getFallbackStableAssetsForWrapper(wrapperSymbol) {
  const normalized = normalizeTokenSymbol(wrapperSymbol);
  const assets = WRAPPER_STABLE_ASSET_FALLBACKS[normalized];
  return Array.isArray(assets) && assets.length ? assets.slice() : ["USDC"];
}

function getSupportedStableAssetsForWrapper(wrapperSymbol, pack = getActiveRailPack()) {
  const normalizedWrapper = normalizeTokenSymbol(wrapperSymbol);
  const choices = new Map();

  if (pack && Array.isArray(pack.rails)) {
    pack.rails.forEach((rail) => {
      if (normalizeTokenSymbol(rail?.wrapper) !== normalizedWrapper) {
        return;
      }
      const stableAsset = String(rail?.stableAsset || "").trim();
      if (!stableAsset) {
        return;
      }
      const existing = choices.get(stableAsset) || { symbol: stableAsset, rails: [] };
      if (rail?.name && !existing.rails.includes(rail.name)) {
        existing.rails.push(rail.name);
      }
      choices.set(stableAsset, existing);
    });
  }

  if (!choices.size) {
    getFallbackStableAssetsForWrapper(wrapperSymbol).forEach((symbol) => {
      choices.set(symbol, { symbol, rails: [] });
    });
  }

  return [...choices.values()];
}

function pickSupportedStableAsset(wrapperSymbol, preferredSymbol, pack = getActiveRailPack()) {
  const options = getSupportedStableAssetsForWrapper(wrapperSymbol, pack);
  const preferred = normalizeTokenSymbol(preferredSymbol);
  const match = options.find((option) => normalizeTokenSymbol(option.symbol) === preferred);
  return (match || options[0] || { symbol: "USDC" }).symbol;
}

function deriveSuggestedDebtUsd(draft) {
  const collateralUsd = asNumber(draft?.btcUnits) * asNumber(draft?.btcPriceUsd);
  if (!(collateralUsd > 0)) {
    return 0;
  }
  const low = pctToDecimal(draft?.targetLtvLowPct);
  const high = pctToDecimal(draft?.targetLtvHighPct);
  const midpointLtv = Math.max(0, (low + high) / 2);
  const ltvDebt = collateralUsd * midpointLtv;
  const liquidityFloor = Math.max(
    asNumber(draft?.stableBufferUsd),
    asNumber(draft?.minStableBufferUsd),
    asNumber(draft?.monthlyPayoutTargetUsd)
  );
  return roundUsd(Math.max(liquidityFloor, ltvDebt));
}

function calculateTriggerPriceUsd(draft, ltvPct) {
  const pct = pctToDecimal(ltvPct);
  if (!(pct > 0)) return 0;
  const btcUnits = asNumber(draft?.btcUnits);
  const debtUsd = asNumber(draft?.debtUsd);
  const spot = asNumber(draft?.btcPriceUsd);
  if (btcUnits > 0 && debtUsd > 0 && spot > 0) {
    const currentLtv = debtUsd / (btcUnits * spot);
    if (currentLtv <= 1) {
      return roundUsd(debtUsd / (btcUnits * pct));
    }
  }
  if (spot > 0) return roundUsd((spot * 0.18) / pct);
  return 0;
}

function calculateLtvPctForPriceUsd(draft, priceUsd) {
  const nextPriceUsd = Number(priceUsd);
  if (Number.isNaN(nextPriceUsd) || !(nextPriceUsd > 0)) return 0;
  const btcUnits = asNumber(draft?.btcUnits);
  const debtUsd = asNumber(draft?.debtUsd);
  const spot = asNumber(draft?.btcPriceUsd);
  if (btcUnits > 0 && debtUsd > 0 && spot > 0) {
    const currentLtv = debtUsd / (btcUnits * spot);
    if (currentLtv <= 1) {
      return (debtUsd / (btcUnits * nextPriceUsd)) * 100;
    }
  }
  if (spot > 0) return (spot * 0.18 / nextPriceUsd) * 100;
  return 0;
}

function clampGuardrailSnapshot(snapshot = {}) {
  const getValue = (field) => {
    const value = asNumber(snapshot[field]);
    if (Number.isFinite(value) && value > 0) return value;
    const fallback = asNumber(DEFAULT_DRAFT?.[field]);
    return Number.isFinite(fallback) && fallback > 0 ? fallback : GUARDRAIL_MIN_GAP_PCT;
  };
  const next = {
    targetLtvLowPct: getValue("targetLtvLowPct"),
    targetLtvHighPct: getValue("targetLtvHighPct"),
    autoRepayLtvPct: getValue("autoRepayLtvPct"),
    emergencyLtvPct: getValue("emergencyLtvPct"),
    maxLtvPct: getValue("maxLtvPct"),
  };

  let max = next.maxLtvPct;
  let emergency = next.emergencyLtvPct;
  let autoRepay = next.autoRepayLtvPct;
  let high = next.targetLtvHighPct;
  let low = next.targetLtvLowPct;

  if (emergency > max - GUARDRAIL_MIN_GAP_PCT) emergency = max - GUARDRAIL_MIN_GAP_PCT;
  if (autoRepay > emergency - GUARDRAIL_MIN_GAP_PCT) autoRepay = emergency - GUARDRAIL_MIN_GAP_PCT;
  if (high > autoRepay - GUARDRAIL_MIN_GAP_PCT) high = autoRepay - GUARDRAIL_MIN_GAP_PCT;
  if (low > high - GUARDRAIL_MIN_GAP_PCT) low = high - GUARDRAIL_MIN_GAP_PCT;

  if (low < GUARDRAIL_MIN_GAP_PCT) low = GUARDRAIL_MIN_GAP_PCT;
  if (high < low + GUARDRAIL_MIN_GAP_PCT) high = low + GUARDRAIL_MIN_GAP_PCT;
  if (autoRepay < high + GUARDRAIL_MIN_GAP_PCT) autoRepay = high + GUARDRAIL_MIN_GAP_PCT;
  if (emergency < autoRepay + GUARDRAIL_MIN_GAP_PCT) emergency = autoRepay + GUARDRAIL_MIN_GAP_PCT;
  if (max < emergency + GUARDRAIL_MIN_GAP_PCT) max = emergency + GUARDRAIL_MIN_GAP_PCT;

  return {
    targetLtvLowPct: Math.round(low * 2) / 2,
    targetLtvHighPct: Math.round(high * 2) / 2,
    autoRepayLtvPct: Math.round(autoRepay * 2) / 2,
    emergencyLtvPct: Math.round(emergency * 2) / 2,
    maxLtvPct: Math.round(max * 2) / 2,
  };
}

function getGuardrailBoundsForField(draft, field) {
  const snapshot = clampGuardrailSnapshot(draft);
  const low = asNumber(snapshot.targetLtvLowPct);
  const high = asNumber(snapshot.targetLtvHighPct);
  const autoRepay = asNumber(snapshot.autoRepayLtvPct);
  const emergency = asNumber(snapshot.emergencyLtvPct);
  const max = asNumber(snapshot.maxLtvPct);

  const bounds = {
    targetLtvLowPct: { min: GUARDRAIL_MIN_GAP_PCT, max: high - GUARDRAIL_MIN_GAP_PCT },
    targetLtvHighPct: { min: low + GUARDRAIL_MIN_GAP_PCT, max: autoRepay - GUARDRAIL_MIN_GAP_PCT },
    autoRepayLtvPct: { min: high + GUARDRAIL_MIN_GAP_PCT, max: emergency - GUARDRAIL_MIN_GAP_PCT },
    emergencyLtvPct: { min: autoRepay + GUARDRAIL_MIN_GAP_PCT, max: max - GUARDRAIL_MIN_GAP_PCT },
    maxLtvPct: { min: emergency + GUARDRAIL_MIN_GAP_PCT, max: 100 },
  };

  return bounds[field] || { min: GUARDRAIL_MIN_GAP_PCT, max: 100 };
}

function normalizeDraftForAlpha(draft) {
  const scenarioOrigin = String(draft?.scenarioOrigin || "").trim().toLowerCase();
  const isJudgeFixture = scenarioOrigin.startsWith("testnet-rehearsal:");
  const coerced = coerceLegacyDraftFields({
    ...draft,
    ...clampGuardrailSnapshot(draft),
  }, {
    defaultWrappedBtcSymbol: DEFAULT_WRAPPED_BTC_SYMBOL,
    defaultWrappedBtcCoinType: DEFAULT_WRAPPED_BTC_COIN_TYPE,
  });

  if (!isLiveEnabled()) {
    coerced.createScope = "shadow";
  }

  coerced.stableAssetSymbol = pickSupportedStableAsset(coerced.collateralAssetSymbol, coerced.stableAssetSymbol);
  if (!isJudgeFixture) {
    coerced.debtUsd = deriveSuggestedDebtUsd(coerced);
  }
  coerced.strategyPreset = detectStrategyPreset(coerced) || "";

  return coerced;
}

function encodeRouteDraftHandoff(draft = {}) {
  try {
    const payload = {
      v: 1,
      draft: clone(draft || {}),
    };
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const encoded = btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    return encoded.length <= 6000 ? encoded : "";
  } catch (_) {
    return "";
  }
}

function decodeRouteDraftHandoff(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const padded = raw.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(raw.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || parsed.v !== 1 || !isPlainObject(parsed.draft)) return null;
    return parsed.draft;
  } catch (_) {
    return null;
  }
}

function readRouteDraftHandoffFromUrl() {
  try {
    const params = new URL(window.location.href).searchParams;
    return decodeRouteDraftHandoff(params.get("draft") || "");
  } catch (_) {
    return null;
  }
}

function readRouteProofArmFromUrl() {
  try {
    const value = String(new URL(window.location.href).searchParams.get("proof") || "").trim().toLowerCase();
    return value === "1" || value === "true" || value === "testnet";
  } catch (_) {
    return false;
  }
}

function armDraftForTestnetProof(draft = {}) {
  return normalizeDraftForAlpha({
    ...draft,
    createScope: "live",
    scenarioOrigin: String(draft?.scenarioOrigin || "").trim() || "testnet-proof-handoff",
  });
}

function syncLiveAvailabilityUI() {
  const enabled = isLiveEnabled();
  document.querySelectorAll("[data-live-control]").forEach((node) => {
    // Mode-card live option stays visible on dev/live-disabled builds —
    // rendered as a disabled "Coming soon" affordance so the roadmap is
    // discoverable. Other [data-live-control] surfaces still hide
    // entirely when live isn't enabled.
    if (node.matches('.mode-card__opt[data-scope="live"]')) {
      node.hidden = false;
      node.setAttribute("aria-hidden", "false");
      return;
    }
    node.hidden = !enabled;
    node.setAttribute("aria-hidden", String(!enabled));
  });
  syncLiveModeCardAvailability();
}

function syncLiveModeCardAvailability() {
  const liveOpt = document.querySelector('.mode-card__opt[data-scope="live"]');
  if (!liveOpt) return;
  const liveEnabled = isLiveEnabled();
  const connected = Boolean(getWalletState().connected);
  // On live-disabled builds (dev/preview), the option reads as
  // "Coming soon" and is fully disabled regardless of wallet state.
  // On live-enabled builds (testnet), the option stays selectable as a
  // proof intent; signing/save/mint actions remain wallet-gated deeper
  // in getCreateScopeState/syncPolicyActionButtons.
  const disabled = !liveEnabled;
  liveOpt.classList.toggle("is-disabled", disabled);
  liveOpt.dataset.liveState = !liveEnabled
    ? "coming-soon"
    : !connected
      ? "wallet-required"
      : "ready";
  liveOpt.setAttribute("aria-disabled", String(disabled));
  liveOpt.title = !liveEnabled
    ? "Testnet proof is unavailable here. Use testnet to connect a wallet and mint receipts."
    : connected
      ? "Bind the draft to a real wrapper + wallet balance."
      : "Select Testnet proof intent now; connect wallet before saving or minting receipts.";
  const radio = liveOpt.querySelector('input[type="radio"]');
  if (radio) {
    radio.disabled = disabled;
  }
  // Swap the sublabel between "Wallet-backed" and "Coming soon" depending
  // on live availability. Cache the original copy on first swap so we can
  // restore it if isLiveEnabled flips back true at runtime.
  const subLabel = liveOpt.querySelector("em");
  if (subLabel) {
    if (!liveEnabled) {
      if (!subLabel.dataset.originalText) {
        subLabel.dataset.originalText = subLabel.textContent || "";
      }
      subLabel.textContent = "Use testnet";
    } else if (!connected) {
      if (!subLabel.dataset.originalText) {
        subLabel.dataset.originalText = subLabel.textContent || "";
      }
      subLabel.textContent = "Connect wallet";
    } else if (connected) {
      subLabel.textContent = "Wallet connected";
    } else if (subLabel.dataset.originalText) {
      subLabel.textContent = subLabel.dataset.originalText;
    }
  }
}

function getDisabledLiveModeStatusCopy() {
  const liveEnabled = isLiveEnabled();
  const connected = Boolean(getWalletState().connected);
  if (!liveEnabled) {
    const network = String(window.TIDE_CONFIG?.sui?.network || "").trim().toLowerCase();
    if (network === "mainnet") {
      return "Testnet proof is disabled on this mainnet read-only build. Use testnet for wallet-backed rehearsal.";
    }
    return "Testnet proof is disabled on this build. Use testnet for wallet-backed rehearsal.";
  }
  if (!connected) {
    return "Testnet proof selected. Connect wallet before saving a policy or minting a receipt.";
  }
  return "Testnet proof is not available for the current draft yet.";
}

// Frozen scope: four BTC-collateralised allocators get the full integration
// contract (live rail pack, simulator, Live rehearsal mode). Everything flagged
// `experimental: true` is behind the `showExperimentalRails` runtime config
// and is NOT part of the product promise — treat as collector telemetry only.
const LIVE_COLLECTOR_RAILS = [
  {
    name: "Bucket Protocol",
    scope: "Allocator",
    subtitle: "Allocator rail · BTC collateral / USDB",
  },
  {
    name: "Scallop",
    scope: "Allocator",
    subtitle: "Allocator rail · BTC collateral / USDC",
  },
  {
    name: "NAVI Protocol",
    scope: "Allocator",
    subtitle: "Allocator rail · BTC collateral / stable debt",
  },
  {
    name: "Suilend",
    scope: "Allocator",
    subtitle: "Allocator rail · onchain reserve parser",
  },
  {
    name: "AlphaLend",
    scope: "Allocator",
    subtitle: "Allocator rail · SDK runtime",
    experimental: true,
  },
  {
    name: "Kai Finance",
    scope: "VaultSurface",
    subtitle: "Vault surface · BTC vaults plus stable pool context",
    experimental: true,
  },
  {
    name: "Astros",
    scope: "StrategySurface",
    subtitle: "Strategy surface · vault risk stats",
    experimental: true,
  },
  {
    name: "Volo",
    scope: "VaultSurface",
    subtitle: "Vault surface · BTC vault TVL and utilization",
    experimental: true,
  },
  {
    name: "Haedal",
    scope: "VaultSurface",
    subtitle: "Vault surface · collateral and liquidity context",
    experimental: true,
  },
  {
    name: "AlphaFi",
    scope: "VaultSurface",
    subtitle: "Vault surface · strategy reachability",
    experimental: true,
  },
  {
    name: "Lotus Finance",
    scope: "VaultSurface",
    subtitle: "Vault surface · farms reachability",
    experimental: true,
  },
  {
    name: "Metastable",
    scope: "VaultSurface",
    subtitle: "Vault surface · mBTC structured vault context",
    experimental: true,
  },
  {
    name: "Native",
    scope: "BridgeSurface",
    subtitle: "Bridge surface · ingress and routing context",
    experimental: true,
  },
  {
    name: "Nemo",
    scope: "StrategySurface",
    subtitle: "Strategy surface · tokenized strategy context",
    experimental: true,
  },
  {
    name: "Typus",
    scope: "DerivativesSurface",
    subtitle: "Derivatives surface · TLP and options context",
    experimental: true,
  },
  {
    name: "Magma",
    scope: "RoutingSurface",
    subtitle: "Routing surface · liquidity engine context",
    experimental: true,
  },
];

const DEFAULT_SCENARIO_NAME = "New scenario";

const DEFAULT_DRAFT = {
  scenarioName: DEFAULT_SCENARIO_NAME,
  strategyPreset: "starter",
  createScope: "shadow",
  scenarioOrigin: "",
  selectedRail: "",
  railId: "",
  mode: UserMode.Income,
  priority: RiskPriority.Stability,
  btcUnits: 0.5,
  collateralCoinType: DEFAULT_WRAPPED_BTC_COIN_TYPE,
  collateralAssetSymbol: DEFAULT_WRAPPED_BTC_SYMBOL,
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
};

const scenarioStateStore = createScenarioStateStore({
  storage: walletStorage,
  defaultDraft: DEFAULT_DRAFT,
  normalizeDraft: normalizeDraftForAlpha,
  normalizeLiveControlStore,
  normalizeLiveUnwindProgressStore,
});
const loadScenarioStateBundle = scenarioStateStore.loadScenarioStateBundle;

const createScopeFieldState = {
  shadow: {
    btcUnits: null,
    btcPriceUsd: null,
  },
  live: {
    btcUnits: null,
    btcPriceUsd: null,
  },
};

const STRATEGY_PRESETS = {
  starter: {
    label: "Harbor",
    fields: {
      strategyPreset: "starter",
      mode: UserMode.Income,
      priority: RiskPriority.Stability,
      monthlyPayoutTargetUsd: 1200,
      desiredRunwayMonths: 4,
      minStableBufferUsd: 3600,
      maxLtvPct: 34,
      targetLtvLowPct: 18,
      targetLtvHighPct: 24,
      autoRepayLtvPct: 27,
      emergencyLtvPct: 31,
      allowPayoutPauseInStress: true,
      allowNewBorrowInStress: false,
      allowNewBorrowInCrisis: false,
    },
  },
  safety: {
    label: "Breakwater",
    fields: {
      strategyPreset: "safety",
      mode: UserMode.Income,
      priority: RiskPriority.Safety,
      monthlyPayoutTargetUsd: 900,
      desiredRunwayMonths: 6,
      minStableBufferUsd: 5400,
      maxLtvPct: 30,
      targetLtvLowPct: 16,
      targetLtvHighPct: 21,
      autoRepayLtvPct: 24,
      emergencyLtvPct: 28,
      allowPayoutPauseInStress: true,
      allowNewBorrowInStress: false,
      allowNewBorrowInCrisis: false,
    },
  },
  drift: {
    label: "Drift",
    fields: {
      strategyPreset: "drift",
      mode: UserMode.Income,
      priority: RiskPriority.Stability,
      monthlyPayoutTargetUsd: 600,
      desiredRunwayMonths: 8,
      minStableBufferUsd: 4800,
      maxLtvPct: 38,
      targetLtvLowPct: 22,
      targetLtvHighPct: 28,
      autoRepayLtvPct: 31,
      emergencyLtvPct: 35,
      allowPayoutPauseInStress: true,
      allowNewBorrowInStress: false,
      allowNewBorrowInCrisis: false,
    },
  },
};

function resolveRouteLocalUrl(path) {
  if (typeof path !== "string" || !path.trim()) {
    return path;
  }
  const value = path.trim();
  if (/^[a-z][a-z\d+\-.]*:\/\//i.test(value) || value.startsWith("/") || value.startsWith("data:")) {
    return value;
  }
  if (typeof window === "undefined" || !window.location?.origin || window.location.origin === "null") {
    return value;
  }
  return new URL(value.replace(/^\.\//, ""), `${window.location.origin}/`).toString();
}

const LOGO_ROOT = resolveRouteLocalUrl("./assets/logos").replace(/\/+$/, "");
const PROTOCOL_VISUAL_OVERRIDES = {
  "kai-finance": {
    src: `${LOGO_ROOT}/protocols/kai-finance.png`,
    fallbackSrc: `${LOGO_ROOT}/protocols/generic.svg`,
    scale: 1.18,
  },
};

/* Background colors for protocol logos that don't fill their container */
const PROTOCOL_BG_COLORS = {
  "scallop": "#f1d6c8",
  "navi": "#2b2d37",
  "bucket": "#1a1a2e",
  "alphalend": "#0e1726",
  "suilend": "#020818",
  "kai-finance": "#000000",
  "astros": "#111827",
  "bluefin": "#0a0f1e",
  "deepbook": "#0a1020",
  "typus": "#1D252D",
  "hop-aggregator": "#0a1628",
  "magma": "#101010",
  "alphafi": "#2898F8",
  "volo": "#ffffff",
  "nemo": "#010914",
};
const TOKEN_LOGO_KEYS = {
  BTC: "btc",
  BTCBASKET: "btcbasket",
  WBTC: "wbtc",
  LBTC: "lbtc",
  STBTC: "stbtc",
  XBTC: "xbtc",
  NBTC: "nbtc",
  USDC: "usdc",
  USDB: "usdb",
  SUIUSD: "suiusd",
  USDSUI: "suiusd",
  BUCK: "usdc",
  FDUSD: "usdc",
  SUIUSDE: "suiusd",
  SUIUSDT: "suiusdt",
  AUSD: "ausd",
  USDCET: "usdcet",
  HASUI: "hasui",
  MBTC: "mbtc",
  MUSD: "musd",
};

const TOKEN_VISUAL_OVERRIDES = {
  USDC: {
    src: `${LOGO_ROOT}/tokens/usdc-suivision.png`,
    fallbackSrc: `${LOGO_ROOT}/tokens/usdc.svg`,
  },
  SUIUSD: {
    src: `${LOGO_ROOT}/tokens/suiusd.svg`,
    fallbackSrc: `${LOGO_ROOT}/tokens/usdc.svg`,
  },
  USDSUI: {
    src: `${LOGO_ROOT}/tokens/suiusd.svg`,
    fallbackSrc: `${LOGO_ROOT}/tokens/usdc.svg`,
  },
  BUCK: {
    src: `${LOGO_ROOT}/tokens/usdc-suivision.png`,
    fallbackSrc: `${LOGO_ROOT}/tokens/usdc.svg`,
  },
  FDUSD: {
    src: `${LOGO_ROOT}/tokens/usdc-suivision.png`,
    fallbackSrc: `${LOGO_ROOT}/tokens/usdc.svg`,
  },
  SUIUSDE: {
    src: `${LOGO_ROOT}/tokens/suiusd.svg`,
    fallbackSrc: `${LOGO_ROOT}/tokens/usdc.svg`,
  },
  SUIUSDT: {
    src: `${LOGO_ROOT}/tokens/suiusdt.svg`,
    fallbackSrc: `${LOGO_ROOT}/tokens/usdc.svg`,
  },
  USDCET: {
    src: `${LOGO_ROOT}/tokens/usdc-suivision.png`,
    fallbackSrc: `${LOGO_ROOT}/tokens/usdcet.svg`,
  },
};

const currentPage = document.body.dataset.page || "workspace";
const form = document.querySelector("#scenario-form");
function getStatusNote() {
  return document.querySelector("#status-note");
}

let _signingTimelineState = null;
let _signingTimelineClearTimer = null;

// Locale-aware Intl formatters. Phase D.4 — currency + numeric
// formatters are LOCKED to en-US because the cockpit is English-only
// and the previous "navigator.language" default produced broken-
// looking output in non-English locales: e.g. ru-RU formatted "$1.2k"
// as "1,2 тыс. $", which is unreadable inside the English UI copy.
// Dates / relative times still follow the user's locale so today /
// yesterday wording is natural. Per i18n §10 update 2026-04-26.
const userLocale = (typeof navigator !== "undefined" && navigator.language)
  ? navigator.language
  : "en-US";
const numberLocale = "en-US";

const currencyFormatter = new Intl.NumberFormat(numberLocale, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const compactCurrencyFormatter = new Intl.NumberFormat(numberLocale, {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const btcAmountFormatter = new Intl.NumberFormat(numberLocale, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 8,
});

const dateTimeFormatter = new Intl.DateTimeFormat(userLocale, {
  dateStyle: "medium",
  timeStyle: "short",
});

const relativeTimeFormatter = new Intl.RelativeTimeFormat(userLocale, {
  numeric: "auto",
});

const appState = {
  draft: null,
  current: null,
  saved: [],
  // Explicitly saved drafts (named templates) — separate from `draft` which
  // is the scratch buffer behind the Create form.
  drafts: [],
  // Id of the drafts[] record the Setup form is currently editing, or "".
  // When set, Save-as-draft updates that record in place, including rename
  // edits, instead of creating a duplicate.
  activeDraftId: "",
  compareId: null,
  theme: loadStorage(STORAGE_THEME_KEY, "dark", { global: true }),
  railPack: loadPersistedRailPack(),
  // Prediction-market forecast (Kalshi/Polymarket consensus, cached by ops
  // worker). Null until refreshMarketForecast() succeeds; the simulator still
  // runs without it, falling back to the hardcoded drawdown bucket scenarios.
  marketForecast: null,
  // "idle" | "loading" | "loaded" | "unavailable". Separate from marketForecast
  // so the UI can distinguish "still waiting" from "fetched and no data" —
  // otherwise the Polymarket overlay sits on a flat placeholder forever.
  marketForecastStatus: "idle",
  // Kalshi short-horizon BTC range ladder. Same shape as marketForecast; kept
  // in a parallel slot because Kalshi horizon (hours/days) and Polymarket
  // horizon (months) represent different questions — we render them as
  // separate overlay tabs rather than mashing them together.
  kalshiForecast: null,
  kalshiForecastStatus: "idle",
  // Read-only Pyth BTC/USD feed posture. Config-driven; empty config renders
  // as an explicit missing state so the readout never implies oracle backing
  // that this environment does not have.
  oracleReadback: null,
  oracleReadbackStatus: "idle",
  latestProofReceipt: null,
  opsHealth: {
    status: "idle",
    payload: null,
    error: "",
    fetchedAt: 0,
  },
  liveControlState: {},
  liveUnwindProgress: {},
  activityLedgerFilter: "all",
};

const _signingDiagnostics = {
  liveExecution: null,
  policySync: null,
  receiptMint: null,
};

let simulator = createSimulator();

// Pulls the latest market forecast snapshot, stashes it on appState, and
// returns it. Non-blocking by design — callers can run the simulator even
// when this resolves with null (we just skip the market-implied scenarios).
async function refreshMarketForecast({ silent = false } = {}) {
  appState.marketForecastStatus = "loading";
  try {
    const result = await fetchMarketForecast(getRuntimeConfig());
    if (result?.forecast) {
      appState.marketForecast = {
        ...result.forecast,
        stale: Boolean(result.stale),
      };
      appState.marketForecastStatus = "loaded";
    } else {
      appState.marketForecast = null;
      appState.marketForecastStatus = "unavailable";
    }
    return appState.marketForecast;
  } catch (error) {
    appState.marketForecast = null;
    appState.marketForecastStatus = "unavailable";
    if (!silent) {
      console.warn("market forecast refresh failed", error);
    }
    return null;
  }
}

let _scenarioForecastWarmPromise = null;
let _scenarioChecksRerenderTimer = null;

async function ensureScenarioForecastLoaded() {
  if (appState.marketForecast) return appState.marketForecast;
  if (_scenarioForecastWarmPromise) return _scenarioForecastWarmPromise;
  _scenarioForecastWarmPromise = refreshMarketForecast({ silent: true })
    .catch(() => null)
    .finally(() => {
      _scenarioForecastWarmPromise = null;
    });
  return _scenarioForecastWarmPromise;
}

async function refreshKalshiForecast({ silent = false } = {}) {
  appState.kalshiForecastStatus = "loading";
  try {
    const result = await fetchKalshiForecast(getRuntimeConfig());
    if (result?.forecast) {
      appState.kalshiForecast = {
        ...result.forecast,
        stale: Boolean(result.stale),
      };
      appState.kalshiForecastStatus = "loaded";
    } else {
      appState.kalshiForecast = null;
      appState.kalshiForecastStatus = "unavailable";
    }
    return appState.kalshiForecast;
  } catch (error) {
    appState.kalshiForecast = null;
    appState.kalshiForecastStatus = "unavailable";
    if (!silent) console.warn("kalshi forecast refresh failed", error);
    return null;
  }
}

let _kalshiForecastWarmPromise = null;
async function ensureKalshiForecastLoaded() {
  if (appState.kalshiForecast) return appState.kalshiForecast;
  if (_kalshiForecastWarmPromise) return _kalshiForecastWarmPromise;
  _kalshiForecastWarmPromise = refreshKalshiForecast({ silent: true })
    .catch(() => null)
    .finally(() => { _kalshiForecastWarmPromise = null; });
  return _kalshiForecastWarmPromise;
}

function getPythOracleRuntimeConfig(runtime = getRuntimeConfig()) {
  const pyth = runtime?.oracle?.pyth || {};
  const staleMaxMs = Number(pyth.staleMaxMs);
  return {
    priceInfoObjectId: String(pyth.priceInfoObjectId || "").trim(),
    feedSymbol: String(pyth.feedSymbol || "BTC/USD").trim() || "BTC/USD",
    rpcUrl: String(pyth.rpcUrl || runtime?.sui?.rpcUrl || "").trim(),
    staleMaxMs: Number.isFinite(staleMaxMs) && staleMaxMs > 0 ? staleMaxMs : 60_000,
  };
}

function buildConfiguredMissingPythReadback(message = "") {
  const cfg = getPythOracleRuntimeConfig();
  return buildMissingPythReadback({
    feedSymbol: cfg.feedSymbol,
    staleMaxMs: cfg.staleMaxMs,
    trustLabel: message || "Pyth BTC/USD is not configured for this environment. This readout uses modeled BTC price inputs.",
  });
}

function isPythOracleReadbackRequired(runtime = getRuntimeConfig()) {
  return Boolean(getPythOracleRuntimeConfig(runtime).priceInfoObjectId);
}

async function refreshPythOracleReadback({ silent = false } = {}) {
  appState.oracleReadbackStatus = "loading";
  const cfg = getPythOracleRuntimeConfig();
  try {
    if (!cfg.priceInfoObjectId) {
      appState.oracleReadback = buildConfiguredMissingPythReadback();
      appState.oracleReadbackStatus = "unavailable";
      return appState.oracleReadback;
    }
    appState.oracleReadback = await fetchPythReadback({
      priceInfoObjectId: cfg.priceInfoObjectId,
      feedSymbol: cfg.feedSymbol,
      network: getSuiNetwork(getRuntimeConfig()),
      rpcUrl: cfg.rpcUrl || null,
      staleMaxMs: cfg.staleMaxMs,
    });
    appState.oracleReadbackStatus = appState.oracleReadback?.source === "missing" ? "unavailable" : "loaded";
    return appState.oracleReadback;
  } catch (error) {
    appState.oracleReadback = buildConfiguredMissingPythReadback("Pyth read-back failed in this environment. This readout keeps using modeled BTC price inputs.");
    appState.oracleReadbackStatus = "unavailable";
    if (!silent) console.warn("pyth oracle read-back failed", error);
    return appState.oracleReadback;
  }
}

let _pythOracleWarmPromise = null;
async function ensurePythOracleReadbackLoaded() {
  if (appState.oracleReadback) return appState.oracleReadback;
  if (_pythOracleWarmPromise) return _pythOracleWarmPromise;
  _pythOracleWarmPromise = refreshPythOracleReadback({ silent: true })
    .catch(() => null)
    .finally(() => { _pythOracleWarmPromise = null; });
  return _pythOracleWarmPromise;
}

function isPythOracleReadbackReadyForReceipt(readback, now = Date.now()) {
  if (!readback || typeof readback !== "object") return false;
  const source = String(readback.source || "").trim();
  if (!source || source === "missing" || source === "fixture") return false;
  if (readback.stale === true) return false;
  return !isReadbackStale(readback, now);
}

async function ensurePythOracleReadbackReadyForReceipt(runtime = getRuntimeConfig()) {
  if (!isPythOracleReadbackRequired(runtime)) return appState.oracleReadback || null;
  let readback = appState.oracleReadback || null;
  if (!isPythOracleReadbackReadyForReceipt(readback)) {
    readback = await refreshPythOracleReadback({ silent: true });
  }
  if (!isPythOracleReadbackReadyForReceipt(readback)) {
    const error = new Error("Pyth BTC/USD read-back is required but unavailable or stale. Refresh oracle read-back before minting a receipt.");
    error.code = "pyth-readback-unavailable";
    throw error;
  }
  return readback;
}

function getReceiptMintReadinessBlocker(runtime = getRuntimeConfig()) {
  if (runtime?.executionProof?.allowSigning === true && !runtime?.walrus?.publisherUrl) {
    return {
      code: "walrus-publisher-missing",
      message: "Proof storage is not available in this build. Use the configured testnet build before minting a receipt.",
    };
  }
  if (!isPythOracleReadbackRequired(runtime)) return null;
  if (isPythOracleReadbackReadyForReceipt(appState.oracleReadback)) return null;
  if (appState.oracleReadbackStatus === "idle" || appState.oracleReadbackStatus === "loading") {
    return {
      code: "pyth-loading",
      message: "Waiting for a fresh BTC price check before minting a receipt.",
    };
  }
  const stale = appState.oracleReadback?.stale === true || isReadbackStale(appState.oracleReadback);
  return {
    code: stale ? "pyth-stale" : "pyth-unavailable",
    message: stale
      ? "The BTC price check is stale. Refresh evidence before minting a receipt."
      : "The BTC price check is unavailable. Refresh evidence before minting a receipt.",
  };
}

function rerenderScenarioChecksForCurrentPage() {
  if (currentPage === "setup" && form) {
    const host = document.getElementById("setup-scenario-workbench");
    if (host) renderGuardrailsChart(host, { draft: readDraftFromForm(), interactive: true });
  }
  if ((currentPage === "results" || currentPage === "live") && appState.current?.draft) {
    const host = document.getElementById("results-guardrails-chart");
    if (host) renderGuardrailsChart(host, { draft: appState.current.draft, interactive: false });
  }
}

function queueScenarioChecksRerender(delay = 180) {
  // Setup, Results, and Live host the guardrails chart. Without a re-render on
  // setup, the strip's closure-captured stripLo/stripSpan go stale after a
  // drag and thumbs get clamped to left:0 when the user pulls a threshold
  // outside the original range. Results/Live also need a refresh after
  // async Polymarket/Kalshi forecast fetches resolve.
  if (currentPage !== "results" && currentPage !== "setup" && currentPage !== "live") return;
  if (_scenarioChecksRerenderTimer) {
    clearTimeout(_scenarioChecksRerenderTimer);
  }
  _scenarioChecksRerenderTimer = setTimeout(() => {
    _scenarioChecksRerenderTimer = null;
    rerenderScenarioChecksForCurrentPage();
  }, delay);
}

let _proofEvidenceRefreshPromise = null;
async function refreshProofEvidence({ silent = false, rerun = true } = {}) {
  if (_proofEvidenceRefreshPromise) return _proofEvidenceRefreshPromise;
  _proofEvidenceRefreshPromise = Promise.allSettled([
    refreshPythOracleReadback({ silent }),
    maybeLoadConfiguredRailPack({ rerun, silent }),
    refreshLatestProofReceipt({ silent: true }),
  ])
    .then((results) => {
      const failures = results
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason);
      if (failures.length > 0 && !silent) {
        setStatus("Some proof evidence could not be refreshed. Check the evidence panel before minting.", true);
      } else if (!silent) {
        setStatus("Proof evidence refreshed.");
      }
      syncPolicyActionButtons();
      syncMintReceiptButton();
      renderCurrentPage();
      return results;
    })
    .finally(() => {
      _proofEvidenceRefreshPromise = null;
    });
  return _proofEvidenceRefreshPromise;
}

const protocolIndex = new Map();
for (const protocol of SUI_BTCFI_PROTOCOLS) {
  protocolIndex.set(normalizeEntityKey(protocol.id), protocol);
  protocolIndex.set(normalizeEntityKey(protocol.name), protocol);
}

function $(selector) {
  return document.querySelector(selector);
}

function getRuntimeConfig() {
  return window.TIDE_CONFIG || {};
}

function getLatestProofReceiptLink(config = getRuntimeConfig()) {
  const receiptMint = appState.latestProofReceipt || config?.proof?.receiptMint || null;
  const objectId = typeof receiptMint?.objectId === "string" ? receiptMint.objectId.trim() : "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(objectId)) return null;
  const href = buildReceiptReadOnlyUrl({ id: objectId }, {
    config,
    network: "testnet",
  });
  if (!href) return null;
  return {
    href,
    id: objectId,
    decisionType: typeof receiptMint?.decisionType === "string" ? receiptMint.decisionType : "",
    selectedRail: typeof receiptMint?.selectedRail === "string" ? receiptMint.selectedRail : "",
  };
}

function getCreateScopeProofContext(config = getRuntimeConfig()) {
  const network = getSuiNetwork(config);
  const allowSigning = config?.executionProof?.allowSigning === true;
  return {
    allowMockCollateral: network === "testnet" && allowSigning,
    modeLabel: "Testnet rehearsal",
  };
}

function getLiveRailPackConfig() {
  const config = getRuntimeConfig().liveRailPack || {};
  const seedMarket = config.seedMarket && typeof config.seedMarket === "object"
    ? config.seedMarket
    : null;

  return {
    buildId: typeof getRuntimeConfig().buildId === "string" ? getRuntimeConfig().buildId.trim() : "",
    url: typeof config.url === "string" ? config.url.trim() : "",
    verifyKey: typeof config.verifyKey === "string" ? config.verifyKey.trim() : "",
    autoLoad: config.autoLoad === true,
    preferRemote: config.preferRemote === true,
    persist: config.persist !== false,
    seedMarket: seedMarket && Number(seedMarket.btcPriceUsd) > 1_000
      ? {
          btcPriceUsd: roundUsd(Number(seedMarket.btcPriceUsd)),
          updatedAt: typeof seedMarket.updatedAt === "string" ? seedMarket.updatedAt : "",
          source: typeof seedMarket.source === "string" ? seedMarket.source : "build-seeded",
        }
      : null,
  };
}

function appendBuildId(url, buildId) {
  if (!url || !buildId) {
    return url;
  }

  if (/[?&]v=/.test(url)) {
    return url;
  }

  return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(buildId)}`;
}

function getLiveRailPackCandidateUrls(config = getLiveRailPackConfig()) {
  const buildId = config.buildId;
  const urls = [
    appendBuildId(resolveRouteLocalUrl(config.url), buildId),
    appendBuildId(resolveRouteLocalUrl("./live-rail-pack.json"), buildId),
    appendBuildId(resolveRouteLocalUrl("./examples/live-rail-pack.generated.json"), buildId),
    appendBuildId(resolveRouteLocalUrl("./examples/live-rail-pack.example.json"), buildId),
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);

  return [...new Set(urls)];
}

function isSameOriginRuntimeUrl(url) {
  if (!isRemoteUrl(url)) {
    return true;
  }
  if (typeof window === "undefined" || !window.location?.origin) {
    return false;
  }
  try {
    return new URL(String(url), window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

function requiresRailPackSignature(url) {
  return isRemoteUrl(url) && !isSameOriginRuntimeUrl(url);
}

const escapeHtml = sharedEscapeHtml;

/**
 * DOM element factory for small native render paths.
 * Children can be strings (set as textContent), Nodes, or arrays of either.
 */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, val] of Object.entries(attrs)) {
      if (key === "className") el.className = val;
      else if (key === "dataset") Object.assign(el.dataset, val);
      else if (key.startsWith("on") && typeof val === "function") {
        el.addEventListener(key.slice(2).toLowerCase(), val);
      } else if (val === true) el.setAttribute(key, "");
      else if (val !== false && val != null) el.setAttribute(key, String(val));
    }
  }
  const append = (child) => {
    if (child == null || child === false) return;
    if (typeof child === "string" || typeof child === "number") {
      el.appendChild(document.createTextNode(String(child)));
    } else if (Array.isArray(child)) {
      child.forEach(append);
    } else if (child instanceof Node) {
      el.appendChild(child);
    }
  };
  children.forEach(append);
  return el;
}

/**
 * Parse a trusted HTML string into a DocumentFragment using a <template> element.
 * This avoids setting innerHTML on live DOM nodes — the parsing happens in
 * an inert context where scripts cannot execute.
 */
const _tmplEl = document.createElement("template");
function trustedFragment(html) {
  _tmplEl.innerHTML = html; // Safe: <template> content is inert (no script execution)
  const frag = _tmplEl.content.cloneNode(true);
  _tmplEl.innerHTML = ""; // Clean up
  return frag;
}

/**
 * Replace all children of a live DOM element with parsed trusted HTML.
 * All dynamic values in the HTML MUST already be escaped via escapeHtml().
 * This replaces direct innerHTML assignment on live elements with inert parsing.
 */
function safeReplaceChildren(el, html) {
  if (!el) return;
  if (html == null || html === false) {
    el.replaceChildren();
    return;
  }
  if (typeof Node !== "undefined" && html instanceof Node) {
    el.replaceChildren(html);
    return;
  }
  el.replaceChildren(trustedFragment(String(html)));
}

const _firstPaintShimmerKeys = new Set();

function markFirstPaintShimmer(el, key) {
  if (!el || !key || _firstPaintShimmerKeys.has(key)) return;
  _firstPaintShimmerKeys.add(key);
  el.dataset.shimmer = "first-paint";
  window.setTimeout(() => {
    if (el.dataset.shimmer === "first-paint") {
      delete el.dataset.shimmer;
    }
  }, 450);
}

function persistLiveControlState(address = getWalletState().address) {
  appState.liveControlState = normalizeLiveControlStore(appState.liveControlState);
  saveStorage(STORAGE_LIVE_CONTROL_KEY, appState.liveControlState, { address });
}

function persistLiveUnwindProgress(address = getWalletState().address) {
  appState.liveUnwindProgress = normalizeLiveUnwindProgressStore(appState.liveUnwindProgress);
  saveStorage(STORAGE_LIVE_UNWIND_PROGRESS_KEY, appState.liveUnwindProgress, { address });
}

function normalizeLiveMainnetEvidenceEntry(raw = {}, policyId = "") {
  const pinnedPolicyId = normalizeLiveHistoryText(policyId || raw?.policyId);
  const status = String(raw?.status || "").trim() === "verified" ? "verified" : raw?.status === "error" ? "error" : "pending";
  const preReadback = normalizeMainnetReadbackForBundle(raw?.preReadback);
  const postReadback = normalizeMainnetReadbackForBundle(raw?.postReadback);
  return {
    policyId: pinnedPolicyId,
    digest: normalizeLiveHistoryText(raw?.digest),
    sender: normalizeWalletAddress(raw?.sender).toLowerCase(),
    obligationId: normalizeLiveHistoryText(raw?.obligationId).toLowerCase(),
    checkpoint: normalizeLiveHistoryText(raw?.checkpoint),
    timestampMs: Number(raw?.timestampMs) || 0,
    objectChangeCount: Number(raw?.objectChangeCount) || 0,
    verifiedAt: Number(raw?.verifiedAt) || 0,
    status,
    error: status === "error" ? normalizeLiveHistoryText(raw?.error) : "",
    ...(preReadback ? { preReadback } : {}),
    ...(postReadback ? { postReadback } : {}),
  };
}

function getPolicyLiveMainnetEvidence(policyId = "") {
  const pinned = normalizeLiveHistoryText(policyId);
  if (!pinned) return normalizeLiveMainnetEvidenceEntry({}, "");
  const progress = getPolicyLiveUnwindProgress(appState.liveUnwindProgress, pinned);
  return normalizeLiveMainnetEvidenceEntry(progress?.mainnetEvidence || {}, pinned);
}

function setPolicyLiveMainnetEvidence(policyId = "", evidence = {}) {
  const pinned = normalizeLiveHistoryText(policyId);
  if (!pinned) return;
  const current = getPolicyLiveUnwindProgress(appState.liveUnwindProgress, pinned);
  appState.liveUnwindProgress = normalizeLiveUnwindProgressStore({
    ...appState.liveUnwindProgress,
    [pinned]: {
      ...current,
      policyId: pinned,
      mainnetEvidence: normalizeLiveMainnetEvidenceEntry(evidence, pinned),
      updatedAt: Date.now(),
    },
  });
}

function persistCurrentState() {
  scenarioStateStore.persistCurrentState(appState.current);
}

function trackEvent(name, properties = {}) {
  if (typeof window.tideTrackEvent === "function") {
    window.tideTrackEvent(name, {
      surface: currentPage,
      ...properties,
    });
  }
}

// 5-event acquisition funnel: setup_started → policy_saved → live_toggled →
// results_viewed → access_requested. Page-mount events fire once per load
// so a re-render does not double-count.
let _funnelFiredPageMount = false;
function fireFunnelPageMountBeacon() {
  if (_funnelFiredPageMount) return;
  _funnelFiredPageMount = true;
  if (currentPage === "setup") {
    trackEvent("setup_started", {
      hasDraft: Boolean(appState.draft),
      walletConnected: getWalletState().connected,
    });
    return;
  }
  if (currentPage === "results") {
    trackEvent("results_viewed", {
      hasRun: Boolean(appState.current?.report),
      preset: appState.current?.draft?.preset || "custom",
    });
    return;
  }
  if (currentPage === "live") {
    trackEvent("live_toggled", {
      liveEnabled: isLiveEnabled(),
      walletConnected: getWalletState().connected,
    });
  }
}

function reportClientError(error, context = {}) {
  if (typeof window.tideReportError !== "function") {
    return;
  }

  window.tideReportError({
    source: "shadow-mode",
    page: currentPage,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack || "" : "",
    ...context,
  });
}

function recordSigningFailure(slot, error, options = {}) {
  const classified = classifySigningError(error, options);
  const telemetry = buildSigningErrorTelemetry(classified);
  const diagnostics = {
    ...telemetry,
    userMessage: classified.userMessage,
    developerMessage: classified.developerMessage,
    rawMessage: classified.rawMessage,
    context: { ...options },
    at: new Date().toISOString(),
  };
  if (Object.prototype.hasOwnProperty.call(_signingDiagnostics, slot)) {
    _signingDiagnostics[slot] = diagnostics;
  }
  if (classified.isUserCancellation) {
    console.info(`[tide] ${slot} signing cancelled`, diagnostics);
  } else {
    console.error(`[tide] ${slot} signing failure`, diagnostics);
  }
  return { classified, telemetry, diagnostics };
}

function isUserSigningCancellation(signingFailure) {
  return Boolean(signingFailure?.classified?.isUserCancellation);
}

function getSigningFailureStatusOptions(signingFailure) {
  const failureClass = signingFailure?.classified?.failureClass || "";
  if (failureClass === "rpc-timeout") {
    return { testId: "rpc-timeout-banner" };
  }
  if (failureClass === "wallet-reject") {
    return { testId: "wallet-cancel-toast" };
  }
  return {};
}

function setSigningFailureStatus(signingFailure) {
  const message = signingFailure?.classified?.userMessage || "Signing failed. Check wallet and network state, then retry.";
  setStatus(message, !isUserSigningCancellation(signingFailure), null, getSigningFailureStatusOptions(signingFailure));
}

function formatPolicyObjectId(policyId) {
  const value = typeof policyId === "string" ? policyId.trim() : "";
  if (!value) {
    return "Local only";
  }

  if (value.length <= 18) {
    return value;
  }

  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function buildLocalPolicyFallback(policyId, snapshot, owner, digest = "") {
  const now = Date.now();
  return {
    id: policyId || "",
    owner: owner || "",
    name: snapshot.name,
    mode: snapshot.mode,
    priority: snapshot.priority,
    collateralSymbol: snapshot.collateralSymbol,
    collateralCoinType: snapshot.collateralCoinType,
    selectedRail: snapshot.selectedRail,
    payoutTargetUsd: snapshot.payoutTargetUsd,
    minBufferUsd: snapshot.minBufferUsd,
    maxLtvBps: snapshot.maxLtvBps,
    targetLtvLowBps: snapshot.targetLtvLowBps,
    targetLtvHighBps: snapshot.targetLtvHighBps,
    repayLtvBps: snapshot.repayLtvBps,
    emergencyLtvBps: snapshot.emergencyLtvBps,
    createdAtMs: now,
    updatedAtMs: now,
    txDigest: digest,
    objectType: getExpectedPolicyObjectType(getRuntimeConfig()),
  };
}

function renderPolicyStatusCopy() {
  const policy = appState.current?.onChainPolicy || null;

  if (policy?.id) {
    return `Testnet policy ${formatPolicyObjectId(policy.id)} · rail ${policy.selectedRail || "pending"}`;
  }

  if (!isPolicyRegistryConfigured(getRuntimeConfig())) {
    return "Testnet proof package is not configured yet.";
  }

  if (!getWalletState().connected) {
    return "Connect wallet to save this policy on Sui testnet.";
  }

  return "Policy is local until you save it to Sui testnet.";
}

// On-chain rail resolver for the Save / Mint CTAs. Returns {canonical, message} so
// callers can gate on whether the currently-selected rail is on the on-chain
// allowlist BEFORE the user clicks and eats a derivePolicySnapshot throw.
function resolveCurrentRailForOnChain() {
  const draft = form ? readDraftFromForm() : (appState.current?.draft || appState.draft || null);
  const report = appState.current?.report || null;
  const canonical = draft ? resolveCanonicalRailId(draft, report) : "";
  if (canonical) {
    return { draft, report, canonical, message: "" };
  }
  const allowed = getAllRailIds().map((id) => getRailDisplay(id)).join(", ");
  return {
    draft,
    report,
    canonical: "",
    message: `Selected rail isn't on the on-chain allowlist. Pick one of: ${allowed}.`,
  };
}

function getForecastStaleRefusal(current = appState.current) {
  const routeJudgeMode = getRouteJudgeMode();
  const routeJudgeOracleStale = routeJudgeMode
    ? getJudgeScenario(routeJudgeMode)?.fixture?.oracle?.stale === true
    : false;
  const stale = current?.marketBand?.stale === true
    || current?.judge?.fixture?.oracle?.stale === true
    || routeJudgeOracleStale;
  if (!stale) {
    return null;
  }

  return {
    reason: "forecast_stale",
    testId: "forecast-stale-refusal",
    message: "Public forecast model is stale — open the forecast panel above and refresh before running.",
  };
}

const READOUT_HEADER_ACTION_SELECTOR =
  'body[data-page="results"] #readout-actions, body[data-page="live"] .page-header--product .action-cluster';

function isReadoutHeaderActionButton(button) {
  return Boolean(button?.closest?.(READOUT_HEADER_ACTION_SELECTOR));
}

function isCompactActionSurface(button) {
  return Boolean(isReadoutHeaderActionButton(button) || button?.closest?.("[data-setup-footer]"));
}

function syncActionDisabledHint(button, reason = "", key = "") {
  if (!button?.parentElement) return;
  const reasonKey = key || button.id || "action";
  const existing = button.parentElement.querySelector(`[data-disabled-reason-for="${reasonKey}"]`);
  if (existing) existing.remove();

  if (isCompactActionSurface(button)) {
    if (button.disabled && reason) {
      const hint = document.createElement("span");
      hint.id = `${reasonKey}-reason`;
      hint.className = "sr-only";
      hint.dataset.disabledReasonFor = reasonKey;
      hint.textContent = reason;
      button.insertAdjacentElement("afterend", hint);
      button.setAttribute("aria-describedby", hint.id);
      button.dataset.disabledReason = reason;
    } else {
      delete button.dataset.disabledReason;
      button.removeAttribute("aria-describedby");
    }
    return;
  }

  if (button.disabled && reason) {
    const hint = document.createElement("p");
    hint.id = `${reasonKey}-reason`;
    hint.className = "action-disabled-hint";
    hint.dataset.disabledReasonFor = reasonKey;
    hint.textContent = reason;
    button.insertAdjacentElement("afterend", hint);
    button.setAttribute("aria-describedby", hint.id);
  } else {
    button.removeAttribute("aria-describedby");
  }
}

function syncPolicyActionButtons() {
  const buttons = [$("#save-policy-toolbar"), $("#save-policy-current")].filter(Boolean);
  if (!buttons.length) {
    return;
  }

  const wallet = getWalletState();
  const configured = isPolicyRegistryConfigured(getRuntimeConfig());
  const railCheck = resolveCurrentRailForOnChain();
  const hasDraft = Boolean(railCheck.draft);
  const hasPolicy = Boolean(appState.current?.onChainPolicy?.id);
  const staleRefusal = getForecastStaleRefusal(appState.current);
  const label = _policySaveInProgress ? (hasPolicy ? "Updating…" : "Saving…") : (hasPolicy ? "Update testnet policy" : "Save on testnet");
  const selectedScope = form?.querySelector?.('input[name="createScope"]:checked')?.value;
  const scope = getCreateScopeKey(selectedScope || railCheck.draft?.createScope);

  // Surface the CTA only when it matches the user's current intent.
  // Simulation is explicitly local, so an on-chain save
  // button in that footer reads as a broken promise even when disabled.
  // Existing on-chain policies may still expose Update regardless of legacy
  // draft scope metadata; new saves require Testnet proof scope.
  const readoutShell = currentPage === "results" || currentPage === "live";
  const headerReadoutButtons = new Set(
    buttons.filter((button) => isReadoutHeaderActionButton(button)),
  );
  const shouldShow = (readoutShell && (configured || hasPolicy))
    || ((configured || hasPolicy) && (hasPolicy || scope === "live"));

  let title = "";
  let disabled = false;

  if (_policySaveInProgress) {
    disabled = true;
    title = "On-chain policy save is already in progress.";
  } else if (!configured) {
    disabled = true;
    title = "This build is not wired to a testnet policy package. Open testnet.tidesui.pro to save on-chain policies.";
  } else if (scope !== "live" && !hasPolicy) {
    disabled = true;
    title = "Switch to Testnet proof before saving this policy to Sui testnet.";
  } else if (!wallet.connected) {
    disabled = true;
    title = "Connect wallet to save the policy on Sui testnet.";
  } else if (!hasDraft) {
    disabled = true;
    title = "Create a scenario first.";
  } else if (staleRefusal) {
    disabled = true;
    title = staleRefusal.message;
  } else if (scope === "live") {
    const scopeState = getCreateScopeState({
      draft: railCheck.draft || appState.current?.draft || {},
      walletState: wallet,
      proofContext: getCreateScopeProofContext(),
    });
    if (scopeState.mockCollateral || !scopeState.walletBacked) {
      disabled = true;
      title = "Save on testnet requires wallet-backed collateral; mock collateral can only run a local rehearsal.";
    }
  } else if (!railCheck.canonical) {
    disabled = true;
    title = railCheck.message;
  } else if (hasPolicy) {
    title = "Update the current testnet policy.";
  } else {
    title = "Save the current policy on Sui testnet.";
  }

  for (const button of buttons) {
    const isReadoutHeaderButton = readoutShell && headerReadoutButtons.has(button);
    button.hidden = isReadoutHeaderButton || !shouldShow;
    button.disabled = disabled;
    button.textContent = label;
    button.title = title;
    button.setAttribute("aria-disabled", String(disabled));
    syncActionDisabledHint(button, disabled && !button.hidden ? title : "", button.id || "policy-action");
  }
}

// Refresh the policy currently bound to appState.current from
// on-chain state. The binding is *explicit*: either the user opened
// Setup with ?policy=<id> (readBoundPolicyIdFromUrl), or they saved
// a new policy and we stored the id at mint time. We intentionally do
// NOT auto-bind "the latest owned policy" — a wallet can own many, and
// silent auto-binding made the UI feel like 1-policy-per-wallet.
async function hydrateCurrentPolicyFromChain({
  address = getWalletState().address,
  policyId = "",
  adoptPolicyDraft = false,
  bindCurrent = true,
} = {}) {
  const requestedPolicyId = normalizeLiveHistoryText(policyId);
  const ownerAddr = normalizeWalletAddress(address);
  if (!isPolicyRegistryConfigured(getRuntimeConfig()) || (!ownerAddr && !requestedPolicyId)) {
    return null;
  }

  if (!appState.current && !requestedPolicyId) {
    return null;
  }

  const currentPolicyId = requestedPolicyId || (typeof appState.current?.onChainPolicy?.id === "string"
    ? appState.current.onChainPolicy.id.trim()
    : "");

  if (!currentPolicyId) {
    return null;
  }

  let policy = null;
  try {
    policy = await fetchPolicyObject(currentPolicyId, getRuntimeConfig());
  } catch {
    // Network/RPC hiccup — keep the stale binding; next hydrate will
    // retry. Only confirmed absence (null from a successful fetch)
    // counts as "this policy is gone".
    return null;
  }

  if (!policy) {
    // Policy is not on-chain (or no longer accessible). Drop the
    // stale binding so the Create CTA stops claiming "Update testnet policy"
    // for a policy the wallet can't actually touch.
    if (bindCurrent && appState.current) {
      appState.current.onChainPolicy = null;
      persistCurrentState();
    }
    if (ownerAddr) pruneLiveProtocolCaches(ownerAddr, getKnownLivePolicyIds());
    return null;
  }

  const policyOwner = normalizeWalletAddress(policy.owner);
  if (ownerAddr && policyOwner && ownerAddr !== policyOwner) {
    // Bound policy belongs to a different wallet (prior session on
    // this browser). The active wallet can't update it — unbind.
    if (bindCurrent && appState.current) {
      appState.current.onChainPolicy = null;
      persistCurrentState();
    }
    if (ownerAddr) pruneLiveProtocolCaches(ownerAddr, getKnownLivePolicyIds());
    return null;
  }

  if (!appState.current) {
    if (adoptPolicyDraft) {
      appState.draft = normalizeDraftForAlpha(buildDraftFromPolicyObject(policy, {
        ...DEFAULT_DRAFT,
        ...(appState.draft || {}),
      }));
      saveStorage(STORAGE_DRAFT_KEY, appState.draft);
    }
    if (ownerAddr) pruneLiveProtocolCaches(ownerAddr, getKnownLivePolicyIds());
    return policy;
  }

  if (bindCurrent) {
    appState.current.onChainPolicy = policy;
  }
  if (adoptPolicyDraft) {
    appState.draft = normalizeDraftForAlpha(buildDraftFromPolicyObject(policy, {
      ...DEFAULT_DRAFT,
      ...(appState.draft || {}),
    }));
    saveStorage(STORAGE_DRAFT_KEY, appState.draft);
  }
  if (bindCurrent || adoptPolicyDraft) {
    persistCurrentState();
  }
  if (ownerAddr) pruneLiveProtocolCaches(ownerAddr, getKnownLivePolicyIds());
  return policy;
}

function applyAccountSavedScenarios(savedScenarios, { address = getWalletState().address } = {}) {
  const scopedAddress = normalizeWalletAddress(address);
  if (!scopedAddress || normalizeWalletAddress(getWalletState().address) !== scopedAddress) {
    return false;
  }

  const remoteSaved = Array.isArray(savedScenarios) ? savedScenarios : [];
  const remoteIds = new Set(remoteSaved.map((scenario) => scenario?.id).filter(Boolean));
  const localOnly = (Array.isArray(appState.saved) ? appState.saved : [])
    .filter((scenario) => scenario?.id && !remoteIds.has(scenario.id));
  appState.saved = [...remoteSaved, ...localOnly].slice(0, 12);

  if (appState.compareId && !appState.saved.some((scenario) => scenario.id === appState.compareId)) {
    appState.compareId = null;
  }

  saveStorage(STORAGE_SAVED_KEY, appState.saved, { address: scopedAddress });
  saveStorage(STORAGE_COMPARE_KEY, appState.compareId, { address: scopedAddress });
  return true;
}

async function syncRemoteSavedScenarios({
  address = getWalletState().address,
  showStatus = false,
} = {}) {
  const scopedAddress = normalizeWalletAddress(address);
  if (!scopedAddress) {
    return [];
  }

  const response = await fetchRemoteScenarios();
  if (normalizeWalletAddress(getWalletState().address) !== scopedAddress) {
    return [];
  }

  const remoteSaved = extractRemoteSavedScenarios(response);
  applyAccountSavedScenarios(remoteSaved, { address: scopedAddress });

  if (showStatus) {
    setStatus(
      remoteSaved.length > 0
        ? `Synced ${remoteSaved.length} saved scenario${remoteSaved.length === 1 ? "" : "s"} from cloud.`
        : "Wallet connected. No saved cloud scenarios were found for this account."
    );
  }

  return remoteSaved;
}

function isIsoDateString(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numeric));
}

function normalizeRatioLike(value, fallback) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  if (numeric > 1) {
    return clampNumber(numeric / 100, 0, 1, fallback);
  }

  return clampNumber(numeric, 0, 1, fallback);
}

function normalizeImportedRailSnapshot(raw, index, importedAt) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const source = raw;
  const label = String(source.name || source.label || source.id || `Imported rail ${index + 1}`).trim();

  if (!label) {
    return null;
  }

  const snapshot = {
    id: slugify(String(source.id || label)),
    name: label,
    source: "adapter",
    wrapper: String(source.wrapper || source.collateralAsset || source.btcAsset || "BTC basket"),
    stableAsset: String(source.stableAsset || source.borrowAsset || "USDC"),
    healthy: source.healthy !== false,
    oracleConfidence: normalizeRatioLike(
      source.oracleConfidence ?? source.oracleConfidencePct,
      0.94
    ),
    liquidityScore: normalizeRatioLike(
      source.liquidityScore ?? source.liquidityScorePct,
      0.84
    ),
    healthScore: normalizeRatioLike(
      source.healthScore ?? source.healthScorePct,
      0.86
    ),
    borrowApr: normalizeRatioLike(source.borrowApr ?? source.borrowAprPct, 0.06),
    depositApr: normalizeRatioLike(source.depositApr ?? source.depositAprPct, 0.01),
    maxLtv: normalizeRatioLike(source.maxLtv ?? source.maxLtvPct, 0.34),
    availableDebtUsd: Math.max(
      0,
      Number(source.availableDebtUsd ?? source.debtDepthUsd ?? source.capacityUsd ?? 0) || 0
    ),
    referencePriceUsd: Math.max(0, Number(source.referencePriceUsd ?? source.btcPriceUsd ?? 0) || 0),
    priceReferences: Array.isArray(source.priceReferences)
      ? source.priceReferences
          .map((item) => ({
            wrapper: String(item?.wrapper || item?.symbol || item?.collateralAsset || "").trim(),
            referencePriceUsd: Math.max(0, Number(item?.referencePriceUsd ?? item?.btcPriceUsd ?? item?.priceUsd ?? 0) || 0),
            source: typeof item?.source === "string" ? item.source.trim() : "",
            quoteKind: typeof item?.quoteKind === "string" ? item.quoteKind.trim() : "",
            proxyOf: typeof item?.proxyOf === "string" ? item.proxyOf.trim() : "",
            disclosure: typeof item?.disclosure === "string" ? item.disclosure.trim() : "",
            updatedAt: isIsoDateString(item?.updatedAt || item?.timestamp)
              ? String(item.updatedAt || item.timestamp)
              : importedAt,
          }))
          .filter((item) => item.wrapper && item.referencePriceUsd > 1_000)
      : [],
    rebalanceCostBps: Math.max(
      0,
      Math.round(Number(source.rebalanceCostBps ?? source.exitCostBps ?? source.costBps ?? 18) || 18)
    ),
    supportsRefinance: source.supportsRefinance !== false,
    tags: Array.isArray(source.tags) ? source.tags.map((item) => String(item)) : ["Imported", "LivePack"],
    notes: Array.isArray(source.notes)
      ? source.notes.map((item) => String(item))
      : ["Imported live rail snapshot pack."],
    updatedAt: isIsoDateString(source.updatedAt || source.asOf || source.timestamp)
      ? String(source.updatedAt || source.asOf || source.timestamp)
      : importedAt,
  };

  if (!snapshot.availableDebtUsd) {
    snapshot.availableDebtUsd = 1000000;
  }

  return snapshot;
}

function parseRailPackPayload(payload) {
  const importedAt = new Date().toISOString();
  const railsSource = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.rails)
      ? payload.rails
      : Array.isArray(payload?.snapshots)
        ? payload.snapshots
        : [];
  const rails = railsSource
    .map((item, index) => normalizeImportedRailSnapshot(item, index, importedAt))
    .filter(Boolean);
  const supplementalSource = Array.isArray(payload?.supplementalRails)
    ? payload.supplementalRails
    : Array.isArray(payload?.supplementalSurfaces)
      ? payload.supplementalSurfaces
      : [];
  const supplementalRails = supplementalSource
    .map((item, index) => normalizeImportedSupplementalSurface(item, index, importedAt))
    .filter(Boolean);

  if (rails.length === 0) {
    throw new Error("No valid rail snapshots were found in the JSON file.");
  }

  const inferredBtcPriceUsd = inferRailPackBtcPriceUsd({
    market: payload?.market,
    rails,
  });

  return {
    label: typeof payload?.label === "string" && payload.label.trim()
      ? payload.label.trim()
      : `Live rail pack (${rails.length})`,
    ...(isIsoDateString(payload?.generatedAt) ? {
      generatedAt: String(payload.generatedAt),
      generatedAtMs: Date.parse(String(payload.generatedAt)),
    } : {}),
    importedAt,
    market: inferredBtcPriceUsd > 0
      ? {
          btcPriceUsd: inferredBtcPriceUsd,
          updatedAt:
            isIsoDateString(payload?.market?.updatedAt || payload?.market?.timestamp)
              ? String(payload.market.updatedAt || payload.market.timestamp)
              : importedAt,
          source:
            typeof payload?.market?.source === "string" && payload.market.source.trim()
              ? payload.market.source.trim()
              : "allocator-median",
        }
      : null,
    rails,
    supplementalRails,
  };
}

function normalizeImportedSupplementalSurface(raw, index, importedAt) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const source = raw;
  const label = String(source.name || source.label || source.id || `Supplemental surface ${index + 1}`).trim();

  if (!label) {
    return null;
  }

  return {
    id: slugify(String(source.id || label)),
    name: label,
    surfaceClass: String(source.surfaceClass || source.scope || source.kind || "SupplementalSurface"),
    wrapper: String(source.wrapper || source.asset || source.partner || ""),
    stableAsset: String(source.stableAsset || source.borrowAsset || source.baseAsset || ""),
    healthy: source.healthy !== false,
    yieldApr: normalizeRatioLike(
      source.yieldApr ?? source.apr ?? source.apy ?? source.depositApr ?? 0,
      0
    ),
    borrowApr: normalizeRatioLike(
      source.borrowApr ?? source.borrowAprPct ?? 0,
      0
    ),
    tvlUsd: Math.max(
      0,
      Number(source.tvlUsd ?? source.totalValueUsd ?? source.totalValue ?? 0) || 0
    ),
    capacityUsd: Math.max(
      0,
      Number(source.capacityUsd ?? source.stakeCapUsd ?? source.availableLiquidityUsd ?? 0) || 0
    ),
    tags: Array.isArray(source.tags)
      ? source.tags.map((item) => String(item))
      : ["Supplemental"],
    notes: Array.isArray(source.notes)
      ? source.notes.map((item) => String(item))
      : ["Imported supplemental live surface."],
    updatedAt: isIsoDateString(source.updatedAt || source.asOf || source.timestamp)
      ? String(source.updatedAt || source.asOf || source.timestamp)
      : importedAt,
  };
}

function getSupplementalRailPackItems(pack = null) {
  if (!pack || !Array.isArray(pack.supplementalRails)) {
    return [];
  }

  return pack.supplementalRails;
}

function isExperimentalRailsVisible() {
  return Boolean(window.TIDE_CONFIG && window.TIDE_CONFIG.showExperimentalRails);
}

function getVisibleCollectorRails() {
  if (isExperimentalRailsVisible()) return LIVE_COLLECTOR_RAILS;
  return LIVE_COLLECTOR_RAILS.filter((item) => !item.experimental);
}

function getCoverageCounts(pack = null) {
  if (pack) {
    const allocator = Array.isArray(pack.rails) ? pack.rails.length : 0;
    const supplemental = getSupplementalRailPackItems(pack).length;
    return {
      allocator,
      supplemental,
      total: allocator + supplemental,
    };
  }

  const visible = getVisibleCollectorRails();
  const allocator = visible.filter((item) => item.scope === "Allocator").length;
  const supplemental = visible.length - allocator;

  return {
    allocator,
    supplemental,
    total: allocator + supplemental,
  };
}

function getActiveRailPack() {
  return appState.railPack && Array.isArray(appState.railPack.rails) && appState.railPack.rails.length > 0
    ? appState.railPack
    : null;
}

function inferRailPackBtcPriceUsd(source) {
  const direct = Number(source?.market?.btcPriceUsd || 0);

  if (Number.isFinite(direct) && direct > 1_000) {
    return roundUsd(direct);
  }

  const candidates = (Array.isArray(source?.rails) ? source.rails : [])
    .map((rail) => Number(rail?.referencePriceUsd || 0))
    .filter((value) => Number.isFinite(value) && value > 1_000)
    .sort((left, right) => left - right);

  if (candidates.length === 0) {
    return 0;
  }

  const midpoint = Math.floor(candidates.length / 2);
  const median = candidates.length % 2 === 0
    ? (candidates[midpoint - 1] + candidates[midpoint]) / 2
    : candidates[midpoint];

  return roundUsd(median);
}

function getTimestampValue(value) {
  const timestamp = Date.parse(typeof value === "string" ? value : "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function loadPersistedRailPack() {
  const stored = loadStorage(STORAGE_RAIL_PACK_KEY, null, { global: true });

  if (!isPlainObject(stored)) {
    return null;
  }

  try {
    const parsed = parseRailPackPayload(stored);

    if (typeof stored.remoteUrl === "string" && stored.remoteUrl.trim()) {
      parsed.remoteUrl = stored.remoteUrl.trim();
    }

    if (typeof stored.importedAt === "string" && stored.importedAt.trim()) {
      parsed.importedAt = stored.importedAt.trim();
    }

    if (typeof stored.trustMode === "string" && stored.trustMode.trim()) {
      parsed.trustMode = stored.trustMode.trim();
    } else if (parsed.remoteUrl && isSameOriginRuntimeUrl(parsed.remoteUrl)) {
      parsed.trustMode = "same-origin-build";
    }

    // Signature verification is a property of the exact network response
    // that was verified in this browser session. Do not rehydrate it from
    // localStorage; a persisted rail pack must be fetched and verified again
    // before it can unlock signing-sensitive live surfaces.
    parsed.signatureVerified = false;

    return parsed;
  } catch {
    return null;
  }
}

function inferRailPackWrapperPriceUsd(source, wrapperSymbol) {
  const wanted = String(wrapperSymbol || "").trim().toLowerCase();
  if (!wanted) return 0;
  const normalizedWanted = normalizeTokenSymbol(wanted).toLowerCase();
  const wantedAliases = new Set([normalizedWanted]);

  // UI users think in canonical wallet wrappers ("wBTC"), while protocol
  // rail-packs may quote the market-specific token label ("sbwBTC" on
  // Scallop). Keep this mapping small and explicit so a generic "BTC" manual
  // simulation asset never swallows xBTC/LBTC prices by accident.
  if (normalizedWanted === "wbtc") {
    wantedAliases.add("sbwbtc");
  }

  const rails = Array.isArray(source?.rails) ? source.rails : [];
  const references = [];
  for (const rail of rails) {
    references.push({
      wrapper: rail?.wrapper,
      referencePriceUsd: rail?.referencePriceUsd,
      source: rail?.id || rail?.source || "",
    });
    if (Array.isArray(rail?.priceReferences)) {
      for (const reference of rail.priceReferences) {
        references.push({
          wrapper: reference?.wrapper,
          referencePriceUsd: reference?.referencePriceUsd,
          source: reference?.source || rail?.id || "",
        });
      }
    }
  }
  const seenReferences = new Set();
  const matches = references
    .filter((rail) => wantedAliases.has(normalizeTokenSymbol(rail?.wrapper).toLowerCase()))
    .filter((rail) => {
      const price = Number(rail?.referencePriceUsd || 0);
      const normalizedWrapper = normalizeTokenSymbol(rail?.wrapper).toLowerCase();
      const keyWrapper = normalizedWanted === "wbtc" && wantedAliases.has(normalizedWrapper)
        ? normalizedWanted
        : normalizedWrapper;
      const key = `${keyWrapper}:${price.toFixed(2)}:${String(rail?.source || "")}`;
      if (seenReferences.has(key)) return false;
      seenReferences.add(key);
      return true;
    })
    .map((rail) => Number(rail?.referencePriceUsd || 0))
    .filter((value) => Number.isFinite(value) && value > 1_000)
    .sort((a, b) => a - b);
  if (matches.length === 0) return 0;
  const mid = Math.floor(matches.length / 2);
  const median = matches.length % 2 === 0
    ? (matches[mid - 1] + matches[mid]) / 2
    : matches[mid];
  return roundUsd(median);
}

function hasWrapperPriceReferences(pack) {
  return (Array.isArray(pack?.rails) ? pack.rails : []).some((rail) => (
    Array.isArray(rail?.priceReferences)
      && rail.priceReferences.some((reference) => Number(reference?.referencePriceUsd || 0) > 1_000)
  ));
}

function hasWrapperPriceCoverage(pack, wrapperSymbol) {
  return inferRailPackWrapperPriceUsd(pack, wrapperSymbol) > 1_000;
}

const REQUIRED_LIVE_WRAPPER_PRICE_SYMBOLS = ["wBTC", "suiWBTC", "xBTC", "LBTC"];

function getMissingWrapperPriceSymbols(pack) {
  return REQUIRED_LIVE_WRAPPER_PRICE_SYMBOLS
    .filter((symbol) => !hasWrapperPriceCoverage(pack, symbol));
}

function hasConfiguredWrapperPriceCoverage(pack) {
  return getMissingWrapperPriceSymbols(pack).length === 0;
}

function shouldKeepActiveRailPackForConfig(activePack, config = getLiveRailPackConfig()) {
  if (!activePack) return false;
  if (config.preferRemote) return false;
  if (isRailPackStaleForTrust(activePack)) return false;

  const seedUpdatedAt = getTimestampValue(config.seedMarket?.updatedAt);
  const activeUpdatedAt = getRailPackFreshnessTimestampMs(activePack);
  if (seedUpdatedAt > 0 && (!activeUpdatedAt || seedUpdatedAt > activeUpdatedAt + 1_000)) {
    return false;
  }

  // Older persisted packs did not retain per-wrapper price references, so
  // wBTC/xBTC/LBTC collapsed back to the global BTC median. Refresh them once
  // the configured same-origin pack can provide wrapper-specific quotes.
  if (!hasWrapperPriceReferences(activePack) || !hasConfiguredWrapperPriceCoverage(activePack)) {
    return false;
  }

  return true;
}

// Resolve live spot for a specific wrapper symbol. Prefer per-rail
// referencePriceUsd (Navi for xBTC, Suilend/Alphalend for WBTC, etc.) so the
// composer shows the price that the actual lending market would use instead
// of a global BTC median. Wrapper-specific misses fail closed instead of
// falling back to the aggregate median.
function getPreferredLiveWrapperPriceUsd(wrapperSymbol) {
  const activeRailPack = getActiveRailPack();
  const perWrapper = inferRailPackWrapperPriceUsd(activeRailPack, wrapperSymbol);
  if (perWrapper > 1_000) return perWrapper;
  const normalized = normalizeTokenSymbol(wrapperSymbol);
  if (["WBTC", "SUIWBTC", "XBTC", "LBTC", "SBWBTC", "STBTC", "MBTC", "NBTC"].includes(normalized)) {
    return 0;
  }
  return getPreferredLiveBtcPriceUsd();
}

// Expose to wallet.js (loaded in a different module) via a stable global so
// the collateral picker can show per-wrapper rates without duplicating the
// rail-pack parser.
if (typeof window !== "undefined") {
  window.__tideLiveWrapperPriceUsd = getPreferredLiveWrapperPriceUsd;
}

function getPreferredLiveBtcPriceUsd() {
  const activeRailPack = getActiveRailPack();
  const livePriceUsd = inferRailPackBtcPriceUsd(activeRailPack);
  const liveUpdatedAt = Math.max(
    getTimestampValue(activeRailPack?.market?.updatedAt),
    getTimestampValue(activeRailPack?.importedAt)
  );
  const seedMarket = getLiveRailPackConfig().seedMarket;
  const seededPriceUsd = Number(seedMarket?.btcPriceUsd || 0);
  const seededUpdatedAt = getTimestampValue(seedMarket?.updatedAt);

  if (livePriceUsd > 1_000 && seededPriceUsd > 1_000) {
    if (seededUpdatedAt >= liveUpdatedAt) {
      return roundUsd(seededPriceUsd);
    }

    return livePriceUsd;
  }

  if (livePriceUsd > 1_000) {
    return livePriceUsd;
  }

  if (Number.isFinite(seededPriceUsd) && seededPriceUsd > 1_000) {
    return roundUsd(seededPriceUsd);
  }

  return 0;
}

function getEffectiveBtcPriceUsd(draft) {
  const wrapperSymbol = draft ? getCollateralAssetSymbol(draft) : "";
  const preferredWrapperPriceUsd = wrapperSymbol
    ? getPreferredLiveWrapperPriceUsd(wrapperSymbol)
    : 0;

  if (preferredWrapperPriceUsd > 1_000) {
    return preferredWrapperPriceUsd;
  }

  const preferredLivePriceUsd = getPreferredLiveBtcPriceUsd();

  if (preferredLivePriceUsd > 1_000) {
    return preferredLivePriceUsd;
  }

  return asNumber(draft?.btcPriceUsd);
}

function getCreateScopeKey(value) {
  return String(value || "").trim().toLowerCase() === "live" ? "live" : "shadow";
}

function getCreateScopeLivePriceUsd(draft = null) {
  const wrapperSymbol = draft
    ? getCollateralAssetSymbol(draft)
    : getCollateralAssetSymbol(appState?.draft);
  const preferredLivePriceUsd = getPreferredLiveWrapperPriceUsd(wrapperSymbol);
  if (preferredLivePriceUsd > 1_000) {
    return roundUsd(preferredLivePriceUsd);
  }
  return roundUsd(asNumber(DEFAULT_DRAFT.btcPriceUsd));
}

function seedCreateScopeFieldState(draft = null) {
  const source = draft ? normalizeDraftForAlpha(draft) : normalizeDraftForAlpha(appState.draft || DEFAULT_DRAFT);
  const scope = getCreateScopeKey(source?.createScope);
  const units = Math.max(0, asNumber(source?.btcUnits));
  const btcPriceUsd = Math.max(0, asNumber(source?.btcPriceUsd));
  const prefersLiveSeed = units <= 0
    && (!btcPriceUsd || Math.abs(btcPriceUsd - asNumber(DEFAULT_DRAFT.btcPriceUsd)) < 0.5);
  if (createScopeFieldState.shadow.btcUnits === null) {
    createScopeFieldState.shadow.btcUnits = scope === "shadow" ? units : 0;
  }
  if (createScopeFieldState.live.btcUnits === null) {
    createScopeFieldState.live.btcUnits = scope === "live" ? units : 0;
  }
  if (createScopeFieldState.shadow.btcPriceUsd === null) {
    createScopeFieldState.shadow.btcPriceUsd = prefersLiveSeed
      ? getCreateScopeLivePriceUsd(source)
      : scope === "shadow" && btcPriceUsd > 0
      ? btcPriceUsd
      : getCreateScopeLivePriceUsd(source);
  }
  createScopeFieldState.live.btcPriceUsd = getCreateScopeLivePriceUsd(source);
}

function captureCreateScopeFieldState(scopeValue = null, draft = null) {
  const scope = getCreateScopeKey(scopeValue || draft?.createScope || form?.querySelector('input[name="createScope"]:checked')?.value);
  const sourceDraft = draft || (form ? readDraftFromForm() : appState.draft || DEFAULT_DRAFT);
  const units = Math.max(0, asNumber(sourceDraft?.btcUnits));
  if (scope === "live") {
    createScopeFieldState.live.btcUnits = units;
    createScopeFieldState.live.btcPriceUsd = getCreateScopeLivePriceUsd(sourceDraft);
    return;
  }
  createScopeFieldState.shadow.btcUnits = units;
  const btcPriceUsd = Math.max(0, asNumber(sourceDraft?.btcPriceUsd));
  if (btcPriceUsd > 0) {
    createScopeFieldState.shadow.btcPriceUsd = btcPriceUsd;
  }
}

function applyCreateScopeFieldState(scopeValue) {
  if (!form) return;
  const currentDraft = readDraftFromForm();
  seedCreateScopeFieldState(currentDraft);
  const scope = getCreateScopeKey(scopeValue);
  const amountField = form.elements.namedItem("btcUnits");
  const priceField = form.elements.namedItem("btcPriceUsd");
  const nextUnits = scope === "live"
    ? Math.max(0, asNumber(createScopeFieldState.live.btcUnits))
    : Math.max(0, asNumber(createScopeFieldState.shadow.btcUnits));
  const nextPriceUsd = scope === "live"
    ? getCreateScopeLivePriceUsd(currentDraft)
    : Math.max(0, asNumber(createScopeFieldState.shadow.btcPriceUsd)) || getCreateScopeLivePriceUsd(currentDraft);
  setFieldValue(amountField, nextUnits);
  setFieldValue(priceField, nextPriceUsd);
}

function resetCreateScopeFieldState(draft = DEFAULT_DRAFT) {
  createScopeFieldState.shadow.btcUnits = Math.max(0, asNumber(draft?.btcUnits));
  createScopeFieldState.live.btcUnits = 0;
  createScopeFieldState.shadow.btcPriceUsd = getCreateScopeLivePriceUsd(draft);
  createScopeFieldState.live.btcPriceUsd = getCreateScopeLivePriceUsd(draft);
}

function draftsMatch(left = null, right = null) {
  try {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  } catch {
    return false;
  }
}

function isCurrentRunFresh() {
  if (!appState.current?.draft) {
    return false;
  }
  return draftsMatch(appState.current.draft, appState.draft);
}

function isVerifiedLiveRailPack() {
  const pack = getActiveRailPack();
  return Boolean(pack && pack.signatureVerified === true && !isRailPackStaleForTrust(pack));
}

function getLiveDataTrustState(current = appState.current) {
  const summary = current?.report?.summary || null;
  const mode = summary?.railDataMode || (getActiveRailPack() ? "live" : "fixture");
  const verified = mode === "live" && isVerifiedLiveRailPack();
  return {
    mode,
    verified,
    pack: getActiveRailPack(),
  };
}

function syncMarketPriceIntoState() {
  const preferredBtcPriceUsd = getPreferredLiveBtcPriceUsd();

  if (preferredBtcPriceUsd <= 1_000) {
    return false;
  }

  let changed = false;

  const applyToDraft = (draft) => {
    if (!draft) {
      return false;
    }

    const scope = getCreateScopeKey(draft.createScope);
    const currentPriceUsd = asNumber(draft.btcPriceUsd);
    const preferredDraftPriceUsd = getCreateScopeLivePriceUsd(draft);

    if (scope !== "live" && currentPriceUsd > 0) {
      return false;
    }

    if (preferredDraftPriceUsd <= 1_000 || Math.abs(currentPriceUsd - preferredDraftPriceUsd) < 0.01) {
      return false;
    }

    draft.btcPriceUsd = preferredDraftPriceUsd;
    return true;
  };

  if (applyToDraft(appState.draft)) {
    saveStorage(STORAGE_DRAFT_KEY, appState.draft);
    changed = true;
  }

  if (appState.current?.draft && applyToDraft(appState.current.draft)) {
    persistCurrentState();
    changed = true;
  }

  if (changed && form) {
    setFieldValue(form.elements.namedItem("btcPriceUsd"), getCreateScopeLivePriceUsd(readDraftFromForm()));
  }

  if (preferredBtcPriceUsd > 0) {
    appState.btcPriceUpdatedAt = Date.now();
    const draftPriceUsd = getCreateScopeLivePriceUsd(appState.draft || DEFAULT_DRAFT);
    createScopeFieldState.live.btcPriceUsd = draftPriceUsd;
    if (!(createScopeFieldState.shadow.btcPriceUsd > 0)) {
      createScopeFieldState.shadow.btcPriceUsd = draftPriceUsd;
    }
  }

  return changed;
}

function buildLivePositionFacts(draft, report) {
  const railPack = getActiveRailPack();
  const effectiveBtcPriceUsd = getEffectiveBtcPriceUsd(draft);
  const collateralUsd = asNumber(draft?.btcUnits) * effectiveBtcPriceUsd;
  const debtUsd = asNumber(draft?.debtUsd);
  const ltv = safeDiv(debtUsd, collateralUsd);
  const summary = report?.summary || null;
  const collateralAssetSymbol = getCollateralAssetSymbol(draft);

  return [
    {
      label: "Collateral position",
      value: `${asNumber(draft?.btcUnits).toFixed(2)} ${collateralAssetSymbol}`,
      copy: collateralUsd > 0 ? `${formatCompactUsd(collateralUsd)} collateral value` : "No collateral value yet",
    },
    {
      label: "BTC price",
      value: formatCompactUsd(effectiveBtcPriceUsd),
      copy: railPack?.market?.source ? `${railPack.market.source} live source` : "Draft market price",
    },
    {
      label: "Debt",
      value: formatCompactUsd(debtUsd),
      copy: "Stable liabilities in the latest modeled run",
    },
    {
      label: "Debt pressure",
      value: formatPercentDecimal(ltv),
      copy: summary ? `Modeled summary ${formatPercentDecimal(summary.currentLtv)}` : "Derived from modeled collateral and debt",
    },
    {
      label: "Stable buffer",
      value: formatCompactUsd(asNumber(draft?.stableBufferUsd)),
      copy: summary ? `${summary.bufferCoverageDays} days of coverage` : "Buffer floor",
    },
    {
      label: "Target payout",
      value: `${formatCompactUsd(asNumber(draft?.monthlyPayoutTargetUsd))}/mo`,
      copy: `${Math.max(1, asNumber(draft?.desiredRunwayMonths)).toFixed(0)} month intent`,
    },
  ];
}

function createSimulator() {
  const railPack = getActiveRailPack();
  const adapters = railPack
    ? createSnapshotRailAdapters(railPack.rails)
    : createStarterRailAdapters();

  return new ShadowModeSimulator(adapters);
}

function refreshSimulator() {
  simulator = createSimulator();
}

async function maybeLoadConfiguredRailPack({ rerun = true, silent = true } = {}) {
  const config = getLiveRailPackConfig();
  const candidateUrls = getLiveRailPackCandidateUrls(config);

  if (!config.autoLoad || candidateUrls.length === 0) {
    return false;
  }

  if (shouldKeepActiveRailPackForConfig(getActiveRailPack(), config)) {
    return false;
  }

  let lastError = null;

  const verifyKeyB64 = typeof config?.verifyKey === "string" ? config.verifyKey.trim() : "";

  for (const railPackUrl of candidateUrls) {
    try {
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timeout = controller ? setTimeout(() => controller.abort(), 3_000) : null;
      let response;
      try {
        response = await fetch(railPackUrl, {
          cache: "no-store",
          signal: controller?.signal,
          headers: {
            accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
          },
        });
      } finally {
        if (timeout) clearTimeout(timeout);
      }

      if (!response.ok) {
        throw new Error(`Configured live rail pack returned ${response.status}.`);
      }

      const bodyText = await response.text();
      // Integrity check: remote rail-packs must carry a valid Ed25519
      // signature in the `x-tide-signature` header when a verify key is
      // configured. This prevents a compromised origin or MITM from
      // swapping the rail list (which drives Sui signAndExecute calls).
      const requiresSignature = requiresRailPackSignature(railPackUrl);
      if (requiresSignature && !verifyKeyB64) {
        throw new Error("Configured live rail pack requires liveRailPack.verifyKey.");
      }
      if (requiresSignature && verifyKeyB64) {
        const sigHeader = response.headers.get("x-tide-signature") || "";
        const verdict = await verifyPackResponse({
          bodyText,
          signatureB64: sigHeader,
          verifyKeyB64,
        });
        if (verdict.verified !== true) {
          throw new Error(`Rail pack signature check failed (${verdict.reason}).`);
        }
      }
      const payload = JSON.parse(bodyText);
      const parsedPack = parseRailPackPayload(payload);
      const missingWrapperPrices = getMissingWrapperPriceSymbols(parsedPack);
      if (missingWrapperPrices.length > 0) {
        throw new Error(`Configured live rail pack is missing wrapper prices for ${missingWrapperPrices.join(", ")}.`);
      }
      parsedPack.label = parsedPack.label || "Configured live rail pack";
      parsedPack.remoteUrl = railPackUrl;
      parsedPack.signatureVerified = requiresSignature ? verifyKeyB64.length > 0 : false;
      parsedPack.trustMode = requiresSignature ? "signed-remote" : "same-origin-build";
      appState.railPack = parsedPack;

      if (config.persist) {
        saveStorage(STORAGE_RAIL_PACK_KEY, appState.railPack, { global: true });
      }

      refreshSimulator();
      const marketSeedApplied = syncMarketPriceIntoState();

      if (rerun && (appState.current?.draft || currentPage !== "setup" || marketSeedApplied)) {
        await refreshCurrentSimulationAfterRailChange();
      }

      if (!silent) {
        const supplementalCount = getSupplementalRailPackItems(appState.railPack).length;
        setStatus(
          supplementalCount > 0
            ? `Loaded ${appState.railPack.rails.length} allocator rails and ${supplementalCount} supplemental surfaces from the configured live pack.`
            : `Loaded ${appState.railPack.rails.length} allocator rails from the configured live pack.`
        );
      }

      trackEvent("rail_pack_config_loaded", {
        allocatorRails: appState.railPack.rails.length,
        supplementalSurfaces: getSupplementalRailPackItems(appState.railPack).length,
        source: "runtime-config",
        railPackUrl,
      });
      return true;
    } catch (error) {
      lastError = error;
    }
  }

  reportClientError(lastError, {
    action: "maybeLoadConfiguredRailPack",
    railPackUrl: candidateUrls[0] || "",
  });
  trackEvent("rail_pack_config_failed", {
    source: "runtime-config",
    attemptedUrls: candidateUrls.length,
    failureClass: classifyRailPackError(lastError),
  });

  if (!silent) {
    setStatus(sanitizeRailPackErrorMessage(lastError), true);
  }

  return false;
}

// Map rail-pack load failures to a compact failure class. Used for
// telemetry (no PII) and to pick a user-facing message below.
function classifyRailPackError(error) {
  const raw = error instanceof Error ? error.message : String(error || "");
  if (/verifyKey/i.test(raw)) return "missing-verify-key";
  if (/signature check failed/i.test(raw)) return "signature-mismatch";
  if (/returned\s+4\d\d/i.test(raw)) return "client-error";
  if (/returned\s+5\d\d/i.test(raw)) return "server-error";
  if (/JSON|Unexpected token|parse/i.test(raw)) return "invalid-format";
  if (/network|fetch failed|failed to fetch/i.test(raw)) return "network";
  return "unknown";
}

// Never ship raw error.message to the status line — internal strings
// can leak server URLs, JSON parser fragments, or signature details
// that are better kept in the error beacon. Map failure classes to
// copy that tells the operator what to do next.
function sanitizeRailPackErrorMessage(error) {
  switch (classifyRailPackError(error)) {
    case "missing-verify-key":
      return "Live rail pack cannot be trusted on this build — liveRailPack.verifyKey is not configured.";
    case "signature-mismatch":
      return "Live rail pack signature did not verify. This build refuses to load unsigned or tampered packs.";
    case "client-error":
      return "Live rail pack could not be reached. Check the runtime-config URL and try again.";
    case "server-error":
      return "Live rail pack source is temporarily unavailable. Retry in a minute.";
    case "invalid-format":
      return "Live rail pack format is invalid. The source responded but the payload is not a recognised pack.";
    case "network":
      return "Live rail pack request could not complete. Check connectivity and retry.";
    default:
      return "Live rail pack could not be loaded. Full detail sent to the error beacon.";
  }
}

function setStatus(message = "", isError = false, link = null, options = {}) {
  const statusNote = getStatusNote();
  if (!statusNote) {
    return;
  }

  statusNote.textContent = message;

  if (link && typeof link.href === "string" && link.href) {
    statusNote.appendChild(document.createTextNode(" "));
    const anchor = document.createElement("a");
    anchor.href = link.href;
    anchor.textContent = typeof link.label === "string" && link.label ? link.label : "View on SuiVision";
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.className = "status-link";
    statusNote.appendChild(anchor);
  }

  statusNote.classList.toggle("is-error", isError);
  statusNote.hidden = message.length === 0;
  if (message && options?.testId) {
    statusNote.setAttribute("data-test-id", String(options.testId));
  } else {
    statusNote.removeAttribute("data-test-id");
  }
}

const SIGNING_TIMELINE_STEPS = [
  { id: "precheck", label: "Pre-check passed" },
  { id: "wallet", label: "Wallet approved" },
  { id: "signed", label: "Signed" },
  { id: "broadcast", label: "Broadcast" },
  { id: "confirming", label: "Confirming" },
  { id: "verify", label: "Verify Move execution" },
  { id: "final", label: "Final evidence" },
];

function getSigningTimelineHost() {
  let host = document.getElementById("signing-timeline-panel");
  const stack = document.querySelector("main.page-stack") || document.querySelector(".page-stack");
  if (!stack) return host || null;

  if (!host) {
    host = document.createElement("section");
    host.id = "signing-timeline-panel";
    host.className = "surface signing-timeline-panel";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    host.setAttribute("aria-atomic", "true");
    host.hidden = true;
  }

  const actionContext = stack.querySelector("#readout-autopilot")
    || stack.querySelector("#results-execution")
    || stack.querySelector("#readout-action");
  if (actionContext?.parentNode === stack) {
    actionContext.insertAdjacentElement("beforebegin", host);
    return host;
  }

  const setupForm = stack.querySelector("#scenario-form");
  if (setupForm?.parentNode === stack) {
    setupForm.insertAdjacentElement("beforebegin", host);
    return host;
  }

  const setupHeader = stack.querySelector(".page-header");
  if (setupHeader?.parentNode === stack) {
    setupHeader.insertAdjacentElement("afterend", host);
    return host;
  }

  stack.prepend(host);
  return host;
}

function formatSigningTimelineTime(value = Date.now()) {
  try {
    return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

function getSigningTimelineStepStatus(stepId, state) {
  const steps = SIGNING_TIMELINE_STEPS.map((step) => step.id);
  const failedStep = state?.failedStep || "";
  if (failedStep) {
    if (stepId === failedStep) return "failed";
    return steps.indexOf(stepId) < steps.indexOf(failedStep) ? "done" : "pending";
  }
  if (state?.phase === "done") return "done";
  const current = state?.currentStep || "wallet";
  if (stepId === current) return "current";
  return steps.indexOf(stepId) < steps.indexOf(current) ? "done" : "pending";
}

function renderSigningTimelineStep(step, state) {
  const status = getSigningTimelineStepStatus(step.id, state);
  const finalLabel = state?.finalLabel || "Final evidence";
  const label = step.id === "final" ? finalLabel : step.label;
  const sub = state?.subByStep?.[step.id] || (status === "pending"
    ? (state?.failedStep ? "unreachable" : "queued")
    : "");
  const role = status === "failed" ? ' role="alert"' : "";
  const dot = status === "done"
    ? icon("check", "xs")
    : status === "failed"
      ? icon("x", "xs")
      : status === "current"
        ? '<span class="spinner spinner--xs" aria-hidden="true"></span>'
        : "";
  return `
    <li class="status-timeline__step status-timeline__step--${escapeHtml(status)}"${role}>
      <span class="status-timeline__dot" aria-hidden="true">${dot}</span>
      <div class="status-timeline__copy">
        <span class="status-timeline__title">${escapeHtml(label)}</span>
        ${sub ? `<span class="status-timeline__sub">${escapeHtml(sub)}</span>` : ""}
      </div>
    </li>
  `;
}

function renderSigningTimeline() {
  const host = getSigningTimelineHost();
  if (!host) return;
  if (!_signingTimelineState) {
    host.hidden = true;
    host.textContent = "";
    return;
  }

  const state = _signingTimelineState;
  const onChainCount = Object.values(state.subByStep || {}).filter(Boolean).length;
  safeReplaceChildren(host, `
    <div class="section-head section-head-compact">
      <div>
        <p class="section-label">Signing flow</p>
        <h2>${escapeHtml(state.title || "Wallet signing")}</h2>
      </div>
      <span class="state-badge">${escapeHtml(state.badge || `${onChainCount}/7`)}</span>
    </div>
    ${state.subtitle ? `<p class="surface-copy">${escapeHtml(state.subtitle)}</p>` : ""}
    <ol class="status-timeline signing-timeline-panel__steps" aria-label="Wallet signing status">
      ${SIGNING_TIMELINE_STEPS.map((step) => renderSigningTimelineStep(step, state)).join("")}
    </ol>
  `);
  host.hidden = false;
}

function startSigningTimeline({
  title = "Wallet signing",
  subtitle = "",
  finalLabel = "Final evidence",
  precheck = "policy + wallet checks OK",
} = {}) {
  if (_signingTimelineClearTimer) {
    clearTimeout(_signingTimelineClearTimer);
    _signingTimelineClearTimer = null;
  }
  _signingTimelineState = {
    title,
    subtitle,
    finalLabel,
    currentStep: "wallet",
    phase: "active",
    failedStep: "",
    badge: "1/7",
    subByStep: {
      precheck: `${precheck} · ${formatSigningTimelineTime()}`,
      wallet: "waiting for wallet approval…",
      signed: "queued",
      broadcast: "queued",
      confirming: "queued",
      verify: "queued",
      final: "queued",
    },
  };
  renderSigningTimeline();
}

function updateSigningTimeline(stepId, updates = {}) {
  if (!_signingTimelineState) return;
  const currentStep = SIGNING_TIMELINE_STEPS.some((step) => step.id === stepId) ? stepId : _signingTimelineState.currentStep;
  _signingTimelineState = {
    ..._signingTimelineState,
    ...updates,
    currentStep,
    subByStep: {
      ..._signingTimelineState.subByStep,
      ...(updates.subByStep || {}),
    },
  };
  const doneCount = SIGNING_TIMELINE_STEPS.filter((step) => (
    getSigningTimelineStepStatus(step.id, _signingTimelineState) === "done"
  )).length;
  if (!updates.badge) {
    _signingTimelineState.badge = _signingTimelineState.failedStep
      ? `${doneCount} done · failed`
      : `${Math.min(doneCount + 1, SIGNING_TIMELINE_STEPS.length)}/7`;
  }
  renderSigningTimeline();
}

function completeSigningTimeline(updates = {}) {
  if (!_signingTimelineState) return;
  _signingTimelineState = {
    ..._signingTimelineState,
    ...updates,
    phase: "done",
    currentStep: "final",
    badge: "Complete",
    subByStep: {
      ..._signingTimelineState.subByStep,
      ...(updates.subByStep || {}),
    },
  };
  renderSigningTimeline();
  _signingTimelineClearTimer = setTimeout(() => {
    _signingTimelineClearTimer = null;
    _signingTimelineState = null;
    renderSigningTimeline();
  }, 16000);
}

function failSigningTimeline(signingFailure, options = {}) {
  if (!_signingTimelineState) {
    startSigningTimeline({
      title: options.title || "Wallet signing",
      subtitle: options.subtitle || describeSigningNetwork(),
      finalLabel: options.finalLabel || "Final evidence",
      precheck: options.precheck || "pre-sign checks reached failure",
    });
  }
  const failedStep = options.step || _signingTimelineState.currentStep || "wallet";
  const message = signingFailure?.classified?.developerMessage
    || signingFailure?.classified?.userMessage
    || options.message
    || "Signing failed";
  _signingTimelineState = {
    ..._signingTimelineState,
    failedStep,
    phase: "failed",
    badge: "Failed",
    subByStep: {
      ..._signingTimelineState.subByStep,
      [failedStep]: `${message} · ${formatSigningTimelineTime()}`,
    },
  };
  renderSigningTimeline();
}

function cancelSigningTimeline(message = "Cancelled — nothing was signed.") {
  if (!_signingTimelineState) return;
  _signingTimelineState = {
    ..._signingTimelineState,
    failedStep: "wallet",
    phase: "cancelled",
    badge: "Cancelled",
    subByStep: {
      ..._signingTimelineState.subByStep,
      wallet: `${message} · ${formatSigningTimelineTime()}`,
    },
  };
  renderSigningTimeline();
  _signingTimelineClearTimer = setTimeout(() => {
    _signingTimelineClearTimer = null;
    _signingTimelineState = null;
    renderSigningTimeline();
  }, 8000);
}

function appendStatusActionButton(label, onClick) {
  const statusNote = getStatusNote();
  if (!statusNote || typeof onClick !== "function") return null;
  statusNote.appendChild(document.createTextNode(" "));
  const button = document.createElement("button");
  button.type = "button";
  button.className = "status-link status-action-button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  statusNote.appendChild(button);
  return button;
}

function buildReceiptClipboardText(receipt, config = getRuntimeConfig()) {
  const copyText = buildReceiptCopyText(receipt, { config });
  const readOnlyUrl = buildReceiptReadOnlyUrl(receipt, {
    config,
    origin: typeof window !== "undefined" ? window.location.origin : "",
  });
  return [
    copyText,
    readOnlyUrl ? `Receipt viewer: ${readOnlyUrl}` : "",
  ].filter(Boolean).join("\n");
}

function appendCopyReceiptLinkButton(receipt, config = getRuntimeConfig()) {
  if (!receipt?.id) return;
  const button = appendStatusActionButton("Copy receipt link", async () => {
    await copyReceiptLinkToClipboard(receipt, { config, button });
  });
  if (button) {
    button.title = "Copy receipt decision, rail, TIDE verifier URL, and SuiVision links.";
  }
}

function getReceiptForShare(receiptId) {
  const pinned = normalizeLiveHistoryText(receiptId);
  if (!pinned) return null;
  const current = appState.current?.onChainReceipt;
  if (normalizeLiveHistoryText(current?.id) === pinned) return current;
  return getMergedWorkspaceReceipts().find((receipt) => normalizeLiveHistoryText(receipt?.id) === pinned) || null;
}

async function copyReceiptLinkToClipboard(receipt, { config = getRuntimeConfig(), button = null } = {}) {
  if (!receipt?.id) throw new Error("No receipt id is available to share.");
  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard API is unavailable in this browser context.");
  }
  const text = buildReceiptClipboardText(receipt, config);
  await navigator.clipboard.writeText(text);
  if (button) {
    const previous = button.textContent;
    button.textContent = "Receipt link copied";
    window.setTimeout(() => {
      button.textContent = previous;
    }, 1800);
  }
  setStatus("Receipt link copied.");
}

async function handleCopyReceiptLinkAction(button) {
  const receipt = getReceiptForShare(button?.dataset?.receiptId || appState.current?.onChainReceipt?.id || "");
  if (!receipt) {
    setStatus("Receipt not loaded yet. Refresh Workspace or open the live policy first.", true);
    return;
  }
  try {
    await copyReceiptLinkToClipboard(receipt, { config: getRuntimeConfig(), button });
    trackEvent("receipt_link_copied", {
      receiptId: receipt.id || "",
      source: "decision-atlas",
    });
  } catch (error) {
    setStatus(error?.message || "Could not copy the receipt link.", true);
  }
}

function buildReceiptEvidencePosture({
  current = appState.current,
  publishResult = null,
  oracleReadback = appState.oracleReadback,
  limitations = "",
} = {}) {
  const railDataMode = String(current?.report?.summary?.railDataMode || "unknown");
  const walrusSource = String(publishResult?.source || "unknown");
  const pythSource = buildPythProofSummary(oracleReadback).pythSource;
  const executionMode = limitations === "testnet-rehearsal"
    ? "testnet-rehearsal"
    : "shadow-only";
  return {
    railDataMode,
    walrusSource,
    walrusFetchBackVerified: publishResult?.fetchBackVerified === true,
    pythSource,
    executionMode,
    claimBoundary: executionMode === "testnet-rehearsal"
      ? "testnet receipt + local proof digest; no mainnet capital movement"
      : "read-only modeled receipt evidence",
  };
}

function buildPythProofSummary(readback) {
  const source = String(readback?.source || "missing");
  const pythSource = source === "live"
    ? (isReadbackStale(readback) ? "stale" : "live")
    : source === "fixture"
    ? "fixture"
    : "missing";
  return {
    pythSource,
    pythFeedSymbol: String(readback?.feedSymbol || "BTC/USD"),
    pythPriceInfoObjectId: String(readback?.priceInfoObjectId || ""),
    pythPriceUsd: Number.isFinite(readback?.priceUsd) ? readback.priceUsd : 0,
    pythPublishTimeMs: Number.isFinite(readback?.publishTimeMs) ? readback.publishTimeMs : 0,
    pythAgeMs: Number.isFinite(readback?.ageMs) ? readback.ageMs : null,
    pythConfidenceBps: Number.isFinite(readback?.confidenceBps) ? readback.confidenceBps : null,
  };
}

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeDiv(a, b) {
  return b === 0 ? 0 : a / b;
}

function pctToDecimal(value) {
  return asNumber(value) / 100;
}

function formatUsd(value) {
  return currencyFormatter.format(Math.round(value));
}

function formatCompactUsd(value) {
  return compactCurrencyFormatter.format(asNumber(value));
}

function roundUsd(value) {
  return Math.round(asNumber(value));
}

function formatUsdRange(low, high) {
  return `${formatUsd(low)}-${formatUsd(high)}`;
}

function formatPercentDecimal(value, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}

function formatDrawdown(value) {
  if (value === null || value === undefined) {
    return "No trigger";
  }

  if (value <= 0) {
    return "Current";
  }

  return `-${Math.round(value * 100)}%`;
}

function formatBtcAmount(value) {
  return btcAmountFormatter.format(asNumber(value));
}

function formatRailDataMode(value) {
  const pack = getActiveRailPack();
  const remote = Boolean(pack?.remoteUrl);
  const verified = pack?.signatureVerified === true;
  const sameOriginBuild = pack?.trustMode === "same-origin-build";

  if (value === "live") {
    if (sameOriginBuild) {
      return "Live rail pack · bundled";
    }
    if (remote && !verified) {
      return "Live rail pack · unverified";
    }
    if (remote && verified) {
      return "Live rail pack · verified";
    }
    return "Live rail pack · fixture";
  }

  if (value === "mixed") {
    return remote && !verified ? "Mixed rail data · unverified" : "Mixed rail data";
  }

  return "Shadow fixtures";
}

function formatCoverageSummary(counts) {
  if (counts.supplemental > 0) {
    return `${counts.allocator} allocator · ${counts.supplemental} supplemental`;
  }

  return `${counts.allocator} allocator`;
}

function formatRelativeTimestamp(value) {
  if (!value) {
    return "Not refreshed";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not refreshed";
  }

  const diffMs = date.getTime() - Date.now();
  const absMs = Math.abs(diffMs);

  if (absMs < 60_000) {
    return "just now";
  }

  if (absMs < 3_600_000) {
    return relativeTimeFormatter.format(Math.round(diffMs / 60_000), "minute");
  }

  if (absMs < 172_800_000) {
    return relativeTimeFormatter.format(Math.round(diffMs / 3_600_000), "hour");
  }

  if (absMs < 1_209_600_000) {
    return relativeTimeFormatter.format(Math.round(diffMs / 86_400_000), "day");
  }

  return dateTimeFormatter.format(date);
}




function buildFallbackRouteScorecard(row, role) {
  const health = Math.round(asNumber(row.rail.healthScore) * 100);
  const liquidity = Math.round(asNumber(row.rail.liquidityScore) * 100);
  const headroom = Math.max(0, asNumber(row.rail.availableDebtUsd));

  return {
    rail: row.rail,
    score: row.score,
    reasons: [
      `${role} fallback ranking · ${health}/100 health · ${liquidity}/100 liquidity · ${formatCompactUsd(headroom)} debt headroom.`,
    ],
  };
}

function formatDelta(value, formatter) {
  if (value === 0) {
    return {
      text: "No change",
      tone: "neutral",
    };
  }

  return {
    text: value > 0 ? `Up ${formatter(value)}` : `Down ${formatter(Math.abs(value))}`,
    tone: value > 0 ? "positive" : "negative",
  };
}

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "shadow-mode";
}

function makeId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `scenario-${Date.now()}`;
}

function isRadioGroup(field) {
  return typeof RadioNodeList !== "undefined" && field instanceof RadioNodeList;
}

function getFieldValue(field, defaultValue) {
  if (!field) {
    return defaultValue;
  }

  if (isRadioGroup(field)) {
    return field.value || defaultValue;
  }

  if (field instanceof HTMLInputElement && field.type === "checkbox") {
    return field.checked;
  }

  if (field instanceof HTMLSelectElement && typeof defaultValue === "boolean") {
    return field.value === "true";
  }

  if (typeof defaultValue === "number") {
    return asNumber(field.value);
  }

  return field.value;
}

function setFieldValue(field, value) {
  if (!field) {
    return;
  }

  if (isRadioGroup(field)) {
    [...field].forEach((item) => {
      item.checked = item.value === String(value);
    });
    return;
  }

  if (field instanceof HTMLInputElement && field.type === "checkbox") {
    field.checked = Boolean(value);
    return;
  }

  field.value = String(value);
  syncEnhancedRangeField(field);
}

function hydrateForm(draft) {
  if (!form) {
    return;
  }

  for (const [name, defaultValue] of Object.entries(DEFAULT_DRAFT)) {
    const field = form.elements.namedItem(name);
    const nextValue = draft[name] ?? defaultValue;
    setFieldValue(field, nextValue);
  }
}

function syncEnhancedRangeField(field) {
  if (!(field instanceof HTMLInputElement)) {
    return;
  }

  const combo = field.parentElement?.querySelector?.(".range-combo");
  if (!combo) {
    return;
  }

  const range = combo.querySelector('input[type="range"]');
  const valueInput = combo.querySelector('input[type="number"]');
  if (range) {
    range.value = field.value;
  }
  if (valueInput) {
    valueInput.value = field.value;
  }
  syncRangeComboFill(combo);
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => syncRangeComboFill(combo));
  }
}

function syncRangeComboFill(combo) {
  const range = combo?.querySelector?.('input[type="range"]');
  if (!range) return;

  const curMin = parseFloat(range.min);
  const curMax = parseFloat(range.max);
  const curValue = parseFloat(range.value);
  const span = curMax - curMin;
  if (!Number.isFinite(curMin) || !Number.isFinite(curMax) || !Number.isFinite(curValue) || span <= 0) {
    combo.style.removeProperty("--range-fill");
    return;
  }

  const pct = Math.min(100, Math.max(0, ((curValue - curMin) / span) * 100));
  combo.style.setProperty("--range-fill", `${pct}%`);
}

function enhanceNumberInputsWithSliders() {
  if (!form) return;

  // Only add sliders to percentage fields where visual range makes sense
  const sliderFields = new Set([
    "maxLtvPct", "targetLtvLowPct", "targetLtvHighPct",
    "autoRepayLtvPct", "emergencyLtvPct",
    "venueExposurePct", "wrapperExposurePct",
    "maxSingleVenueExposurePct", "maxWrapperExposurePct",
    "oracleConfidencePct", "liquidityScorePct", "venueHealthScorePct",
    "minOracleConfidencePct", "minLiquidityScorePct",
    "marketRealizedVolPct", "marketDailyMovePct",
    "marketWeeklyDrawdownPct", "marketTrendStrengthPct"
  ]);

  form.querySelectorAll('input[type="number"][min][max]').forEach((input) => {
    if (!sliderFields.has(input.name)) return;

    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;

    const wrapper = document.createElement("div");
    wrapper.className = "range-combo range-slider";

    const range = document.createElement("input");
    range.type = "range";
    range.min = input.min;
    range.max = input.max;
    range.step = input.step || "1";
    range.value = input.value || input.min;
    range.setAttribute("aria-label", input.getAttribute("aria-label") || `${input.name} slider`);

    const valueInput = document.createElement("input");
    valueInput.type = "number";
    valueInput.className = "range-value-input";
    valueInput.min = input.min;
    valueInput.max = input.max;
    valueInput.step = input.step || "1";
    valueInput.value = input.value || input.min;
    valueInput.setAttribute("aria-label", input.getAttribute("aria-label") || `${input.name} value`);

    const syncRangeFill = () => syncRangeComboFill(wrapper);

    range.addEventListener("input", () => {
      input.value = range.value;
      valueInput.value = range.value;
      syncRangeFill();
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    range.addEventListener("change", () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    valueInput.addEventListener("input", () => {
      const v = parseFloat(valueInput.value);
      if (Number.isFinite(v)) {
        const curMin = parseFloat(range.min) || min;
        const curMax = parseFloat(range.max) || max;
        const clamped = Math.min(curMax, Math.max(curMin, v));
        input.value = clamped;
        range.value = clamped;
        syncRangeFill();
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });

    valueInput.addEventListener("change", () => {
      const v = parseFloat(valueInput.value);
      if (Number.isFinite(v)) {
        const curMin = parseFloat(range.min) || min;
        const curMax = parseFloat(range.max) || max;
        const clamped = Math.min(curMax, Math.max(curMin, v));
        valueInput.value = clamped;
        input.value = clamped;
        range.value = clamped;
        syncRangeFill();
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    input.addEventListener("input", () => {
      range.value = input.value;
      valueInput.value = input.value;
      syncRangeFill();
    });

    input.type = "hidden";
    input.parentElement.appendChild(wrapper);
    wrapper.appendChild(range);
    wrapper.appendChild(valueInput);
    syncRangeFill();
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(syncRangeFill);
    }
  });
}

function readDraftFromForm() {
  if (!form) {
    return clone(appState.draft);
  }

  const draft = {};

  for (const [name, defaultValue] of Object.entries(DEFAULT_DRAFT)) {
    const field = form.elements.namedItem(name);
    draft[name] = getFieldValue(field, defaultValue);
  }

  return normalizeDraftForAlpha(draft);
}

function formatStableSupportCopy(wrapperSymbol, choices, selectedSymbol) {
  const selected = choices.find((entry) => normalizeTokenSymbol(entry.symbol) === normalizeTokenSymbol(selectedSymbol));
  if (!selected) {
    return `No supported reserve asset found for ${wrapperSymbol}.`;
  }
  if (!selected.rails.length) {
    return `${selected.symbol} is the current reserve asset for ${wrapperSymbol}. Live buffer should be funded in the wallet with this stable.`;
  }
  if (selected.rails.length === 1) {
    return `${selected.symbol} is supported with ${wrapperSymbol} on ${selected.rails[0]}. Live buffer should already sit on-wallet in this stable.`;
  }
  return `${selected.symbol} is supported with ${wrapperSymbol} on ${selected.rails.join(", ")}. Live buffer should already sit on-wallet in this stable.`;
}

function syncPositionSupportFields(draft) {
  if (!form) {
    return draft;
  }

  const nextDraft = normalizeDraftForAlpha(draft);
  const stableSelect = form.elements.namedItem("stableAssetSymbol");
  const debtField = form.elements.namedItem("debtUsd");
  const choices = getSupportedStableAssetsForWrapper(nextDraft.collateralAssetSymbol);
  const stableAssetSymbol = pickSupportedStableAsset(nextDraft.collateralAssetSymbol, nextDraft.stableAssetSymbol);
  nextDraft.stableAssetSymbol = stableAssetSymbol;

  if (stableSelect instanceof HTMLSelectElement) {
    const currentOptions = [...stableSelect.options].map((option) => option.value);
    const nextOptions = choices.map((option) => option.symbol);
    const needsRebuild = currentOptions.length !== nextOptions.length
      || currentOptions.some((value, index) => value !== nextOptions[index]);
    if (needsRebuild) {
      stableSelect.innerHTML = choices
        .map((option) => `<option value="${escapeHtml(option.symbol)}">${escapeHtml(option.symbol)}</option>`)
        .join("");
    }
    if (stableSelect.value !== stableAssetSymbol) {
      stableSelect.value = stableAssetSymbol;
    }
    const pill = stableSelect.closest(".stable-asset-pill");
    if (pill) {
      pill.classList.toggle("is-single", choices.length <= 1);
    }
  }

  if (debtField && !isRadioGroup(debtField)) {
    debtField.value = String(nextDraft.debtUsd);
  }

  document.querySelectorAll("[data-stable-asset-echo]").forEach((node) => {
    node.textContent = stableAssetSymbol;
  });

  const stableAssetMarkNode = document.querySelector("[data-stable-asset-mark]");
  if (stableAssetMarkNode) {
    stableAssetMarkNode.innerHTML = renderVisualMark(getTokenVisual(stableAssetSymbol), "sm");
  }

  const derivedDebtValueNode = document.querySelector("[data-derived-debt-value]");
  if (derivedDebtValueNode) {
    derivedDebtValueNode.textContent = formatCompactUsd(nextDraft.debtUsd);
  }

  const bufferCompatNode = document.querySelector("[data-buffer-compat-copy]");
  if (bufferCompatNode) {
    bufferCompatNode.textContent = formatStableSupportCopy(
      getCollateralAssetSymbol(nextDraft),
      choices,
      stableAssetSymbol
    );
  }

  const runwayCopyNode = document.querySelector("[data-runway-copy]");
  if (runwayCopyNode) {
    const metrics = deriveDraftMetrics(nextDraft);
    runwayCopyNode.textContent = `Runway = starting buffer / monthly draw. This setup lasts about ${metrics.runwayMonths.toFixed(metrics.runwayMonths >= 10 ? 0 : 1)} months and keeps the floor above ${formatCompactUsd(metrics.requiredBufferUsd)} ${stableAssetSymbol}.`;
  }

  appState.draft = clone(nextDraft);
  saveStorage(STORAGE_DRAFT_KEY, appState.draft);

  return nextDraft;
}

function valuesMatchForPreset(actual, expected) {
  if (typeof expected === "number") {
    return Number(actual) === expected;
  }
  if (typeof expected === "boolean") {
    return Boolean(actual) === expected;
  }
  return String(actual) === String(expected);
}

function detectStrategyPreset(draft) {
  for (const [key, preset] of Object.entries(STRATEGY_PRESETS)) {
    const matches = Object.entries(preset.fields).every(([field, expected]) => (
      valuesMatchForPreset(draft?.[field], expected)
    ));
    if (matches) return key;
  }
  return "";
}

function syncStrategyPresetField(form, presetKey) {
  const field = form?.elements?.namedItem("strategyPreset");
  if (!field || isRadioGroup(field)) return;
  field.value = presetKey || "";
}

// Canonical "base case" name per preset. Applied whenever the current
// scenario name is empty or matches one of the preset defaults — which
// means picking a preset behaves like a fresh template, while a name the
// user actually typed is preserved.
const PRESET_DEFAULT_NAMES = {
  starter: "Harbor Base Case",
  safety: "Breakwater Base Case",
  drift: "Drift Base Case",
};

function isPresetDefaultName(name) {
  const clean = String(name || "").trim();
  if (!clean) return true;
  const { root } = splitScenarioNameRoot(clean);
  const lowered = root.toLowerCase();
  if (lowered === DEFAULT_SCENARIO_NAME.toLowerCase()) return true;
  for (const canonical of Object.values(PRESET_DEFAULT_NAMES)) {
    if (canonical.toLowerCase() === lowered) return true;
  }
  return false;
}

function applyStrategyPreset(form, presetKey) {
  const preset = STRATEGY_PRESETS[presetKey];
  if (!form || !preset) return;

  for (const [name, value] of Object.entries(preset.fields)) {
    const field = form.elements.namedItem(name);
    setFieldValue(field, value);
  }

  const nameField = form.elements.namedItem("scenarioName");
  const currentName = nameField && "value" in nameField ? String(nameField.value || "") : "";
  const canonicalForPreset = PRESET_DEFAULT_NAMES[presetKey];
  if (canonicalForPreset && isPresetDefaultName(currentName)) {
    const uniqueName = makeUniqueScenarioName(canonicalForPreset, collectOwnedScenarioNames(appState.activeDraftId));
    writeScenarioNameToForm(uniqueName);
    if (appState.draft && typeof appState.draft === "object") {
      appState.draft.scenarioName = uniqueName;
    }
  }

  syncStrategyPresetField(form, presetKey);
  enforceGuardrailOrdering();
  persistDraft();
  validateFieldsInline();
  renderScenarioNameCollisionHint();
  const nextDraft = readDraftFromForm();
  const createScopeState = renderCreateScopeState();
  renderCreatePreviewRail(nextDraft, createScopeState);
  renderIntentSwapUsd(nextDraft);
  queueScenarioChecksRerender(0);
}

function validateDraft(draft) {
  const createScopeState = getCreateScopeState({
    draft,
    walletState: getWalletState(),
    proofContext: getCreateScopeProofContext(),
  });

  return validateScenarioDraft({ draft, createScopeState });
}

function validateFieldsInline() {
  if (!form) return;
  let draft = readDraftFromForm();
  draft = syncPositionSupportFields(draft);
  const createScopeState = getCreateScopeState({
    draft,
    walletState: getWalletState(),
    proofContext: getCreateScopeProofContext(),
  });

  const fieldChecks = {
    btcUnits: asNumber(draft.btcUnits) <= 0 ? "error" : null,
    btcPriceUsd: asNumber(draft.btcPriceUsd) <= 0 ? "error" : null,
    monthlyPayoutTargetUsd: asNumber(draft.monthlyPayoutTargetUsd) <= 0 ? "error" : null,
    desiredRunwayMonths: asNumber(draft.desiredRunwayMonths) < 1 ? "error" : null,
    maxLtvPct: asNumber(draft.maxLtvPct) <= 0 ? "error" : null,
    targetLtvLowPct: asNumber(draft.targetLtvLowPct) >= asNumber(draft.targetLtvHighPct) ? "error" : null,
    targetLtvHighPct: asNumber(draft.targetLtvHighPct) >= asNumber(draft.maxLtvPct) ? "error" : null,
    autoRepayLtvPct: asNumber(draft.autoRepayLtvPct) >= asNumber(draft.emergencyLtvPct) ? "error" : null,
    emergencyLtvPct: asNumber(draft.emergencyLtvPct) > asNumber(draft.maxLtvPct) ? "error" : null,
    marketRealizedVolPct: asNumber(draft.marketRealizedVolPct) > 100 ? "warn" : null,
  };

  for (const [name, state] of Object.entries(fieldChecks)) {
    const input = form.querySelector(`[name="${name}"]`);
    if (!input) continue;
    const field = input.closest(".field");
    if (!field) continue;
    field.classList.remove("field--error", "field--warn");
    if (state === "error") field.classList.add("field--error");
    else if (state === "warn") field.classList.add("field--warn");
  }

  const collateralField = form.querySelector(".field-collateral");
  if (collateralField) {
    collateralField.classList.remove("field--error", "field--warn");
    if (createScopeState.scope === "live" && !createScopeState.canRunSimulation) {
      collateralField.classList.add("field--error");
    }
  }
}

function normalizeJudgeMode(mode) {
  return getJudgeScenario(mode)?.mode || null;
}

function getRouteJudgeMode() {
  try {
    return typeof window === "undefined" ? null : resolveJudgeDemoMode(window.location.search);
  } catch {
    return null;
  }
}

function canPreserveCurrentJudgeForDraft(draft) {
  const currentMode = normalizeJudgeMode(appState.current?.judge?.mode);
  if (!currentMode) return false;

  const nextOrigin = String(draft?.scenarioOrigin || "").trim();
  if (!nextOrigin.startsWith("testnet-rehearsal:")) return false;

  const currentOrigin = String(appState.current?.draft?.scenarioOrigin || "").trim();
  const fixtureId = String(appState.current?.judge?.fixture?.id || "").trim();
  return currentOrigin === nextOrigin || nextOrigin === `testnet-rehearsal:${fixtureId}`;
}

function resolveRunJudgeMode(explicitMode, { preserveCurrent = false, draft = null } = {}) {
  return normalizeJudgeMode(explicitMode)
    || getRouteJudgeMode()
    || (preserveCurrent && canPreserveCurrentJudgeForDraft(draft)
      ? normalizeJudgeMode(appState.current?.judge?.mode)
      : null);
}

async function runSimulation(draft, { silent = false, judgeMode = null, preserveJudgeMode = false } = {}) {
  const activeJudgeMode = resolveRunJudgeMode(judgeMode, {
    preserveCurrent: preserveJudgeMode || silent,
    draft,
  });
  const runBtn = document.querySelector("#run-sim-toolbar")
    || document.querySelector('[type="submit"][form="scenario-form"]');
  if (!silent) {
    setStatus("Running simulation...");
    if (runBtn) {
      runBtn.disabled = true;
      runBtn.dataset.originalText = runBtn.textContent;
      runBtn.textContent = "";
      runBtn.appendChild(h("span", { className: "btn-spinner" }));
      runBtn.appendChild(document.createTextNode(" Simulating\u2026"));
      runBtn.classList.add("is-running");
    }
  }

  const restoreBtn = () => {
    if (runBtn && runBtn.dataset.originalText) {
      runBtn.disabled = false;
      runBtn.textContent = runBtn.dataset.originalText;
      runBtn.classList.remove("is-running");
      delete runBtn.dataset.originalText;
    }
  };

  try {
    const validation = validateDraft(draft);

    if (validation.errors.length > 0) {
      setStatus(validation.errors.join(" · "), true);
      trackEvent("shadow_validation_failed", {
        fieldCount: validation.errors.length,
      });
      restoreBtn();
      return null;
    }

    // Yield so the spinner actually paints before the simulator (which may
    // be a hot synchronous loop) blocks the main thread. Without this the
    // click feels like a page hang.
    await new Promise((resolve) => {
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => setTimeout(resolve, 0));
      } else {
        setTimeout(resolve, 0);
      }
    });

    const input = buildSimulationInput(draft);
    const { scenarios, marketBand } = buildSimulationScenarios({
      draft,
      forecast: appState.marketForecast,
      defaultScenarios: DEFAULT_SHADOW_SCENARIOS,
    });
    const judgeContext = buildJudgeRunContext(activeJudgeMode);
    const effectiveMarketBand = applyJudgeMarketBandOverrides(marketBand, activeJudgeMode);
    const report = await simulator.simulate(input, scenarios);
    if (!report?.summary || !report?.baseline) {
      throw new Error("Simulation did not return a complete readout.");
    }
    const priorCurrent = appState.current || {};
    const priorSourceScenarioId = String(priorCurrent?.sourceScenarioId || "").trim();
    const priorScenarioName = String(priorCurrent?.draft?.scenarioName || "").trim().toLowerCase();
    const nextScenarioName = String(draft?.scenarioName || "").trim().toLowerCase();
    const routeScenarioId = normalizeLiveHistoryText(readRouteScenarioIdFromUrl());
    const routePinsSourceScenario = Boolean(routeScenarioId && priorSourceScenarioId === routeScenarioId);
    const sameSavedScenario = Boolean(priorSourceScenarioId && (
      priorScenarioName === nextScenarioName || routePinsSourceScenario
    ));
    const routePolicyId = normalizeLiveHistoryText(readRoutePolicyIdFromUrl());
    const priorPolicyId = normalizeLiveHistoryText(priorCurrent?.onChainPolicy?.id || "");
    const routePinsPolicy = Boolean(routePolicyId && priorPolicyId && routePolicyId === priorPolicyId);
    const carryOnChainBinding = sameSavedScenario || routePinsPolicy;
    const operatorReview = buildOperatorReview(
      draft,
      report,
      carryOnChainBinding ? priorCurrent?.operatorReview : null,
    );
    const onChainPolicy = carryOnChainBinding && priorCurrent?.onChainPolicy
      ? clone(priorCurrent.onChainPolicy)
      : null;
    const sourceScenarioId = sameSavedScenario ? priorSourceScenarioId : "";

    appState.current = {
      sourceScenarioId,
      draft: clone(draft),
      input,
      report,
      operatorReview,
      onChainPolicy,
      marketBand: effectiveMarketBand,
      judge: judgeContext,
    };
    appState.draft = clone(draft);

    saveStorage(STORAGE_DRAFT_KEY, draft);
    persistCurrentState();
    autoPersistRunToSavedList();
    renderCurrentPage();

    if (!silent) {
      setStatus(`Updated ${dateTimeFormatter.format(new Date(report.generatedAt))}.`);
    }

    trackEvent("shadow_run_completed", {
      railMode: report.summary.railDataMode,
      primaryRail: report.summary.primaryRailName || "none",
      backupRail: report.summary.backupRailName || "none",
      averageHealthScore: report.summary.averageHealthScore,
    });

    restoreBtn();
    return appState.current;
  } catch (error) {
    restoreBtn();
    reportClientError(error, { action: "runSimulation" });
    trackEvent("shadow_run_failed", { action: "runSimulation" });
    if (!silent) {
      setStatus(error instanceof Error ? error.message : "Simulation failed.", true);
    }
    return null;
  }
}

async function ensureCurrentRun() {
  const routeJudgeMode = getRouteJudgeMode();
  if (routeJudgeMode) {
    const currentJudgeMode = normalizeJudgeMode(appState.current?.judge?.mode);
    if (appState.current?.draft && appState.current?.report && currentJudgeMode === routeJudgeMode) {
      return appState.current;
    }
    return runSimulation(buildJudgeDraft(clone(DEFAULT_DRAFT), routeJudgeMode), {
      silent: true,
      judgeMode: routeJudgeMode,
    });
  }

  if (appState.current?.draft && appState.current?.report) {
    return appState.current;
  }

  return runSimulation(appState.draft, { silent: true, judgeMode: routeJudgeMode });
}

// Collect every scenario name the wallet already owns (drafts + saved
// runs). Used for the inline collision warning and for the silent
// auto-number that runs at save time.
function collectOwnedScenarioNames(excludeId = "", excludeIds = []) {
  return collectScenarioRegistryNames({
    drafts: appState.drafts,
    saved: appState.saved,
    excludeId,
    excludeIds,
  });
}

function pruneDraftsPromotedToSavedRuns({ address = getWalletState().address, persist = true } = {}) {
  const savedIds = new Set((Array.isArray(appState.saved) ? appState.saved : [])
    .map((scenario) => scenario?.id)
    .filter(Boolean));
  if (!savedIds.size) return false;

  const stateDrafts = Array.isArray(appState.drafts) ? appState.drafts : [];
  const storedDrafts = persist
    ? walletStorage.load(STORAGE_DRAFTS_KEY, stateDrafts, { address })
    : stateDrafts;
  const beforeDrafts = Array.isArray(storedDrafts) ? storedDrafts : stateDrafts;
  const nextDrafts = beforeDrafts.filter((draft) => !savedIds.has(draft?.id));
  const activeWasPromoted = savedIds.has(appState.activeDraftId);
  if (nextDrafts.length === beforeDrafts.length && !activeWasPromoted) {
    return false;
  }

  appState.drafts = nextDrafts;
  if (activeWasPromoted) {
    appState.activeDraftId = "";
  }
  if (persist) {
    saveStorage(STORAGE_DRAFTS_KEY, appState.drafts, { address });
    saveStorage(STORAGE_ACTIVE_DRAFT_KEY, appState.activeDraftId, { address });
  }
  return true;
}

function getScenarioNameCollisionExclusions(typedName = "") {
  const excluded = new Set();
  const typed = String(typedName || "").trim().toLowerCase();

  if (appState.activeDraftId) {
    excluded.add(appState.activeDraftId);
  }

  const sourceScenarioId = String(appState.current?.sourceScenarioId || "").trim();
  if (sourceScenarioId) {
    excluded.add(sourceScenarioId);
  }

  // A loaded draft can already have a latest saved run with the same user-facing
  // name. Switching that draft from Simulation to Live is an in-place promotion
  // of the same policy family, not a request to create another scenario.
  if (typed && appState.activeDraftId) {
    for (const scenario of Array.isArray(appState.saved) ? appState.saved : []) {
      if (String(scenario?.name || "").trim().toLowerCase() === typed) {
        excluded.add(scenario.id);
      }
    }
  }

  return [...excluded].filter(Boolean);
}

// Keep the scenario-name input, hidden field, draft state, and command
// strip in sync. Called from the header-name input listener and from
// preset application.
function writeScenarioNameToForm(newName) {
  if (!form) return;
  const hidden = form.elements.namedItem("scenarioName");
  if (hidden && "value" in hidden) hidden.value = newName;
  const header = document.querySelector("[data-header-name]");
  if (header && "value" in header) header.value = newName;
  const stripName = document.querySelector("[data-command-strip-name-text]");
  if (stripName) stripName.textContent = newName || "Untitled scenario";
}

// True when the scenario-name field currently holds a value that
// collides with another of the wallet's drafts or saved runs. Checked at
// submit-time (Run simulation / Save as draft / Rehearse) to block
// actions while the hint is showing.
function hasActiveScenarioNameCollision() {
  const headerField = document.querySelector("[data-header-name]");
  if (!headerField) return false;
  const typed = String(headerField.value || "").trim();
  if (!typed) return false;
  // When editing a loaded draft, that record's own name is not a collision
  // (re-saving unchanged is an in-place update, not a duplicate).
  return collectOwnedScenarioNames("", getScenarioNameCollisionExclusions(typed)).some(
    (n) => n.toLowerCase() === typed.toLowerCase()
  );
}

// Phase D.36 — submit-time gate. Returns a problem kind ("empty" | "collision")
// or null when the name is acceptable. Used by the three submit paths
// (Run simulation / Save as draft / Anchor on-chain) so the operator
// can't ship a scenario with an invalid name.
function getScenarioNameSubmitProblem() {
  const headerField = document.querySelector("[data-header-name]");
  if (!headerField) return null;
  const typed = String(headerField.value || "").trim();
  if (!typed) return "empty";
  if (hasActiveScenarioNameCollision()) return "collision";
  return null;
}

// Draw attention to the scenario-name collision: scroll the hint into
// view and apply a brief shake to both the hint and the input. Called
// when the user tries to submit/save with a colliding name.
function flagScenarioNameCollision() {
  const hint = document.querySelector("[data-scenario-name-hint]");
  const headerField = document.querySelector("[data-header-name]");
  const targets = [hint, headerField].filter(Boolean);
  if (!targets.length) return;
  if (hint && typeof hint.scrollIntoView === "function") {
    hint.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  for (const el of targets) {
    el.classList.remove("is-shaking");
    // Restart the animation even if the class was already present.
    void el.offsetWidth;
    el.classList.add("is-shaking");
    setTimeout(() => el.classList.remove("is-shaking"), 600);
  }
}

// Inline collision warning on the scenario-name input. Hidden unless the
// typed name matches another of the wallet's drafts/saved scenarios; then
// it names the collision, offers a one-click auto-numbered suggestion,
// and flags the input itself with a "has-collision" class so styling can
// highlight the field.
function renderScenarioNameCollisionHint() {
  const headerField = document.querySelector("[data-header-name]");
  const hint = document.querySelector("[data-scenario-name-hint]");
  if (!hint || !headerField) return;
  const typed = String(headerField.value || "").trim();
  if (!typed) {
    hint.hidden = true;
    hint.replaceChildren();
    headerField.classList.remove("has-collision");
    return;
  }
  const owned = collectOwnedScenarioNames("", getScenarioNameCollisionExclusions(typed));
  const collision = owned.some((n) => n.toLowerCase() === typed.toLowerCase());
  if (!collision) {
    hint.hidden = true;
    hint.replaceChildren();
    headerField.classList.remove("has-collision");
    return;
  }
  const suggested = makeUniqueScenarioName(typed, owned);
  headerField.classList.add("has-collision");
  hint.hidden = false;
  const prefix = document.createElement("span");
  prefix.textContent = `“${typed}” is already taken. `;
  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "inline-title-hint__apply";
  apply.textContent = `Use “${suggested}”`;
  apply.addEventListener("click", () => {
    writeScenarioNameToForm(suggested);
    if (appState.draft && typeof appState.draft === "object") {
      appState.draft.scenarioName = suggested;
      saveStorage(STORAGE_DRAFT_KEY, appState.draft);
    }
    renderScenarioNameCollisionHint();
    headerField.focus();
  });
  const suffix = document.createElement("span");
  suffix.textContent = " or rename.";
  hint.replaceChildren(prefix, apply, suffix);
}

// Silently persist the just-completed run into the wallet-scoped saved list
// that powers Workspace recents. A draft id is promoted into the run id on
// first simulation/anchor, so the policy family keeps one position id across
// draft, simulation, and live states.
function autoPersistRunToSavedList() {
  if (!appState.current?.draft || !appState.current?.report) return;
  if (!getWalletState().connected) return;

  if (!appState.current.operatorReview) {
    appState.current.operatorReview = buildOperatorReview(appState.current.draft, appState.current.report);
  }

  const planned = buildAutoSavedRunRecord({
    current: appState.current,
    saved: appState.saved,
    drafts: appState.drafts,
    activeDraftId: appState.activeDraftId,
    sourceSavedId: appState.current.sourceScenarioId || "",
    defaultName: DEFAULT_SCENARIO_NAME,
    makeId,
    buildOperatorReview,
  });

  if (!planned) return;

  if (planned.renamed) {
    appState.current.draft.scenarioName = planned.record.name;
    if (appState.draft && typeof appState.draft === "object") {
      appState.draft.scenarioName = planned.record.name;
      saveStorage(STORAGE_DRAFT_KEY, appState.draft);
    }
    writeScenarioNameToForm(planned.record.name);
    renderScenarioNameCollisionHint();
  }

  appState.current.draft = clone(planned.record.draft);
  appState.current.sourceScenarioId = planned.record.id;
  appState.saved = planned.saved;
  appState.compareId = planned.compareId;
  const walletAddress = getWalletState().address || "";
  pruneDraftsPromotedToSavedRuns({ address: walletAddress });
  saveStorage(STORAGE_SAVED_KEY, appState.saved, { address: walletAddress });
  saveStorage(STORAGE_COMPARE_KEY, appState.compareId, { address: walletAddress });
  persistCurrentState();

  trackEvent("scenario_auto_saved", { scenarioId: planned.record.id, replaced: planned.replaced });

  pushScenario({ ...planned.record, _syncType: "saved" }).catch((err) =>
    console.warn("[sync] push failed:", err.message)
  );
}

// Snapshot a draft (from the Setup form, or from a completed run's inputs
// when called from Results) as a named, reusable template in appState.drafts.
//
// Two paths:
//   1. In-place update — the form was loaded from a specific draft and the
//      scenario name is unchanged. Overwrites that record so repeated saves
//      of the same template don't pile up duplicates.
//   2. New draft — no active record, or the user changed the name. Runs
//      the full collision/auto-number check before adding a fresh entry.
async function saveScenarioAsDraft(draft) {
  const source = draft && typeof draft === "object" ? draft : appState.draft;
  if (!source) {
    setStatus("Nothing to save — the draft is empty.", true);
    return null;
  }

  let planned = planDraftSave({
    source,
    drafts: appState.drafts,
    saved: appState.saved,
    activeDraftId: appState.activeDraftId,
    defaultName: DEFAULT_SCENARIO_NAME,
    makeId,
  });

  if (planned.type === "duplicate") {
    const when = dateTimeFormatter.format(new Date(planned.duplicate.createdAt));
    const proceed = confirm(
      `Already saved as "${planned.duplicate.name}" at ${when}. Save another copy anyway?`
    );
    if (!proceed) {
      setStatus("Save cancelled — identical draft already exists.");
      return null;
    }
    planned = planDraftSave({
      source,
      drafts: appState.drafts,
      saved: appState.saved,
      activeDraftId: appState.activeDraftId,
      defaultName: DEFAULT_SCENARIO_NAME,
      makeId,
      allowDuplicate: true,
    });
  }

  if (planned.type === "empty" || !planned.record) {
    setStatus("Nothing to save — the draft is empty.", true);
    return null;
  }

  appState.drafts = planned.drafts;
  appState.activeDraftId = planned.activeDraftId;
  saveStorage(STORAGE_DRAFTS_KEY, appState.drafts);
  saveStorage(STORAGE_ACTIVE_DRAFT_KEY, appState.activeDraftId);
  replaceSetupRouteId(appState.activeDraftId, { preservePolicy: false });

  if (planned.type === "update") {
    setStatus(`Updated draft "${planned.record.name}".`);
    trackEvent("draft_updated", { draftId: planned.record.id });
    return planned.record;
  }

  if (planned.renamed) {
    trackEvent("draft_name_auto_numbered", { action: "auto_number" });
    source.scenarioName = planned.record.name;
    if (appState.draft && typeof appState.draft === "object") {
      appState.draft.scenarioName = planned.record.name;
      saveStorage(STORAGE_DRAFT_KEY, appState.draft);
    }
    writeScenarioNameToForm(planned.record.name);
    renderScenarioNameCollisionHint();
  }

  setStatus(`Saved draft "${planned.record.name}".`);
  trackEvent("draft_saved", { draftId: planned.record.id });
  return planned.record;
}

function setCurrentFromSaved(savedScenario, options = {}) {
  const { persist = true, adoptDraft = true } = options;
  appState.current = {
    sourceScenarioId: savedScenario.id || "",
    draft: clone(savedScenario.draft),
    input: buildSimulationInput(savedScenario.draft),
    report: clone(savedScenario.report),
    marketBand: isPlainObject(savedScenario.marketBand) ? clone(savedScenario.marketBand) : null,
    judge: isPlainObject(savedScenario.judge) ? clone(savedScenario.judge) : null,
    operatorReview: clone(
      savedScenario.operatorReview || buildOperatorReview(savedScenario.draft, savedScenario.report)
    ),
    onChainPolicy: isPlainObject(savedScenario.onChainPolicy) ? clone(savedScenario.onChainPolicy) : null,
    onChainReceipt: isPlainObject(savedScenario.onChainReceipt) ? clone(savedScenario.onChainReceipt) : null,
  };
  if (adoptDraft) {
    appState.draft = clone(savedScenario.draft);
    appState.activeDraftId = "";
    saveStorage(STORAGE_DRAFT_KEY, appState.draft);
    saveStorage(STORAGE_ACTIVE_DRAFT_KEY, "");
  }
  if (persist) {
    persistCurrentState();
  }
}

function applyRouteRunSelection(routeRunId = readRouteRunIdFromUrl()) {
  const pinned = normalizeLiveHistoryText(routeRunId);
  if (!pinned || currentPage === "workspace" || currentPage === "setup") {
    return { requested: Boolean(pinned), applied: false, missing: false };
  }

  const currentMatchesRoute = Boolean(
    appState.current?.sourceScenarioId === pinned &&
    appState.current?.draft &&
    appState.current?.report
  );

  const savedScenario = (Array.isArray(appState.saved) ? appState.saved : [])
    .find((scenario) => scenario?.id === pinned);

  if (currentMatchesRoute) {
    const savedPolicyId = normalizeLiveHistoryText(savedScenario?.onChainPolicy?.id);
    const currentPolicyId = normalizeLiveHistoryText(appState.current?.onChainPolicy?.id);
    if (!savedScenario || (currentPolicyId && !savedPolicyId)) {
      if (savedScenario && currentPolicyId) {
        attachPolicyToSavedScenario(pinned, appState.current.onChainPolicy, appState.current.onChainReceipt || null);
      }
      persistCurrentState();
      if (currentPage === "results" || currentPage === "live") {
        scheduleRender();
      }
      return { requested: true, applied: true, missing: false, id: pinned, source: "current" };
    }
  }

  if (!savedScenario) {
    if (currentPage === "results" || currentPage === "live") {
      appState.current = null;
    }
    return { requested: true, applied: false, missing: true };
  }

  setCurrentFromSaved(savedScenario, { adoptDraft: false });
  return { requested: true, applied: true, missing: false, id: pinned };
}

function applyRouteSetupSelection(routeId = readRouteScenarioIdFromUrl()) {
  const pinned = normalizeLiveHistoryText(routeId);
  const proofArm = readRouteProofArmFromUrl();
  const handoffDraft = readRouteDraftHandoffFromUrl();
  const applyDraftToSetup = (draft, { id = "", type = "handoff", activeDraftId = "" } = {}) => {
    appState.draft = proofArm ? armDraftForTestnetProof(draft) : normalizeDraftForAlpha(draft);
    appState.activeDraftId = activeDraftId;
    saveStorage(STORAGE_DRAFT_KEY, appState.draft);
    saveStorage(STORAGE_ACTIVE_DRAFT_KEY, appState.activeDraftId);
    return { requested: true, applied: true, missing: false, id, type };
  };
  if (!pinned || currentPage !== "setup") {
    if (currentPage === "setup" && handoffDraft) {
      return applyDraftToSetup(handoffDraft, { type: "handoff" });
    }
    return { requested: Boolean(pinned), applied: false, missing: false };
  }

  const draftRecord = (Array.isArray(appState.drafts) ? appState.drafts : [])
    .find((record) => record?.id === pinned);
  if (draftRecord?.draft) {
    return applyDraftToSetup(draftRecord.draft, {
      id: pinned,
      type: "draft",
      activeDraftId: proofArm ? "" : draftRecord.id,
    });
  }

  const savedScenario = (Array.isArray(appState.saved) ? appState.saved : [])
    .find((scenario) => scenario?.id === pinned);
  if (savedScenario?.draft) {
    setCurrentFromSaved(savedScenario, { adoptDraft: true });
    if (proofArm) {
      appState.draft = armDraftForTestnetProof(appState.draft);
      appState.activeDraftId = "";
      saveStorage(STORAGE_DRAFT_KEY, appState.draft);
      saveStorage(STORAGE_ACTIVE_DRAFT_KEY, "");
    }
    return { requested: true, applied: true, missing: false, id: pinned, type: "run" };
  }

  if (appState.current?.sourceScenarioId === pinned && appState.current?.draft) {
    appState.draft = proofArm ? armDraftForTestnetProof(appState.current.draft) : clone(appState.current.draft);
    appState.activeDraftId = "";
    saveStorage(STORAGE_DRAFT_KEY, appState.draft);
    saveStorage(STORAGE_ACTIVE_DRAFT_KEY, "");
    return { requested: true, applied: true, missing: false, id: pinned, type: "current" };
  }

  if (handoffDraft) {
    return applyDraftToSetup(handoffDraft, { id: pinned, type: "handoff" });
  }

  return { requested: true, applied: false, missing: true, id: pinned };
}

function replaceSetupRouteId(id, { preservePolicy = true } = {}) {
  if (currentPage !== "setup" || typeof window === "undefined" || !window.history?.replaceState) {
    return;
  }
  try {
    const next = buildSetupHref(id, { policy: preservePolicy ? readRoutePolicyIdFromUrl() : "" });
    window.history.replaceState(window.history.state, "", next);
  } catch {}
}

function downloadJsonArtifact(payload, filenameBase, successMessage) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  downloadArtifactBlob(blob, `${slugify(filenameBase || "tide-export")}.json`, successMessage);
}

function downloadTextArtifact(payload, filenameBase, successMessage, mimeType = "text/plain;charset=utf-8") {
  const blob = new Blob([String(payload ?? "")], {
    type: mimeType,
  });
  downloadArtifactBlob(blob, `${slugify(filenameBase || "tide-export")}.md`, successMessage);
}

function downloadArtifactBlob(blob, filename, successMessage) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  if (successMessage) {
    setStatus(successMessage);
  }
}

function exportCurrentScenario() {
  if (!appState.current) {
    return;
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    draft: appState.current.draft,
    report: appState.current.report,
    operatorReview: appState.current.operatorReview,
    onChainPolicy: appState.current.onChainPolicy || null,
    onChainReceipt: appState.current.onChainReceipt || null,
  };
  downloadJsonArtifact(
    payload,
    appState.current.draft.scenarioName,
    "Exported current scenario JSON.",
  );
  trackEvent("scenario_exported", { hasRun: true });
}

function normalizeEntityKey(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/protocol/g, "")
    .replace(/aggregator/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getProtocolRecord(name) {
  const normalized = normalizeEntityKey(name);

  if (protocolIndex.has(normalized)) {
    return protocolIndex.get(normalized);
  }

  for (const protocol of SUI_BTCFI_PROTOCOLS) {
    const protocolName = normalizeEntityKey(protocol.name);

    if (normalized.includes(protocolName) || protocolName.includes(normalized)) {
      return protocol;
    }
  }

  return null;
}

function getProtocolVisual(name) {
  const record = getProtocolRecord(name);
  const key = normalizeEntityKey(record?.id || name);
  const override = PROTOCOL_VISUAL_OVERRIDES[key];

  return {
    label: record?.name || name,
    src: override?.src || `${LOGO_ROOT}/protocols/${key}.svg`,
    fallbackSrc: override?.fallbackSrc || `${LOGO_ROOT}/protocols/generic.svg`,
    bg: PROTOCOL_BG_COLORS[key] || "",
    scale: override?.scale || 0,
  };
}

function normalizeTokenSymbol(symbol) {
  return String(symbol || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function getCollateralAssetSymbol(draft) {
  const raw = String(draft?.collateralAssetSymbol || "").trim();
  return raw || "BTC";
}

function getTokenVisual(symbol) {
  const normalized = normalizeTokenSymbol(symbol);
  const key = TOKEN_LOGO_KEYS[normalized] || normalized.toLowerCase();
  const fallbackKey = normalized.includes("BTC")
    ? normalized.includes("BASKET")
      ? "btcbasket"
      : "btc"
    : normalized.includes("USD") || normalized.includes("USDC")
      ? "usdc"
      : "btc";
  const override = TOKEN_VISUAL_OVERRIDES[normalized];
  return {
    label: symbol,
    src: override?.src || `${LOGO_ROOT}/tokens/${key}.svg`,
    fallbackSrc: override?.fallbackSrc || `${LOGO_ROOT}/tokens/${fallbackKey}.svg`,
  };
}

function renderVisualMark(config, variant = "md") {
  const size = variant === "sm" ? 18 : 40;
  const bgStyle = config.bg ? `background:${escapeHtml(config.bg)};` : "";
  const imgStyle = config.scale ? `style="transform:scale(${config.scale})"` : "";

  return `
    <span class="visual-mark visual-mark-${variant}" ${bgStyle ? `style="${bgStyle}"` : ""}>
      <img
        class="visual-mark-image"
        src="${escapeHtml(config.src)}"
        alt="${escapeHtml(config.label)} logo"
        data-fallback-src="${escapeHtml(config.fallbackSrc || "")}"
        width="${size}"
        height="${size}"
        loading="eager"
        decoding="sync"
        fetchpriority="high"
        ${imgStyle}
      >
    </span>
  `;
}

function renderTokenChip(symbol) {
  const visual = getTokenVisual(symbol);

  return `
    <span class="token-chip" title="${escapeHtml(symbol)}">
      ${renderVisualMark(visual, "sm")}
      <span class="token-chip-label">${escapeHtml(symbol)}</span>
    </span>
  `;
}

function renderTokenSubline(symbol, label = "") {
  const safeSymbol = String(symbol || "").trim();
  if (!safeSymbol) return "";
  const safeLabel = label || safeSymbol;
  return `<span class="ws-token-sub">${renderTokenMark({ symbol: safeSymbol, size: "md", ariaLabel: `${safeSymbol} token` })}<span>${escapeHtml(safeLabel)}</span></span>`;
}

function renderTokenChips(value) {
  if (!value) return "";
  return value.split(/\s*\/\s*/).filter(Boolean).map(renderTokenChip).join("");
}

function renderProtocolInline(name, subtitle = "", variant = "md") {
  const visual = getProtocolVisual(name);

  return `
    <div class="entity-inline entity-inline--${variant}">
      ${renderVisualMark(visual, variant)}
      <div class="entity-copy">
        <strong title="${escapeHtml(visual.label)}">${escapeHtml(visual.label)}</strong>
        ${subtitle ? `<span>${escapeHtml(subtitle)}</span>` : ""}
      </div>
    </div>
  `;
}

/* ─── Icon system ─── */

// Vendored Lucide path data (MIT). 25 glyphs covering TIDE's operator
// vocabulary: anchor / mint / sign / play / pause / run / copy /
// external-link / nav chevrons / x / check / info / warn / danger /
// search / filter / settings / refresh / download / upload /
// trending-up (sparkline) / shield-check. All use the canonical
// 24×24 viewBox with stroke="currentColor" stroke-width="2"
// stroke-linecap="round" stroke-linejoin="round" so they inherit
// colour from the surrounding text and respect the icon-size tokens.
// Source: https://lucide.dev/ (paths copied verbatim).
const ICON_PATHS = {
  "anchor":         '<circle cx="12" cy="5" r="3"/><line x1="12" y1="22" x2="12" y2="8"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/>',
  "archive":        '<rect x="2" y="4" width="20" height="5" rx="2"/><path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"/><line x1="10" y1="13" x2="14" y2="13"/>',
  "pen-line":       '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  "play":           '<polygon points="5 3 19 12 5 21 5 3"/>',
  "pause":          '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
  "zap":            '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  "copy":           '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  "external-link":  '<line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/>',
  "chevron-down":   '<polyline points="6 9 12 15 18 9"/>',
  "chevron-up":     '<polyline points="18 15 12 9 6 15"/>',
  "chevron-right":  '<polyline points="9 18 15 12 9 6"/>',
  "chevron-left":   '<polyline points="15 18 9 12 15 6"/>',
  "x":              '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  "check":          '<polyline points="20 6 9 17 4 12"/>',
  "info":           '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  "alert-triangle": '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  "alert-octagon":  '<polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  "search":         '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  "filter":         '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  "settings":       '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  "refresh-cw":     '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>',
  "download":       '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  "upload":         '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  "trending-up":    '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  "shield-check":   '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>',
  "calendar":       '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  // Phase B.16.2 — section-head category icons (UI 4th-pass A+5).
  // Lucide-source paths (open ISC) for the 7 missing categories.
  "palette":        '<circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c1.105 0 2-.895 2-2 0-.523-.213-.999-.544-1.367a2 2 0 0 1 1.451-3.4H17a5 5 0 0 0 5-5C22 6.477 16.97 2 12 2z"/>',
  "image":          '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  "list":           '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  "layers":         '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  "key":            '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
  "activity":       '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  "compass":        '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  // Phase D.1 — consolidate one-off inline SVGs (chain link / cloud / monitor /
  // alert-circle) into the canonical icon() registry so workspace chips and
  // review-flag stop carrying their own ad-hoc viewBoxes + stroke widths.
  "link":           '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  "cloud":          '<path d="M17.5 19a4.5 4.5 0 1 0-1.4-8.78A6.5 6.5 0 1 0 5 14.5"/>',
  "monitor":        '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  "alert-circle":   '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
};

// Render a single SVG icon by name. Sizing is driven by --icon-* CSS
// tokens via a class modifier so the icon scales with type around it.
// Usage: icon("anchor"), icon("anchor", "lg"), icon("anchor", "md", { ariaLabel: "Anchor", className: "my-icon" }).
function icon(name, size = "md", opts = {}) {
  const path = ICON_PATHS[name];
  if (!path) return "";
  const sizeClass = `ds-icon--${size}`;
  const extraClass = opts.className ? ` ${opts.className}` : "";
  const ariaLabel = opts.ariaLabel || "";
  const a11y = ariaLabel
    ? ` role="img" aria-label="${escapeHtml(ariaLabel)}"`
    : ' aria-hidden="true"';
  return `<svg class="ds-icon ${sizeClass}${extraClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${a11y}>${path}</svg>`;
}

function renderIconBadge(label, { tone = "", iconName = "info", title = "" } = {}) {
  const cls = `icon-badge${tone ? ` icon-badge--${tone}` : ""}`;
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
  return `<span class="${cls}"${titleAttr}>${icon(iconName, "xs")}${escapeHtml(label)}</span>`;
}

// Inline sparkline — 8-point series → smoothed polyline SVG. Tone is
// inherited via currentColor so the parent .spark-inline--mint/rose/...
// modifier flows through. No tooltip, no axis — purely a row decoration
// to show "this number has a shape" inside dense tables.
function renderInlineSpark(values, opts = {}) {
  const arr = Array.isArray(values) && values.length >= 2 ? values.slice() : null;
  if (!arr) return "";
  const w = Number.isFinite(opts.width) ? opts.width : 48;
  const h = Number.isFinite(opts.height) ? opts.height : 12;
  const pad = Math.max(1, Math.min(Number.isFinite(opts.padding) ? opts.padding : 2, h / 3));
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const span = max - min;
  const stepX = arr.length > 1 ? w / (arr.length - 1) : w;
  const points = arr.map((v, i) => {
    const x = i * stepX;
    const ratio = span > 0 ? (v - min) / span : 0.5;
    const y = (h - pad) - ratio * (h - pad * 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const d = `M${points[0]} L${points.slice(1).join(" L")}`;
  const tone = opts.tone ? ` spark-inline--${opts.tone}` : "";
  return `<span class="spark-inline${tone}" aria-hidden="true"><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${d}"/></svg></span>`;
}

// Polymarket-style event chart. Shows a price curve over time with
// horizontal level lines (liq / target / current) and vertical event
// markers (anchored / minted / re-tuned / outage / etc). Renders as
// inline SVG so it scales fluidly inside any surface.
//
//   renderEventChart({
//     points: [{ t: 0, price: 77800 }, { t: 1, price: 78100 }, …],
//     events: [{ t: 5, label: "Anchored", tone: "accent" }, …],
//     levels: [{ value: 60000, label: "Liq $60k", tone: "rose" }, …],
//     width: 560, height: 220, tone: "accent", label: "BTC · 30d",
//   })
//
// `t` is just an ordering index (0…N-1); axes are unitless except for
// the optional date strip below the curve. Per master-synthesis +
// Polymarket-style chart user reference.
function buildRoundedSvgPath(points, { radius = 14, precision = 2 } = {}) {
  const pts = (Array.isArray(points) ? points : [])
    .map((p) => ({ x: Number(p?.x), y: Number(p?.y) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const fmt = (v) => v.toFixed(precision);
  if (!pts.length) return "";
  if (pts.length === 1) return `M ${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
  if (pts.length === 2) return `M ${fmt(pts[0].x)} ${fmt(pts[0].y)} L ${fmt(pts[1].x)} ${fmt(pts[1].y)}`;

  const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const toward = (from, to, amount) => {
    const len = dist(from, to);
    if (len < 1e-6) return { x: from.x, y: from.y };
    const t = Math.min(0.5, Math.max(0, amount / len));
    return {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    };
  };

  let d = `M ${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const next = pts[i + 1];
    const prevLen = dist(prev, cur);
    const nextLen = dist(cur, next);
    if (prevLen < 1e-6 || nextLen < 1e-6) {
      d += ` L ${fmt(cur.x)} ${fmt(cur.y)}`;
      continue;
    }
    const corner = Math.min(radius, prevLen * 0.38, nextLen * 0.38);
    const entry = toward(cur, prev, corner);
    const exit = toward(cur, next, corner);
    d += ` L ${fmt(entry.x)} ${fmt(entry.y)} Q ${fmt(cur.x)} ${fmt(cur.y)} ${fmt(exit.x)} ${fmt(exit.y)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${fmt(last.x)} ${fmt(last.y)}`;
  return d;
}

function renderEventChart(opts = {}) {
  const points = Array.isArray(opts.points) ? opts.points : [];
  if (points.length < 2) return "";
  const events = Array.isArray(opts.events) ? opts.events : [];
  const levels = Array.isArray(opts.levels) ? opts.levels : [];
  const W = Number.isFinite(opts.width) ? opts.width : 600;
  const H = Number.isFinite(opts.height) ? opts.height : 220;
  // Per frontend second pass HYG-18: tone allow-list (the value flows
  // through escapeHtml to a class name AND maps a CSS variable; treat
  // it as an enum, not a string). Same for level/event tones below.
  const TONE_ENUM = ["accent", "mint", "amber", "rose", "cyan", "violet", "muted"];
  const safeTone = (v, fallback = "accent") => TONE_ENUM.includes(v) ? v : fallback;
  const tone = safeTone(opts.tone, "accent");
  const label = opts.label || "Price chart with events";
  const xLabels = Array.isArray(opts.xLabels) ? opts.xLabels : [];
  const TONE = {
    accent: "var(--accent)", mint: "var(--mint)", amber: "var(--amber)",
    rose: "var(--rose)", cyan: "var(--cyan)", violet: "var(--violet)",
    muted: "var(--muted)",
  };
  const padTop = 18, padBottom = 38, padLeft = 12, padRight = 92;
  const innerW = W - padLeft - padRight;
  const innerH = H - padTop - padBottom;
  const ys = points.map((p) => Number.isFinite(Number(p?.price)) ? Number(p.price) : 0);
  const maxX = Math.max(1, points.length - 1);
  // Per frontend HYG-2: filter out non-finite level.value before
  // Math.min/max so a stray NaN doesn't poison the y-span math.
  const validLevelValues = levels
    .map((l) => Number(l?.value))
    .filter((v) => Number.isFinite(v));
  const minY = Math.min(...ys, ...(validLevelValues.length ? validLevelValues : []));
  const maxY = Math.max(...ys, ...(validLevelValues.length ? validLevelValues : []));
  const ySpan = Math.max(1, maxY - minY);
  const xToPx = (i) => padLeft + (i / maxX) * innerW;
  const yToPx = (v) => padTop + ((maxY - v) / ySpan) * innerH;
  const linePath = buildRoundedSvgPath(points.map((p, i) => ({ x: xToPx(i), y: yToPx(p.price) })), { radius: 10, precision: 2 });
  const lineColor = TONE[tone] || TONE.accent;

  const levelLines = levels.map((lv) => {
    const v = Number(lv?.value);
    if (!Number.isFinite(v)) return "";
    const y = yToPx(v).toFixed(2);
    const t = safeTone(lv?.tone, "muted");
    const c = TONE[t];
    return `<g class="event-chart__level event-chart__level--${t}">
      <line x1="${padLeft}" y1="${y}" x2="${padLeft + innerW}" y2="${y}" stroke="${c}" stroke-width="1" stroke-dasharray="6 6" opacity="0.6"/>
      <text x="${padLeft + innerW + 8}" y="${(Number(y) + 4).toFixed(2)}" font-size="10" font-family="ui-monospace,Menlo,monospace" fill="${c}" font-weight="700">${escapeHtml(lv?.label || "")}</text>
    </g>`;
  }).join("");

  const eventMarks = events.map((ev) => {
    const x = xToPx(Number(ev?.t) || 0).toFixed(2);
    const t = safeTone(ev?.tone, "accent");
    const c = TONE[t];
    return `<g class="event-chart__event event-chart__event--${t}">
      <line x1="${x}" y1="${padTop}" x2="${x}" y2="${padTop + innerH}" stroke="${c}" stroke-width="1" stroke-dasharray="2 4" opacity="0.45"/>
      <circle cx="${x}" cy="${(padTop + innerH + 12).toFixed(2)}" r="4.5" fill="${c}"/>
      <text x="${(Number(x) + 9).toFixed(2)}" y="${(padTop + innerH + 16).toFixed(2)}" font-size="10" font-family="ui-monospace,Menlo,monospace" fill="${c}" font-weight="700">${escapeHtml(ev?.label || "")}</text>
    </g>`;
  }).join("");

  const xAxisLabels = xLabels.length
    ? xLabels.map((lbl, i) => {
        const idx = Math.round((i / Math.max(1, xLabels.length - 1)) * (points.length - 1));
        const x = xToPx(idx).toFixed(2);
        return `<text x="${x}" y="${(padTop + innerH + 32).toFixed(2)}" font-size="9.5" font-family="ui-monospace,Menlo,monospace" fill="var(--muted)" text-anchor="middle">${escapeHtml(lbl)}</text>`;
      }).join("")
    : "";

  // Phase D.16 — area-fill polygon under the curve removed. The
  // user pointed out the dark rectangle/area-fill background read as
  // a "ugly frame" that didn't belong in the chart language. Levels
  // (dashed) and event markers (dotted) carry the visual context;
  // the line itself is the curve. No bg fill.
  return `<svg class="event-chart" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(label)}">
    ${levelLines}
    <path d="${linePath}" fill="none" stroke="${lineColor}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
    ${eventMarks}
    ${xAxisLabels}
  </svg>`;
}

// Circular token-mark wrapper. Same idea as renderVisualMark but with
// a 1 px outer rim + var(--surface-soft) inner fill, sized via the
// --token-mark-* scale (xs 16, sm 20, md 28, lg 40, xl 56). Used in
// the design-system playground for the "circular token icons with
// rim" treatment the reference vibe leans on.
// Prefer renderTokenMark("btc", "md") OR renderTokenMark({ symbol, size, ariaLabel })
// for the opts-bag form (allows ariaLabel + future tone modifier).
function renderTokenMark(symbol, size = "md") {
  let opts = null;
  if (symbol && typeof symbol === "object" && !Array.isArray(symbol)) {
    opts = symbol;
    symbol = opts.symbol;
    size = opts.size || "md";
  }
  const visual = getTokenVisual(symbol);
  const safeSize = ["xs", "sm", "md", "lg", "xl"].includes(size) ? size : "md";
  const ariaLabel = opts?.ariaLabel
    ? ` role="img" aria-label="${escapeHtml(opts.ariaLabel)}"`
    : ' aria-hidden="true"';
  if (!visual?.src) {
    return `<span class="token-mark token-mark--${safeSize} token-mark--missing"${ariaLabel}></span>`;
  }
  return `<span class="token-mark token-mark--${safeSize}"${ariaLabel}>
    <img
      class="token-mark-image visual-mark-image"
      src="${escapeHtml(visual.src)}"
      alt=""
      data-fallback-src="${escapeHtml(visual.fallbackSrc || "")}"
      loading="lazy"
    />
  </span>`;
}

/* ─── Visual component renderers ─── */

// Horizontal BTC-price chart — Polymarket-shaped sensitivity bar that
// answers "how far does BTC have to drop before I'm in trouble?". Bands
// are deterministic from policy: priceAtBoundary = debt / (collateral
// × boundaryLtv). Reads left → right by danger: rose (below liq) →
// amber (warn corridor) → mint (target band) → neutral safe zone, with
// a cyan needle at the current spot price and a headroom callout
// underneath. Pairs visually with renderPositionScale (LTV axis) — same
// band grammar, same needle style, stacked together on Live monitor.
// renderScaleShell — DOM scaffold shared between renderPriceScale +
// renderPositionScale. Both helpers compute domain-specific axis
// math and tone, then ask the shell to assemble the canonical
// `<figure class="{kind}-scale {kind}-scale--{tone}">…</figure>`.
//
// kind          ∈ "price" | "position"  — toggles CSS prefix
// tone          ∈ "danger" | "warn" | "ok" | "low"
// label         section eyebrow text
// currentLabel  big strong inside .__head (e.g. "$77,586" or "18.6%")
// ariaLabel     full sentence for SR
// legendHtml    pre-built legend chip cluster
// bandsHtml     pre-built band divs (caller owns geometry)
// needlePct     current value as 0-100 percentage along axis
// ticksHtml     optional tick row beneath the track
// footerHtml    optional paragraph below ticks (price-scale headroom)
// live          true when the scale is bound to a live/on-chain readout
//
// CSS hosts (.price-scale__*, .position-scale__*) stay untouched —
// this is a pure DOM-template extraction, no rule-name churn.
function renderScaleShell({ kind, tone, label, currentLabel, ariaLabel, legendHtml, bandsHtml, needlePct, ticksHtml = "", footerHtml = "", live = false } = {}) {
  const k = kind === "position" ? "position" : "price";
  const liveAttr = live === true ? ' data-live="true"' : "";
  return `
    <figure class="${k}-scale ${k}-scale--${tone}"${liveAttr} aria-label="${escapeHtml(ariaLabel || "")}">
      <figcaption class="${k}-scale__caption">
        <div class="${k}-scale__head">
          <span class="section-label">${escapeHtml(label || "")}</span>
          <strong class="${k}-scale__current ${k}-scale__current--${tone}">${currentLabel}</strong>
        </div>
        <div class="${k}-scale__legend" aria-hidden="true">${legendHtml}</div>
      </figcaption>
      <div class="${k}-scale__track">
        ${bandsHtml}
        <div class="${k}-scale__needle" style="left:${needlePct.toFixed(2)}%" data-tone="${tone}">
          <span class="${k}-scale__needle-dot"></span>
          <span class="${k}-scale__needle-label">${currentLabel}</span>
        </div>
      </div>
      ${ticksHtml ? `<div class="${k}-scale__ticks" aria-hidden="true">${ticksHtml}</div>` : ""}
      ${footerHtml}
    </figure>
  `;
}

// 7-day spot-price sparkline overlay is a TODO once the feed lands.
function renderPriceScale({
  currentPrice,
  debtUsd,
  collateralBtc,
  targetLow,
  targetHigh,
  maxLtv,
  ...options
} = {}) {
  const price = Number(currentPrice) || 0;
  const debt = Number(debtUsd) || 0;
  const coll = Number(collateralBtc) || 0;
  if (!(price > 0) || !(coll > 0) || !(debt > 0)) return "";
  const safeMax = Math.max(0.01, Number(maxLtv) || 0.6);
  const lo = Math.max(0, Math.min(safeMax, Number(targetLow) || 0));
  const hi = Math.max(lo, Math.min(safeMax, Number(targetHigh) || lo));

  const priceAtMaxLtv = debt / (coll * safeMax);
  const priceAtTargetHigh = debt / (coll * hi);
  const priceAtTargetLow = lo > 0 ? debt / (coll * lo) : Infinity;

  // Axis: span from below-liq (×0.85) to above-current/target (×1.2).
  const axisLow = Math.max(0, Math.min(priceAtMaxLtv * 0.85, price * 0.55));
  const axisHigh = Math.max(price * 1.2, isFinite(priceAtTargetLow) ? priceAtTargetLow * 1.05 : price * 1.4);
  const span = Math.max(axisHigh - axisLow, 1);
  const toPct = (p) => Math.max(0, Math.min(100, ((p - axisLow) / span) * 100));

  const liqPct = toPct(priceAtMaxLtv);
  const warnPct = toPct(priceAtTargetHigh);
  const targetPct = isFinite(priceAtTargetLow) ? toPct(priceAtTargetLow) : 100;
  const currentPct = toPct(price);

  const headroomPct = ((price - priceAtMaxLtv) / Math.max(price, 1)) * 100;
  const tone = price < priceAtMaxLtv
    ? "danger"
    : price < priceAtTargetHigh
      ? "warn"
      : price < (isFinite(priceAtTargetLow) ? priceAtTargetLow : Infinity)
        ? "ok"
        : "low";

  const fmtUsd = (v) => `$${Math.round(v).toLocaleString()}`;
  const bandsHtml = `
    <div class="price-scale__band price-scale__band--danger" style="left:0; width:${liqPct.toFixed(2)}%"></div>
    <div class="price-scale__band price-scale__band--warn" style="left:${liqPct.toFixed(2)}%; width:${Math.max(0, warnPct - liqPct).toFixed(2)}%"></div>
    <div class="price-scale__band price-scale__band--target" style="left:${warnPct.toFixed(2)}%; width:${Math.max(0, targetPct - warnPct).toFixed(2)}%"></div>
  `;
  const legendHtml = `
    <span class="legend-chip legend-chip--rose">liq ${fmtUsd(priceAtMaxLtv)}</span>
    <span class="legend-chip legend-chip--amber">warn ${fmtUsd(priceAtTargetHigh)}</span>
    ${isFinite(priceAtTargetLow) ? `<span class="legend-chip legend-chip--mint">target ${fmtUsd(priceAtTargetLow)}</span>` : ""}
  `;
  const ticksHtml = `<span class="price-scale__tick--liq" style="left:${liqPct.toFixed(2)}%">liq ${fmtUsd(priceAtMaxLtv)}</span>`;
  const footerHtml = `
    <p class="price-scale__headroom">
      ${headroomPct > 0
        ? `<strong>${headroomPct.toFixed(0)}% modeled headroom</strong> — at the current modeled debt/collateral assumptions, BTC reaches max pressure near ${fmtUsd(priceAtMaxLtv)} (from ${fmtUsd(price)}).`
        : `<strong class="price-scale__headroom--danger">Inside danger zone</strong> — BTC at ${fmtUsd(price)} vs max pressure ${fmtUsd(priceAtMaxLtv)}.`}
    </p>
  `;
  return renderScaleShell({
    kind: "price",
    tone,
    label: options.label || "BTC price · drawdown sensitivity",
    currentLabel: fmtUsd(price),
    ariaLabel: `BTC price ${fmtUsd(price)}, max pressure at ${fmtUsd(priceAtMaxLtv)}`,
    legendHtml,
    bandsHtml,
    needlePct: currentPct,
    ticksHtml,
    footerHtml,
    live: options.live === true,
  });
}

// Horizontal LTV positioning chart — slim companion to the price-scale.
// Same Polymarket-shaped grammar (mint target band, amber warn corridor,
// rose liquidation zone, cyan needle at current value) but the axis is
// LTV % instead of BTC price. The two charts read as a vertical pair
// on Live monitor: price answers "how far can BTC drop", LTV answers
// "how close am I to my configured threshold".
// Prefer renderPositionScale({ currentLtv, targetLow, targetHigh, maxLtv, label }).
// Legacy 4-positional form accepted for one release.
function renderPositionScale(currentLtv, targetLow, targetHigh, maxLtv, options = {}) {
  if (currentLtv && typeof currentLtv === "object" && !Array.isArray(currentLtv)) {
    const o = currentLtv;
    return renderPositionScale(o.currentLtv, o.targetLow, o.targetHigh, o.maxLtv, o);
  }
  const safeMax = Math.max(0.01, Number(maxLtv) || 0.6);
  const lo = Math.max(0, Math.min(safeMax, Number(targetLow) || 0));
  const hi = Math.max(lo, Math.min(safeMax, Number(targetHigh) || lo));
  const ltv = Math.max(0, Number(currentLtv) || 0);

  const axisMax = Math.max(1.0, safeMax * 1.3);
  const toPct = (v) => Math.max(0, Math.min(100, (v / axisMax) * 100));

  const loPct = toPct(lo);
  const hiPct = toPct(hi);
  const maxPct = toPct(safeMax);
  const ltvPct = toPct(ltv);

  const tone = ltv > safeMax
    ? "danger"
    : ltv > hi
      ? "warn"
      : ltv >= lo
        ? "ok"
        : "low";
  const toneLabel = tone === "danger"
    ? "above max, danger zone"
    : tone === "warn"
      ? "above target, warning corridor"
      : tone === "ok"
        ? "within target band"
        : "below target band";

  const fmt = (v) => `${(v * 100).toFixed(0)}%`;
  const ltvFmt = `${(ltv * 100).toFixed(1)}%`;

  const bandsHtml = `
    <div class="position-scale__band position-scale__band--target" style="left:${loPct.toFixed(2)}%; width:${(hiPct - loPct).toFixed(2)}%"></div>
    <div class="position-scale__band position-scale__band--warn" style="left:${hiPct.toFixed(2)}%; width:${(maxPct - hiPct).toFixed(2)}%"></div>
    <div class="position-scale__band position-scale__band--danger" style="left:${maxPct.toFixed(2)}%; right:0"></div>
  `;
  const legendHtml = `
    <span class="legend-chip legend-chip--mint">${fmt(lo)}–${fmt(hi)} target</span>
    <span class="legend-chip legend-chip--amber">${fmt(safeMax)} max</span>
    <span class="legend-chip legend-chip--rose">danger</span>
  `;
  const ticksHtml = `
    <span style="left:0%">0%</span>
    <span style="left:${loPct.toFixed(2)}%">${fmt(lo)}</span>
    <span style="left:${hiPct.toFixed(2)}%">${fmt(hi)}</span>
    <span class="position-scale__tick--max" style="left:${maxPct.toFixed(2)}%">${fmt(safeMax)} max</span>
  `;
  return renderScaleShell({
    kind: "position",
    tone,
    label: options.label || "Position · debt pressure",
    currentLabel: ltvFmt,
    ariaLabel: `Debt pressure ${ltvFmt}, ${toneLabel}, target ${fmt(lo)}–${fmt(hi)}, max ${fmt(safeMax)}`,
    legendHtml,
    bandsHtml,
    needlePct: ltvPct,
    ticksHtml,
    live: options.live === true,
  });
}

// Mini health ring — used inside each stress-scenario card. SVG donut
// from 0 to score/100, mint above 70, amber above 40, rose otherwise,
// with the score number in the centre.
// Prefer renderMiniHealthRing(score, size) OR renderMiniHealthRing({ score, size, tone })
// where tone overrides the score-derived auto-tone.
function renderMiniHealthRing(score, size = 40) {
  let opts = null;
  if (score && typeof score === "object" && !Array.isArray(score)) {
    opts = score;
    score = Number(opts.score) || 0;
    size = opts.size || 40;
  }
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(100, Math.max(0, score)) / 100);
  const TONE_VAR = { mint: "var(--mint)", amber: "var(--amber)", rose: "var(--rose)", accent: "var(--accent)", cyan: "var(--cyan)", violet: "var(--violet)" };
  const color = (opts?.tone && TONE_VAR[opts.tone])
    || (score >= 70 ? "var(--mint)" : score >= 40 ? "var(--amber)" : "var(--rose)");
  return `
    <span class="scenario-ring-shell" role="img" aria-label="Health score: ${score} out of 100">
      <svg class="scenario-ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
        <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="3"/>
        <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round"
          stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"
          transform="rotate(-90 ${size/2} ${size/2})"/>
        <text x="${size/2}" y="${size/2}" text-anchor="middle" dominant-baseline="central" fill="var(--text-strong)" font-family="Sora,Manrope,sans-serif" font-weight="700" font-size="${size < 44 ? 11 : 13}">${score}</text>
      </svg>
    </span>
  `;
}

function renderStressSparkline(scenarios) {
  if (!scenarios || scenarios.length === 0) return "";
  const maxScore = 100;
  return `
    <div class="stress-spark" aria-label="Health scores across stress scenarios">
      ${scenarios.map((o, i) => {
        const h = Math.max(4, (o.health.score / maxScore) * 48);
        return `<div class="stress-spark-bar" data-spark-state="${escapeHtml(o.operatingState)}" data-spark-index="${i}" style="height:${h.toFixed(0)}px" title="${escapeHtml(o.scenario.label)}: ${o.health.score}/100" aria-hidden="true"></div>`;
      }).join("")}
    </div>
    <div class="spark-detail-popup" hidden></div>
  `;
}

function renderStressScenarioStrip(scenarios) {
  if (!scenarios || scenarios.length === 0) return "";
  return `
    <div class="stress-ladder-strip" aria-label="Stress scenario checkpoints">
      ${scenarios.map((outcome, index) => `
        <button
          type="button"
          class="stress-ladder-cell"
          data-state="${escapeHtml(outcome.operatingState)}"
          data-spark-index="${index}"
          aria-label="${escapeHtml(outcome.scenario.label)}: ${outcome.health.score}/100, ${escapeHtml(formatOperatingStateLabel(outcome.operatingState))}"
        >
          <span class="stress-ladder-cell__kicker">#${index + 1} · ${formatDrawdown(outcome.scenario?.drawdownPct)}</span>
          <span class="stress-ladder-cell__main">
            <strong>${outcome.health.score}</strong>
            <span>${escapeHtml(formatOperatingStateLabel(outcome.operatingState))}</span>
          </span>
          <span class="stress-ladder-cell__meta">
            <span>${formatPercentDecimal(outcome.result.decision.risk.ltv)}</span>
            <span>${escapeHtml(formatActionTypeLabel(outcome.result.decision.chosen.type))}</span>
          </span>
        </button>
      `).join("")}
    </div>
  `;
}

function bindSparkBarClicks(container, scenarios) {
  if (!container || !scenarios) return;
  const allTargets = container.querySelectorAll(".stress-spark-bar[data-spark-index], .stress-ladder-cell[data-spark-index]");
  const keyboardTargets = container.querySelectorAll(".stress-ladder-cell[data-spark-index]");
  const popup = container.querySelector(".spark-detail-popup");
  if (!popup) return;

  allTargets.forEach((bar) => {
    bar.style.cursor = "pointer";
    const handler = () => {
      const idx = parseInt(bar.dataset.sparkIndex, 10);
      const o = scenarios[idx];
      if (!o) return;

      // Toggle off if clicking same bar
      if (popup.dataset.activeIndex === String(idx) && !popup.hidden) {
        popup.hidden = true;
        popup.dataset.activeIndex = "";
        allTargets.forEach((b) => b.classList.remove("is-selected"));
        return;
      }

      allTargets.forEach((b) => b.classList.remove("is-selected"));
      allTargets.forEach((b) => {
        if (b.dataset.sparkIndex === String(idx)) b.classList.add("is-selected");
      });
      popup.dataset.activeIndex = String(idx);
      popup.hidden = false;
      safeReplaceChildren(popup, `
        <div class="spark-detail-head">
          <strong>${escapeHtml(o.scenario.label)}</strong>
          <span class="state-badge">${escapeHtml(formatOperatingStateLabel(o.operatingState))}</span>
        </div>
        <div class="spark-detail-grid">
          <div><span>Health</span><strong>${o.health.score}/100</strong></div>
          <div><span>Action</span><strong>${escapeHtml(formatActionTypeLabel(o.result.decision.chosen.type))}</strong></div>
          <div><span>Payout</span><strong>${formatUsdRange(o.payoutBandLowUsd, o.payoutBandHighUsd)}</strong></div>
          <div><span>Debt pressure</span><strong>${formatPercentDecimal(o.result.decision.risk.ltv)}</strong></div>
          <div><span>Buffer</span><strong>${Math.round(o.bufferCoverageDays)}d</strong></div>
          <div><span>Regime</span><strong>${escapeHtml(o.result.decision.regime)}</strong></div>
        </div>
        <p class="spark-detail-explain">${escapeHtml(o.result.decision.chosen.explanation)}</p>
      `);
    };
    bar.addEventListener("click", handler);
  });
  keyboardTargets.forEach((bar) => {
    const handler = () => {
      bar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    };
    bar.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handler(); } });
  });
}

// Compact chip shown next to the results hero title when a market-implied
// scenario band is active. Clicking is not wired — this is context, not a
// control — the scenarios are rendered in the main scenario list already.

// Renders the market-implied sustainableMonthlyPayout band as a distribution
// across the p10/p25/p50/p75/p90 quantiles. Called from the main results
// surface. Returns empty string when no market band is present so the DOM
// stays clean on fallback-only runs.
function renderMarketPayoutBand(report, marketBand) {
  if (!marketBand?.scenarios?.length) return "";
  const byId = new Map();
  for (const outcome of report.scenarios || []) {
    if (outcome.scenario?.id) byId.set(outcome.scenario.id, outcome);
  }
  const rows = marketBand.scenarios
    .map((scenario) => {
      const outcome = byId.get(scenario.id);
      if (!outcome) return null;
      const payout = outcome.result?.decision?.risk?.sustainableMonthlyPayoutUsd ?? 0;
      return {
        quantile: scenario.quantile,
        priceUsd: scenario.impliedPriceUsd,
        payoutUsd: payout,
        operatingState: outcome.operatingState,
      };
    })
    .filter(Boolean);
  if (rows.length === 0) return "";

  const maxPayout = Math.max(1, ...rows.map((r) => r.payoutUsd));
  const quantileRows = rows
    .map((row) => {
      const widthPct = Math.min(100, (row.payoutUsd / maxPayout) * 100);
      return `
        <div class="market-band-row">
          <span class="market-band-q">p${Math.round(row.quantile * 100)}</span>
          <span class="market-band-price">BTC ≈ ${formatUsd(row.priceUsd)}</span>
          <div class="market-band-track"><div class="market-band-fill" style="width:${widthPct.toFixed(1)}%"></div></div>
          <strong class="market-band-payout">${formatUsd(row.payoutUsd)}</strong>
          <span class="market-band-state">${escapeHtml(formatOperatingStateLabel(row.operatingState))}</span>
        </div>
      `;
    })
    .join("");

  const warnings = (marketBand.warnings || [])
    .slice(0, 2)
    .map((w) => `<li>${escapeHtml(w)}</li>`)
    .join("");

  const desc = marketBand.description;
  const header = desc
    ? `${escapeHtml(desc.source)} · obs ${escapeHtml(desc.observedAt)} · horizon ${escapeHtml(desc.horizonAt)}`
    : "market-implied";

  return `
    <section class="market-band-surface">
      <header class="market-band-head">
        <h3>Read-only public-market model payout band</h3>
        <span class="market-band-meta">${header}${marketBand.stale ? " · <em>stale</em>" : ""}</span>
      </header>
      <p class="market-band-copy">
        Modeled sustainable monthly payout across public prediction-market quantiles. No live execution or signing is triggered.
        Baseline stress buckets (${DEFAULT_SHADOW_SCENARIOS.map((s) => `${Math.round(s.drawdownPct * 100)}%`).join(" · ")}) still run alongside.
      </p>
      <div class="market-band-rows">${quantileRows}</div>
      ${warnings ? `<ul class="market-band-warnings">${warnings}</ul>` : ""}
    </section>
  `;
}

function renderPayoutRangeBar(low, high, target) {
  const maxVal = Math.max(target * 1.2, high * 1.1, 1);
  const leftPct = (low / maxVal) * 100;
  const widthPct = ((high - low) / maxVal) * 100;
  return `
    <div class="payout-range-bar" title="Payout range: ${formatUsd(low)} - ${formatUsd(high)}">
      <div class="payout-range-fill" style="left:${leftPct.toFixed(1)}%;width:${widthPct.toFixed(1)}%"></div>
    </div>
  `;
}

function renderMetricCard(label, value, copy = "", tone = "") {
  return `
    <article class="metric-card ${tone ? `metric-card-${tone}` : ""}">
      <span>${escapeHtml(label)}</span>
      <strong title="${escapeHtml(value)}">${escapeHtml(value)}</strong>
      ${copy ? `<p>${escapeHtml(copy)}</p>` : ""}
    </article>
  `;
}

// Prefer renderFactList(items, "fact-list-compact") OR
// renderFactList(items, { className, dense, ariaLabel }).
function renderFactList(items, className = "") {
  let opts = null;
  if (className && typeof className === "object" && !Array.isArray(className)) {
    opts = className;
    className = opts.className || (opts.dense ? "fact-list-compact" : "");
  }
  const ariaLabel = opts?.ariaLabel
    ? ` aria-label="${escapeHtml(opts.ariaLabel)}"`
    : "";
  return `
    <div class="fact-list ${className}"${ariaLabel}>`+ `
      ${items.map((item) => {
        const tone = ["success", "warn", "danger", "neutral"].includes(item.tone) ? item.tone : "";
        return `
        <article class="fact-row"${tone ? ` data-tone="${escapeHtml(tone)}"` : ""}>
          <span>${escapeHtml(item.label)}</span>
          <strong>${escapeHtml(item.value)}</strong>
          ${item.copy ? `<p>${escapeHtml(item.copy)}</p>` : ""}
        </article>
      `;
      }).join("")}
    </div>
  `;
}

function renderSectionEmpty(title, copy, ctaLabel, ctaHref) {
  const cta = ctaLabel && ctaHref
    ? `<a class="button button-primary" href="${escapeHtml(ctaHref)}" style="margin-top:0.9rem;">${escapeHtml(ctaLabel)}</a>`
    : "";
  return `
    <article class="empty-panel">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(copy)}</p>
      ${cta}
    </article>
  `;
}


function getStatusBadgeIcon(tone) {
  if (tone === "warn") return '<svg class="badge-icon" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M8 4.5v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="11.5" r="0.8" fill="currentColor"/></svg>';
  if (tone === "good") return '<svg class="badge-icon" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M5 8.2 7 10.2 11 5.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return '<svg class="badge-icon" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M6 6h4M6 10h4M6 8h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
}

function renderOperatorSummary(review, report) {
  const status = getOperatorReviewStatus(review, report);
  const progress = getOperatorReviewProgress(review);
  const ratio = progress.total === 0 ? 0 : Math.max(0, Math.min(1, progress.completed / progress.total));

  const badgeIcon = getStatusBadgeIcon(status.tone);

  return `
    <article class="review-hero review-hero-${status.tone}">
      <div class="review-hero-top">
        <span class="review-badge review-badge-${status.tone}">${badgeIcon} ${escapeHtml(status.label)}</span>
        <strong>${progress.completed}/${progress.total} checks</strong>
      </div>
      <div class="review-progress" aria-hidden="true">
        <span style="width:${Math.round(ratio * 100)}%"></span>
      </div>
      <p>${escapeHtml(status.copy)}</p>
    </article>
  `;
}

function renderOperatorReviewPanel(review, draft, report) {
  const summary = report.summary;
  const status = getOperatorReviewStatus(review, report);
  const progress = getOperatorReviewProgress(review);
  const nextReview = `${review.reviewWindowHours}h`;

  return `
    <div class="section-head">
      <div>
        <p class="section-label">Operator review</p>
        <h2>Operator gate</h2>
      </div>
    </div>

    ${renderOperatorSummary(review, report)}

    <div class="operator-grid">
      <div class="review-list-shell">
        <div class="review-list">
          ${review.items.map((item, index) => `
            <label class="review-item ${item.done ? "is-done" : ""} ${index === 0 ? "is-first" : ""}">
              <input class="review-check" type="checkbox" data-review-check="${escapeHtml(item.id)}" ${item.done ? "checked" : ""}>
              <span class="review-copy">
                <strong>${escapeHtml(item.title)}</strong>
                <small>${escapeHtml(item.copy)}</small>
              </span>
              ${item.critical
                ? `<span
                    class="review-flag"
                    title="Critical: ${escapeHtml(item.title)}"
                    aria-label="Critical: ${escapeHtml(item.title)}"
                    data-tooltip="${escapeHtml(`Critical check: ${item.title}`)}"
                    tabindex="0"
                  >
                    ${icon("alert-circle", "sm")}
                    <span class="sr-only">Critical item</span>
                  </span>`
                : ""}
            </label>
          `).join("")}
        </div>
      </div>

      <div class="operator-stack">
        <div class="operator-facts">
          <article class="operator-fact">
            <span>Checks</span>
            <strong>${progress.completed}/${progress.total}</strong>
            <p>${progress.criticalCompleted}/${progress.criticalTotal} critical complete</p>
          </article>
          <article class="operator-fact">
            <span>Next review</span>
            <strong>${escapeHtml(nextReview)}</strong>
            <p>${escapeHtml(formatDrawdown(summary.breakwaterTriggerDrawdownPct))} trigger</p>
          </article>
          <article class="operator-fact">
            <span>Reviewer</span>
            <strong>${escapeHtml(review.owner || "Unassigned")}</strong>
            <p>${escapeHtml(review.owner ? "Assigned reviewer" : "Needs assignment")}</p>
          </article>
          <article class="operator-fact">
            <span>Payout floor</span>
            <strong>${formatUsd(summary.survivablePayoutBandLowUsd)}</strong>
            <p>${escapeHtml(MODE_LABELS[draft.mode] || draft.mode)} floor</p>
          </article>
        </div>

        <div class="operator-form-shell">
          <div class="operator-form-grid">
            <label class="field">
              <span>Reviewer name</span>
              <input data-review-field="owner" type="text" maxlength="48" value="${escapeHtml(review.owner)}" placeholder="Your name or team lead" />
            </label>
            <label class="field">
              <span>Review note</span>
              <textarea class="text-area" data-review-field="note" rows="4" placeholder="Capture context before executing any treasury action.">${escapeHtml(review.note)}</textarea>
            </label>
          </div>
        </div>

        <div class="action-cluster operator-actions">
          <button class="button button-secondary" type="button" data-review-action="mark-critical">Mark critical done</button>
          <button class="button button-ghost" type="button" data-review-action="reset-review">Reset review</button>
        </div>
      </div>
    </div>
  `;
}

function collectUniqueNotes(report) {
  const seen = new Set();
  const items = [];
  const summary = report?.summary;

  if (summary && (
    Number(summary.baselineCarryCostUsd) > 0 ||
    Number(summary.baselineRebalanceCostUsd) > 0 ||
    Number(summary.worstCaseLiquidationPenaltyUsd) > 0
  )) {
    const modelBits = [];
    if (Number(summary.baselineCarryCostUsd) > 0) {
      modelBits.push(`${formatUsd(summary.baselineCarryCostUsd)} debt carry`);
    }
    if (Number(summary.baselineRebalanceCostUsd) > 0) {
      modelBits.push(`${formatUsd(summary.baselineRebalanceCostUsd)} rebalance drag`);
    }

    let copy = `Baseline ${Math.max(1, Number(summary.baselineHorizonDays) || 30)}-day run includes ${modelBits.join(" and ") || "modeled drag"}.`;
    if (Number(summary.worstCaseLiquidationPenaltyUsd) > 0) {
      copy += ` Worst-case danger-zone penalty is ${formatUsd(summary.worstCaseLiquidationPenaltyUsd)}`;
      if (summary.liquidationScenarioLabel) {
        copy += ` in ${summary.liquidationScenarioLabel}`;
      }
      copy += ".";
    }

    items.push({
      label: "Model",
      title: "Economic drag included",
      copy,
    });
  }

  for (const outcome of report.scenarios) {
    for (const note of outcome.health.notes) {
      if (seen.has(note)) {
        continue;
      }

      seen.add(note);
      items.push({
        label: outcome.scenario.label,
        title: `${outcome.health.label} health`,
        copy: note,
      });
    }
  }

  return items.slice(0, 8);
}

function applyTheme(theme, options = {}) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  const { source = "app" } = options;
  const changed = appState.theme !== nextTheme;

  appState.theme = nextTheme;
  document.documentElement.dataset.theme = appState.theme;
  saveStorage(STORAGE_THEME_KEY, appState.theme, { global: true });
  renderThemeToggle();

  if (changed && source !== "app") {
    trackEvent("theme_changed", {
      theme: appState.theme,
      source,
    });
  }
}

function renderThemeToggle() {
  document.querySelectorAll("[data-theme-value]").forEach((button) => {
    const isActive = button.dataset.themeValue === appState.theme;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function handleAssetError(event) {
  const image = event.target;

  if (!(image instanceof HTMLImageElement) || !image.classList.contains("visual-mark-image")) {
    return;
  }

  const fallbackSrc = image.dataset.fallbackSrc;

  if (fallbackSrc && image.src !== new URL(fallbackSrc, window.location.href).href) {
    image.src = fallbackSrc;
    image.dataset.fallbackSrc = "";
    trackEvent("asset_fallback_used", {
      src: image.currentSrc || image.src,
      fallbackSrc,
    });
    return;
  }

  image.closest(".visual-mark, .token-mark")?.classList.add("is-fallback");
  trackEvent("asset_missing", {
    src: image.currentSrc || image.src,
  });
}

function renderNavStats() {
  const summary = appState.current?.report?.summary;
  const draft = form ? readDraftFromForm() : appState.draft;
  const railPack = getActiveRailPack();
  const coverageCounts = getCoverageCounts(railPack);
  const walletConnected = getWalletState().connected;

  const setupNav = document.querySelector('[data-nav="setup"] span');
  const liveNav = document.querySelector('[data-nav="live"] span');
  const libraryNav = document.querySelector('[data-nav="library"] span');

  if (setupNav) {
    setupNav.textContent = summary
      ? `${MODE_LABELS[draft.mode] || draft.mode} · ${formatCompactUsd(draft.monthlyPayoutTargetUsd)}/mo`
      : "Build policy";
  }
  if (liveNav) {
    liveNav.textContent = railPack
      ? `${coverageCounts.allocator} observed rail${coverageCounts.allocator === 1 ? "" : "s"}`
      : "Read-only rails";
  }
  if (libraryNav) {
    libraryNav.textContent = walletConnected && appState.saved.length > 0
      ? `${appState.saved.length} saved run${appState.saved.length === 1 ? "" : "s"}`
      : walletConnected
        ? "Saved runs"
        : "Wallet required";
  }
}

function renderShell() {
  syncLiveAvailabilityUI();
  renderNavStats();
  renderThemeToggle();
}

/* ------------------------------------------------------------------ */
/*  Live execution UI                                                  */
/* ------------------------------------------------------------------ */

const ACTION_TYPE_LABELS = {
  Hold: "Hold position",
  BuildBuffer: "Build buffer",
  BorrowForBuffer: "Borrow to rebuild buffer",
  PartialRepay: "Partial debt repayment",
  EmergencyDeRisk: "Emergency de-risk",
  ReducePayout: "Reduce payout target",
  PausePayout: "Pause payouts",
  RotateVenue: "Rotate venue exposure",
};

const OPERATING_STATE_LABELS = {
  Observe: "Observe",
  Maintain: "Maintain",
  BuildBuffer: "Build buffer",
  DeRisk: "De-risk",
  StressLockdown: "Stress lockdown",
};

const ACTION_TYPE_TONES = {
  Hold: "neutral",
  BuildBuffer: "neutral",
  BorrowForBuffer: "accent",
  PartialRepay: "warn",
  EmergencyDeRisk: "danger",
  ReducePayout: "warn",
  PausePayout: "warn",
  RotateVenue: "accent",
};

function splitEnumLabel(value) {
  const label = String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return label || "—";
}

function formatActionTypeLabel(actionType) {
  return ACTION_TYPE_LABELS[actionType] || splitEnumLabel(actionType);
}

function formatOperatingStateLabel(state) {
  return OPERATING_STATE_LABELS[state] || splitEnumLabel(state);
}

const PROOF_LIMITATION_LABELS = {
  "shadow-only": "Rehearsal — local only",
  "testnet-rehearsal": "Testnet proof — no mainnet funds move",
};

function formatProofLimitationLabel(limitations) {
  return PROOF_LIMITATION_LABELS[limitations] || splitEnumLabel(limitations);
}

const RECEIPT_ACTION_LABELS = {
  shadow_run_completed: "Shadow run completed",
  "harbor.rebalance": "Policy rebalance rehearsal",
  "decision.hold": "Hold position rehearsal",
  "decision.build_buffer": "Build buffer rehearsal",
  "decision.borrow_for_buffer": "Borrow buffer rehearsal",
  "decision.partial_repay": "Partial repayment rehearsal",
  "decision.emergency_de_risk": "Emergency de-risk rehearsal",
  "decision.reduce_payout": "Reduce payout rehearsal",
  "decision.pause_payout": "Pause payout rehearsal",
  "decision.rotate_venue": "Rotate venue rehearsal",
  harbor_rebalance_preview: "Harbor rebalance preview",
  breakwater_drill: "Breakwater drill",
  drift_accumulate_preview: "Drift accumulation preview",
  "mainnet.event_observed": "Manual Suilend repayment observed",
  "receipt.mint": "Mint receipt",
  "mint-receipt": "Mint receipt",
  "policy.anchor": "Save policy",
  "policy.update": "Update policy",
  "save-policy-on-chain": "Save or update policy",
  "execute-live-action": "Receipt preview",
};

function formatReceiptActionLabel(action) {
  return RECEIPT_ACTION_LABELS[action] || splitEnumLabel(action);
}

const RECEIPT_ACTION_BY_DECISION_TYPE = Object.freeze({
  Hold: "decision.hold",
  BuildBuffer: "decision.build_buffer",
  BorrowForBuffer: "decision.borrow_for_buffer",
  PartialRepay: "decision.partial_repay",
  EmergencyDeRisk: "decision.emergency_de_risk",
  ReducePayout: "decision.reduce_payout",
  PausePayout: "decision.pause_payout",
  RotateVenue: "decision.rotate_venue",
});

function receiptActionForDecision(decisionType) {
  return RECEIPT_ACTION_BY_DECISION_TYPE[decisionType] || "shadow_run_completed";
}


function getActionExecutable(actionType) {
  return actionType === "BorrowForBuffer" ||
         actionType === "PartialRepay" ||
         actionType === "EmergencyDeRisk";
}

function parsePortfolioDisplayNumber(value) {
  const parsed = Number(String(value || "").replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getModeledPortfolioInput(current) {
  return current?.input?.portfolio ||
    current?.report?.inputs?.portfolio ||
    current?.report?.baseline?.result?.input?.portfolio ||
    {};
}

function buildLivePortfolioPreview(readback = _lastPortfolioState) {
  if (!readback) return null;
  const totalBtc = parsePortfolioDisplayNumber(readback.totalBtcDisplay);
  const totalStable = parsePortfolioDisplayNumber(readback.totalStableDisplay);
  if (totalBtc <= 0 && totalStable <= 0) return null;

  return {
    source: "wallet",
    btcLabel: `${readback.totalBtcDisplay} BTC`,
    stableLabel: `$${readback.totalStableDisplay}`,
    timestampLabel: `Wallet read-back · updated ${formatRelativeTimestamp(readback.fetchedAt)}`,
  };
}

function buildModeledPortfolioPreview(current = appState.current) {
  const portfolio = getModeledPortfolioInput(current);
  const draft = current?.draft || {};
  const btcUnits = asNumber(portfolio.btcUnits ?? draft.btcUnits);
  const stableUsd = asNumber(
    portfolio.stableBufferUsd ??
    portfolio.stableUsd ??
    draft.stableBufferUsd ??
    draft.minStableBufferUsd,
  );
  if (btcUnits <= 0 && stableUsd <= 0) return null;

  return {
    source: "modeled",
    btcLabel: `${formatBtcAmount(btcUnits)} ${getCollateralAssetSymbol(draft)}`,
    stableLabel: formatCompactUsd(stableUsd),
    timestampLabel: "Modeled run snapshot",
  };
}

function buildExecutionPortfolioPreview({ current = appState.current, readback = _lastPortfolioState } = {}) {
  return buildLivePortfolioPreview(readback) || buildModeledPortfolioPreview(current);
}

function renderExecutionPanel(rootSelector = "#results-execution") {
  const root = typeof rootSelector === "string" ? $(rootSelector) : rootSelector;
  if (!root) return;
  const isVerdictHost = root.id === "results-execution";

  const wallet = getWalletState();
  const current = appState.current;
  const currentRunHref = buildRunReadoutHref(current?.sourceScenarioId || "");
  const isSavedLiveReadout = Boolean(current?.onChainPolicy?.id);
  if (currentPage === "live" && !isSavedLiveReadout) {
    _executionConfirmArmed = false;
    safeReplaceChildren(root, `
      <div class="section-head">
        <div>
          <p class="section-label">Proof path</p>
          <h2>Select a saved policy</h2>
        </div>
      </div>
      <p class="surface-copy">This surface monitors a saved policy family. Open Workspace, pick a policy, then return here for receipts and operator review.</p>
      <div class="action-cluster action-cluster-compact">
        <a class="button button-primary" href="/">Open Workspace</a>
        ${current?.report ? `<a class="button button-secondary" href="${escapeHtml(currentRunHref)}">Review simulation</a>` : ""}
      </div>
    `);
    return;
  }
  const report = current?.report;
  const decision = report?.baseline?.result?.decision;
  const railName = report?.summary?.primaryRailName || null;
  const liveTrustState = getLiveDataTrustState(current);
  const executionState = getLiveExecutionState({
    walletState: wallet,
    current,
    railName,
    draft: current?.draft || null,
    isCurrentDraftFresh: isCurrentRunFresh(),
    liveDataMode: liveTrustState.mode,
    livePackVerified: liveTrustState.verified,
  });
  const chosen = executionState.chosen;

  if (!executionState.canExecute) {
    _executionConfirmArmed = false;
  }

  const blockerHref = "/setup";
  const blockerSecondaryHref = current?.report ? currentRunHref : "/setup";

  if (executionState.state === "decision-required") {
    safeReplaceChildren(root, `
      <div class="section-head">
        <div>
          <p class="section-label">Proof path</p>
          <h2>Create and simulate first</h2>
        </div>
      </div>
      <p class="surface-copy">The receipt flow starts after Create and Readout. Produce a policy decision first, then this surface can prepare the proof path.</p>
      <div class="action-cluster action-cluster-compact">
        <a class="button button-primary" href="/setup">Open Create</a>
        ${!isVerdictHost && current?.report ? `<a class="button button-secondary" href="${escapeHtml(currentRunHref)}">Open Readout</a>` : ""}
      </div>
    `);
    return;
  }

  if (executionState.state === "stale-run") {
    safeReplaceChildren(root, `
      <div class="section-head">
        <div>
          <p class="section-label">Proof path</p>
          <h2>Re-run the draft before signing</h2>
        </div>
      </div>
      <p class="surface-copy">The Create draft changed after the last simulation. Testnet proof stays blocked until Readout reflects the current form, not an older run.</p>
      <div class="action-cluster action-cluster-compact">
        <a class="button button-primary" href="/setup">Open Create</a>
        ${!isVerdictHost ? `<a class="button button-secondary" href="${escapeHtml(currentRunHref)}">Open Readout</a>` : ""}
      </div>
    `);
    return;
  }

  if (executionState.state === "fixture-data" || executionState.state === "unverified-data") {
    const title = executionState.state === "fixture-data"
      ? "Verified market data required"
      : "Unsigned market data cannot mint";
    const copy = executionState.state === "fixture-data"
      ? "This run is still backed by fixtures or starter scope. Load a verified market snapshot in Create, re-run the draft, then return here."
      : "The app can read this market snapshot, but receipt minting stays blocked until the snapshot is signature-verified end to end.";
    safeReplaceChildren(root, `
      <div class="section-head">
        <div>
          <p class="section-label">Proof path</p>
          <h2>${escapeHtml(title)}</h2>
        </div>
      </div>
      <p class="surface-copy">${escapeHtml(copy)}</p>
      <div class="action-cluster action-cluster-compact">
        <a class="button button-primary" href="${blockerHref}">Load market data in Create</a>
        ${!isVerdictHost ? `<a class="button button-secondary" href="${blockerSecondaryHref}">Review Readout</a>` : ""}
      </div>
    `);
    return;
  }

  if (executionState.state === "wallet-required") {
    safeReplaceChildren(root, `
      <div class="section-head">
        <div>
          <p class="section-label">Proof path</p>
          <h2>Connect wallet to mint receipt</h2>
        </div>
      </div>
      <p class="surface-copy">The route is ready for review, but wallet-specific checks require an active wallet session.</p>
      <div class="action-cluster action-cluster-compact">
        <a class="button button-primary" href="/setup">Open Create</a>
        ${!isVerdictHost ? `<a class="button button-secondary" href="${escapeHtml(currentRunHref)}">Open Readout</a>` : ""}
      </div>
    `);
    return;
  }

  const actionLabel = ACTION_TYPE_LABELS[chosen.type] || chosen.type;
  const tone = ACTION_TYPE_TONES[chosen.type] || "neutral";
  const isExecutable = getActionExecutable(chosen.type);
  const executionCapability = executionState.capability || getProtocolExecutionCapability(railName);
  const txPreview = isExecutable ? buildTransactionForAction(chosen, railName, wallet.address) : null;
  const hasSignablePath = executionState.canSign;
  const canExecute = executionState.canExecute &&
    executionCapability &&
    txPreview &&
    !txPreview.error &&
    !txPreview.skip;
  const isPreviewOnly = executionState.state === "preview-only";
  const missingCoinType = executionState.state === "collateral-required";
  const executionNote = !isExecutable
    ? "This decision is monitoring-only. No on-chain transaction is required right now."
    : missingCoinType
      ? "Manual collateral is fine for simulation, but signing needs a real BTC wrapper selected in Create. Pick the wrapper in the collateral control, run the simulation again, then return here."
      : isPreviewOnly
        ? executionState.reason === "protocol-execution-gated"
          ? "Receipt flow keeps borrow, repay, and swap adapters preview-only. Save the policy and mint a receipt for evidence; no live rail transaction is sent here."
          : (executionCapability?.message || txPreview?.tx?.warning || "This rail is connected in read-only mode for now.")
        : executionState.state === "unsupported-rail"
          ? "This rail is visible, but no signed adapter is attached yet."
        : "";

  const confirmPanelHidden = !(canExecute && _executionConfirmArmed);
  const confirmPanel = `
      <div class="exec-confirm-panel" role="status" aria-live="polite" aria-atomic="true" ${confirmPanelHidden ? "hidden" : ""}>
        <strong>Confirm wallet signing</strong>
        <p>You are about to sign <b>${escapeHtml(actionLabel)}</b> on <b>${escapeHtml(executionCapability?.protocol || railName || "this rail")}</b> for ${chosen.amountUsd ? escapeHtml(`$${formatCompactUsd(chosen.amountUsd)}`) : "the current amount"}.</p>
        <div class="action-cluster action-cluster-compact">
          <button type="button" class="button button-secondary" id="exec-cancel-confirm" ${confirmPanelHidden ? "disabled" : ""}>Cancel</button>
          <button type="button" class="button button-primary exec-sign-btn" id="exec-sign-btn" ${_executionInProgress || confirmPanelHidden ? "disabled" : ""}>
            ${_executionInProgress ? '<span class="btn-spinner"></span> Signing…' : "Sign with wallet"}
          </button>
        </div>
      </div>
    `;

  const portfolioPreview = buildExecutionPortfolioPreview({ current, readback: _lastPortfolioState });
  const portfolioHtml = portfolioPreview
    ? `<div class="exec-portfolio" data-source="${escapeHtml(portfolioPreview.source)}">
        <div class="exec-portfolio-row">
          <span>BTC position</span>
          <strong>${escapeHtml(portfolioPreview.btcLabel)}</strong>
        </div>
        <div class="exec-portfolio-row">
          <span>Stable buffer</span>
          <strong>${escapeHtml(portfolioPreview.stableLabel)}</strong>
        </div>
        <span class="exec-portfolio-ts">${escapeHtml(portfolioPreview.timestampLabel)}</span>
      </div>`
    : "";

  safeReplaceChildren(root, `
    <div class="section-head">
      <div>
        <p class="section-label">Proof path</p>
        <h2>Receipt readiness</h2>
      </div>
      <div class="exec-header-actions">
        <button type="button" class="button button-ghost button-sm" id="exec-refresh-portfolio">
          ${icon("refresh-cw", "sm")}
          Refresh wallet data
        </button>
      </div>
    </div>

    ${portfolioHtml}

    <div class="exec-action-card exec-tone-${tone}">
      <div class="exec-action-header">
        <span class="exec-action-badge exec-badge-${tone}">${escapeHtml(actionLabel)}</span>
        ${chosen.amountUsd ? `<strong class="exec-action-amount">$${formatCompactUsd(chosen.amountUsd)}</strong>` : ""}
      </div>
      <p class="exec-action-reason">${escapeHtml(chosen.explanation || chosen.reason)}</p>

      ${isExecutable && railName ? `
        <div class="exec-action-route">
          <span>Selected rail</span>
          <strong>${escapeHtml(executionCapability?.protocol || railName)}</strong>
        </div>
      ` : ""}

      ${txPreview?.error ? `<p class="exec-action-error">${escapeHtml(txPreview.error)}</p>` : ""}
      ${txPreview?.skip ? `<p class="exec-action-skip">${escapeHtml(txPreview.reason)}</p>` : ""}

      ${txPreview?.tx ? `
        <div class="exec-action-meta">
          <span>Action preview: ${escapeHtml(txPreview.tx.description)}</span>
          <span>Est. gas: ${(txPreview.tx.estimatedGas / 1e6).toFixed(1)} MIST</span>
        </div>
      ` : ""}

      ${canExecute ? `
        <div class="exec-action-cta">
          <button type="button" class="button button-primary exec-sign-btn" id="exec-review-btn" ${_executionInProgress ? "disabled" : ""}>
            ${_executionConfirmArmed ? "Ready to sign below" : "Review signing details"}
          </button>
        </div>
      ` : executionNote ? `
        <p class="exec-action-note">${escapeHtml(executionNote)}</p>
      ` : ""}
      ${confirmPanel}

      <div class="exec-risk-checks">
        <span class="exec-check ${decision.risk.needsEmergencyDeRisk ? "exec-check-warn" : "exec-check-ok"}">
          ${decision.risk.needsEmergencyDeRisk ? "Emergency conditions active" : "No emergency conditions"}
        </span>
        <span class="exec-check ${decision.risk.ltv > 0.6 ? "exec-check-warn" : "exec-check-ok"}">
          Debt pressure ${(decision.risk.ltv * 100).toFixed(1)}%
        </span>
        <span class="exec-check exec-check-ok">
          Regime: ${escapeHtml(decision.regime)}
        </span>
      </div>
    </div>
  `);

  // Bind events
  root.querySelector("#exec-refresh-portfolio")?.addEventListener("click", handleRefreshPortfolio);
  root.querySelector("#exec-review-btn")?.addEventListener("click", () => {
    _executionConfirmArmed = true;
    renderExecutionSurfaces();
    window.requestAnimationFrame?.(() => {
      document.getElementById("exec-sign-btn")?.focus?.({ preventScroll: true });
    });
  });
  root.querySelector("#exec-cancel-confirm")?.addEventListener("click", () => {
    _executionConfirmArmed = false;
    renderExecutionSurfaces();
    window.requestAnimationFrame?.(() => {
      document.getElementById("exec-review-btn")?.focus?.({ preventScroll: true });
    });
  });
  root.querySelector("#exec-sign-btn")?.addEventListener("click", handleSignAndExecute);
}

function renderExecutionSurfaces() {
  if (currentPage === "live") return;
  if (!appState.current?.onChainPolicy?.id) {
    renderExecutionPanel("#results-execution");
  }
}

async function handleRefreshPortfolio() {
  const wallet = getWalletState();
  if (!wallet.connected) return;

  setStatus("Refreshing portfolio from chain\u2026");
  _lastPortfolioState = await fetchPortfolioState(wallet.address);
  if (_lastPortfolioState) {
    setStatus(`Portfolio updated ${formatRelativeTimestamp(_lastPortfolioState.fetchedAt)}.`);
    trackEvent("live_readback_refreshed", {
      surface: currentPage || "app",
    });
  } else {
    setStatus("Could not fetch portfolio state.", true);
  }
  scheduleRender();
  renderExecutionSurfaces();
}

async function handleSignAndExecute() {
  const wallet = getWalletState();
  if (!wallet.connected || _executionInProgress) return;

  const current = appState.current;
  const decision = current?.report?.baseline?.result?.decision;
  const chosen = decision?.chosen;
  const railName = current?.report?.summary?.primaryRailName;
  const trustState = getLiveDataTrustState(current);
  const executionState = getLiveExecutionState({
    walletState: wallet,
    current,
    railName,
    draft: current?.draft || null,
    isCurrentDraftFresh: isCurrentRunFresh(),
    liveDataMode: trustState.mode,
    livePackVerified: trustState.verified,
  });

  if (!chosen || !getActionExecutable(chosen.type) || !executionState.canExecute) {
    renderExecutionSurfaces();
    return;
  }

  const preCheck = await preSigningCheck(buildPreSigningOptions(wallet, "execute-live-action"));
  if (!preCheck.allowed) {
    _executionConfirmArmed = false;
    setStatus(preCheck.message || "Signing is not allowed for this wallet right now.", true);
    renderExecutionSurfaces();
    return;
  }

  if (!_executionConfirmArmed) {
    _executionConfirmArmed = true;
    renderExecutionSurfaces();
    return;
  }

  const txResult = await buildSignableTransactionForAction(
    chosen,
    railName,
    wallet.address,
    current?.draft || {},
  );
  if (txResult.error) {
    _executionConfirmArmed = false;
    setStatus(txResult.error, true);
    renderExecutionSurfaces();
    return;
  }
  if (!txResult.tx?.signable || !txResult.tx?.transaction) {
    _executionConfirmArmed = false;
    setStatus(txResult.tx?.warning || "This action is still preview-only and cannot be signed yet.", true);
    renderExecutionSurfaces();
    return;
  }

  const preSignAccepted = await confirmPreSign({
    title: "Review rehearsal rail action before wallet signature",
    subtitle: describeSigningNetwork(),
    moveCalls: [txResult.tx.description || `${txResult.tx.protocol || "Rail"} action`],
    fields: [
      { label: "Action", value: formatActionTypeLabel(chosen.type) },
      { label: "Protocol", value: txResult.tx.protocol || railName || "—" },
      { label: "Amount", value: chosen.amountUsd ? formatUsdAmount(chosen.amountUsd) : "modeled amount" },
      { label: "Policy", value: formatPolicyObjectId(current?.onChainPolicy?.id || "") },
      { label: "Rail", value: current?.onChainPolicy?.selectedRail || current?.draft?.selectedRail || railName || "—" },
    ],
    warning: "This is a wallet-signable rail action. Confirm only if the network, policy, rail, and amount match the current review.",
  });
  if (!preSignAccepted) {
    _executionConfirmArmed = false;
    setStatus("Cancelled — nothing was signed.");
    renderExecutionSurfaces();
    return;
  }

  _executionInProgress = true;
  renderExecutionSurfaces();
  setStatus("Waiting for wallet signature\u2026");
  startSigningTimeline({
    title: txResult.tx?.description || "Preview rail action",
    subtitle: describeSigningNetwork(),
    finalLabel: "Live action recorded",
    precheck: "policy + balance checks OK",
  });

  try {
    const receipt = await signAndExecuteTransaction(txResult.tx.transaction);
    const digest = receipt?.digest || receipt?.effects?.transactionDigest || null;
    if (digest) {
      const txShort = shortenMiddle(digest, 8, 6);
      updateSigningTimeline("confirming", {
        subByStep: {
          wallet: `${shortenMiddle(wallet.address, 8, 6)} · ${formatSigningTimelineTime()}`,
          signed: `tx ${txShort} · ${formatSigningTimelineTime()}`,
          broadcast: "RPC accepted",
          confirming: "awaiting checkpoint…",
        },
      });
    }

    saveTxReceipt(wallet.address, {
      ok: true,
      txId: digest,
      action: chosen.type,
      amountUsd: chosen.amountUsd,
      description: txResult.tx.description,
      protocol: txResult.tx.protocol,
      policyId: current?.onChainPolicy?.id || "",
      sourceScenarioId: current?.sourceScenarioId || "",
      selectedRail: current?.onChainPolicy?.selectedRail || current?.draft?.selectedRail || "",
    });

    setStatus(digest
      ? `Transaction submitted: ${digest.slice(0, 12)}\u2026`
      : "Transaction submitted.");

    trackEvent("live_execution_completed", {
      action: chosen.type,
      protocol: txResult.tx.protocol,
      amountUsd: Math.round(chosen.amountUsd || 0),
    });

    // Poll for confirmation
    if (digest) {
      const confirmation = await waitForTransaction(digest);
      updateSigningTimeline(confirmation.confirmed ? "verify" : "confirming", {
        subByStep: {
          confirming: confirmation.confirmed ? `confirmed · ${formatSigningTimelineTime()}` : "confirmation failed",
          verify: confirmation.confirmed ? "checking Move effects…" : "blocked before Move verification",
        },
      });
      if (confirmation.confirmed) {
        setStatus("Transaction confirmed on-chain.");
        completeSigningTimeline({
          subByStep: {
            verify: "Move execution succeeded",
            final: `${shortenMiddle(digest, 8, 6)} · confirmed`,
          },
        });
      } else {
        const signingFailure = recordSigningFailure(
          "liveExecution",
          new Error(confirmation.error || "Transaction confirmation failed"),
          {
            action: "execute-live-action",
            protocol: txResult.tx.protocol,
            liveAction: chosen.type,
            stage: "confirmation",
          },
        );
        failSigningTimeline(signingFailure, { step: "verify" });
        setSigningFailureStatus(signingFailure);
      }
    }

    // Refresh portfolio after execution
    _lastPortfolioState = await fetchPortfolioState(wallet.address);

    // Re-run simulation with updated state
    if (current?.draft) {
      await runSimulation(current.draft, { silent: true, preserveJudgeMode: true });
    }
  } catch (err) {
    const signingFailure = recordSigningFailure("liveExecution", err, {
      action: "execute-live-action",
      protocol: txResult.tx.protocol,
      liveAction: chosen.type,
    });
    const preSignUnavailable = signingFailure.classified?.isPreSignUnavailable === true ||
      signingFailure.classified?.failureClass === "pre-sign-unavailable";
    if (!isUserSigningCancellation(signingFailure) && !preSignUnavailable) {
      saveTxReceipt(wallet.address, {
        ok: false,
        txId: null,
        action: chosen.type,
        amountUsd: chosen.amountUsd,
        description: txResult.tx.description,
        protocol: txResult.tx.protocol,
        error: signingFailure.classified.developerMessage,
        policyId: current?.onChainPolicy?.id || "",
        sourceScenarioId: current?.sourceScenarioId || "",
        selectedRail: current?.onChainPolicy?.selectedRail || current?.draft?.selectedRail || "",
      });
    }

    setSigningFailureStatus(signingFailure);
    failSigningTimeline(signingFailure);

    trackEvent("live_execution_failed", {
      action: chosen.type,
      protocol: txResult.tx.protocol,
      ...signingFailure.telemetry,
    });
  } finally {
    _executionInProgress = false;
    _executionConfirmArmed = false;
    renderExecutionSurfaces();
  }
}

async function handleSavePolicyOnChain(options = {}) {
  const { navigateToReadout = false } = options;
  const wallet = getWalletState();
  if (!wallet.connected || _policySaveInProgress) {
    return;
  }

  const preCheck = await preSigningCheck(buildPreSigningOptions(wallet, "save-policy-on-chain"));
  if (!preCheck.allowed) {
    setStatus(preCheck.message || "Signing is not allowed for this wallet right now.", true);
    return;
  }

  const namePolicyProblem = getScenarioNameSubmitProblem();
  if (namePolicyProblem) {
    flagScenarioNameCollision();
    setStatus(
      namePolicyProblem === "empty"
        ? "Pick a scenario name before saving on-chain."
        : "Pick a unique scenario name before saving on-chain.",
      true,
    );
    return;
  }

  if (!isPolicyRegistryConfigured(getRuntimeConfig())) {
    setStatus("Policy registry package is not configured yet.", true);
    return;
  }

  const latestDraft = form ? readDraftFromForm() : appState.current?.draft || appState.draft;
  if (!latestDraft) {
    setStatus("Create a scenario first.", true);
    return;
  }

  const latestScope = getCreateScopeKey(latestDraft.createScope);
  if (latestScope !== "live" && !appState.current?.onChainPolicy?.id) {
    setStatus("Switch Create to Testnet proof before saving a policy on-chain.", true);
    return;
  }
  if (latestScope === "live") {
    const scopeState = getCreateScopeState({
      draft: latestDraft,
      walletState: wallet,
      proofContext: getCreateScopeProofContext(),
    });
    if (scopeState.mockCollateral || !scopeState.walletBacked) {
      setStatus("Save on testnet requires wallet-backed collateral. Run the mock rehearsal locally, then connect an owned wBTC/xBTC balance before saving.", true);
      return;
    }
  }

  const currentDraftJson = JSON.stringify(appState.current?.draft || null);
  const latestDraftJson = JSON.stringify(latestDraft);
  let current = appState.current;
  const preservedPolicyBeforeRefresh = current?.onChainPolicy?.id ? clone(current.onChainPolicy) : null;
  const preservedReceiptBeforeRefresh = current?.onChainReceipt?.id ? clone(current.onChainReceipt) : null;
  const preservedSourceScenarioId = normalizeLiveHistoryText(current?.sourceScenarioId || readRouteScenarioIdFromUrl());

  const needsRun = !current || !current.report || currentDraftJson !== latestDraftJson;
  if (needsRun) {
    const validation = validateDraft(latestDraft);
    if (validation.errors.length) {
      console.error("[tide] policy snapshot validation failed", {
        errors: validation.errors,
        warnings: validation.warnings,
      });
      setStatus(validation.errors.join(" · "), true);
      trackEvent("anchor_snapshot_validation_failed", {
        fieldCount: validation.errors.length,
      });
      return;
    }
    setStatus("Preparing a fresh policy snapshot before signing…");
    trackEvent("anchor_snapshot_auto_refresh", {
      hadCurrentRun: Boolean(current?.report),
    });
    current = await runSimulation(latestDraft, { silent: true, preserveJudgeMode: true });
    if (!current?.report) {
      setStatus("Could not prepare a fresh policy snapshot — review the form and try again.", true);
      return;
    }
    if (preservedPolicyBeforeRefresh?.id && !current.onChainPolicy?.id) {
      const routePolicyId = normalizeLiveHistoryText(readRoutePolicyIdFromUrl());
      const nextSourceScenarioId = normalizeLiveHistoryText(current.sourceScenarioId || readRouteScenarioIdFromUrl());
      const samePolicyRoute = !routePolicyId || routePolicyId === preservedPolicyBeforeRefresh.id;
      const sameRunRoute = !preservedSourceScenarioId || !nextSourceScenarioId || preservedSourceScenarioId === nextSourceScenarioId;
      if (samePolicyRoute && sameRunRoute) {
        current.onChainPolicy = clone(preservedPolicyBeforeRefresh);
        if (preservedReceiptBeforeRefresh) {
          current.onChainReceipt = clone(preservedReceiptBeforeRefresh);
        }
        if (!current.sourceScenarioId && preservedSourceScenarioId) {
          current.sourceScenarioId = preservedSourceScenarioId;
        }
        appState.current = current;
        persistCurrentState();
      }
    }
  }

  const staleRefusal = getForecastStaleRefusal(current);
  if (staleRefusal) {
    setStatus(staleRefusal.message, true, null, { testId: staleRefusal.testId });
    trackEvent("forecast_stale_signing_refused", {
      action: current.onChainPolicy?.id ? "policy.update" : "policy.anchor",
      policyId: current.onChainPolicy?.id || "",
    });
    return;
  }

  _policySaveInProgress = true;
  syncPolicyActionButtons();
  setStatus(current.onChainPolicy?.id ? "Updating policy on-chain…" : "Saving policy on-chain…");

  try {
    const runtime = getRuntimeConfig();
    if (current.onChainPolicy?.id) {
      const refreshedPolicy = await fetchPolicyObject(current.onChainPolicy.id, runtime).catch(() => null);
      const policyForUpdate = refreshedPolicy || current.onChainPolicy;
      if (refreshedPolicy) {
        current.onChainPolicy = {
          ...current.onChainPolicy,
          ...refreshedPolicy,
        };
      }
      if (!isPolicyObjectTypeCompatible(policyForUpdate, runtime)) {
        trackEvent("policy_package_mismatch_refused", {
          policyId: policyForUpdate.id || current.onChainPolicy.id || "",
          objectType: policyForUpdate.objectType || "",
        });
        current.onChainPolicy = null;
        if (appState.current) {
          appState.current.onChainPolicy = null;
          persistCurrentState();
        }
        renderCurrentPage();
        setStatus(
          "This policy belongs to an older testnet package. Review the draft in Testnet proof, then save a fresh policy explicitly.",
          true,
        );
        return;
      }
    }

    const builder = current.onChainPolicy?.id
      ? await buildUpdatePolicyTransaction({
          sender: wallet.address,
          policyId: current.onChainPolicy.id,
          previousPolicy: current.onChainPolicy,
          draft: current.draft,
          report: current.report,
          config: getRuntimeConfig(),
        })
      : await buildCreatePolicyTransaction({
          sender: wallet.address,
          draft: current.draft,
          report: current.report,
          config: getRuntimeConfig(),
        });

    const pkg = runtime?.policyRegistry?.packageId || "";
    const mod = runtime?.policyRegistry?.module || "policy_registry";
    const isUpdate = Boolean(current.onChainPolicy?.id);
    const previousRail = String(current.onChainPolicy?.selectedRail || "").trim();
    const railWillChange = isUpdate && previousRail && previousRail !== builder.policy.selectedRail;
    const moveCalls = [`${pkg}::${mod}::${isUpdate ? "update_policy" : "create_policy"}`];
    if (railWillChange) moveCalls.push(`${pkg}::${mod}::select_rail`);

    startSigningTimeline({
      title: isUpdate ? "Update policy on-chain" : "Save policy on-chain",
      subtitle: describeSigningNetwork(),
      finalLabel: isUpdate ? "Policy update linked" : "Policy linked",
      precheck: "policy snapshot + wallet checks OK",
    });
    updateSigningTimeline("wallet", {
      subByStep: {
        wallet: "reviewing pre-sign summary…",
      },
    });

    const confirmed = await confirmPreSign({
      title: isUpdate ? "Update policy on-chain" : "Save new policy on-chain",
      subtitle: describeSigningNetwork(),
      moveCalls,
      fields: buildPolicyPreSignFields(builder.policy),
      warning: railWillChange
        ? `Rail will change: ${previousRail} → ${builder.policy.selectedRail}. Included as a select_rail call in the same PTB.`
        : "",
    });
    if (!confirmed) {
      cancelSigningTimeline("Cancelled — nothing was signed.");
      setStatus("Cancelled — nothing was signed.");
      return;
    }

    updateSigningTimeline("wallet", {
      subByStep: {
        wallet: "pre-sign confirmed; waiting for wallet approval…",
      },
    });
    const receipt = await signAndExecuteTransaction(builder.transaction);
    const initialPolicyRef = resolvePolicyObjectReference({
      result: receipt,
      fallbackObjectId: current.onChainPolicy?.id || "",
      config: getRuntimeConfig(),
    });
    const digest = initialPolicyRef.digest || null;
    let confirmation = null;

    if (digest) {
      const txShort = shortenMiddle(digest, 8, 6);
      updateSigningTimeline("confirming", {
        subByStep: {
          wallet: `${shortenMiddle(wallet.address, 8, 6)} · ${formatSigningTimelineTime()}`,
          signed: `tx ${txShort} · ${formatSigningTimelineTime()}`,
          broadcast: "RPC accepted",
          confirming: "awaiting checkpoint…",
        },
      });
      confirmation = await waitForTransaction(digest);
    }
    const policyTxConfirmed = confirmation?.confirmed === true;
    updateSigningTimeline(policyTxConfirmed ? "verify" : "confirming", {
      subByStep: {
        confirming: policyTxConfirmed
          ? `confirmed · ${formatSigningTimelineTime()}`
          : (digest ? "confirmation failed" : "no transaction digest returned"),
        verify: policyTxConfirmed ? "checking Move effects…" : "blocked before Move verification",
      },
    });
    const confirmedResult = requireConfirmedTransaction(
      confirmation,
      digest,
      isUpdate ? "Policy update" : "Policy save",
    );

    const policyRef = resolvePolicyObjectReference({
      result: receipt,
      confirmation: confirmedResult,
      fallbackObjectId: current.onChainPolicy?.id || "",
      config: getRuntimeConfig(),
    });
    const policyId = policyRef.objectId;

    if (!policyId) {
      throw new Error(`Policy transaction confirmed but no policy id was returned (${policyRef.reason || "unknown"}).`);
    }
    updateSigningTimeline("final", {
      subByStep: {
        verify: "Move execution succeeded",
        final: `${formatPolicyObjectId(policyId)} · ${formatSigningTimelineTime()}`,
      },
    });

    let policy = policyId
      ? await fetchPolicyObject(policyId, getRuntimeConfig())
      : null;

    if (!policy) {
      policy = buildLocalPolicyFallback(policyId, builder.policy, wallet.address, digest || "");
    }

    appState.current.onChainPolicy = {
      ...policy,
      txDigest: digest || policy.txDigest || "",
    };
    persistCurrentPolicyBindingToSavedRun();
    renderCurrentPage();

    saveTxReceipt(wallet.address, {
      ok: true,
      txId: digest,
      action: builder.mode === "update" ? "policy.update" : "policy.anchor",
      description: builder.mode === "update" ? "Update policy on-chain" : "Save new policy on-chain",
      protocol: "Policy registry",
      policyId: appState.current.onChainPolicy.id || policyId,
      sourceScenarioId: appState.current.sourceScenarioId || "",
      selectedRail: builder.policy.selectedRail || appState.current.onChainPolicy.selectedRail || "",
    });

    setStatus(
      appState.current.onChainPolicy.id
        ? `Policy saved on Sui testnet: ${formatPolicyObjectId(appState.current.onChainPolicy.id)}.`
        : "Policy submitted on-chain."
    );
    trackEvent("policy_sync_completed", {
      mode: builder.mode,
      policyId: appState.current.onChainPolicy.id || "pending",
      rail: builder.policy.selectedRail || "unknown",
    });
    trackEvent("policy_saved", {
      mode: builder.mode,
      rail: builder.policy.selectedRail || "unknown",
    });
    completeSigningTimeline({
      subByStep: {
        final: `${formatPolicyObjectId(appState.current.onChainPolicy.id || policyId)} · ${digest ? shortenMiddle(digest, 8, 6) : "confirmed"}`,
      },
    });
    if (navigateToReadout) {
      window.location.assign(buildRunReadoutHref(appState.current.sourceScenarioId || "", {
        policy: appState.current.onChainPolicy?.id || policyId,
        hash: "readout-actions",
      }));
    }
  } catch (error) {
    const policyAction = appState.current?.onChainPolicy?.id ? "policy.update" : "policy.anchor";
    const signingFailure = recordSigningFailure("policySync", error, {
      action: policyAction,
      policyId: appState.current?.onChainPolicy?.id || "",
      rail: current?.draft?.selectedRail || appState.current?.onChainPolicy?.selectedRail || "",
    });
    if (!isUserSigningCancellation(signingFailure)) {
      saveTxReceipt(wallet.address, {
        ok: false,
        txId: null,
        action: policyAction,
        description: policyAction === "policy.update" ? "Update policy on-chain" : "Save new policy on-chain",
        protocol: "Policy registry",
        error: signingFailure.classified.developerMessage,
        policyId: appState.current?.onChainPolicy?.id || "",
        sourceScenarioId: appState.current?.sourceScenarioId || current?.sourceScenarioId || "",
        selectedRail: current?.draft?.selectedRail || appState.current?.onChainPolicy?.selectedRail || "",
      });
      reportClientError(error, { action: "handleSavePolicyOnChain" });
    }
    trackEvent("policy_sync_failed", {
      ...signingFailure.telemetry,
    });
    failSigningTimeline(signingFailure);
    setSigningFailureStatus(signingFailure);
  } finally {
    _policySaveInProgress = false;
    syncPolicyActionButtons();
  }
}

// Render a sequenced proof-timeline card so an operator (and reviewers)
// can follow the on-chain trail of a mint end-to-end: policy saved →
// signing tx → receipt object → Walrus evidence. Each step that has data
// renders a SuiVision link; steps with no data show as inactive so the
// shape stays consistent while the flow is in-progress.
function renderProofTimelineHash({ kind, value, rawValue }) {
  if (!value || value === "—") {
    return `<code class="status-timeline__sub">—</code>`;
  }

  const classes = ["hash-pill"];
  if (kind === "tx") classes.push("hash-pill--tx");
  if (kind === "object") classes.push("hash-pill--object");
  if (kind === "walrus") classes.push("hash-pill--walrus");

  const prefix = kind === "tx"
    ? "tx · "
    : kind === "object"
      ? "obj · "
      : kind === "walrus"
        ? "walrus · "
        : "";
  const full = typeof rawValue === "string" && rawValue.trim() ? rawValue.trim() : value;
  const isCopyable = kind === "walrus"
    ? /^[A-Za-z0-9_-]{20,}$/.test(full)
    : kind === "tx"
      ? /^[1-9A-HJ-NP-Za-km-z]{20,}$/.test(full)
      : /^0x[0-9a-fA-F]{16,}$/.test(full);
  const fullAttr = full && full !== value ? ` data-full="${escapeHtml(full)}"` : "";
  const copyLabel = kind === "tx"
    ? `Copy transaction digest ${shortenMiddle(full, 6, 4)}`
    : kind === "object"
      ? `Copy object id ${shortenMiddle(full, 6, 4)}`
      : kind === "walrus"
        ? `Copy Walrus blob id ${shortenMiddle(full, 6, 4)}`
        : `Copy hash ${shortenMiddle(full, 6, 4)}`;

  return `
    <span class="${classes.join(" ")}"${fullAttr}>
      <span class="hash-pill__dot" aria-hidden="true"></span>
      <span class="hash-pill__value">${escapeHtml(`${prefix}${value}`)}</span>
      ${isCopyable ? `<button type="button" class="hash-pill__btn" aria-label="${escapeHtml(copyLabel)}" data-copy="${escapeHtml(full)}">${icon("copy", "xs")}</button>` : ""}
    </span>
  `;
}

function getWalrusEvidenceLabel(blobId) {
  const value = typeof blobId === "string" ? blobId.trim() : "";
  if (!value) return "Walrus evidence";
  if (/^tide-stub:\/\//i.test(value) || /^(?:testnet|mainnet|devnet)-proof:/i.test(value)) {
    return "Local digest";
  }
  return "Walrus blob";
}

function renderProofTimelineCard({ receipt, policy }) {
  const cfg = getRuntimeConfig();
  const receiptVerifierUrl = receipt?.id
    ? buildReceiptReadOnlyUrl(receipt, {
        config: cfg,
        network: receipt?.limitations === "testnet-rehearsal" ? "testnet" : "",
      })
    : "";
  const receiptUrl = receipt?.id ? buildSuiExplorerUrl("object", receipt.id, cfg) : "";
  const mintTxUrl = receipt?.txDigest ? buildSuiExplorerUrl("tx", receipt.txDigest, cfg) : "";
  const policyUrl = policy?.id ? buildSuiExplorerUrl("object", policy.id, cfg) : "";
  const policyTxUrl = policy?.txDigest ? buildSuiExplorerUrl("tx", policy.txDigest, cfg) : "";
  const mintedAt = Number(receipt?.createdAtMs) || Number(receipt?.mintedAtMs) || 0;
  const mintedLabel = mintedAt ? dateTimeFormatter.format(new Date(mintedAt)) : "just now";
  const verification = receipt?.proofVerification || null;
  const verificationSource = typeof verification?.source === "string" && verification.source
    ? verification.source.replace(/-/g, " ")
    : "";

  const steps = [
    {
      n: 1,
      label: "Policy saved",
      value: policy?.id ? formatPolicyObjectId(policy.id) : "—",
      rawValue: policy?.id || "",
      kind: "object",
      hrefs: [
        policyUrl ? { url: policyUrl, text: "object" } : null,
        policyTxUrl ? { url: policyTxUrl, text: "tx" } : null,
      ].filter(Boolean),
      done: Boolean(policy?.id),
    },
    {
      n: 2,
      label: "Mint transaction",
      value: receipt?.txDigest ? formatPolicyObjectId(receipt.txDigest) : "—",
      rawValue: receipt?.txDigest || "",
      kind: "tx",
      hrefs: mintTxUrl ? [{ url: mintTxUrl, text: "SuiVision" }] : [],
      done: Boolean(receipt?.txDigest),
    },
    {
      n: 3,
      label: "Receipt object",
      value: receipt?.id ? formatPolicyObjectId(receipt.id) : "—",
      rawValue: receipt?.id || "",
      kind: "object",
      hrefs: [
        receiptVerifierUrl ? { url: receiptVerifierUrl, text: "verifier" } : null,
        receiptUrl ? { url: receiptUrl, text: "SuiVision" } : null,
      ].filter(Boolean),
      done: Boolean(receipt?.id),
    },
    {
      n: 4,
      label: getWalrusEvidenceLabel(receipt?.walrusBlobId),
      value: receipt?.walrusBlobId ? formatPolicyObjectId(receipt.walrusBlobId) : "—",
      rawValue: receipt?.walrusBlobId || "",
      kind: "walrus",
      hrefs: [],
      done: Boolean(receipt?.walrusBlobId),
    },
  ];

  return `
    <article class="log-card proof-timeline" data-state="on-chain-receipt" data-verified="${verification?.ok === true ? "true" : "false"}">
      <div class="log-card-head">
        <div>
          <span>Receipt • ${escapeHtml(formatReceiptActionLabel(receipt.action || "shadow_run_completed"))}</span>
          <strong>${escapeHtml(formatPolicyObjectId(receipt.id))}</strong>
        </div>
        <div class="proof-timeline__actions">
          <span class="state-badge">Receipt</span>
          ${receiptVerifierUrl ? `<a class="button button-primary button-sm" href="${escapeHtml(receiptVerifierUrl)}">Open verifier</a>` : ""}
          ${receiptUrl ? `<a class="button button-secondary button-sm" href="${escapeHtml(receiptUrl)}" target="_blank" rel="noopener noreferrer">SuiVision</a>` : ""}
        </div>
      </div>
      <p>Rail <strong>${escapeHtml(receipt.selectedRail || "unknown")}</strong> · policy v${escapeHtml(String(receipt.policyVersion || 1))} · minted ${escapeHtml(mintedLabel)}.</p>
      <p class="section-footnote">
        Decision: <strong>${escapeHtml(receipt.decisionType ? formatActionTypeLabel(receipt.decisionType) : "legacy schema v1")}</strong>
        ${receipt.limitations ? `· ${escapeHtml(formatProofLimitationLabel(receipt.limitations))}` : ""}
        ${receipt.stateBeforeDigestHex ? `· Pre-action state digest ${renderProofTimelineHash({ kind: "digest", value: formatPolicyObjectId(receipt.stateBeforeDigestHex), rawValue: receipt.stateBeforeDigestHex })}` : ""}
      </p>
      ${verification
        ? `<p class="section-footnote"><strong>Verification:</strong> ${verification.ok ? "receipt bundle verified" : escapeHtml(verification.digestReason || verification.freshnessReason || "pending")} ${verificationSource ? `· source ${escapeHtml(verificationSource)}` : ""}</p>`
        : ""}

      <ol class="status-timeline" aria-label="On-chain receipt timeline">
        ${steps.map((step) => `
          <li class="status-timeline__step ${step.done ? "status-timeline__step--done" : "status-timeline__step--pending"}">
            <span class="status-timeline__dot" aria-hidden="true">${step.n}</span>
            <div class="status-timeline__copy">
              <span class="status-timeline__title">${escapeHtml(step.label)}</span>
              ${renderProofTimelineHash({
                kind: step.kind,
                value: step.value,
                rawValue: step.rawValue,
              })}
              ${step.hrefs.length ? `<span class="status-timeline__links">${step.hrefs.map((h) => `<a href="${escapeHtml(h.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(h.text)}</a>`).join(" · ")}</span>` : ""}
            </div>
          </li>
        `).join("")}
      </ol>

      <p class="proof-digests">
        content: ${renderProofTimelineHash({ kind: "digest", value: formatPolicyObjectId(receipt.contentDigestHex || ""), rawValue: receipt.contentDigestHex || "" })}<br/>
        rail pack: ${renderProofTimelineHash({ kind: "digest", value: formatPolicyObjectId(receipt.railPackDigestHex || ""), rawValue: receipt.railPackDigestHex || "" })}
      </p>
    </article>
  `;
}

function renderReceiptEvidencePanel({ current = appState.current, policy = current?.onChainPolicy || null } = {}) {
  const receipt = current?.onChainReceipt || null;
  if (receipt?.id) {
    return `
      <div class="readout-action-proof" data-receipt-state="${receipt?.proofVerification?.ok === true ? "verified" : "pending"}">
        ${renderProofTimelineCard({ receipt, policy })}
        ${renderDecisionAtlas({ receipt, policy })}
      </div>
    `;
  }

  if (!policy?.id) return "";

  const cfg = getRuntimeConfig();
  const policyUrl = buildSuiExplorerUrl("object", policy.id, cfg);
  const policyTxUrl = policy?.txDigest ? buildSuiExplorerUrl("tx", policy.txDigest, cfg) : "";
  const rail = getRailDisplay(policy?.selectedRail) || policy?.selectedRail || "unknown";
  const policyVersion = Number(policy?.version) || 1;

  const steps = [
    {
      n: 1,
      label: "Policy saved",
      value: formatPolicyObjectId(policy.id),
      rawValue: policy.id,
      kind: "object",
      hrefs: [
        policyUrl ? { url: policyUrl, text: "object" } : null,
        policyTxUrl ? { url: policyTxUrl, text: "tx" } : null,
      ].filter(Boolean),
      done: true,
    },
    { n: 2, label: "Mint transaction", value: "—", rawValue: "", kind: "tx", hrefs: [], done: false },
    { n: 3, label: "Receipt object", value: "—", rawValue: "", kind: "object", hrefs: [], done: false },
    { n: 4, label: "Walrus evidence", value: "—", rawValue: "", kind: "walrus", hrefs: [], done: false },
  ];

  return `
    <div class="readout-action-proof" data-receipt-state="awaiting-mint">
      <article class="log-card proof-timeline proof-timeline--pending" data-state="receipt-pending" data-verified="false">
        <div class="log-card-head">
          <div>
            <span>Receipt</span>
            <strong>Awaiting mint</strong>
          </div>
          <span class="state-badge state-badge--amber">Pending</span>
        </div>
        <p>Rail <strong>${escapeHtml(rail)}</strong> · policy v${escapeHtml(String(policyVersion))} · receipt not minted yet.</p>
        <p class="section-footnote"><strong>Verification:</strong> waiting for receipt object + digest check.</p>

        <ol class="status-timeline" aria-label="Receipt timeline">
          ${steps.map((step) => `
            <li class="status-timeline__step ${step.done ? "status-timeline__step--done" : "status-timeline__step--pending"}">
              <span class="status-timeline__dot" aria-hidden="true">${step.n}</span>
              <div class="status-timeline__copy">
                <span class="status-timeline__title">${escapeHtml(step.label)}</span>
                ${renderProofTimelineHash({
                  kind: step.kind,
                  value: step.value,
                  rawValue: step.rawValue,
                })}
                ${step.hrefs.length ? `<span class="status-timeline__links">${step.hrefs.map((h) => `<a href="${escapeHtml(h.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(h.text)}</a>`).join(" · ")}</span>` : ""}
              </div>
            </li>
          `).join("")}
        </ol>
      </article>
    </div>
  `;
}

function renderDecisionAtlas({ receipt, policy }) {
  if (!receipt?.id) return "";
  const cfg = getRuntimeConfig();
  const receiptUrl = buildSuiExplorerUrl("object", receipt.id, cfg);
  const txUrl = receipt.txDigest ? buildSuiExplorerUrl("tx", receipt.txDigest, cfg) : "";
  const policyUrl = policy?.id ? buildSuiExplorerUrl("object", policy.id, cfg) : "";
  const readOnlyUrl = buildReceiptReadOnlyUrl(receipt, {
    config: cfg,
    origin: typeof window !== "undefined" ? window.location.origin : "",
  });
  const decisionLabel = receipt.decisionType ? formatActionTypeLabel(receipt.decisionType) : "Action recorded";
  const verification = receipt.proofVerification || null;
  const verificationOk = verification?.ok === true;
  const verificationLabel = verificationOk ? "Digest + freshness verified" : "Digest pinned";
  const verificationCopy = verificationOk
    ? "The local verifier matched the receipt digest and the proof-bundle freshness window."
    : "The receipt pins the content digest; the receipt timeline carries the current verifier status.";
  const shortReadOnlyPath = receipt.id ? `TIDE verifier ${formatPolicyObjectId(receipt.id)}` : "TIDE verifier";

  return `
    <article class="decision-atlas" aria-label="Receipt verification summary">
      <div class="decision-atlas__item">
        <span>What changed</span>
        <strong>${escapeHtml(decisionLabel)}</strong>
        <p>The operator action is attached to the current policy version and rail context.</p>
      </div>
      <div class="decision-atlas__item">
        <span>What was proven</span>
        <strong>${escapeHtml(verificationLabel)}</strong>
        <p>${escapeHtml(verificationCopy)}</p>
      </div>
      <div class="decision-atlas__item">
        <span>Where to verify</span>
        <strong>${escapeHtml(describeSuiNetworkLabel())}</strong>
        <p>
          ${readOnlyUrl ? `<a href="${escapeHtml(readOnlyUrl)}" target="_blank" rel="noopener noreferrer">TIDE verifier</a>` : ""}
          ${readOnlyUrl && receiptUrl ? " · " : ""}
          ${receiptUrl ? `<a href="${escapeHtml(receiptUrl)}" target="_blank" rel="noopener noreferrer">Receipt object</a>` : ""}
          ${txUrl ? ` · <a href="${escapeHtml(txUrl)}" target="_blank" rel="noopener noreferrer">Mint tx</a>` : ""}
          ${policyUrl ? ` · <a href="${escapeHtml(policyUrl)}" target="_blank" rel="noopener noreferrer">Policy</a>` : ""}
        </p>
      </div>
      <div class="decision-atlas__item">
        <span>Share</span>
        <strong>${escapeHtml(shortReadOnlyPath)}</strong>
        <p>
          <button
            class="button button-secondary button-sm decision-atlas__share"
            type="button"
            data-action="copy-receipt-link"
            data-receipt-id="${escapeHtml(receipt.id)}"
            aria-label="Copy TIDE verifier receipt link"
            title="${escapeHtml(readOnlyUrl || "Copy receipt decision, rail, TIDE verifier URL, and SuiVision links.")}"
          >Copy receipt link</button>
        </p>
      </div>
    </article>
  `;
}

function renderJudgeDemoFrame(mode, runContext = null) {
  const scenario = getJudgeScenario(mode);
  if (!scenario) return "";
  const fixture = runContext?.fixture || scenario.fixture || null;
  const guardCopy = fixture?.guardFired
    ? `${fixture.guardFired}${fixture.expectedAbortCode ? ` · ${fixture.expectedAbortCode}` : ""}`
    : "No guard fired";
  const decisionCopy = fixture?.decisionExpected || "Decision modeled";
  return `
    <div class="section-head section-head-compact">
      <div>
        <p class="section-label">Judge frame</p>
        <h2>Manual treasury ops vs TIDE</h2>
      </div>
      <span class="state-badge">${escapeHtml(scenario.label)}</span>
    </div>
    <div class="judge-compare-grid">
      <article class="judge-compare-card judge-compare-card--manual">
        <span>Today</span>
        <h3>Spreadsheet + rail UI</h3>
        <ul>
          <li>Reason lives in chat or memory.</li>
          <li>Rail state and policy state drift apart.</li>
          <li>Later reviewer has no receipt trail.</li>
        </ul>
      </article>
      <article class="judge-compare-card judge-compare-card--tide">
        <span>TIDE</span>
        <h3>Policy → decision → receipt</h3>
        <ul>
          <li>Decision state and reason are explicit.</li>
          <li>Policy and rail digest are pinned.</li>
          <li>SuiVision anchors the receipt object and mint transaction.</li>
          ${fixture?.trustLabel ? `<li>${escapeHtml(fixture.trustLabel)} fixture is loaded for this judge route.</li>` : ""}
          <li>Expected decision: ${escapeHtml(decisionCopy)}. Guard: ${escapeHtml(guardCopy)}.</li>
          <li>${escapeHtml(scenario.defenseLine || "The route shows one rehearsal defence in context.")}</li>
        </ul>
      </article>
    </div>
  `;
}

// Build the reactive trust-label set. The three safety labels ("Shadow
// Mode", "No mainnet capital", "No live execution") are shown on every
// posture so a user glancing at the chrome always knows this is a rehearsal
// surface, not live trading. The network-specific label (testnet rehearsal
// ready/minted, devnet rehearsal, mainnet read-only) is added on top. Mint
// flows that move real capital are out of scope for the MVP and are
// additionally blocked at build time by the CI guard.
const RAIL_PACK_TRUST_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function parseTrustTimestampMs(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  return 0;
}

function getRailPackFreshnessTimestampMs(pack) {
  if (!pack || typeof pack !== "object") return 0;
  const sourceTimestamps = [
    parseTrustTimestampMs(pack.market?.updatedAt),
    parseTrustTimestampMs(pack.generatedAt),
    parseTrustTimestampMs(pack.generatedAtMs),
    parseTrustTimestampMs(pack.updatedAt),
    parseTrustTimestampMs(pack.updatedAtMs),
  ].filter((value) => value > 0);

  if (sourceTimestamps.length > 0) {
    return Math.max(...sourceTimestamps);
  }

  const railUpdates = (Array.isArray(pack.rails) ? pack.rails : [])
    .map((rail) => parseTrustTimestampMs(rail?.updatedAt))
    .filter((value) => value > 0);

  if (railUpdates.length > 0) {
    return Math.max(...railUpdates);
  }

  return parseTrustTimestampMs(pack.importedAt);
}

function isRailPackStaleForTrust(pack = getActiveRailPack(), nowMs = Date.now()) {
  if (!pack) return false;
  const freshnessMs = getRailPackFreshnessTimestampMs(pack);
  if (!freshnessMs) return true;
  const ageMs = Number(nowMs) - freshnessMs;
  return !Number.isFinite(ageMs) || ageMs < 0 || ageMs > RAIL_PACK_TRUST_MAX_AGE_MS;
}

function getCurrentOracleConfidenceTrustState(current = appState.current) {
  const primaryRail = current?.report?.baseline?.allocation?.primary?.rail || null;
  const confidence = normalizeRatioLike(primaryRail?.oracleConfidence, NaN);
  const minConfidence = normalizeRatioLike(
    current?.report?.baseline?.result?.input?.policy?.minOracleConfidence ??
      current?.input?.policy?.minOracleConfidence ??
      current?.draft?.minOracleConfidencePct,
    NaN
  );
  if (!Number.isFinite(confidence) || !Number.isFinite(minConfidence)) {
    return { known: false, low: false };
  }
  return {
    known: true,
    low: confidence < minConfidence,
    confidence,
    minConfidence,
  };
}

function getCurrentPythOracleReadback(judgeMode = null) {
  const currentJudgeOracle = appState.current?.judge?.fixture?.oracle;
  const judgeOracle = currentJudgeOracle || (judgeMode ? getJudgeScenario(judgeMode)?.fixture?.oracle : null);
  if (judgeOracle) return judgeOracle;
  return appState.oracleReadback || buildConfiguredMissingPythReadback();
}

function formatReadbackAge(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return "unknown age";
  if (value < 60_000) return `${Math.max(1, Math.round(value / 1000))}s old`;
  if (value < 3_600_000) return `${Math.round(value / 60_000)}m old`;
  if (value < 86_400_000) return `${Math.round(value / 3_600_000)}h old`;
  return `${Math.round(value / 86_400_000)}d old`;
}

function getPythOracleBadge(readback) {
  if (!readback || readback.source === "missing") {
    return {
      text: "Modeled BTC price",
      tone: "",
      iconName: "info",
      title: "No Pyth PriceInfoObject is configured for this environment.",
    };
  }
  if (readback.source === "fixture") {
    return {
      text: readback.stale ? "Pyth fixture · stale" : "Pyth fixture",
      tone: readback.stale ? "amber" : "violet",
      iconName: readback.stale ? "alert-triangle" : "activity",
      title: "Judge fixture with Pyth-compatible read-back shape.",
    };
  }
  return {
    text: readback.stale ? "Pyth read-back · stale" : "Pyth read-back · fresh",
    tone: readback.stale ? "amber" : "mint",
    iconName: readback.stale ? "alert-triangle" : "activity",
    title: "Read-only Pyth PriceInfoObject fetched from Sui RPC. Not execution.",
  };
}

function getBtcPriceContextLabel({ oracleReadback = null } = {}) {
  if (oracleReadback?.source === "live" && oracleReadback.stale !== true) {
    return "Pyth BTC ";
  }
  return "Modeled BTC ";
}

function renderPythOracleReadbackStrip(readback) {
  const rb = readback || buildConfiguredMissingPythReadback();
  const badge = getPythOracleBadge(rb);
  const priceLine = rb.source !== "missing" && Number(rb.priceUsd) > 0
    ? `<span><strong>${escapeHtml(formatUsd(rb.priceUsd))}</strong> ${escapeHtml(rb.feedSymbol || "BTC/USD")}</span>`
    : `<span><strong>${escapeHtml(rb.feedSymbol || "BTC/USD")}</strong> not configured</span>`;
  const confidenceLine = rb.source !== "missing"
    ? `<span>confidence ${escapeHtml(formatUsd(rb.confidenceUsd || 0))} · ${escapeHtml(String(rb.confidenceBps || 0))} bps</span>`
    : "";
  const freshnessLine = rb.source !== "missing"
    ? `<span>${escapeHtml(formatReadbackAge(rb.ageMs))}${rb.stale ? " · stale" : ""}</span>`
    : "";
  return `
    <div class="oracle-readback-strip" aria-label="Oracle read-back posture">
      ${renderIconBadge(badge.text, badge)}
      ${priceLine}
      ${confidenceLine}
      ${freshnessLine}
      <span class="oracle-readback-strip__note">${escapeHtml(rb.trustLabel || "Read-only oracle posture. Not execution.")}</span>
    </div>
  `;
}

function computeTrustLabels() {
  const runtime = getRuntimeConfig();
  const network = getSuiNetwork(runtime);
  const allowSigning = runtime?.executionProof?.allowSigning === true;
  const receiptsConfigured = isExecutionReceiptsConfigured(runtime);
  const hasReceipt = Boolean(appState.current?.onChainReceipt?.id);
  const railDataMode = appState.current?.report?.summary?.railDataMode || (appState.railPack ? "live" : "fixture");
  const forecastStale = appState.current?.marketBand?.stale === true;
  const railPackStale = isRailPackStaleForTrust();
  const oracleConfidenceLow = getCurrentOracleConfidenceTrustState().low;
  const unsignedForecast = allowsUnsignedForecast(runtime, window.location?.origin || "");

  // Phase D.30.8 — full label set for /workspace (entry-point trust
  // calibration); inner pages (/setup, /results, /live, /library)
  // collapse to a single composite chip so the strip is a glanceable
  // signal rather than five repeated chips drilling the same point on
  // every page. Aria-label still carries the full posture.
  const fullLabels = [];
  fullLabels.push({ kind: "shadow", text: "Shadow-first" });

  if (network === "testnet" && allowSigning && receiptsConfigured) {
    fullLabels.push({
      kind: "testnet",
      text: hasReceipt ? "Receipt minted" : "Testnet rehearsal",
    });
    fullLabels.push({ kind: "safe", text: "Alpha allowlist active" });
  } else if (network === "devnet" && allowSigning && receiptsConfigured) {
    fullLabels.push({ kind: "testnet", text: "Devnet rehearsal" });
  } else if (network === "mainnet" && !allowSigning) {
    fullLabels.push({ kind: "readonly", text: "Mainnet read-only" });
  } else if (!allowSigning) {
    fullLabels.push({ kind: "readonly", text: "Read-only preview" });
  }

  fullLabels.push({ kind: "readonly", text: railDataMode === "live" ? "Read-only rail data" : "Fixture rails" });
  if (unsignedForecast) {
    fullLabels.push({ kind: "readonly", text: "Unsigned feed · not executable" });
  }
  if (forecastStale) {
    fullLabels.push({ kind: "readonly", text: "Public forecast model stale" });
  }
  if (railPackStale) {
    fullLabels.push({ kind: "readonly", text: "Rail pack stale" });
  }
  if (oracleConfidenceLow) {
    fullLabels.push({ kind: "readonly", text: "Oracle confidence low" });
  }
  fullLabels.push({ kind: "safe", text: "No live capital" });
  fullLabels.push({ kind: "safe", text: "No live execution" });

  if (currentPage === "workspace") {
    const primary = network === "testnet" && allowSigning && receiptsConfigured
      ? { kind: "testnet", text: hasReceipt ? "Receipt minted" : "Testnet proof" }
      : network === "mainnet" && !allowSigning
        ? { kind: "readonly", text: "Mainnet read-only" }
        : !allowSigning
          ? { kind: "readonly", text: "Read-only" }
          : { kind: "shadow", text: "Simulation" };
    const review = forecastStale
      ? { kind: "readonly", text: "Forecast review" }
      : railPackStale
        ? { kind: "readonly", text: "Rail data review" }
        : oracleConfidenceLow
          ? { kind: "readonly", text: "Oracle review" }
          : unsignedForecast
            ? { kind: "readonly", text: "Unsigned feed" }
            : null;
    const visibleLabels = [
      primary,
      ...(review ? [review] : []),
      { kind: "safe", text: "No live execution" },
    ];
    const fullText = fullLabels.map((l) => l.text).join(" · ");
    return visibleLabels.map((label) => ({ ...label, ariaDescription: fullText }));
  }

  // Inner-page condensed: pick the most-operationally-relevant label
  // for the page's primary operator question. Full posture stays in
  // aria-description for AT users.
  const fullText = fullLabels.map((l) => l.text).join(" · ");
  const onChainPolicy = appState.current?.onChainPolicy;
  let condensedText;
  if (forecastStale) {
    condensedText = "Public forecast model stale · refresh before running";
  } else if (railPackStale) {
    condensedText = "Rail pack stale · review before signing";
  } else if (oracleConfidenceLow) {
    condensedText = "Oracle confidence low · review route";
  } else if (currentPage === "setup") {
    const selectedScope = document.querySelector('input[name="createScope"]:checked')?.value || "shadow";
    if (selectedScope === "live") {
      condensedText = unsignedForecast
        ? "Unsigned feed · not executable"
        : network === "testnet" && allowSigning
        ? "Testnet rehearsal · no mainnet capital"
        : "Wallet draft · read-only";
    } else {
      condensedText = "Simulation · No signing";
    }
  } else if (currentPage === "results") {
    // Phase D.30 round-E fix: was branching on `network === mainnet`,
    // which answers "what network?" — but the dominant /results question
    // is "is this saved or still a draft sim?". Re-keyed on the
    // saved-policy dimension so an operator landing on /results in Journey
    // A reads "Simulation only · not saved" instead of generic
    // "Read-only preview".
    if (onChainPolicy) {
      condensedText = unsignedForecast
        ? "Unsigned feed · not executable"
        : network === "testnet" && allowSigning
        ? "On-chain policy · testnet rehearsal"
        : `On-chain policy · ${network || "read-only"}`;
    } else if (allowSigning && receiptsConfigured) {
      condensedText = "Simulation ready · save before receipt";
    } else {
      condensedText = "Simulation only · not saved";
    }
  } else if (currentPage === "live") {
    condensedText = onChainPolicy
      ? unsignedForecast
        ? "Unsigned feed · not executable"
        : network === "testnet" && allowSigning
        ? "On-chain policy monitor · testnet"
        : "Policy monitor · read-only"
      : "No on-chain policy selected";
  } else {
    condensedText = "Shadow-first";
  }
  return [{ kind: "readonly", text: condensedText, ariaDescription: fullText }];
}

function requireConfirmedTransaction(confirmation, digest, label) {
  if (!digest) {
    throw new Error(`${label} failed: wallet returned no transaction digest.`);
  }
  if (!confirmation?.confirmed) {
    throw new Error(confirmation?.error || `${label} failed before on-chain confirmation.`);
  }
  return confirmation.result || null;
}

// Pre-sign confirmation dialog. Shows a structured summary of the PTB
// an operator is about to sign — Move calls, argument values, network,
// and any warnings — so intent can be verified in human-readable form
// before the wallet popup. Returns Promise<boolean>: true = confirm,
// false = cancel / ESC / backdrop. The wallet still shows its own
// signing UI after this; this dialog is an extra gate, not a replacement.
function ensurePreSignDialog() {
  let dialog = document.getElementById("pre-sign-dialog");
  if (dialog) return dialog;
  if (typeof document.createElement("dialog").showModal !== "function") {
    return null;
  }
  dialog = document.createElement("dialog");
  dialog.id = "pre-sign-dialog";
  dialog.className = "pre-sign-dialog";
  dialog.setAttribute("aria-labelledby", "pre-sign-dialog-title");
  dialog.setAttribute("aria-describedby", "pre-sign-dialog-subtitle");
  dialog.setAttribute("aria-modal", "true");
  dialog.innerHTML = `
    <form method="dialog" class="pre-sign-form">
      <header class="pre-sign-head">
        <h3 class="pre-sign-title" id="pre-sign-dialog-title"></h3>
        <p class="pre-sign-subtitle" id="pre-sign-dialog-subtitle"></p>
      </header>
      <section class="pre-sign-section">
        <span class="pre-sign-section-label">Move calls</span>
        <ul class="pre-sign-calls" role="list"></ul>
      </section>
      <section class="pre-sign-section">
        <span class="pre-sign-section-label">Arguments</span>
        <dl class="pre-sign-fields"></dl>
      </section>
      <p class="pre-sign-warning" role="alert" hidden></p>
      <p class="pre-sign-status sr-only" role="status" aria-live="polite" aria-atomic="true"></p>
      <div class="pre-sign-actions">
        <button type="button" class="button button-secondary" data-action="cancel">Cancel</button>
        <button type="button" class="button button-primary" data-action="confirm">Confirm &amp; sign</button>
      </div>
    </form>
  `;
  document.body.appendChild(dialog);
  return dialog;
}

function confirmPreSign({ title, subtitle = "", moveCalls = [], fields = [], warning = "" }) {
  const dialog = ensurePreSignDialog();
  if (!dialog) {
    const error = new Error(
      "Wallet signing preflight is unavailable in this browser. Refresh or use a browser with dialog support before signing.",
    );
    error.code = "pre-sign-unavailable";
    throw error;
  }

  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dialog.querySelector(".pre-sign-title").textContent = title;
  dialog.querySelector(".pre-sign-subtitle").textContent = subtitle;

  const callsEl = dialog.querySelector(".pre-sign-calls");
  callsEl.replaceChildren(...moveCalls.map((call) => {
    const li = document.createElement("li");
    const code = document.createElement("code");
    code.textContent = call;
    li.appendChild(code);
    return li;
  }));

  const fieldsEl = dialog.querySelector(".pre-sign-fields");
  fieldsEl.replaceChildren(...fields.flatMap((f) => {
    const dt = document.createElement("dt");
    dt.textContent = f.label;
    const dd = document.createElement("dd");
    dd.textContent = f.value;
    return [dt, dd];
  }));

  const warnEl = dialog.querySelector(".pre-sign-warning");
  warnEl.textContent = warning;
  warnEl.hidden = !warning;
  const statusEl = dialog.querySelector(".pre-sign-status");
  if (statusEl) {
    statusEl.textContent = "Review the Move calls and arguments before opening your wallet.";
  }

  const confirmBtn = dialog.querySelector('[data-action="confirm"]');
  const cancelBtn = dialog.querySelector('[data-action="cancel"]');
  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.textContent = "Confirm & sign";
    confirmBtn.onclick = null;
  }
  if (cancelBtn) {
    cancelBtn.hidden = false;
    cancelBtn.disabled = false;
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
      dialog.removeEventListener("close", onClose);
      window.setTimeout(() => {
        if (previouslyFocused && typeof previouslyFocused.focus === "function") {
          previouslyFocused.focus({ preventScroll: true });
        }
      }, 0);
      resolve(value);
    };
    const onConfirm = (event) => {
      event.preventDefault();
      if (statusEl) statusEl.textContent = "Pre-sign summary confirmed. Opening wallet signing flow.";
      dialog.close("confirm");
      finish(true);
    };
    const onCancel = (event) => {
      event.preventDefault();
      dialog.close("cancel");
      finish(false);
    };
    const onClose = () => {
      if (!settled) finish(false);
    };
    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
    dialog.addEventListener("close", onClose);
    dialog.returnValue = "";
    dialog.showModal();
    window.setTimeout(() => {
      const target = cancelBtn && !cancelBtn.disabled ? cancelBtn : confirmBtn;
      target?.focus?.({ preventScroll: true });
    }, 0);
  });
}

function formatUsdAmount(value) {
  const n = Number(value) || 0;
  return `$${n.toLocaleString("en-US")}`;
}

function formatBpsAsPct(bps) {
  const n = Number(bps) || 0;
  return `${(n / 100).toFixed(2)}%`;
}

function normalizeLtvToBps(value, { percent = false } = {}) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  if (percent) return Math.round(raw * 100);
  if (raw <= 2) return Math.round(raw * 10_000);
  if (raw <= 100) return Math.round(raw * 100);
  return Math.round(raw);
}

function buildPolicyPreSignFields(snapshot) {
  return [
    { label: "Name", value: snapshot.name || "—" },
    { label: "Mode", value: snapshot.mode || "—" },
    { label: "Priority", value: snapshot.priority || "—" },
    { label: "Rail (canonical)", value: snapshot.selectedRail || "—" },
    { label: "Collateral", value: snapshot.collateralSymbol || "BTC" },
    { label: "Monthly draw / mo", value: formatUsdAmount(snapshot.payoutTargetUsd) },
    { label: "Min stable buffer", value: formatUsdAmount(snapshot.minBufferUsd) },
    { label: "Max debt pressure", value: formatBpsAsPct(snapshot.maxLtvBps) },
    { label: "Target debt pressure", value: `${formatBpsAsPct(snapshot.targetLtvLowBps)} → ${formatBpsAsPct(snapshot.targetLtvHighBps)}` },
    { label: "Managed repay pressure", value: formatBpsAsPct(snapshot.repayLtvBps) },
    { label: "Emergency pressure", value: formatBpsAsPct(snapshot.emergencyLtvBps) },
  ];
}

function describeSigningNetwork() {
  const cfg = getRuntimeConfig();
  const network = getSuiNetwork(cfg);
  const allowSigning = cfg?.executionProof?.allowSigning === true;
  return `Network: ${network}${allowSigning ? "" : " · signing disabled"}`;
}

function describeSuiNetworkLabel() {
  const network = getSuiNetwork(getRuntimeConfig());
  return network ? `Sui ${network}` : "Configured Sui network";
}

function getWalletChainForPreSign(wallet = {}, expectedChain = null) {
  const wanted = typeof expectedChain === "string" ? expectedChain.trim().toLowerCase() : "";
  const supported = Array.isArray(wallet.chains)
    ? wallet.chains
      .filter((chain) => typeof chain === "string")
      .map((chain) => chain.trim())
      .filter(Boolean)
    : [];

  if (wanted && supported.length) {
    const match = supported.find((chain) => chain.toLowerCase() === wanted);
    if (match) return match;
  }
  if (typeof wallet.chain === "string" && wallet.chain.trim()) {
    return wallet.chain;
  }
  if (Array.isArray(wallet.chains) && typeof wallet.chains[0] === "string") {
    return wallet.chains[0];
  }
  return null;
}

function getWalletNetworkWarning(wallet = getWalletState()) {
  const status = getWalletNetworkStatus(wallet, getRuntimeConfig());
  if (status.ok) return "";
  return `${status.message} Rehearsals remain read-only until testnet proof signing is available.`;
}

function buildPreSigningOptions(wallet = {}, action = "unknown") {
  const cfg = getRuntimeConfig();
  const network = getSuiNetwork(cfg);
  const allowSigning = cfg?.executionProof?.allowSigning === true;
  const configured = isPolicyRegistryConfigured(cfg) || isExecutionReceiptsConfigured(cfg);
  const signingAllowed = network === "testnet" && allowSigning && configured;
  const failClosedHook = async () => (
    signingAllowed
      ? { allowed: true }
      : { allowed: false, message: "Signing is only enabled for configured testnet rehearsal builds." }
  );

  return {
    address: wallet?.address || "",
    action,
    walletConnected: wallet?.connected === true,
    expectedChain: network ? `sui:${network}` : null,
    walletChain: getWalletChainForPreSign(wallet, network ? `sui:${network}` : null),
    screeningHook: failClosedHook,
    jurisdictionHook: failClosedHook,
  };
}

// Renders the trust-label pills into every `.trust-labels` container.
// The visual label set is intentionally condensed; the complete posture
// stays on each chip as aria-description so the UI does not become a
// diagnostic log that breaks the first-screen layout.
function syncTrustLabels(_opts = {}) {
  const targets = document.querySelectorAll(".trust-labels");
  if (!targets.length) return;

  const labels = computeTrustLabels();
  const buildNodes = () => labels.map(({ kind, text, ariaDescription }) => {
    const span = document.createElement("span");
    span.className = `trust-label trust-label--${kind}`;
    span.textContent = text;
    if (ariaDescription) span.setAttribute("aria-description", ariaDescription);
    return span;
  });

  targets.forEach((el) => {
    el.hidden = labels.length === 0;
    el.replaceChildren(...buildNodes());
  });
}

// Renders a short custody + no-wallet reminder at the bottom of every app
// page. Idempotent — attaches once and updates in place. The purpose is
// addressed to TC-07 (custody framing) and TC-08 (no-wallet Shadow Mode):
// users repeatedly assume we hold their collateral and that a wallet is
// always required, so both disclaimers must be visible at rest.
function ensureAppFooter() {
  const main = document.querySelector(".app-main");
  if (!main) return;
  let footer = main.querySelector("[data-app-footer]");
  if (!footer) {
    footer = document.createElement("footer");
    footer.className = "app-footer";
    footer.setAttribute("data-app-footer", "");
    footer.setAttribute("aria-label", "Custody and wallet disclosure");
    main.appendChild(footer);
  }
  footer.innerHTML = renderCustodyFooterHtml();
}

function syncEnvBadge() {
  const badge = document.getElementById("env-badge");
  if (!badge) return;

  const cfg = getRuntimeConfig();
  const network = getSuiNetwork(cfg);
  const allowSigning = cfg?.executionProof?.allowSigning === true;
  const setBadge = (label, title, toneClass, state = "") => {
    const dot = document.createElement("span");
    dot.className = "network-badge__dot";
    dot.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.textContent = label;
    badge.replaceChildren(dot, text);
    badge.title = title || "";
    badge.classList.add("network-badge");
    badge.classList.remove(
      "network-badge--testnet",
      "network-badge--mainnet",
      "network-badge--devnet",
      "network-badge--rpc-down",
      "network-badge--no-wallet",
    );
    if (toneClass) badge.classList.add(toneClass);
    if (state) {
      badge.dataset.state = state;
    } else {
      badge.removeAttribute("data-state");
    }
    badge.hidden = !label;
  };

  if (network === "testnet") {
    setBadge(
      allowSigning ? "Testnet · proof signing" : "Testnet · read-only",
      "Sui testnet — wallet signatures save policies and mint receipts only. No mainnet capital moves.",
      "network-badge--testnet",
      allowSigning ? "live" : "read-only",
    );
  } else if (network === "mainnet") {
    setBadge(
      allowSigning ? "Mainnet · live signing" : "Mainnet · read-only",
      "Sui mainnet — read-only surface.",
      "network-badge--mainnet",
      allowSigning ? "live" : "read-only",
    );
  } else {
    setBadge(network ? String(network) : "", network ? `Sui ${network}.` : "", "network-badge--devnet");
  }
}

function syncMintReceiptButton() {
  const button = $("#mint-receipt");
  if (!button) return;

  const wallet = getWalletState();
  const configured = isExecutionReceiptsConfigured(getRuntimeConfig());
  const mintReadinessBlocker = getReceiptMintReadinessBlocker();
  const policy = appState.current?.onChainPolicy || null;
  const hasPolicy = Boolean(policy?.id);
  const hasReport = Boolean(appState.current?.report);
  const staleRefusal = getForecastStaleRefusal(appState.current);

  const readoutShell = currentPage === "results" || currentPage === "live";
  const readoutHeaderButton = readoutShell && isReadoutHeaderActionButton(button);
  const shouldShow = (readoutShell && (configured || hasPolicy)) || configured || hasPolicy;
  button.hidden = Boolean(readoutHeaderButton) || !shouldShow;

  if (!shouldShow) return;

  let disabled = false;
  let title = "Mint a testnet receipt pinned by a content digest.";

  const railCheck = resolveCurrentRailForOnChain();

  if (_mintReceiptInProgress) {
    disabled = true;
    title = "Mint already in progress…";
  } else if (!configured) {
    disabled = true;
    title = "This build is not wired to a testnet receipts module. Open testnet.tidesui.pro to mint receipts.";
  } else if (!wallet.connected) {
    disabled = true;
    title = "Connect wallet to mint a testnet receipt.";
  } else if (!hasPolicy) {
    disabled = true;
    title = "Save the policy on testnet first.";
  } else if (!hasReport) {
    disabled = true;
    title = "Run a simulation first.";
  } else if (mintReadinessBlocker) {
    disabled = true;
    title = mintReadinessBlocker.message;
  } else if (staleRefusal) {
    disabled = true;
    title = staleRefusal.message;
  } else {
    const scopeState = getCreateScopeState({
      draft: appState.current?.draft || {},
      walletState: wallet,
      proofContext: getCreateScopeProofContext(),
    });
    if (scopeState.mockCollateral || (scopeState.scope === "live" && !scopeState.walletBacked)) {
      disabled = true;
      title = "Mint receipt requires wallet-backed collateral; mock collateral can only run a local rehearsal.";
    }
  }

  if (!disabled && !railCheck.canonical) {
    disabled = true;
    title = railCheck.message;
  }

  button.disabled = disabled;
  button.title = title;
  button.setAttribute("aria-disabled", String(disabled));
  button.textContent = _mintReceiptInProgress
    ? "Minting…"
    : appState.current?.onChainReceipt?.id
      ? "Mint another receipt"
      : "Mint receipt";

  syncActionDisabledHint(button, disabled && !button.hidden ? title : "", "mint-receipt");
}

function buildProofRailPackFromState() {
  const pack = appState.railPack && typeof appState.railPack === "object" ? appState.railPack : {};
  const generatedAtMs = Number(pack.generatedAtMs)
    || Number(pack.updatedAtMs)
    || Date.parse(pack.generatedAt || pack.updatedAt || "")
    || 0;
  return {
    digest: pack.digest && Array.isArray(pack.digest) ? pack.digest : null,
    signedBy: typeof pack.signedBy === "string" ? pack.signedBy : "",
    signatureAlg: typeof pack.signatureAlg === "string" ? pack.signatureAlg : "ed25519",
    generatedAtMs,
    source: typeof pack.label === "string" ? pack.label : "",
    signatureVerified: pack.signatureVerified === true,
    snapshot: pack,
  };
}

async function computeRailPackDigestBytes() {
  const pack = appState.railPack && typeof appState.railPack === "object" ? appState.railPack : null;
  return digestBundle(canonicalizeRailPackForProof(pack || {}));
}

function buildReceiptDecisionAttestation(current, runtime = getRuntimeConfig()) {
  const decision = current?.report?.baseline?.result?.decision || null;
  const chosen = decision?.chosen || null;
  const risk = decision?.risk || {};
  const draft = current?.draft || {};
  const input = current?.input || current?.report?.inputs || current?.report?.baseline?.result?.input || {};
  const portfolio = input?.portfolio || {};
  const ltvBps = risk.ltv !== undefined
    ? normalizeLtvToBps(risk.ltv)
    : current?.metrics?.ltv !== undefined
      ? normalizeLtvToBps(current.metrics.ltv)
      : normalizeLtvToBps(draft.targetLtvLowPct, { percent: true });
  const bufferUsd = Math.round(Number(
    portfolio.stableBufferUsd ??
    portfolio.stableUsd ??
    draft.minBufferUsd ??
    draft.bufferFloorUsd ??
    current?.report?.summary?.bufferFloorUsd ??
    0,
  ) || 0);
  const stressLabel = String(
    current?.report?.summary?.worstOperatingState ||
    decision?.regime ||
    current?.report?.summary?.verdict ||
    "Unknown",
  );
  const network = runtime?.sui?.network || "";
  return {
    decisionType: String(chosen?.type || "Hold"),
    limitations: network === "testnet" ? "testnet-rehearsal" : "shadow-only",
    plannerInput: input,
    regime: String(decision?.regime || "Calm"),
    risk,
    stateBefore: {
      ltvBps: Math.max(0, ltvBps),
      bufferUsd: Math.max(0, bufferUsd),
      stressLabel,
    },
  };
}

function normalizeMainnetReadbackForBundle(readback = null) {
  if (!readback || typeof readback !== "object" || Array.isArray(readback)) return null;
  const observedAt = normalizeLiveHistoryText(readback.observedAt || readback.fetchedAt || "");
  const collateralUsd = Number(readback.collateralUsd);
  const debtUsd = Number(readback.debtUsd);
  const ltvBps = Number(readback.ltvBps);
  if (!observedAt || !Number.isFinite(collateralUsd) || !Number.isFinite(debtUsd) || !Number.isFinite(ltvBps)) {
    return null;
  }
  return {
    schemaVersion: Number(readback.schemaVersion) || 1,
    railId: resolveCanonicalRailId({
      selectedRail: readback.railId || "suilend-sui",
      railId: readback.railId || "suilend-sui",
    }) || normalizeLiveHistoryText(readback.railId, "suilend-sui"),
    walletAddress: normalizeWalletAddress(readback.walletAddress || "").toLowerCase(),
    obligationId: normalizeLiveHistoryText(readback.obligationId || "").toLowerCase(),
    objectOwnerAddress: normalizeWalletAddress(readback.objectOwnerAddress || "").toLowerCase(),
    ownerBinding: normalizeLiveHistoryText(readback.ownerBinding || ""),
    source: normalizeLiveHistoryText(readback.source || "live-mainnet-readonly"),
    network: normalizeLiveHistoryText(readback.network || "mainnet-readonly"),
    observedAt,
    stale: readback.stale === true,
    staleMaxMs: Number(readback.staleMaxMs) || 0,
    collateralUsd: Math.max(0, collateralUsd),
    debtUsd: Math.max(0, debtUsd),
    ltvBps: Math.max(0, Math.round(ltvBps)),
    trustLabel: normalizeLiveHistoryText(readback.trustLabel || "Live mainnet read-only read-back from Sui RPC. Not execution."),
  };
}

function observedAtMs(readback = null) {
  const ms = Date.parse(readback?.observedAt || "");
  return Number.isFinite(ms) ? ms : 0;
}

function getLiveMainnetReceiptReadiness(policyId = "") {
  const pinned = normalizeLiveHistoryText(policyId);
  const evidence = getPolicyLiveMainnetEvidence(pinned);
  if (evidence.status !== "verified") {
    return {
      ok: false,
      message: "Verify the mainnet action digest first.",
      evidence,
      pre: null,
      post: null,
    };
  }
  const pre = normalizeMainnetReadbackForBundle(evidence.preReadback);
  if (!pre) {
    return {
      ok: false,
      message: "Refresh Suilend read-back before the manual action, then verify the tx digest.",
      evidence,
      pre: null,
      post: null,
    };
  }
  const txMs = Number(evidence.timestampMs) || 0;
  if (!txMs || observedAtMs(pre) >= txMs) {
    return {
      ok: false,
      message: "Refresh Suilend read-back before the manual action, then verify the tx digest again.",
      evidence,
      pre,
      post: null,
    };
  }
  const post = normalizeMainnetReadbackForBundle(getCachedLiveProtocolReadback(pinned)?.balanceReadback);
  if (!post) {
    return {
      ok: false,
      message: "Refresh Suilend read-back after the mainnet action before minting the final receipt.",
      evidence,
      pre,
      post: null,
    };
  }
  if (observedAtMs(post) < txMs) {
    return {
      ok: false,
      message: "Refresh Suilend read-back after the verified mainnet tx, then mint the final receipt.",
      evidence,
      pre,
      post,
    };
  }
  if (post.debtUsd >= pre.debtUsd && post.ltvBps >= pre.ltvBps) {
    return {
      ok: false,
      message: "Post-action read-back does not show lower debt or lower debt pressure yet.",
      evidence,
      pre,
      post,
    };
  }
  return { ok: true, message: "", evidence, pre, post };
}

function railVenueForMainnetAttestation(railId = "") {
  const canonical = resolveCanonicalRailId({ selectedRail: railId, railId });
  return canonical.endsWith("-sui") ? canonical.slice(0, -4) : "";
}

function isMainnetAttestedDecisionType(decisionType = "") {
  return MAINNET_READONLY_DECISION_TYPES.has(decisionType);
}

async function buildMainnetReadOnlyReceiptProof({
  policy,
  current,
  expectedReceiptRail,
  decisionAttestation,
}) {
  const readiness = getLiveMainnetReceiptReadiness(policy?.id);
  if (!readiness.ok) {
    const error = new Error(readiness.message);
    error.code = "mainnet-evidence-not-ready";
    throw error;
  }
  const railId = resolveCanonicalRailId({ selectedRail: expectedReceiptRail, railId: expectedReceiptRail });
  const rail = railVenueForMainnetAttestation(railId);
  if (rail !== "suilend") {
    throw new Error("Mainnet-read-only receipt minting is enabled for Suilend first.");
  }
  const decisionType = decisionAttestation.decisionType;
  if (!isMainnetAttestedDecisionType(decisionType)) {
    throw new Error(`Mainnet-read-only bundle does not support decision type ${decisionType || "(empty)"}.`);
  }
  const mainnetEvidence = {
    digest: readiness.evidence.digest,
    sender: readiness.evidence.sender,
    obligationId: readiness.evidence.obligationId,
    checkpoint: readiness.evidence.checkpoint,
    timestampMs: readiness.evidence.timestampMs,
    objectChangeCount: readiness.evidence.objectChangeCount,
    protocolAction: "repay",
    source: "live-mainnet-readonly",
  };
  const observedAt = new Date().toISOString();
  const bundle = {
    schemaVersion: 1,
    kind: "tide-mainnet-attested-demo/v1",
    rail,
    railId,
    observedAt,
    network: {
      mainnetReadback: "mainnet",
      receiptMint: "testnet",
    },
    claimBoundary: "founder-manual-mainnet-execution / TIDE-readonly-observation / testnet-decision-attestation",
    ownerAddress: readiness.evidence.sender,
    obligationId: readiness.evidence.obligationId,
    pre: readiness.pre,
    post: readiness.post,
    mainnetEvidence,
    action: receiptActionForDecision(decisionType),
    decisionType,
    limitations: "testnet-rehearsal",
    selectedRail: railId,
    policy: {
      id: policy.id,
      version: Number(policy.version) || 1,
      owner: policy.owner || readiness.evidence.sender,
      selectedRail: railId,
    },
    report: {
      summary: current?.report?.summary || {},
      schemaVersion: Number(current?.report?.schemaVersion) || 1,
    },
  };
  const contentDigest = await digestBundle(bundle);
  const stateBeforeDigest = await digestBundle({
    collateralUsd: Number(readiness.pre.collateralUsd) || 0,
    debtUsd: Number(readiness.pre.debtUsd) || 0,
    ltvBps: Number(readiness.pre.ltvBps) || 0,
  });
  return {
    bundle,
    canonical: canonicalizeBundle(bundle),
    stateBeforeDigest,
    stateBeforeDigestHex: toHexDigest(stateBeforeDigest),
    contentDigest,
    contentDigestHex: toHexDigest(contentDigest),
    railPackDigest: contentDigest.slice(),
    railPackDigestHex: toHexDigest(contentDigest),
    mainnetReadOnlyAttested: true,
  };
}

async function handleMintReceipt({ receiptMode = "testnet" } = {}) {
  if (_mintReceiptInProgress) return;
  _mintReceiptInProgress = true;
  syncMintReceiptButton();

  const wallet = getWalletState();
  if (!wallet.connected) {
    setStatus("Connect wallet before minting a testnet receipt.", true);
    _mintReceiptInProgress = false;
    syncMintReceiptButton();
    return;
  }

  let preCheck;
  try {
    preCheck = await preSigningCheck(buildPreSigningOptions(wallet, "mint-receipt"));
  } catch (error) {
    const signingFailure = recordSigningFailure("receiptMint", error, {
      action: "receipt.mint.precheck",
      policyId: appState.current?.onChainPolicy?.id || "",
    });
    setSigningFailureStatus(signingFailure);
    _mintReceiptInProgress = false;
    syncMintReceiptButton();
    return;
  }
  if (!preCheck.allowed) {
    setStatus(preCheck.message || "Signing is not allowed for this wallet right now.", true);
    _mintReceiptInProgress = false;
    syncMintReceiptButton();
    return;
  }

  if (!isExecutionReceiptsConfigured(getRuntimeConfig())) {
    setStatus("Testnet receipts aren't available on this network yet.", true);
    _mintReceiptInProgress = false;
    syncMintReceiptButton();
    return;
  }

  const current = appState.current;
  let policy = current?.onChainPolicy || null;
  if (!policy?.id) {
    setStatus("Save the policy on-chain before minting a testnet receipt.", true);
    _mintReceiptInProgress = false;
    syncMintReceiptButton();
    return;
  }
  if (!current?.report) {
    setStatus("Run a simulation first to produce an execution snapshot.", true);
    _mintReceiptInProgress = false;
    syncMintReceiptButton();
    return;
  }

  const receiptScopeState = getCreateScopeState({
    draft: current.draft || {},
    walletState: wallet,
    proofContext: getCreateScopeProofContext(),
  });
  if (receiptScopeState.mockCollateral || (receiptScopeState.scope === "live" && !receiptScopeState.walletBacked)) {
    setStatus("Mint receipt requires wallet-backed collateral. Mock collateral can only run a local rehearsal.", true);
    _mintReceiptInProgress = false;
    syncMintReceiptButton();
    return;
  }

  const cfg = getRuntimeConfig();
  const refreshedPolicy = await fetchPolicyObject(policy.id, cfg).catch(() => null);
  if (refreshedPolicy) {
    policy = {
      ...policy,
      ...refreshedPolicy,
    };
    appState.current.onChainPolicy = policy;
    persistCurrentState();
  }
  if (!isPolicyObjectTypeCompatible(policy, cfg)) {
    const expectedType = getExpectedPolicyObjectType(cfg);
    setStatus(
      `This policy was saved with an older testnet package. Save a fresh policy, then mint the receipt. Expected ${expectedType || "current package"}; got ${policy.objectType || "unknown type"}.`,
      true,
    );
    trackEvent("receipt_policy_package_mismatch", {
      policyId: policy.id || "",
      objectType: policy.objectType || "",
      expectedType,
    });
    _mintReceiptInProgress = false;
    syncMintReceiptButton();
    return;
  }

  const staleRefusal = getForecastStaleRefusal(current);
  if (staleRefusal) {
    setStatus(staleRefusal.message, true, null, { testId: staleRefusal.testId });
    trackEvent("forecast_stale_signing_refused", {
      action: "receipt.mint",
      policyId: policy.id || "",
    });
    _mintReceiptInProgress = false;
    syncMintReceiptButton();
    return;
  }

  let pythReadbackForReceipt = null;
  try {
    pythReadbackForReceipt = await ensurePythOracleReadbackReadyForReceipt(cfg);
  } catch (error) {
    setStatus(error?.message || "Pyth BTC/USD read-back is not ready. Refresh oracle read-back before minting a receipt.", true);
    trackEvent("pyth_readback_receipt_refused", {
      policyId: policy.id || "",
      rail: policy.selectedRail || current?.draft?.selectedRail || "",
      reason: error?.code || error?.message || "unknown",
    });
    _mintReceiptInProgress = false;
    syncMintReceiptButton();
    return;
  }

  setStatus("Preparing receipt proof bundle…");
  let receiptMintObservation = null;

  try {
    const railPackDigest = await computeRailPackDigestBytes();
    const railPackInfo = buildProofRailPackFromState();
    const decisionAttestation = buildReceiptDecisionAttestation(current, cfg);
    const desiredRail = String(
      current.draft?.selectedRail || current.draft?.venueId || policy.selectedRail || ""
    ).trim();
    const currentOnChainRail = String(policy.selectedRail || "").trim();
    const railWillChange = Boolean(desiredRail) && desiredRail !== currentOnChainRail;
    const expectedReceiptRail = railWillChange ? desiredRail : currentOnChainRail;
    if (!expectedReceiptRail) {
      throw new Error("Cannot mint receipt without a selected rail.");
    }

    const useMainnetReadOnlyBundle = receiptMode === "mainnet-readonly";
    const proof = useMainnetReadOnlyBundle
      ? await buildMainnetReadOnlyReceiptProof({
          policy,
          current: {
            ...current,
            report: {
              ...(current.report || {}),
              summary: {
                ...(current.report.summary || {}),
                ...buildPythProofSummary(pythReadbackForReceipt),
              },
            },
          },
          expectedReceiptRail,
          decisionAttestation,
        })
      : await buildProofBundleWithDigest({
          policy: {
            id: policy.id,
            version: Number(policy.version) || 1,
            owner: policy.owner || wallet.address,
            selectedRail: expectedReceiptRail,
            mode: policy.mode || current.draft?.mode || "",
            priority: policy.priority || current.draft?.priority || "",
            collateralSymbol: policy.collateralSymbol || current.draft?.collateralAssetSymbol || "",
            collateralCoinType: policy.collateralCoinType || current.draft?.collateralCoinType || "",
            payoutTargetUsd: Number(policy.payoutTargetUsd) || 0,
            minBufferUsd: Number(policy.minBufferUsd) || 0,
            maxLtvBps: Number(policy.maxLtvBps) || 0,
            targetLtvLowBps: Number(policy.targetLtvLowBps) || 0,
            targetLtvHighBps: Number(policy.targetLtvHighBps) || 0,
            repayLtvBps: Number(policy.repayLtvBps) || 0,
            emergencyLtvBps: Number(policy.emergencyLtvBps) || 0,
          },
          report: {
            summary: {
              ...(current.report.summary || {}),
              ...buildPythProofSummary(pythReadbackForReceipt),
            },
            schemaVersion: Number(current.report.schemaVersion) || 1,
          },
          railPack: { ...railPackInfo, digest: railPackDigest },
          ...decisionAttestation,
          action: receiptActionForDecision(decisionAttestation.decisionType),
          createdAtMs: Date.now(),
        });
    const receiptAction = proof.bundle.action || receiptActionForDecision(proof.bundle.decisionType);
    receiptMintObservation = {
      action: receiptAction,
      policyId: policy.id,
      policyVersion: Number(policy.version) || 1,
      selectedRail: expectedReceiptRail,
      correlationId: proof.bundle.correlationId,
      contentDigestHex: proof.contentDigestHex,
      railPackDigestHex: proof.railPackDigestHex,
      railChanged: railWillChange,
    };

    const network = cfg?.sui?.network || "testnet";
    const publisherUrl = cfg?.walrus?.publisherUrl || "";
    const aggregatorUrl = cfg?.walrus?.aggregatorUrl || "";
    const walrusEpochs = Number(cfg?.walrus?.epochs) || 5;
    if (cfg?.executionProof?.allowSigning === true && !publisherUrl) {
      const error = new Error("Walrus proof storage is not configured for this signing build. Set a publisher URL before minting receipts.");
      error.code = "walrus-proof-unverified";
      throw error;
    }
    const publishResult = await publishProofBundle({
      contentDigest: proof.contentDigest,
      canonicalBody: canonicalizeBundle(proof.bundle),
      network,
      publisherUrl,
      aggregatorUrl,
      epochs: walrusEpochs,
      verifyFetchBack: Boolean(publisherUrl),
    });
    const walrusBlobId = publishResult.blobId;
    if (publisherUrl && (publishResult.source !== "walrus" || publishResult.fetchBackVerified !== true)) {
      const reason = publishResult.fallbackError || "Walrus fetch-back did not verify the canonical proof bundle.";
      reportClientError(new Error(reason), {
        action: "publishProofBundle.fallback",
      });
      const error = new Error(`Walrus proof storage is not verified yet: ${reason}`);
      error.code = "walrus-proof-unverified";
      throw error;
    }

    setStatus(
      railWillChange
        ? "Minting receipt with rail change (one atomic tx)…"
        : "Minting receipt on-chain…"
    );

    const builder = railWillChange
      ? await buildSelectRailAndMintTransaction({
          sender: wallet.address,
          policyId: policy.id,
          railId: desiredRail,
          currentRail: currentOnChainRail,
          action: receiptAction,
          decisionAttestation: {
            decisionType: proof.bundle.decisionType,
            limitations: proof.bundle.limitations,
            stateBeforeDigest: proof.stateBeforeDigest,
            plannerInput: decisionAttestation.plannerInput,
            regime: decisionAttestation.regime,
            risk: decisionAttestation.risk,
          },
          walrusBlobId,
          railPackDigest: proof.railPackDigest,
          contentDigest: proof.contentDigest,
          forecast: isPlainObject(current.marketBand) ? current.marketBand : null,
          marketBand: isPlainObject(current.marketBand) ? current.marketBand : null,
          pythReadback: pythReadbackForReceipt,
          requirePythReadback: isPythOracleReadbackRequired(cfg),
          config: getRuntimeConfig(),
        })
      : await buildMintReceiptTransaction({
          sender: wallet.address,
          policyId: policy.id,
          action: receiptAction,
          decisionAttestation: {
            decisionType: proof.bundle.decisionType,
            limitations: proof.bundle.limitations,
            stateBeforeDigest: proof.stateBeforeDigest,
            plannerInput: decisionAttestation.plannerInput,
            regime: decisionAttestation.regime,
            risk: decisionAttestation.risk,
          },
          walrusBlobId,
          railPackDigest: proof.railPackDigest,
          contentDigest: proof.contentDigest,
          expectedRail: currentOnChainRail,
          forecast: isPlainObject(current.marketBand) ? current.marketBand : null,
          marketBand: isPlainObject(current.marketBand) ? current.marketBand : null,
          pythReadback: pythReadbackForReceipt,
          requirePythReadback: isPythOracleReadbackRequired(cfg),
          config: getRuntimeConfig(),
        });

    const runtimeForPreview = getRuntimeConfig();
    const mintPolicyPkg = runtimeForPreview?.policyRegistry?.packageId || "";
    const mintReceiptsPkg = runtimeForPreview?.executionReceipts?.packageId || mintPolicyPkg;
    const mintPolicyModule = runtimeForPreview?.policyRegistry?.module || "policy_registry";
    const mintReceiptsModule = runtimeForPreview?.executionReceipts?.module || "execution_receipts";
    const mintMoveCalls = [];
    if (railWillChange) mintMoveCalls.push(`${mintPolicyPkg}::${mintPolicyModule}::select_rail`);
    mintMoveCalls.push(`${mintReceiptsPkg}::${mintReceiptsModule}::mint_receipt`);

    startSigningTimeline({
      title: railWillChange ? "Rail update + mint receipt" : "Mint receipt",
      subtitle: describeSigningNetwork(),
      finalLabel: "Receipt minted",
      precheck: "receipt bytes + wallet checks OK",
    });
    updateSigningTimeline("wallet", {
      subByStep: {
        wallet: "reviewing pre-sign summary…",
      },
    });

    const mintConfirmed = await confirmPreSign({
      title: railWillChange ? "Rail update + mint receipt" : "Mint receipt",
      subtitle: describeSigningNetwork(),
      moveCalls: mintMoveCalls,
      fields: [
        { label: "Action", value: formatReceiptActionLabel(receiptAction) },
        { label: "Expected rail", value: builder.expectedRail || currentOnChainRail || "—" },
        { label: "Policy", value: formatPolicyObjectId(policy.id) },
        { label: "Policy version", value: String(policy.version || 1) },
        { label: "Decision", value: formatActionTypeLabel(proof.bundle.decisionType) },
        { label: "Limitations", value: formatProofLimitationLabel(proof.bundle.limitations) },
        { label: "Pre-action state digest", value: builder.stateBeforeDigestHex || `0x${proof.stateBeforeDigestHex}` },
        { label: "Content digest", value: builder.contentDigestHex || `0x${proof.contentDigestHex}` },
        { label: "Rail-pack digest", value: builder.railPackDigestHex || `0x${proof.railPackDigestHex}` },
        {
          label: publishResult.source === "walrus" ? "Walrus blob id" : "Local digest",
          value: walrusBlobId,
        },
      ],
      warning: railWillChange
        ? `Rail update included in the same PTB: ${currentOnChainRail || "(none)"} → ${desiredRail}.`
        : "",
    });
    if (!mintConfirmed) {
      cancelSigningTimeline("Cancelled — nothing was signed.");
      setStatus("Cancelled — nothing was signed.");
      return;
    }

    assertMintReceiptByteBinding(builder.transaction, {
      policyId: policy.id,
      action: receiptAction,
      decisionType: proof.bundle.decisionType,
      limitations: proof.bundle.limitations,
      stateBeforeDigest: proof.stateBeforeDigest,
      walrusBlobId,
      railPackDigest: proof.railPackDigest,
      contentDigest: proof.contentDigest,
      expectedRail: builder.expectedRail || expectedReceiptRail,
    }, {
      packageId: mintReceiptsPkg,
      moduleName: mintReceiptsModule,
    });

    emitObservation("mint-submitted", receiptMintObservation, { source: "setup" });
    updateSigningTimeline("wallet", {
      subByStep: {
        wallet: "pre-sign confirmed; waiting for wallet approval…",
      },
    });
    const receipt = await signAndExecuteTransaction(builder.transaction);
    const initialReceiptRef = resolveReceiptObjectReference({
      result: receipt,
      config: getRuntimeConfig(),
    });
    const txDigest = initialReceiptRef.digest || null;
    let confirmation = null;
    if (txDigest) {
      const txShort = shortenMiddle(txDigest, 8, 6);
      updateSigningTimeline("confirming", {
        subByStep: {
          wallet: `${shortenMiddle(wallet.address, 8, 6)} · ${formatSigningTimelineTime()}`,
          signed: `tx ${txShort} · ${formatSigningTimelineTime()}`,
          broadcast: "RPC accepted",
          confirming: "awaiting checkpoint…",
        },
      });
      confirmation = await waitForTransaction(txDigest);
    }
    const receiptTxConfirmed = confirmation?.confirmed === true;
    updateSigningTimeline(receiptTxConfirmed ? "verify" : "confirming", {
      subByStep: {
        confirming: receiptTxConfirmed
          ? `confirmed · ${formatSigningTimelineTime()}`
          : (txDigest ? "confirmation failed" : "no transaction digest returned"),
        verify: receiptTxConfirmed ? "checking Move effects…" : "blocked before Move verification",
      },
    });
    const confirmedResult = requireConfirmedTransaction(confirmation, txDigest, "Receipt mint");

    const receiptRef = resolveReceiptObjectReference({
      result: receipt,
      confirmation: confirmedResult,
      config: getRuntimeConfig(),
    });
    const receiptId = receiptRef.objectId;

    if (!receiptId) {
      throw new Error(`Receipt transaction confirmed but no receipt object id was returned (${receiptRef.reason || "unknown"}).`);
    }
    updateSigningTimeline("final", {
      subByStep: {
        verify: "Move execution succeeded",
        final: `${formatPolicyObjectId(receiptId)} · ${formatSigningTimelineTime()}`,
      },
    });

    let fetched = null;
    if (receiptId) fetched = await fetchReceiptObject(receiptId, getRuntimeConfig());

    const minted = parseReceiptMintedEvents(receipt, getRuntimeConfig())[0]
      || parseReceiptMintedEvents(confirmedResult, getRuntimeConfig())[0]
      || null;

    // Re-verify the off-chain proof bundle against the digest that made
    // it on-chain. Catches three real failure modes before we persist:
    //   1. wallet/RPC tampering between signAndExecute and settlement,
    //   2. a bug in this file that submits a different digest than the
    //      bundle we canonicalized,
    //   3. a bundle that was built too long ago to still be trustworthy.
    // The verdict rides with the stored receipt so the UI (and any
    // future indexer) can gate trust on it; telemetry classifies the
    // failure bucket so funnels can separate wallet rejects from proof
    // integrity issues.
    const receiptObjectVerified = Boolean(
      fetched?.id
      && fetched?.contentDigestHex
      && fetched?.railPackDigestHex
      && fetched?.stateBeforeDigestHex
      && fetched?.walrusBlobId
    );
    const receiptObjectReason = receiptObjectVerified
      ? ""
      : (!fetched?.id ? "receipt-object-missing" : "receipt-object-digests-missing");
    const onChainContentDigestHex =
      fetched?.contentDigestHex || minted?.contentDigestHex || `0x${proof.contentDigestHex}`;
    const expectedContentDigestHex = `0x${proof.contentDigestHex}`;
    const mainnetReadOnlyAttested = proof.mainnetReadOnlyAttested === true;
    const freshness = mainnetReadOnlyAttested
      ? { ok: true, reason: "handled-by-mainnet-evidence", ageMs: 0, maxAgeMs: 0 }
      : checkFreshness(proof.bundle, { now: Date.now() });
    const digestVerdict = mainnetReadOnlyAttested
      ? {
          ok: onChainContentDigestHex.toLowerCase() === expectedContentDigestHex.toLowerCase(),
          reason: onChainContentDigestHex.toLowerCase() === expectedContentDigestHex.toLowerCase() ? "match" : "digest-mismatch",
          expectedHex: expectedContentDigestHex,
          actualHex: onChainContentDigestHex,
        }
      : await verifyBundleDigest(proof.bundle, onChainContentDigestHex);
    const storedBase = {
      id: fetched?.id || receiptId,
      policyId: fetched?.policyId || minted?.policyId || policy.id,
      sourceScenarioId: current?.sourceScenarioId || "",
      policyVersion: fetched?.policyVersion || minted?.policyVersion || Number(policy.version) || 1,
      owner: fetched?.owner || minted?.owner || wallet.address,
      action: fetched?.action || minted?.action || receiptAction,
      selectedRail: fetched?.selectedRail || minted?.selectedRail || expectedReceiptRail,
      walrusBlobId: fetched?.walrusBlobId || minted?.walrusBlobId || walrusBlobId,
      railPackDigest: fetched?.railPackDigest || minted?.railPackDigest || proof.railPackDigest,
      railPackDigestHex: fetched?.railPackDigestHex || minted?.railPackDigestHex || `0x${proof.railPackDigestHex}`,
      contentDigest: fetched?.contentDigest || minted?.contentDigest || proof.contentDigest,
      contentDigestHex: onChainContentDigestHex,
      createdAtMs: fetched?.createdAtMs || minted?.createdAtMs || Date.now(),
      txDigest: txDigest || "",
      proofCanonical: proof.canonical,
      proofBundleVersion: proof.bundle.version || proof.bundle.kind || "",
      decisionType: fetched?.decisionType || minted?.decisionType || proof.bundle.decisionType,
      limitations: fetched?.limitations || minted?.limitations || proof.bundle.limitations,
      stateBeforeDigest: fetched?.stateBeforeDigest || minted?.stateBeforeDigest || proof.stateBeforeDigest,
      stateBeforeDigestHex: fetched?.stateBeforeDigestHex || minted?.stateBeforeDigestHex || `0x${proof.stateBeforeDigestHex}`,
      receiptEventSchemaVersion: minted?.schemaVersion || null,
      mintedAtMs: Date.now(),
    };
    let semanticVerdict;
    try {
      semanticVerdict = await verifyReceiptBundleSemantics({
        receipt: storedBase,
        bundleBytes: new TextEncoder().encode(proof.canonical),
      });
    } catch (error) {
      semanticVerdict = {
        ok: false,
        reason: error?.code || "semantic-verify-error",
        error: error?.message || String(error),
        mismatches: [],
      };
    }
    const proofVerified = Boolean(receiptObjectVerified && digestVerdict.ok && freshness.ok && semanticVerdict?.ok);
    const verificationFailure = !proofVerified
      ? (!receiptObjectVerified
          ? receiptObjectReason
          : !digestVerdict.ok
            ? digestVerdict.reason
            : !freshness.ok
              ? freshness.reason
              : semanticVerdict?.reason)
      : "";
    const proofVerification = {
      ok: proofVerified,
      receiptObjectOk: receiptObjectVerified,
      receiptObjectReason,
      digestOk: Boolean(digestVerdict.ok),
      digestReason: digestVerdict.reason || "",
      bundleFreshnessOk: Boolean(freshness.ok),
      bundleFreshnessReason: freshness.reason || "",
      freshnessOk: Boolean(freshness.ok),
      freshnessReason: freshness.reason || "",
      semanticOk: Boolean(semanticVerdict?.ok),
      semanticReason: semanticVerdict?.reason || "",
      semanticMismatches: Array.isArray(semanticVerdict?.mismatches) ? semanticVerdict.mismatches : [],
      ageMs: Number.isFinite(freshness.ageMs) ? freshness.ageMs : null,
      verifiedAtMs: Date.now(),
      source: fetched?.id ? "receipt-object" : minted?.receiptId ? "receipt-event" : "tx-args",
      evidencePosture: buildReceiptEvidencePosture({
        current,
        publishResult,
        oracleReadback: appState.oracleReadback || null,
        limitations: storedBase.limitations,
      }),
    };

    const stored = {
      ...storedBase,
      proofVerification,
    };
    emitObservation("mint-confirmed", {
      ...receiptMintObservation,
      receiptId: stored.id || "",
      txDigest: txDigest || "",
      proofVerified,
      verificationFailure: verificationFailure || "",
    }, { source: "setup" });

    appState.current.onChainReceipt = stored;

    if (builder.railChanged) {
      const refreshed = await fetchPolicyObject(policy.id, getRuntimeConfig()).catch(() => null);
      if (refreshed) {
        appState.current.onChainPolicy = {
          ...refreshed,
          txDigest: txDigest || refreshed.txDigest || "",
        };
      }
    }

    persistCurrentPolicyBindingToSavedRun(stored);
    renderCurrentPage();

    saveTxReceipt(wallet.address, {
      ok: true,
      txId: txDigest,
      action: stored.action || receiptAction,
      description: builder.railChanged ? "Select rail + mint receipt" : "Mint receipt",
      protocol: "Execution receipts",
      policyId: stored.policyId || policy.id,
      sourceScenarioId: current?.sourceScenarioId || "",
      receiptId: stored.id || "",
      selectedRail: stored.selectedRail || policy.selectedRail || "",
    });

    const idSuffix = stored.id ? `: ${formatPolicyObjectId(stored.id)}` : "";
    // cfg already fetched above when computing the Walrus publisher URL.
    const receiptTxUrl = txDigest ? buildSuiExplorerUrl("tx", txDigest, cfg) : "";
    const receiptObjUrl = stored.id ? buildSuiExplorerUrl("object", stored.id, cfg) : "";
    const explorerLink = receiptTxUrl
      ? { href: receiptTxUrl, label: "View tx on SuiVision" }
      : receiptObjUrl
        ? { href: receiptObjUrl, label: "View receipt on SuiVision" }
        : null;
    if (proofVerified) {
      setStatus(`Receipt minted${idSuffix} — receipt bundle verified.`, false, explorerLink);
    } else {
      setStatus(
        `Receipt minted${idSuffix}, but local verification failed (${verificationFailure}). Keep the receipt and inspect developer diagnostics before using it as evidence.`,
        true,
        explorerLink,
      );
    }
    appendCopyReceiptLinkButton(stored, cfg);
    trackEvent("receipt_minted", {
      receiptId: stored.id || "pending",
      policyId: stored.policyId,
      rail: stored.selectedRail || "unknown",
      txDigest: txDigest || "",
      mode: builder.mode,
      railChanged: Boolean(builder.railChanged),
      proofVerified,
      failureClass: verificationFailure || "none",
      verifiedAgeMs: Number.isFinite(freshness.ageMs) ? freshness.ageMs : null,
    });
    completeSigningTimeline({
      subByStep: {
        final: `${formatPolicyObjectId(stored.id || receiptId)} · ${proofVerified ? "receipt verified" : "receipt needs review"}`,
      },
    });
  } catch (error) {
    const signingFailure = recordSigningFailure("receiptMint", error, {
      action: "mint-receipt",
      policyId: current?.onChainPolicy?.id || "",
      rail: current?.onChainPolicy?.selectedRail || current?.draft?.selectedRail || "",
    });
    const preSignUnavailable = signingFailure.classified?.isPreSignUnavailable === true ||
      signingFailure.classified?.failureClass === "pre-sign-unavailable";
    if (!isUserSigningCancellation(signingFailure) && !preSignUnavailable) {
      saveTxReceipt(wallet.address, {
        ok: false,
        txId: null,
        action: receiptMintObservation?.action || receiptActionForDecision(current?.report?.baseline?.result?.decision?.chosen?.type),
        description: "Mint receipt",
        protocol: "Execution receipts",
        error: signingFailure.classified.developerMessage,
        policyId: current?.onChainPolicy?.id || "",
        sourceScenarioId: current?.sourceScenarioId || "",
        selectedRail: current?.onChainPolicy?.selectedRail || current?.draft?.selectedRail || "",
      });
      emitObservation("mint-failed", {
        ...(receiptMintObservation || {
          action: receiptActionForDecision(current?.report?.baseline?.result?.decision?.chosen?.type),
          policyId: current?.onChainPolicy?.id || "",
          policyVersion: Number(current?.onChainPolicy?.version) || 1,
          selectedRail: current?.onChainPolicy?.selectedRail || current?.draft?.selectedRail || "",
          correlationId: "",
          contentDigestHex: "",
          railPackDigestHex: "",
          railChanged: false,
        }),
        failureClass: signingFailure.classified.failureClass || "unknown",
      }, { source: "setup" });
      reportClientError(error, { action: "handleMintReceipt" });
    }
    trackEvent("receipt_mint_failed", {
      ...signingFailure.telemetry,
    });
    failSigningTimeline(signingFailure);
    setSigningFailureStatus(signingFailure);
  } finally {
    _mintReceiptInProgress = false;
    syncMintReceiptButton();
  }
}

let wsFilter = "all";

// Workspace on-chain cache. Populated by refreshWorkspaceOnChainState()
// on init and on wallet change. `address` pins the cache to the wallet
// that owns it so late-arriving RPC responses can't overwrite a newer
// wallet's state (stale-write guard).
const _workspaceOnChain = {
  policies: [],
  receipts: [],
  status: "idle", // "idle" | "loading" | "loaded" | "error" | "skipped"
  error: null,
  address: "",
};

// Coalesce re-renders that otherwise land back-to-back during init and
// wallet-connect (loading flip → fetch resolve → renderCurrentPage →
// wallet-subscribe .then chains). Two renders in the same microtask/frame
// visibly flicker the card grid; folding into a single rAF tick removes
// the flash.
let _workspaceRenderScheduled = false;
function scheduleWorkspaceRender() {
  if (_workspaceRenderScheduled) return;
  _workspaceRenderScheduled = true;
  const run = () => {
    _workspaceRenderScheduled = false;
    if (currentPage === "workspace" || currentPage === "overview") {
      renderWorkspacePage();
    }
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(run);
  } else {
    Promise.resolve().then(run);
  }
}

let _pageRenderScheduled = false;
function scheduleRender() {
  if (_pageRenderScheduled) return;
  _pageRenderScheduled = true;
  const run = () => {
    _pageRenderScheduled = false;
    renderCurrentPage();
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(run);
  } else {
    Promise.resolve().then(run);
  }
}

async function refreshWorkspaceOnChainState() {
  const address = normalizeWalletAddress();
  const cfg = getRuntimeConfig();

  if (!address || !isPolicyRegistryConfigured(cfg)) {
    _workspaceOnChain.policies = [];
    _workspaceOnChain.receipts = [];
    _workspaceOnChain.status = "skipped";
    _workspaceOnChain.error = null;
    _workspaceOnChain.address = address;
    pruneLiveProtocolCaches(address, getKnownLivePolicyIds());
    scheduleWorkspaceRender();
    return;
  }

  _workspaceOnChain.status = "loading";
  _workspaceOnChain.error = null;
  _workspaceOnChain.address = address;
  scheduleWorkspaceRender();

  try {
    const [policies, receipts] = await Promise.all([
      fetchOwnedPolicies(address, cfg),
      fetchOwnedReceipts(address, cfg).catch(() => []),
    ]);
    if (_workspaceOnChain.address !== address) return;
    _workspaceOnChain.policies = Array.isArray(policies) ? policies : [];
    _workspaceOnChain.receipts = Array.isArray(receipts) ? receipts : [];
    _workspaceOnChain.status = "loaded";
    _workspaceOnChain.error = null;
  } catch (err) {
    if (_workspaceOnChain.address !== address) return;
    _workspaceOnChain.status = "error";
    _workspaceOnChain.error = err instanceof Error ? err.message : String(err);
  } finally {
    pruneLiveProtocolCaches(address, getKnownLivePolicyIds());
    scheduleWorkspaceRender();
  }
}

function shortenMiddle(value, head = 6, tail = 4) {
  const str = typeof value === "string" ? value : "";
  if (str.length <= head + tail + 1) return str;
  return `${str.slice(0, head)}…${str.slice(-tail)}`;
}

function getWorkspacePolicyTreasury(policy) {
  const modeled = findLatestModeledSnapshotForPolicy(policy?.id || "");
  const modeledDraft = modeled?.draft || null;
  const btc = asNumber(modeledDraft?.btcUnits)
    || asNumber(policy?.snapshot?.collateralBtc)
    || asNumber(policy?.collateralBtc)
    || 0;
  const price = getEffectiveBtcPriceUsd(modeledDraft)
    || asNumber(policy?.snapshot?.btcPriceUsd)
    || asNumber(policy?.btcPriceUsd)
    || 0;
  return { btc, usd: btc * price };
}

function getWorkspaceSavedRunTreasury(record) {
  const draft = record?.draft || null;
  if (!draft) return null;
  const btc = asNumber(draft.btcUnits);
  const price = getEffectiveBtcPriceUsd(draft) || asNumber(draft.btcPriceUsd);
  const usd = btc * price;
  if (!(usd > 0)) return null;
  const ts = normalizeLiveHistoryTimestamp(record?.createdAtMs || record?.createdAt || record?.report?.generatedAt || "");
  return { ts, usd };
}

function buildWorkspaceTreasurySparkValues({ aggregateUsd = 0, savedRuns = [] } = {}) {
  const values = (Array.isArray(savedRuns) ? savedRuns : [])
    .map(getWorkspaceSavedRunTreasury)
    .filter(Boolean)
    .sort((left, right) => left.ts - right.ts)
    .slice(-7)
    .map((entry) => entry.usd);
  if (aggregateUsd > 0 && (values.length === 0 || Math.abs(values[values.length - 1] - aggregateUsd) > 1)) {
    values.push(aggregateUsd);
  }
  if (values.length >= 2) return values;
  if (aggregateUsd > 0) return [aggregateUsd, aggregateUsd];
  return [0, 0];
}

function formatWorkspaceTrend({ values = [], policyCount = 0 } = {}) {
  const first = Number(values[0]) || 0;
  const last = Number(values[values.length - 1]) || 0;
  const policyLabel = `${policyCount} live polic${policyCount === 1 ? "y" : "ies"}`;
  if (first > 0 && last > 0 && Math.abs(last - first) > 1) {
    const pct = ((last - first) / first) * 100;
    const tone = pct >= 0 ? "ds-hero__sub-delta" : "ds-hero__sub-delta workspace-head__sub-delta--down";
    return `
      <span class="${tone}">${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}%</span>
      <span class="ds-hero__sub-meta">vs recent modeled runs · ${policyLabel}</span>
    `;
  }
  return `
    <span class="ds-hero__sub-delta">Current modeled</span>
    <span class="ds-hero__sub-meta">${policyLabel}</span>
  `;
}

function getWorkspaceLatestActivityMs(policies = [], receipts = []) {
  const timestamps = [
    ...policies.flatMap((policy) => [
      policy?.createdAtMs,
      policy?.updatedAtMs,
      policy?.snapshot?.createdAtMs,
      policy?.snapshot?.updatedAtMs,
    ]),
    ...receipts.flatMap((receipt) => [
      receipt?.createdAtMs,
      receipt?.mintedAtMs,
      receipt?.updatedAtMs,
    ]),
  ].map(normalizeLiveHistoryTimestamp).filter((value) => value > 0);
  return timestamps.length ? Math.max(...timestamps) : 0;
}

function renderWorkspaceIdentity() {
  const root = $("#workspace-identity");
  if (!root) return;
  root.classList.remove("ds-hero");
  root.classList.add("workspace-head");

  const wallet = getWalletState();
  const cfg = getRuntimeConfig();
  const network = getSuiNetwork(cfg);
  const connected = Boolean(wallet.connected && wallet.address);
  const addressShort = wallet.address ? shortenMiddle(wallet.address, 6, 4) : "";
  const packageId = getPolicyRegistryConfig(cfg).packageId || "";
  const status = _workspaceOnChain.status;
  const policies = getMergedWorkspacePolicies();
  const receipts = getMergedWorkspaceReceipts();
  const savedDrafts = Array.isArray(appState.drafts) ? appState.drafts : [];
  const savedRuns = Array.isArray(appState.saved) ? appState.saved : [];
  const policyCount = policies.length;
  const receiptCount = receipts.length;
  const savedCount = savedDrafts.length + (appState.draft ? 1 : 0);
  const simulationCount = savedRuns.length;
  const addressHref = wallet.address ? buildSuiExplorerUrl("address", wallet.address, cfg) : "";
  const packageHref = packageId ? buildSuiExplorerUrl("object", packageId, cfg) : "";
  const loadingDots = status === "loading" ? "…" : "";

  const envChip = network
    ? `<span class="ws-id-chip ws-id-chip--env ws-id-chip--${escapeHtml(network)}">${escapeHtml(network)}</span>`
    : "";

  const ctaHint = !connected
    ? "Wallet is optional for simulation. Connect it to save runs to your account and unlock proof actions where signing is enabled."
    : "";
  const cta = !connected
    ? `<a class="button button-primary" href="/setup">Run first simulation ${icon("activity", "sm")}</a>`
    : policyCount > 0
      ? `<a class="button button-primary" href="/setup" data-action="start-new-draft">Start new draft ${icon("plus", "sm")}</a>`
      : `<a class="button button-primary" href="/setup" data-action="start-new-draft">Create first policy ${icon("plus", "sm")}</a>`;

  const treasury = policies.reduce((sum, policy) => {
    const entry = getWorkspacePolicyTreasury(policy);
    sum.usd += entry.usd;
    sum.btc += entry.btc;
    return sum;
  }, { usd: 0, btc: 0 });
  const aggregateUsd = treasury.usd;
  const aggregateBtc = treasury.btc;
  const sparkValues = buildWorkspaceTreasurySparkValues({ aggregateUsd, savedRuns });
  const trendMarkup = formatWorkspaceTrend({ values: sparkValues, policyCount });
  const sparkline = renderInlineSpark(sparkValues, { tone: "mint", width: 280, height: 64 });
  const latestActivityMs = getWorkspaceLatestActivityMs(policies, receipts);
  const latestActivityLabel = latestActivityMs
    ? dateTimeFormatter.format(new Date(latestActivityMs))
    : "No on-chain events";
  const aggregateDisplay = aggregateUsd > 0
    ? formatUsd(aggregateUsd)
    : (loadingDots ? loadingDots : "$0");

  safeReplaceChildren(root, `
    <div class="workspace-head__top">
      <p class="section-label">Aggregate treasury</p>
      <div class="workspace-head__top-actions">
        <div class="trust-labels trust-strip trust-strip--workspace" aria-label="Safety posture"></div>
        <div class="workspace-head__actions">
          ${envChip}
          ${packageHref ? `<a class="ws-id-chip ws-id-chip--muted" href="${escapeHtml(packageHref)}" target="_blank" rel="noopener">Registry ↗</a>` : ""}
          ${cta}
        </div>
      </div>
    </div>

    <div class="workspace-head__main">
      <div class="workspace-head__anchor">
        <div class="ds-hero__amount">${escapeHtml(aggregateDisplay)}</div>
        <div class="ds-hero__sub">${trendMarkup}</div>
      </div>
      <div class="workspace-head__visual">
        <div class="ds-hero__chart">${sparkline}</div>
        <p id="status-note" class="status-line" role="status" aria-live="polite" aria-atomic="true" hidden></p>
      </div>
    </div>

    <dl class="workspace-head__metrics">
      <div>
        <dt>Live policies</dt>
        <dd>${policyCount > 0 ? policyCount : (loadingDots || "0")}</dd>
      </div>
      <div>
        <dt>BTC under cockpit</dt>
        <dd>${aggregateBtc > 0 ? formatBtcAmount(aggregateBtc) : "0"}</dd>
      </div>
      <div>
        <dt>Receipts minted</dt>
        <dd>${receiptCount > 0 ? receiptCount : (loadingDots || "0")}</dd>
      </div>
      <div>
        <dt>Latest activity</dt>
        <dd>${escapeHtml(latestActivityLabel)}</dd>
      </div>
      <div>
        <dt>Wallet</dt>
        <dd>${connected
          ? `<a href="${escapeHtml(addressHref)}" target="_blank" rel="noopener">${escapeHtml(addressShort)}</a>`
          : "Not connected"}</dd>
      </div>
    </dl>

    <div id="workspace-filter" class="workspace-filter-toolbar" aria-label="Workspace filters"></div>
    ${ctaHint ? `<p class="ws-identity__cta-hint">${escapeHtml(ctaHint)}</p>` : ""}
  `);
  syncTrustLabels();
}

function normalizeLiveHistoryText(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readRoutePolicyIdFromUrl() {
  try {
    return normalizeLiveHistoryText(new URL(window.location.href).searchParams.get("policy") || "");
  } catch {
    return "";
  }
}

function readRouteScenarioIdFromUrl() {
  try {
    const params = new URL(window.location.href).searchParams;
    return normalizeLiveHistoryText(params.get("id") || params.get("run") || "");
  } catch {
    return "";
  }
}

function readRouteRunIdFromUrl() {
  return readRouteScenarioIdFromUrl();
}

function buildSetupHref(id = "", options = {}) {
  const params = new URLSearchParams();
  const pinned = normalizeLiveHistoryText(id);
  const policy = normalizeLiveHistoryText(options.policy);
  if (pinned) params.set("id", pinned);
  if (policy) params.set("policy", policy);
  if (options.proof === true) params.set("proof", "1");
  if (isPlainObject(options.draft)) {
    const encodedDraft = encodeRouteDraftHandoff(options.draft);
    if (encodedDraft) params.set("draft", encodedDraft);
  }
  const query = params.toString();
  return `/setup${query ? `?${query}` : ""}`;
}

function appendHashToHref(href = "", hash = "") {
  const cleanHash = String(hash || "").trim().replace(/^#/, "");
  if (!cleanHash) return href;
  const base = String(href || "").split("#")[0] || "";
  return `${base || ""}#${cleanHash}`;
}

function buildRunReadoutHref(runId, options = {}) {
  const page = normalizeLiveHistoryText(options.page, "results");
  const pinned = normalizeLiveHistoryText(runId);
  const policy = normalizeLiveHistoryText(options.policy);
  const hash = normalizeLiveHistoryText(options.hash);
  const hashSuffix = hash ? (hash.startsWith("#") ? hash : `#${hash}`) : "";
  const params = new URLSearchParams();
  if (pinned) params.set("id", pinned);
  if (policy) params.set("policy", policy);
  const serialized = params.toString();
  const query = serialized ? `?${serialized}` : "";
  return `/${page}${query}${hashSuffix}`;
}

function buildTestnetSetupHref(id = "", options = {}) {
  return new URL(buildSetupHref(id, options), "https://testnet.tidesui.pro").href;
}

function buildLivePolicyHref(policyId = "", options = {}) {
  const params = new URLSearchParams();
  const pinnedPolicy = normalizeLiveHistoryText(policyId);
  const pinnedScenario = normalizeLiveHistoryText(options.id || options.scenarioId);
  const hash = normalizeLiveHistoryText(options.hash);
  if (pinnedPolicy) params.set("policy", pinnedPolicy);
  if (pinnedScenario) params.set("id", pinnedScenario);
  const query = params.toString();
  const hashSuffix = hash ? (hash.startsWith("#") ? hash : `#${hash}`) : "";
  return `/live${query ? `?${query}` : ""}${hashSuffix}`;
}

function syncReadoutEditCreateLinks(current = appState.current) {
  if (currentPage !== "results" && currentPage !== "live") return;
  const scenarioId = normalizeLiveHistoryText(current?.sourceScenarioId || readRouteScenarioIdFromUrl());
  const policyId = normalizeLiveHistoryText(current?.onChainPolicy?.id || readRoutePolicyIdFromUrl());
  const href = buildSetupHref(scenarioId, { policy: policyId });
  document.querySelectorAll('[data-action="edit-in-create"], .page-actions a.button').forEach((link) => {
    if (!link.matches?.('[data-action="edit-in-create"]') && !/edit in create/i.test(String(link.textContent || ""))) return;
    link.setAttribute("href", href);
    link.setAttribute("title", scenarioId
      ? "Reopen this exact position id in Create."
      : "Reopen this policy in Create.");
  });
}

function normalizeLiveHistoryTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatLiveActivityLabel(value, fallback = "Action") {
  const raw = normalizeLiveHistoryText(value, fallback);
  if (!raw) return fallback;
  if (RECEIPT_ACTION_LABELS[raw]) return RECEIPT_ACTION_LABELS[raw];
  const cleaned = raw
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return fallback;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

const LIVE_CONTROL_MODE_META = {
  active: {
    label: "Active review",
    badge: "Active",
    copy: "TIDE is allowed to keep modeling the next step. Funds still do not move until you sign.",
    next: "Re-run in Setup before approving the next on-chain step.",
    eventTitle: "Marked active",
    eventBadge: "Control",
    tone: "control",
    status: "Ready for the next reviewed step.",
  },
  paused: {
    label: "Paused",
    badge: "Paused",
    copy: "Hold the next approval until the modeled snapshot is reviewed again.",
    next: "Do not sign. Re-open in Setup and review the updated snapshot first.",
    eventTitle: "Paused approvals",
    eventBadge: "Paused",
    tone: "pause",
    status: "Waiting for operator review before any next step.",
  },
  "unwind-planned": {
    label: "Exit planned",
    badge: "Exit",
    copy: "The next intended step is to repay, withdraw, or close on the underlying rail UI.",
    next: "Complete the exit on the rail UI, then mint a final receipt.",
    eventTitle: "Exit planned",
    eventBadge: "Exit",
    tone: "control",
    status: "Exit is planned but not yet confirmed.",
  },
  unwound: {
    label: "Closed locally",
    badge: "Closed",
    copy: "Local operator state says the live position has been closed or withdrawn back out.",
    next: "Mint or keep the final receipt so Workspace captures the exit cleanly.",
    eventTitle: "Marked closed locally",
    eventBadge: "Closed",
    tone: "control",
    status: "Latest known operator posture says the position is out.",
  },
};

function getLiveControlMeta(mode = "active") {
  return LIVE_CONTROL_MODE_META[mode] || LIVE_CONTROL_MODE_META.active;
}

function getPolicyLocalControlState(policyId) {
  return getPolicyLiveControlState(appState.liveControlState, policyId);
}

function getPolicyLocalUnwindProgress(policyId) {
  return getPolicyLiveUnwindProgress(appState.liveUnwindProgress, policyId);
}

function applyPolicyControlState(policyId, mode, source = "workspace") {
  const pinned = normalizeLiveHistoryText(policyId);
  if (!pinned) {
    setStatus("Pick a live policy first.", true);
    return;
  }

  if (mode === "unwound") {
    const unwindProgress = getPolicyLocalUnwindProgress(pinned);
    const exitEvidence = buildLiveExitEvidence({
      receipts: getReceiptsForPolicyFromWorkspace(pinned),
      controlState: getPolicyLocalControlState(pinned),
      unwindProgress,
    });
    if (!canMarkPolicyUnwound(unwindProgress, exitEvidence)) {
      setStatus(exitEvidence.copy || "Complete the full exit checklist and mint the final proof before marking this policy closed locally.", true);
      return;
    }
  }

  const meta = getLiveControlMeta(mode);
  appState.liveControlState = applyPolicyLiveControlTransition(appState.liveControlState, pinned, {
    mode,
    source,
    note: meta.copy,
  });
  persistLiveControlState();
  renderCurrentPage();
  setStatus(`${meta.label} saved for ${shortenMiddle(pinned, 8, 6)}. This is local operator state only — it does not move funds on-chain.`);
  trackEvent("live_control_state_changed", {
    mode,
    source,
  });
}

function toggleLiveUnwindStep(policyId, stepId, completed, source = "workspace") {
  const pinned = normalizeLiveHistoryText(policyId);
  if (!pinned) {
    setStatus("Pick a live policy first.", true);
    return;
  }

  appState.liveUnwindProgress = togglePolicyLiveUnwindStep(
    appState.liveUnwindProgress,
    pinned,
    stepId,
    completed
  );
  persistLiveUnwindProgress();
  renderCurrentPage();
  trackEvent("live_unwind_step_toggled", {
    stepId,
    completed: completed === true,
    source,
  });
}

function getCachedLiveProtocolReadback(policyId, address = normalizeWalletAddress()) {
  const key = buildLiveProtocolCacheKey(policyId, address);
  return key ? _liveProtocolReadbacks[key] || null : null;
}

function getLiveMainnetEvidenceContext(policyId = "") {
  const pinned = normalizeLiveHistoryText(policyId);
  const policy = getLivePolicyRecord(pinned)
    || (normalizeLiveHistoryText(appState.current?.onChainPolicy?.id) === pinned
      ? appState.current?.onChainPolicy
      : null);
  const readback = getCachedLiveProtocolReadback(pinned);
  const balanceReadback = readback?.balanceReadback || null;
  const selectedRail = policy?.selectedRail || readback?.railId || balanceReadback?.railId || "";
  return {
    policy,
    readback,
    balanceReadback,
    railId: resolveCanonicalRailId({ selectedRail, railId: selectedRail }),
    ownerAddress: normalizeWalletAddress(getWalletState().address || policy?.owner || "").toLowerCase(),
    obligationId: normalizeLiveHistoryText(
      readback?.obligationId ||
      balanceReadback?.obligationId ||
      ""
    ).toLowerCase(),
  };
}

function isValidMainnetTxDigest(value = "") {
  const digest = normalizeLiveHistoryText(value);
  return digest.length >= 32 && digest.length <= 96 && !/\s/.test(digest);
}

async function postReadonlyMainnetRpc(body) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), MAINNET_READONLY_RPC_TIMEOUT_MS);
  try {
    const response = await fetch(MAINNET_READONLY_RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Sui mainnet RPC returned HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (payload?.error) {
      throw new Error(payload.error.message || "Sui mainnet RPC returned an error");
    }
    return payload?.result || null;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Sui mainnet RPC timed out. Try again or refresh the Suilend position first.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function collectMainnetMoveCalls(value, calls = []) {
  if (!value || typeof value !== "object") return calls;
  if (Array.isArray(value)) {
    for (const item of value) collectMainnetMoveCalls(item, calls);
    return calls;
  }
  const moveCall = value.MoveCall || value.moveCall || null;
  if (moveCall && typeof moveCall === "object") {
    calls.push({
      package: normalizeLiveHistoryText(moveCall.package || moveCall.packageId || "").toLowerCase(),
      module: normalizeLiveHistoryText(moveCall.module || "").toLowerCase(),
      function: normalizeLiveHistoryText(moveCall.function || "").toLowerCase(),
      arguments: Array.isArray(moveCall.arguments) ? moveCall.arguments : [],
      typeArguments: (moveCall.type_arguments || moveCall.typeArguments || []).map((arg) =>
        normalizeLiveHistoryText(arg || "").toLowerCase()
      ),
    });
  }
  for (const item of Object.values(value)) collectMainnetMoveCalls(item, calls);
  return calls;
}

function collectMainnetObjectIds(value, objects = new Set()) {
  const stack = [value];
  while (stack.length > 0) {
    const item = stack.pop();
    if (typeof item === "string" && /^0x[0-9a-fA-F]{64}$/.test(item)) {
      objects.add(item.toLowerCase());
      continue;
    }
    if (!item || typeof item !== "object") continue;
    for (const [key, child] of Object.entries(item)) {
      if (
        ["objectid", "object_id", "id"].includes(String(key).toLowerCase())
        && typeof child === "string"
        && /^0x[0-9a-fA-F]{64}$/.test(child)
      ) {
        objects.add(child.toLowerCase());
      }
      stack.push(child);
    }
  }
  return objects;
}

function collectMainnetMoveCallObjectArgs(call, transactionInputs = []) {
  const objects = new Set();
  let sawStructuredArgs = false;
  const stack = Array.isArray(call?.arguments) ? [...call.arguments] : [];
  while (stack.length > 0) {
    const item = stack.pop();
    if (typeof item === "string" && /^0x[0-9a-fA-F]{64}$/.test(item)) {
      objects.add(item.toLowerCase());
      sawStructuredArgs = true;
      continue;
    }
    if (!item || typeof item !== "object") continue;
    for (const [key, value] of Object.entries(item)) {
      if (String(key).toLowerCase() === "input" && Number.isInteger(Number(value))) {
        sawStructuredArgs = true;
        collectMainnetObjectIds(transactionInputs[Number(value)], objects);
        continue;
      }
      if (
        ["objectid", "object_id", "id"].includes(String(key).toLowerCase())
        && typeof value === "string"
        && /^0x[0-9a-fA-F]{64}$/.test(value)
      ) {
        objects.add(value.toLowerCase());
        sawStructuredArgs = true;
      }
      stack.push(value);
    }
  }
  return { objects, sawStructuredArgs };
}

function mainnetMoveCallTouchesObject(call, objectId = "", transactionInputs = []) {
  const expected = normalizeLiveHistoryText(objectId).toLowerCase();
  if (!expected) return true;
  const args = Array.isArray(call?.arguments) ? call.arguments : null;
  if (!args || args.length === 0) return true;
  const { objects, sawStructuredArgs } = collectMainnetMoveCallObjectArgs(call, transactionInputs);
  return sawStructuredArgs && objects.has(expected);
}

function assertSuilendMainnetRepayMoveCall(tx, { digest = "", obligationId = "" } = {}) {
  const txProgrammable = tx?.transaction?.data?.transaction;
  const calls = collectMainnetMoveCalls(txProgrammable);
  const transactionInputs = Array.isArray(txProgrammable?.inputs) ? txProgrammable.inputs : [];
  const mainPoolTypeArg = `${SUILEND_MAINNET_PACKAGE_ID}::suilend::main_pool`;
  const matched = calls.some((call) =>
    SUILEND_MAINNET_REPAY_PACKAGE_IDS.has(call.package)
    && call.module.includes("lending")
    && call.function.includes("repay")
    && (
      call.package === SUILEND_MAINNET_PACKAGE_ID
      || call.typeArguments.some((arg) => arg.includes(mainPoolTypeArg))
    )
    && mainnetMoveCallTouchesObject(call, obligationId, transactionInputs)
  );
  if (!matched) {
    throw new Error(`Mainnet tx ${digest || "(unknown)"} touched the obligation but did not include an expected Suilend repay MoveCall bound to that obligation.`);
  }
  return true;
}

async function verifyLiveMainnetTxDigest(policyId = "", digest = "") {
  const pinned = normalizeLiveHistoryText(policyId);
  const normalizedDigest = normalizeLiveHistoryText(digest);
  if (!pinned) {
    throw new Error("Load an on-chain policy before verifying a mainnet action.");
  }
  if (!isValidMainnetTxDigest(normalizedDigest)) {
    throw new Error("Paste the full mainnet transaction digest from SuiVision or the rail UI.");
  }
  const context = getLiveMainnetEvidenceContext(pinned);
  if (context.railId !== "suilend-sui") {
    throw new Error("Mainnet action verification is enabled for Suilend read-back first.");
  }
  if (!context.ownerAddress) {
    throw new Error("Connect the wallet that performed the mainnet action.");
  }
  if (!context.obligationId) {
    throw new Error("Refresh Suilend read-back first so TIDE knows which obligation to verify.");
  }
  const storedEvidence = getPolicyLiveMainnetEvidence(pinned);
  const preReadback = normalizeMainnetReadbackForBundle(storedEvidence.preReadback)
    || normalizeMainnetReadbackForBundle(context.balanceReadback);

  const tx = await postReadonlyMainnetRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "sui_getTransactionBlock",
    params: [
      normalizedDigest,
      {
        showInput: true,
        showEffects: true,
        showEvents: true,
        showObjectChanges: true,
        showBalanceChanges: true,
      },
    ],
  });
  if (!tx || typeof tx !== "object") {
    throw new Error("Sui mainnet RPC did not return this transaction block.");
  }
  const status = String(tx?.effects?.status?.status || "").trim().toLowerCase();
  if (status !== "success") {
    throw new Error(`Mainnet transaction is not successful (${status || "missing status"}).`);
  }
  const sender = normalizeWalletAddress(tx?.transaction?.data?.sender || tx?.input?.sender || "").toLowerCase();
  if (!sender) {
    throw new Error("Mainnet transaction returned no sender.");
  }
  if (sender !== context.ownerAddress) {
    throw new Error(`Mainnet sender ${shortenMiddle(sender, 6, 4)} does not match connected wallet ${shortenMiddle(context.ownerAddress, 6, 4)}.`);
  }
  const objectChanges = Array.isArray(tx?.objectChanges) ? tx.objectChanges : [];
  const touched = objectChanges.some((change) => {
    const objectId = normalizeLiveHistoryText(change?.objectId || change?.outputObjectId || "").toLowerCase();
    return objectId && objectId === context.obligationId;
  });
  if (!touched) {
    throw new Error(`Mainnet transaction did not touch Suilend obligation ${shortenMiddle(context.obligationId, 6, 4)}.`);
  }
  assertSuilendMainnetRepayMoveCall(tx, {
    digest: normalizedDigest,
    obligationId: context.obligationId,
  });
  return normalizeLiveMainnetEvidenceEntry({
    policyId: pinned,
    digest: normalizedDigest,
    sender,
    obligationId: context.obligationId,
    checkpoint: normalizeLiveHistoryText(tx?.checkpoint),
    timestampMs: Number(tx?.timestampMs) || 0,
    objectChangeCount: objectChanges.length,
    protocolAction: "repay",
    verifiedAt: Date.now(),
    status: "verified",
    error: "",
    preReadback,
  }, pinned);
}

function captureLiveMainnetPreActionSnapshot(policyId = "") {
  const pinned = normalizeLiveHistoryText(policyId);
  if (!pinned) {
    throw new Error("Load an on-chain policy before saving a pre-action snapshot.");
  }
  const context = getLiveMainnetEvidenceContext(pinned);
  if (context.railId !== "suilend-sui") {
    throw new Error("Pre-action snapshot capture is enabled for Suilend read-back first.");
  }
  const preReadback = normalizeMainnetReadbackForBundle(context.balanceReadback);
  if (!preReadback) {
    throw new Error("Refresh Suilend read-back before saving the pre-action snapshot.");
  }
  const existing = getPolicyLiveMainnetEvidence(pinned);
  return normalizeLiveMainnetEvidenceEntry({
    ...existing,
    policyId: pinned,
    preReadback,
    status: existing.status === "verified" ? "verified" : "pending",
    error: "",
  }, pinned);
}

function handleCaptureLiveMainnetPreActionSnapshot(button) {
  const pinned = normalizeLiveHistoryText(
    button?.dataset?.policyId || appState.current?.onChainPolicy?.id || ""
  );
  try {
    const evidence = captureLiveMainnetPreActionSnapshot(pinned);
    setPolicyLiveMainnetEvidence(pinned, evidence);
    persistLiveUnwindProgress();
    renderCurrentPage();
    setStatus(`Pre-action Suilend snapshot saved for ${shortenMiddle(pinned, 8, 6)}.`);
    trackEvent("live_mainnet_pre_snapshot_saved", {
      policyId: pinned,
      railId: getLiveMainnetEvidenceContext(pinned).railId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err || "Pre-action snapshot could not be saved.");
    setStatus(message, true);
    trackEvent("live_mainnet_pre_snapshot_failed", {
      policyId: pinned,
      reason: message,
    });
  }
}

async function handleVerifyLiveMainnetTx(button) {
  const pinned = normalizeLiveHistoryText(
    button?.dataset?.policyId || appState.current?.onChainPolicy?.id || ""
  );
  const host = button?.closest?.(".ws-exit-mainnet-evidence") || document;
  const input = host.querySelector?.("[data-live-mainnet-digest]");
  const digest = normalizeLiveHistoryText(input?.value || "");
  if (!pinned) {
    setStatus("Load an on-chain policy before verifying a mainnet action.", true);
    return;
  }
  if (button instanceof HTMLButtonElement) {
    button.disabled = true;
    button.textContent = "Verifying…";
  }
  try {
    const evidence = await verifyLiveMainnetTxDigest(pinned, digest);
    setPolicyLiveMainnetEvidence(pinned, evidence);
    persistLiveUnwindProgress();
    renderCurrentPage();
    setStatus(`Suilend repayment verified for ${shortenMiddle(pinned, 8, 6)}. Refresh Suilend position to unlock the final receipt.`);
    trackEvent("live_mainnet_tx_verified", {
      policyId: pinned,
      railId: getLiveMainnetEvidenceContext(pinned).railId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err || "Mainnet action verification failed.");
    const existing = getPolicyLiveMainnetEvidence(pinned);
    setPolicyLiveMainnetEvidence(pinned, {
      ...existing,
      policyId: pinned,
      digest,
      status: "error",
      error: message,
    });
    persistLiveUnwindProgress();
    renderCurrentPage();
    setStatus(message, true);
    trackEvent("live_mainnet_tx_verify_failed", {
      policyId: pinned,
      reason: message,
    });
  }
}

function setCachedLiveProtocolReadback(policyId, next, address = normalizeWalletAddress()) {
  const key = buildLiveProtocolCacheKey(policyId, address);
  if (!key) return;
  if (next) {
    _liveProtocolReadbacks[key] = next;
  } else {
    delete _liveProtocolReadbacks[key];
  }
}

function setLiveProtocolRefreshState(policyId, next = {}, address = normalizeWalletAddress()) {
  const key = buildLiveProtocolCacheKey(policyId, address);
  if (!key) return;
  _liveProtocolRefreshState[key] = {
    pending: next.pending === true,
    lastRequestedAt: Number(next.lastRequestedAt) || 0,
    lastSettledAt: Number(next.lastSettledAt) || 0,
  };
}

function getKnownLivePolicyIds() {
  const ids = new Set();
  for (const policy of Array.isArray(_workspaceOnChain.policies) ? _workspaceOnChain.policies : []) {
    const pinned = normalizeLiveHistoryText(policy?.id);
    if (pinned) ids.add(pinned);
  }
  const currentPolicyId = normalizeLiveHistoryText(appState.current?.onChainPolicy?.id);
  if (currentPolicyId) ids.add(currentPolicyId);
  return Array.from(ids);
}

function pruneLiveProtocolCaches(address = normalizeWalletAddress(), policyIds = getKnownLivePolicyIds()) {
  const next = pruneLiveProtocolCacheEntries({
    readbacks: _liveProtocolReadbacks,
    refreshState: _liveProtocolRefreshState,
    walletAddress: address,
    policyIds,
  });
  _liveProtocolReadbacks = next.readbacks;
  _liveProtocolRefreshState = next.refreshState;
}

function getMergedWorkspacePolicies() {
  const policies = Array.isArray(_workspaceOnChain.policies) ? _workspaceOnChain.policies.slice() : [];
  const pushUniquePolicy = (policy, prepend = false) => {
    const id = normalizeLiveHistoryText(policy?.id);
    if (!id || policies.some((entry) => normalizeLiveHistoryText(entry?.id) === id)) {
      return;
    }
    if (prepend) {
      policies.unshift(clone(policy));
    } else {
      policies.push(clone(policy));
    }
  };

  pushUniquePolicy(appState.current?.onChainPolicy, true);
  for (const scenario of Array.isArray(appState.saved) ? appState.saved : []) {
    pushUniquePolicy(scenario?.onChainPolicy, false);
  }
  return policies;
}

function getMergedWorkspaceReceipts() {
  const receipts = Array.isArray(_workspaceOnChain.receipts) ? _workspaceOnChain.receipts.slice() : [];
  const localFields = [
    "sourceScenarioId",
    "proofVerification",
    "proofCanonical",
    "proofBundle",
    "evidencePosture",
    "receiptUrl",
    "contentDigest",
    "contentDigestHex",
    "railPackDigestHex",
    "txDigest",
  ];
  const mergeReceipt = (candidate, prepend = false) => {
    const id = normalizeLiveHistoryText(candidate?.id);
    if (!id) return;
    const local = clone(candidate);
    const existingIndex = receipts.findIndex((receipt) => normalizeLiveHistoryText(receipt?.id) === id);
    if (existingIndex >= 0) {
      const merged = { ...local, ...receipts[existingIndex] };
      for (const field of localFields) {
        if (local[field] !== undefined && local[field] !== null && local[field] !== "") {
          merged[field] = local[field];
        }
      }
      receipts[existingIndex] = merged;
      return;
    }
    if (prepend) {
      receipts.unshift(local);
    } else {
      receipts.push(local);
    }
  };

  mergeReceipt(appState.current?.onChainReceipt, true);
  for (const scenario of Array.isArray(appState.saved) ? appState.saved : []) {
    mergeReceipt(scenario?.onChainReceipt, false);
  }
  return receipts;
}

function getReceiptsForPolicyFromWorkspace(policyId) {
  const pinned = normalizeLiveHistoryText(policyId);
  if (!pinned) return [];
  return getMergedWorkspaceReceipts()
    .filter((receipt) => normalizeLiveHistoryText(receipt?.policyId) === pinned)
    .sort((left, right) => normalizeLiveHistoryTimestamp(right?.createdAtMs) - normalizeLiveHistoryTimestamp(left?.createdAtMs));
}

function getReceiptsForPolicyRunFromWorkspace(policyId, scenarioId = getCurrentReadoutScenarioId()) {
  const pinnedScenario = normalizeLiveHistoryText(scenarioId);
  const receipts = getReceiptsForPolicyFromWorkspace(policyId);
  if (!pinnedScenario) return receipts;
  return receipts.filter((receipt) => {
    const receiptScenario = normalizeLiveHistoryText(receipt?.sourceScenarioId);
    return receiptScenario === pinnedScenario;
  });
}

function getLivePolicyRecord(policyId) {
  const pinned = normalizeLiveHistoryText(policyId);
  if (!pinned) return null;
  return getMergedWorkspacePolicies().find((entry) => normalizeLiveHistoryText(entry?.id) === pinned)
    || (appState.current?.onChainPolicy?.id === pinned ? appState.current.onChainPolicy : null);
}

function bindRoutePolicyContext(policyId, {
  policy = null,
  adoptDraft = false,
  runId = "",
} = {}) {
  const pinned = normalizeLiveHistoryText(policyId);
  if (!pinned) return false;

  const livePolicy = policy || getLivePolicyRecord(pinned);
  if (!livePolicy?.id) return false;

  const preferredRunId = normalizeLiveHistoryText(runId);
  const latestReceipt = getReceiptsForPolicyRunFromWorkspace(pinned, preferredRunId)[0] || null;
  const snapshot = findLatestModeledSnapshotForPolicy(pinned, {
    preferredRunId,
    allowUnboundPreferredCurrent: false,
  });

  if (snapshot?.draft && snapshot?.report) {
    appState.current = {
      sourceScenarioId: snapshot.sourceScenarioId || "",
      draft: clone(snapshot.draft),
      input: buildSimulationInput(snapshot.draft),
      report: clone(snapshot.report),
      marketBand: isPlainObject(snapshot.marketBand) ? clone(snapshot.marketBand) : null,
      judge: isPlainObject(snapshot.judge) ? clone(snapshot.judge) : null,
      operatorReview: buildOperatorReview(snapshot.draft, snapshot.report),
      onChainPolicy: clone(livePolicy),
      onChainReceipt: latestReceipt ? clone(latestReceipt) : null,
    };
    if (adoptDraft) {
      appState.draft = clone(snapshot.draft);
      saveStorage(STORAGE_DRAFT_KEY, appState.draft);
    }
    persistCurrentState();
    attachPolicyToSavedScenario(snapshot.sourceScenarioId, livePolicy, latestReceipt);
    return true;
  }

  if (preferredRunId) {
    return false;
  }

  const policyDraft = normalizeDraftForAlpha(buildDraftFromPolicyObject(livePolicy, {
    ...DEFAULT_DRAFT,
    ...(appState.draft || {}),
  }));

  if (adoptDraft || currentPage === "live") {
    appState.draft = policyDraft;
    saveStorage(STORAGE_DRAFT_KEY, appState.draft);
  }

  if (currentPage === "live" || currentPage === "results") {
    appState.current = {
      draft: clone(policyDraft),
      onChainPolicy: clone(livePolicy),
      onChainReceipt: latestReceipt ? clone(latestReceipt) : null,
    };
    persistCurrentState();
    return true;
  }

  if (currentPage === "setup" && livePolicy?.id) {
    appState.current = {
      draft: clone(policyDraft),
      input: buildSimulationInput(policyDraft),
      report: null,
      marketBand: null,
      judge: null,
      operatorReview: null,
      onChainPolicy: clone(livePolicy),
      onChainReceipt: latestReceipt ? clone(latestReceipt) : null,
    };
    appState.draft = clone(policyDraft);
    appState.activeDraftId = "";
    saveStorage(STORAGE_DRAFT_KEY, appState.draft);
    saveStorage(STORAGE_ACTIVE_DRAFT_KEY, "");
    persistCurrentState();
    return true;
  }

  const currentPolicyId = normalizeLiveHistoryText(appState.current?.onChainPolicy?.id);
  if (appState.current && (currentPolicyId === pinned || adoptDraft)) {
    appState.current.onChainPolicy = clone(livePolicy);
    appState.current.onChainReceipt = latestReceipt ? clone(latestReceipt) : null;
    persistCurrentState();
    return true;
  }

  return false;
}

async function ensurePolicyOnlyReadoutRun(policyId = readRoutePolicyIdFromUrl()) {
  const pinned = normalizeLiveHistoryText(policyId);
  if (!pinned || readRouteRunIdFromUrl() || (currentPage !== "results" && currentPage !== "live")) {
    return null;
  }
  const currentPolicyId = normalizeLiveHistoryText(appState.current?.onChainPolicy?.id);
  if (currentPolicyId !== pinned || !appState.current?.draft || appState.current?.report) {
    return appState.current || null;
  }
  return runSimulation(appState.current.draft, {
    silent: true,
    preserveJudgeMode: true,
  });
}

async function refreshLiveProtocolPosture(policyId, source = "workspace", { silent = false } = {}) {
  const pinned = normalizeLiveHistoryText(policyId);
  const walletAddress = normalizeWalletAddress();
  if (!pinned) {
    if (!silent) setStatus("Pick a live policy first.", true);
    return;
  }
  if (!walletAddress) {
    if (!silent) setStatus("Connect a wallet first to refresh protocol posture.", true);
    return;
  }

  const policy = getLivePolicyRecord(pinned);
  if (!policy) {
    if (!silent) setStatus("Pick a live policy first.", true);
    return;
  }

  const currentState = getLiveProtocolRefreshState(_liveProtocolRefreshState, pinned, walletAddress);
  if (currentState.pending) {
    return;
  }
  const requestedAt = Date.now();

  setLiveProtocolRefreshState(pinned, {
    pending: true,
    lastRequestedAt: requestedAt,
    lastSettledAt: currentState.lastSettledAt,
  }, walletAddress);
  scheduleRender();

  try {
    const posture = await fetchLiveProtocolReadback({
      railId: policy?.selectedRail || "",
      walletAddress,
      network: getSuiNetwork(getRuntimeConfig()),
    });
    setCachedLiveProtocolReadback(pinned, posture, walletAddress);
    setLiveProtocolRefreshState(pinned, {
      pending: false,
      lastRequestedAt: requestedAt,
      lastSettledAt: Date.now(),
    }, walletAddress);
    renderCurrentPage();
    if (!silent) {
      setStatus(`${posture.railLabel || "Rail"} posture refreshed. ${posture.copy}`);
    }
    trackEvent("live_protocol_readback_refreshed", {
      source,
      railId: posture.railId || policy?.selectedRail || "unknown",
      status: posture.status || "unknown",
      refreshable: posture.refreshable === true,
    });
  } catch (error) {
    setLiveProtocolRefreshState(pinned, {
      pending: false,
      lastRequestedAt: requestedAt,
      lastSettledAt: Date.now(),
    }, walletAddress);
    scheduleRender();
    if (!silent) {
      setStatus(error instanceof Error ? error.message : "Protocol posture refresh failed.", true);
    }
    if (!silent) {
      reportClientError(error, { action: "refreshLiveProtocolPosture", policyId: pinned });
    }
  }
}

function getPolicyWalletTxHistory(policyId, address = normalizeWalletAddress()) {
  const pinned = normalizeLiveHistoryText(policyId);
  if (!pinned || !address) return [];
  return loadTxHistory(address)
    .filter((entry) => normalizeLiveHistoryText(entry?.policyId) === pinned)
    .sort((left, right) => normalizeLiveHistoryTimestamp(right?.timestamp) - normalizeLiveHistoryTimestamp(left?.timestamp));
}

function getPolicyRunWalletTxHistory(policyId, scenarioId = readRouteScenarioIdFromUrl(), address = normalizeWalletAddress()) {
  const pinnedScenario = normalizeLiveHistoryText(scenarioId);
  const history = getPolicyWalletTxHistory(policyId, address);
  if (!pinnedScenario) return history;
  return history.filter((entry) => normalizeLiveHistoryText(entry?.sourceScenarioId) === pinnedScenario);
}

function getCurrentReadoutScenarioId(current = appState.current) {
  return normalizeLiveHistoryText(current?.sourceScenarioId || readRouteScenarioIdFromUrl());
}


function getOpsHealthUrl() {
  return getOpsApiUrl("/v1/healthz");
}

function getOpsApiUrl(pathname) {
  const base = resolveOpsBaseUrl(getRuntimeConfig(), window.location.origin).replace(/\/+$/, "");
  return /^https?:\/\//i.test(base) ? `${base}${pathname}` : pathname;
}

async function refreshLatestProofReceipt({ silent = false } = {}) {
  const url = getOpsApiUrl("/v1/onchain/last-receipt");
  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) {
      throw new Error(`${url} returned ${response.status}`);
    }
    const payload = await response.json();
    const objectId = String(payload?.lastReceiptId || payload?.receiptId || payload?.objectId || "").trim();
    if (payload?.configured === true && payload?.ok === true && /^0x[0-9a-fA-F]{64}$/.test(objectId)) {
      appState.latestProofReceipt = {
        objectId,
        decisionType: typeof payload.lastDecisionType === "string" ? payload.lastDecisionType : "",
        selectedRail: typeof payload.selectedRail === "string" ? payload.selectedRail : "",
        createdAtMs: Number(payload.lastReceiptCreatedAtMs) || 0,
        source: "ops-last-receipt",
      };
      return appState.latestProofReceipt;
    }
    appState.latestProofReceipt = null;
  } catch (error) {
    if (!silent) {
      setStatus("Latest receipt lookup failed.", true);
      reportClientError(error, { action: "refreshLatestProofReceipt" });
    }
  }
  return null;
}

async function refreshOpsHealth({ silent = false } = {}) {
  if (appState.opsHealth.status === "loading") return;
  appState.opsHealth = {
    ...appState.opsHealth,
    status: "loading",
    error: "",
  };
  scheduleRender();

  try {
    const response = await fetch(getOpsHealthUrl(), {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) {
      throw new Error(`/v1/healthz returned ${response.status}`);
    }
    const payload = await response.json();
    appState.opsHealth = {
      status: "loaded",
      payload,
      error: "",
      fetchedAt: Date.now(),
    };
    const posture = buildOpsHealthPosture(appState.opsHealth);
    if (!silent) setStatus(posture.copy);
    trackEvent("ops_health_refreshed", {
      status: posture.status,
      healthy: posture.healthy === true,
      packSigner: payload?.checks?.packSigner === true,
      livePack: payload?.checks?.livePack === true,
    });
  } catch (error) {
    appState.opsHealth = {
      status: "error",
      payload: null,
      error: error instanceof Error ? error.message : String(error),
      fetchedAt: Date.now(),
    };
    if (!silent) {
      setStatus(appState.opsHealth.error || "Ops health check failed.", true);
      reportClientError(error, { action: "refreshOpsHealth" });
    }
  } finally {
    scheduleRender();
  }
}


function buildLiveActivityEvents(policy, receipts = [], txHistory = [], controlState = null, unwindProgress = null) {
  const cfg = getRuntimeConfig();
  const events = [];
  const txHistoryList = Array.isArray(txHistory) ? txHistory : [];
  const policyId = normalizeLiveHistoryText(policy?.id);
  const policyTxDigest = normalizeLiveHistoryText(policy?.txDigest);
  const selectedPolicyRail = getRailDisplay(policy?.selectedRail) || normalizeLiveHistoryText(policy?.selectedRail);
  const hasAnchorWalletTx = txHistoryList.some((entry) => {
    const entryPolicyId = normalizeLiveHistoryText(entry?.policyId);
    return normalizeLiveHistoryText(entry?.action) === "policy.anchor"
      && (!policyId || !entryPolicyId || entryPolicyId === policyId);
  });

  if (policyId && !hasAnchorWalletTx) {
    const createdAt = normalizeLiveHistoryTimestamp(policy?.createdAtMs || policy?.updatedAtMs);
    events.push({
      kind: "policy",
      tone: "wallet",
      title: "Policy saved on-chain",
      badge: "Policy",
      meta: ["On-chain policy", selectedPolicyRail, createdAt ? dateTimeFormatter.format(new Date(createdAt)) : ""].filter(Boolean).join(" · "),
      href: policyTxDigest
        ? buildSuiExplorerUrl("tx", policyTxDigest, cfg)
        : buildSuiExplorerUrl("object", policyId, cfg),
      linkLabel: policyTxDigest ? shortenMiddle(policyTxDigest, 6, 4) : shortenMiddle(policyId, 6, 4),
      ts: createdAt,
    });
  }

  for (const receipt of Array.isArray(receipts) ? receipts : []) {
    const rail = getRailDisplay(receipt?.selectedRail) || normalizeLiveHistoryText(receipt?.selectedRail, "Unknown rail");
    const createdAt = normalizeLiveHistoryTimestamp(receipt?.createdAtMs);
    events.push({
      kind: "receipt",
      tone: "receipt",
      title: formatLiveActivityLabel(receipt?.action, "Receipt minted"),
      badge: "Receipt",
      meta: [rail, `v${Number(receipt?.policyVersion) || 1}`, createdAt ? dateTimeFormatter.format(new Date(createdAt)) : ""].filter(Boolean).join(" · "),
      href: receipt?.id ? buildSuiExplorerUrl("object", receipt.id, cfg) : "",
      linkLabel: receipt?.id ? shortenMiddle(receipt.id, 6, 4) : "",
      ts: createdAt,
    });
  }

  for (const entry of txHistoryList) {
    const txId = normalizeLiveHistoryText(entry?.txId);
    const selectedRail = getRailDisplay(entry?.selectedRail) || normalizeLiveHistoryText(entry?.selectedRail);
    const timestamp = normalizeLiveHistoryTimestamp(entry?.timestamp);
    const meta = [
      entry?.ok === false ? "Failed tx" : "Wallet tx",
      normalizeLiveHistoryText(entry?.protocol),
      selectedRail,
      timestamp ? dateTimeFormatter.format(new Date(timestamp)) : "",
    ].filter(Boolean).join(" · ");
    events.push({
      kind: "wallet",
      tone: entry?.ok === false ? "danger" : "wallet",
      title: formatLiveActivityLabel(entry?.description || entry?.action, entry?.ok === false ? "Failed tx" : "Wallet tx"),
      badge: entry?.ok === false ? "Failed tx" : "Wallet tx",
      meta,
      href: txId ? buildSuiExplorerUrl("tx", txId, cfg) : "",
      linkLabel: txId ? shortenMiddle(txId, 6, 4) : "",
      linkKind: txId ? "tx" : "",
      linkValue: txId,
      ts: timestamp,
    });
  }

  const controlHistory = Array.isArray(controlState?.history) ? controlState.history : [];
  for (const entry of controlHistory) {
    const mode = normalizeLiveHistoryText(entry?.mode, "active");
    const meta = getLiveControlMeta(mode);
    const timestamp = normalizeLiveHistoryTimestamp(entry?.timestamp);
    events.push({
      kind: "control",
      tone: meta.tone,
      title: meta.eventTitle,
      badge: meta.eventBadge,
      meta: [
        "Local operator state",
        normalizeLiveHistoryText(entry?.source, "workspace"),
        timestamp ? dateTimeFormatter.format(new Date(timestamp)) : "",
      ].filter(Boolean).join(" · "),
      detail: normalizeLiveHistoryText(entry?.note),
      href: "",
      linkLabel: "",
      ts: timestamp,
    });
  }

  const progressCompleted = unwindProgress?.completed && typeof unwindProgress.completed === "object"
    ? unwindProgress.completed
    : {};
  for (const [stepId, timestampRaw] of Object.entries(progressCompleted)) {
    const timestamp = normalizeLiveHistoryTimestamp(timestampRaw);
    if (!(timestamp > 0)) continue;
    const label = normalizeLiveHistoryText(stepId, "checklist step").replace(/[._-]+/g, " ");
    events.push({
      kind: "checklist",
      tone: "control",
      title: `Exit checklist: ${formatLiveActivityLabel(label)}`,
      badge: "Checklist",
      meta: ["Local operator state", dateTimeFormatter.format(new Date(timestamp))].join(" · "),
      detail: "Marked complete in the manual exit checklist.",
      href: "",
      linkLabel: "",
      ts: timestamp,
    });
  }

  return events
    .sort((left, right) => right.ts - left.ts)
    .slice(0, 8);
}

function formatActivityLedgerTime(ts) {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    const today = new Date();
    const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
    return sameDay
      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString([], { month: "short", day: "2-digit" }) + " · " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch (_) {
    return "—";
  }
}

function renderActivityLedgerRows(events = []) {
  return events.map((event) => `
    <li class="tx-row tx-row--${escapeHtml(event.tone)}">
      <span class="tx-row__time">${escapeHtml(formatActivityLedgerTime(event.ts))}</span>
      <span class="tx-row__kind tx-row__kind--${escapeHtml(event.tone)}">${escapeHtml(event.badge)}</span>
      <div class="tx-row__body">
        <strong>${escapeHtml(event.title)}</strong>
        <span>${escapeHtml(event.detail || event.meta || "")}</span>
      </div>
      ${event.href && event.linkKind === "tx" && event.linkValue
        ? `<span class="tx-row__link tx-row__link--hash"><a href="${escapeHtml(event.href)}" target="_blank" rel="noopener">Open ↗</a>${renderProofTimelineHash({ kind: "tx", value: event.linkLabel || shortenMiddle(event.linkValue, 6, 4), rawValue: event.linkValue })}</span>`
        : event.href
        ? `<a class="tx-row__link" href="${escapeHtml(event.href)}" target="_blank" rel="noopener">${escapeHtml(event.linkLabel || "Open")} ↗</a>`
        : `<span class="tx-row__link tx-row__link--quiet">—</span>`}
    </li>
  `).join("");
}

function isOnChainActivityEvent(event) {
  return event?.kind === "policy" || event?.kind === "receipt" || event?.kind === "wallet";
}

function getActivityLedgerFilter() {
  return appState.activityLedgerFilter === "onchain" ? "onchain" : "all";
}

function filterActivityLedgerEvents(events = [], filter = getActivityLedgerFilter()) {
  const list = Array.isArray(events) ? events : [];
  return filter === "onchain" ? list.filter(isOnChainActivityEvent) : list;
}

function renderActivityLedgerFilter(filter, totalCount = 0, onChainCount = 0) {
  const active = filter === "onchain" ? "onchain" : "all";
  const option = (key, label, count) => `
    <button
      type="button"
      class="segmented__option"
      data-action="activity-ledger-filter"
      data-filter="${escapeHtml(key)}"
      aria-pressed="${active === key ? "true" : "false"}"
    >${escapeHtml(label)} <span class="activity-ledger-filter__count">${Number(count) || 0}</span></button>
  `;
  return `
    <div class="activity-ledger-controls">
      <div class="segmented activity-ledger-filter" role="group" aria-label="Activity ledger filter">
        ${option("all", "All", totalCount)}
        ${option("onchain", "On-chain", onChainCount)}
      </div>
    </div>
  `;
}


function renderLiveControlPanel(policy, { includeReadoutLink = false } = {}) {
  const policyId = encodeURIComponent(policy?.id || "");
  const hasPolicyId = Boolean(policy?.id);
  const controlState = getPolicyLocalControlState(policy?.id || "");
  const unwindProgress = getPolicyLocalUnwindProgress(policy?.id || "");
  const exitEvidence = buildLiveExitEvidence({
    receipts: getReceiptsForPolicyFromWorkspace(policy?.id || ""),
    controlState,
    unwindProgress,
  });
  const lifecycle = buildLivePolicyStatus({
    policy,
    controlState,
    unwindProgress,
    receipts: getReceiptsForPolicyFromWorkspace(policy?.id || ""),
    exitEvidence,
  });
  const meta = getLiveControlMeta(controlState.mode);
  const controlBadgeTone = meta.tone === "pause" ? "amber" : controlState.mode === "unwound" ? "" : "violet";
  const controlBadgeIcon = meta.tone === "pause" ? "alert-triangle" : controlState.mode === "unwound" ? "check" : "settings";
  const controlDisabledReason = (mode) => {
    if (!hasPolicyId) return "Load an on-chain policy to use local review controls.";
    if (controlState.mode === mode) return `${getLiveControlMeta(mode).label} is already selected.`;
    if (mode === "unwound" && !lifecycle.canMarkUnwound) {
      return exitEvidence.copy || "Complete all local exit checklist steps before marking this policy closed locally.";
    }
    return "";
  };
  const renderControlButton = (mode, label) => {
    const reason = controlDisabledReason(mode);
    const id = `live-control-${mode}-reason`;
    return `<button class="button button-secondary" type="button" data-action="live-control" data-policy-id="${escapeHtml(policy?.id || "")}" data-control-mode="${escapeHtml(mode)}"${reason ? ` disabled aria-describedby="${escapeHtml(id)}"` : ""}>${escapeHtml(label)}</button>${reason ? `<span id="${escapeHtml(id)}" class="sr-only">${escapeHtml(reason)}</span>` : ""}`;
  };
  return `
    <section class="ws-live-panel ws-live-panel--compact">
      <div class="ws-live-panel__head">
        <div>
          <span>Review mode</span>
          <strong>${escapeHtml(meta.label)}</strong>
        </div>
        ${renderIconBadge(meta.badge, { tone: controlBadgeTone, iconName: controlBadgeIcon, title: meta.status })}
      </div>
      <p class="ws-live-panel__copy">${escapeHtml(meta.copy)} Manual actions stay in the rail UI; TIDE records review state and verifies proof evidence without signing mainnet transactions.</p>
      <div class="ws-live-control-group">
        <span class="ws-live-control-label">Review state</span>
        <div class="ws-live-control-actions" role="group" aria-label="Local live control state">
          ${renderControlButton("active", "Resume review")}
          ${renderControlButton("paused", "Pause approvals")}
          ${renderControlButton("unwind-planned", "Plan exit")}
          ${renderControlButton("unwound", "Mark closed locally")}
        </div>
      </div>
      ${hasPolicyId && !lifecycle.canMarkUnwound
        ? `<p class="ws-live-panel__note">${escapeHtml(exitEvidence.copy || "Finish all local exit checklist steps before marking this policy closed locally.")}</p>`
        : ""}
      <div class="ws-live-handoff">
        <span class="ws-live-control-label">Exit handoff</span>
        <div class="ws-live-actions" role="group" aria-label="Exit handoff actions">
          <a class="button button-secondary" href="/setup${policyId ? `?policy=${policyId}` : ""}">Open in Create</a>
          ${includeReadoutLink ? `<a class="button button-secondary" href="${escapeHtml(buildLivePolicyHref(policy?.id || ""))}">Review readout</a>` : ""}
          <button class="button button-secondary" type="button" data-action="mint-live-receipt" data-receipt-mode="testnet" data-policy-id="${escapeHtml(policy?.id || "")}"${hasPolicyId ? "" : " disabled aria-describedby=\"mint-live-receipt-reason\""}>Mint testnet receipt</button>${hasPolicyId ? "" : `<span id="mint-live-receipt-reason" class="sr-only">Load an on-chain policy before minting a receipt.</span>`}
        </div>
      </div>
    </section>
  `;
}

function renderLiveUnwindPanel(policy, snapshot = null, receipts = [], txHistory = [], controlState = null, unwindProgress = null) {
  const exitEvidence = buildLiveExitEvidence({
    receipts,
    controlState,
    unwindProgress,
  });
  const brief = buildLiveUnwindBrief({
    policy,
    snapshot,
    receipts,
    txHistory,
    controlState,
    unwindProgress,
    exitEvidence,
  });
  const policyId = normalizeLiveHistoryText(policy?.id);
  const mainnetEvidence = getPolicyLiveMainnetEvidence(policyId);
  const mainnetEvidenceVerified = mainnetEvidence.status === "verified";
  const mainnetEvidenceDigest = normalizeLiveHistoryText(mainnetEvidence.digest);
  const mainnetPreReadback = normalizeMainnetReadbackForBundle(mainnetEvidence.preReadback);
  const mainnetPreSnapshotCopy = mainnetPreReadback
    ? `Pre-action snapshot saved at ${dateTimeFormatter.format(new Date(mainnetPreReadback.observedAt))}`
    : "Save a Suilend snapshot before taking the manual action.";
  const mainnetEvidenceLink = mainnetEvidenceDigest
    ? buildSuiExplorerUrl("tx", mainnetEvidenceDigest, { sui: { network: "mainnet" } })
    : "";
  const mainnetEvidenceStatus = mainnetEvidenceVerified
    ? `Verified Suilend repayment${mainnetEvidence.checkpoint ? ` at checkpoint ${mainnetEvidence.checkpoint}` : ""}`
    : mainnetEvidence.status === "error" && mainnetEvidence.error
      ? mainnetEvidence.error
      : "Waiting for the mainnet action digest";
  const mainnetEvidenceTone = mainnetEvidenceVerified
    ? "success"
    : mainnetEvidence.status === "error"
      ? "error"
      : "neutral";
  const mainnetReceiptReadiness = getLiveMainnetReceiptReadiness(policyId);
  const finalReceiptUnlocked = mainnetReceiptReadiness.ok;
  const finalReceiptBlocker = policyId ? mainnetReceiptReadiness.message : "Load an on-chain policy before minting a final receipt.";
  const finalReceiptReasonId = `live-final-receipt-reason-${policyId || "policy"}`;
  const progressSummary = getLiveUnwindProgressSummary(unwindProgress);
  const completedSteps = brief.unwindProgress?.completed && typeof brief.unwindProgress.completed === "object"
    ? brief.unwindProgress.completed
    : {};
  const nextChecklistStep = brief.steps.find((step) => Number(completedSteps?.[step.id] || 0) <= 0);
  const needsFinalReceipt = progressSummary.allDone && !exitEvidence.hasFreshReceipt;
  const nextActionTitle = nextChecklistStep
    ? nextChecklistStep.title
    : needsFinalReceipt
      ? "Mint the final receipt"
      : "Exit evidence sealed";
  const nextActionCopy = nextChecklistStep
    ? nextChecklistStep.copy
    : exitEvidence.copy;
  const nextActionLabel = nextChecklistStep
    ? "Next checklist step"
    : needsFinalReceipt
      ? "Next proof step"
      : "Exit status";
  const evidenceTone = exitEvidence.tone === "success" ? "mint" : exitEvidence.tone === "warning" ? "amber" : "";

  return `
    <section id="live-monitor" class="ws-live-panel">
      <div class="ws-exit-brief-head">
        <div>
          <span>Proof package</span>
          <strong>Suilend evidence flow</strong>
          <p>Save a before snapshot, act in Suilend, paste the transaction digest, then refresh the position before minting the final receipt.</p>
        </div>
        ${renderIconBadge("Guided", { tone: "violet", iconName: "settings" })}
      </div>
      <div class="ws-exit-brief-grid">
        <div class="ws-exit-next" data-tone="${needsFinalReceipt ? "amber" : exitEvidence.hasFreshReceipt ? "success" : "neutral"}">
          <span>${escapeHtml(nextActionLabel)}</span>
          <strong>${escapeHtml(nextActionTitle)}</strong>
          <p>${escapeHtml(nextActionCopy)}</p>
        </div>
        <div class="ws-exit-verify" aria-label="Amounts to verify before signing">
          <div>
            <span>Verify in ${escapeHtml(brief.railLabel)}</span>
            <strong>${formatCompactUsd(brief.modeledSnapshot.debtUsd)}</strong>
            <p>Modeled debt to clear</p>
          </div>
          <div>
            <span>Then free</span>
            <strong>${formatBtcAmount(brief.modeledSnapshot.collateralUnits)} ${escapeHtml(brief.modeledSnapshot.collateralSymbol)}</strong>
            <p>${brief.modeledSnapshot.collateralUsd > 0 ? `${formatCompactUsd(brief.modeledSnapshot.collateralUsd)} modeled value` : "No modeled collateral value yet"}</p>
          </div>
          <div>
            <span>Evidence</span>
            <strong>${escapeHtml(exitEvidence.label)}</strong>
            <p>${escapeHtml(progressSummary.allDone ? `${progressSummary.done}/${progressSummary.total} checklist done` : `${progressSummary.done}/${progressSummary.total} checklist progress`)}</p>
          </div>
        </div>
      </div>
      <div class="ws-exit-boundary">
        ${renderIconBadge("Manual rail close", { tone: "cyan", iconName: "anchor" })}
        <p>${escapeHtml(brief.warnings.join(" "))}</p>
      </div>
      <div class="ws-exit-mainnet-evidence" data-state="${escapeHtml(mainnetEvidenceTone)}">
        <div class="ws-exit-mainnet-evidence__copy">
          <span>Mainnet action evidence</span>
          <strong>${escapeHtml(mainnetEvidenceVerified ? "Verified Suilend repayment" : "Paste transaction digest")}</strong>
          <p>1 save the before snapshot, 2 repay in Suilend, 3 paste the tx digest, 4 refresh the Suilend position, 5 mint the proof receipt.</p>
        </div>
        <div class="ws-exit-mainnet-evidence__form">
          <button class="button button-secondary" type="button" data-action="capture-live-mainnet-pre" data-policy-id="${escapeHtml(policyId)}"${policyId ? "" : " disabled"}>1 Save before snapshot</button>
          <label class="sr-only" for="live-mainnet-tx-${escapeHtml(policyId || "policy")}">Mainnet transaction digest</label>
          <input
            id="live-mainnet-tx-${escapeHtml(policyId || "policy")}"
            class="input"
            type="text"
            inputmode="text"
            autocomplete="off"
            spellcheck="false"
            placeholder="Mainnet tx digest"
            value="${escapeHtml(mainnetEvidenceDigest)}"
            data-live-mainnet-digest
            data-policy-id="${escapeHtml(policyId)}"
            ${policyId ? "" : "disabled"}
          />
          <button class="button button-secondary" type="button" data-action="verify-live-mainnet-tx" data-policy-id="${escapeHtml(policyId)}"${policyId ? "" : " disabled"}>3 Verify tx</button>
          <button class="button button-secondary" type="button" data-action="refresh-live-protocol" data-policy-id="${escapeHtml(policyId)}"${policyId ? "" : " disabled"}>4 Refresh after snapshot</button>
        </div>
        <p class="ws-exit-mainnet-evidence__status">
          <span>${escapeHtml(mainnetPreSnapshotCopy)}</span>
          ${mainnetEvidenceVerified ? "✓ " : mainnetEvidence.status === "error" ? "Check failed: " : ""}
          ${escapeHtml(mainnetEvidenceStatus)}
          ${mainnetEvidenceVerified && !finalReceiptUnlocked ? `<span>${escapeHtml(finalReceiptBlocker)}</span>` : ""}
          ${mainnetEvidenceLink ? `<a href="${escapeHtml(mainnetEvidenceLink)}" target="_blank" rel="noopener">Open tx ↗</a>` : ""}
        </p>
      </div>
      <div class="ws-exit-checklist-head">
        <div>
          <span>Exit checklist</span>
          <strong>${progressSummary.done}/${progressSummary.total} complete</strong>
        </div>
        ${renderIconBadge(exitEvidence.badge || exitEvidence.label, { tone: evidenceTone, iconName: exitEvidence.hasFreshReceipt ? "check" : "alert-triangle" })}
      </div>
      <div class="ws-live-step-list ws-live-step-list--exit">
        ${brief.steps.map((step, index) => {
          const doneAt = Number(brief.unwindProgress?.completed?.[step.id] || 0);
          return `
          <div class="ws-live-step ws-live-step--checklist${doneAt > 0 ? " is-complete" : ""}">
            <div class="ws-live-step__main">
              <span class="ws-live-step__index">${index + 1}</span>
              <div>
                <strong>${escapeHtml(step.title)}</strong>
                <span>${escapeHtml(step.copy)}</span>
              </div>
            </div>
            <div class="ws-live-step__actions">
              <button class="button button-secondary" type="button" data-action="toggle-live-unwind-step" data-policy-id="${escapeHtml(policyId)}" data-step-id="${escapeHtml(step.id)}" data-step-complete="${doneAt > 0 ? "false" : "true"}"${policyId ? "" : " disabled"}>${doneAt > 0 ? "Mark pending" : "Mark complete"}</button>
              <span class="ws-live-step__status">${doneAt > 0 ? `Completed ${escapeHtml(dateTimeFormatter.format(new Date(doneAt)))}` : "Pending"}</span>
            </div>
          </div>
        `;}).join("")}
      </div>
      <div class="ws-exit-actions">
        <div class="ws-exit-actions__primary">
          ${policyId ? `<button class="button button-secondary" type="button" data-action="live-control" data-policy-id="${escapeHtml(policyId)}" data-control-mode="unwind-planned"${controlState?.mode === "unwind-planned" ? " disabled" : ""}>Set exit planned</button>` : ""}
          <button class="button button-primary" type="button" data-action="mint-live-receipt" data-receipt-mode="mainnet-readonly" data-policy-id="${escapeHtml(policyId)}"${finalReceiptUnlocked ? "" : ` disabled aria-describedby="${escapeHtml(finalReceiptReasonId)}"`} title="${escapeHtml(finalReceiptBlocker)}">5 Mint final receipt</button>
          ${finalReceiptUnlocked ? "" : `<p class="ws-exit-actions__reason" id="${escapeHtml(finalReceiptReasonId)}">${escapeHtml(finalReceiptBlocker)}</p>`}
        </div>
        <div class="ws-exit-actions__secondary">
          <button class="button button-secondary" type="button" data-action="export-live-unwind" data-policy-id="${escapeHtml(policyId)}"${policyId ? "" : " disabled"}>Export brief</button>
          <button class="button button-secondary" type="button" data-action="export-live-unwind-md" data-policy-id="${escapeHtml(policyId)}"${policyId ? "" : " disabled"}>Export markdown</button>
          ${brief.railLinks?.siteUrl ? `<a class="button button-secondary" href="${escapeHtml(brief.railLinks.siteUrl)}" target="_blank" rel="noopener">${escapeHtml(brief.railLinks.siteLabel)}</a>` : ""}
          ${brief.railLinks?.docsUrl ? `<a class="button button-secondary" href="${escapeHtml(brief.railLinks.docsUrl)}" target="_blank" rel="noopener">${escapeHtml(brief.railLinks.docsLabel)}</a>` : ""}
        </div>
      </div>
    </section>
  `;
}

function renderWorkspaceReceiptRow(receipt) {
  const cfg = getRuntimeConfig();
  const action = formatReceiptActionLabel(receipt.action || "receipt");
  const rail = getRailDisplay(receipt.selectedRail) || receipt.selectedRail || "—";
  const shortReceipt = receipt.id ? shortenMiddle(receipt.id, 6, 4) : "";
  const when = receipt.createdAtMs ? dateTimeFormatter.format(new Date(receipt.createdAtMs)) : "";
  const explorer = receipt.id ? buildSuiExplorerUrl("object", receipt.id, cfg) : "";
  const version = Number(receipt.policyVersion) || 0;

  return `
    <li class="ws-live-receipt">
      <div class="ws-live-receipt__main">
        <strong>${escapeHtml(action)}</strong>
        <span class="ws-live-receipt__sub">${escapeHtml(rail)} · v${version}${when ? ` · ${escapeHtml(when)}` : ""}</span>
      </div>
      ${shortReceipt ? `<a class="ws-live-receipt__link" href="${escapeHtml(explorer)}" target="_blank" rel="noopener">${escapeHtml(shortReceipt)} ↗</a>` : ""}
    </li>
  `;
}

function getWorkspaceScenarioMoment(record = {}) {
  const raw = record.updatedAt || record.createdAt || record.report?.generatedAt || "";
  const ts = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(ts) ? ts : 0;
}

function findLatestModeledSnapshotForPolicy(policyId, options = {}) {
  const pinnedPolicy = normalizeLiveHistoryText(policyId);
  if (!pinnedPolicy) return null;

  const preferredRunId = normalizeLiveHistoryText(options.preferredRunId || "");
  const allowUnboundPreferredCurrent = options.allowUnboundPreferredCurrent !== false;
  const candidates = [];

  const policyMatchesCandidate = (candidatePolicyId, {
    preferred = false,
    allowUnboundPreferred = false,
  } = {}) => {
    const normalized = normalizeLiveHistoryText(candidatePolicyId);
    if (normalized === pinnedPolicy) return true;
    return preferred && allowUnboundPreferred && !normalized;
  };

  const pushCandidate = ({ kind, label, sourceScenarioId, draft, report, marketBand, judge, moment }) => {
    if (!draft || !report) return;
    candidates.push({
      kind,
      label,
      sourceScenarioId: normalizeLiveHistoryText(sourceScenarioId || ""),
      draft,
      report,
      marketBand: isPlainObject(marketBand) ? marketBand : null,
      judge: isPlainObject(judge) ? judge : null,
      moment,
    });
  };

  const currentRunId = normalizeLiveHistoryText(appState.current?.sourceScenarioId || "");
  const currentPreferred = preferredRunId && currentRunId === preferredRunId;
  if (
    appState.current?.draft &&
    appState.current?.report &&
    policyMatchesCandidate(appState.current?.onChainPolicy?.id, {
      preferred: currentPreferred,
      allowUnboundPreferred: allowUnboundPreferredCurrent,
    })
  ) {
    pushCandidate({
      kind: "current",
      label: "Current run",
      sourceScenarioId: appState.current.sourceScenarioId || "",
      draft: appState.current.draft,
      report: appState.current.report,
      marketBand: appState.current.marketBand,
      judge: appState.current.judge,
      moment: getWorkspaceScenarioMoment(appState.current),
    });
  }

  for (const scenario of Array.isArray(appState.saved) ? appState.saved : []) {
    const scenarioId = normalizeLiveHistoryText(scenario?.id || "");
    const scenarioPreferred = preferredRunId && scenarioId === preferredRunId;
    if (!policyMatchesCandidate(scenario?.onChainPolicy?.id, { preferred: scenarioPreferred })) {
      continue;
    }
    pushCandidate({
      kind: "saved",
      label: "Saved run",
      sourceScenarioId: scenario.id || "",
      draft: scenario.draft,
      report: scenario.report,
      marketBand: scenario.marketBand,
      judge: scenario.judge,
      moment: getWorkspaceScenarioMoment(scenario),
    });
  }

  if (preferredRunId) {
    return candidates.find((candidate) => candidate.sourceScenarioId === preferredRunId) || null;
  }

  candidates.sort((left, right) => right.moment - left.moment);
  return candidates[0] || null;
}

function findModeledSnapshotByScenarioId(scenarioId) {
  const pinned = normalizeLiveHistoryText(scenarioId);
  if (!pinned) return null;

  if (appState.current?.sourceScenarioId === pinned && appState.current?.draft && appState.current?.report) {
    return {
      kind: "current",
      label: "Current run",
      sourceScenarioId: pinned,
      draft: appState.current.draft,
      report: appState.current.report,
      marketBand: isPlainObject(appState.current.marketBand) ? appState.current.marketBand : null,
      judge: isPlainObject(appState.current.judge) ? appState.current.judge : null,
      moment: getWorkspaceScenarioMoment(appState.current),
    };
  }

  const savedScenario = (Array.isArray(appState.saved) ? appState.saved : [])
    .find((scenario) => scenario?.id === pinned && scenario?.draft && scenario?.report);
  if (!savedScenario) return null;

  return {
    kind: "saved",
    label: "Saved run",
    sourceScenarioId: savedScenario.id || "",
    draft: savedScenario.draft,
    report: savedScenario.report,
    marketBand: isPlainObject(savedScenario.marketBand) ? savedScenario.marketBand : null,
    judge: isPlainObject(savedScenario.judge) ? savedScenario.judge : null,
    moment: getWorkspaceScenarioMoment(savedScenario),
  };
}

function attachPolicyToSavedScenario(scenarioId, livePolicy, latestReceipt = null) {
  const pinned = normalizeLiveHistoryText(scenarioId);
  const policyId = normalizeLiveHistoryText(livePolicy?.id);
  if (!pinned || !policyId || !Array.isArray(appState.saved)) return;

  let changed = false;
  appState.saved = appState.saved.map((scenario) => {
    if (scenario?.id !== pinned) return scenario;
    const next = {
      ...scenario,
      onChainPolicy: clone(livePolicy),
    };
    if (latestReceipt) {
      next.onChainReceipt = clone(latestReceipt);
    }
    changed = true;
    return next;
  });

  if (changed) {
    saveStorage(STORAGE_SAVED_KEY, appState.saved);
  }

  if (normalizeLiveHistoryText(appState.current?.sourceScenarioId) === pinned) {
    appState.current = {
      ...appState.current,
      onChainPolicy: clone(livePolicy),
      onChainReceipt: latestReceipt ? clone(latestReceipt) : appState.current?.onChainReceipt || null,
    };
    persistCurrentState();
    if (currentPage === "results" || currentPage === "live") {
      scheduleRender();
    }
  }
}

function persistCurrentPolicyBindingToSavedRun(latestReceipt = null) {
  if (!appState.current?.draft || !appState.current?.report || !appState.current?.onChainPolicy?.id) {
    persistCurrentState();
    return;
  }

  // Anchor/update happens against the current modeled run, but the Live URL is
  // keyed by the saved run id. Keep the saved record in sync before redirecting
  // so /live?policy=<policy>&id=<run> hydrates the same policy/run family.
  autoPersistRunToSavedList();
  if (appState.current.sourceScenarioId) {
    attachPolicyToSavedScenario(
      appState.current.sourceScenarioId,
      appState.current.onChainPolicy,
      latestReceipt,
    );
  }
  persistCurrentState();
}

function exportLivePolicyHistory(policyId) {
  const pinned = normalizeLiveHistoryText(policyId);
  if (!pinned) {
    setStatus("Pick a live policy first.", true);
    return;
  }

  const policy = getLivePolicyRecord(pinned);
  const receipts = getReceiptsForPolicyFromWorkspace(pinned);
  const txHistory = getPolicyWalletTxHistory(pinned);
  const controlState = getPolicyLocalControlState(pinned);
  const unwindProgress = getPolicyLocalUnwindProgress(pinned);
  const snapshot = findLatestModeledSnapshotForPolicy(pinned);
  const exitEvidence = buildLiveExitEvidence({
    receipts,
    controlState,
    unwindProgress,
  });

  downloadJsonArtifact({
    exportedAt: new Date().toISOString(),
    policy: policy || null,
    modeledSnapshot: snapshot
      ? {
          label: snapshot.label,
          moment: snapshot.moment ? new Date(snapshot.moment).toISOString() : "",
          draft: snapshot.draft,
          report: snapshot.report,
          judge: snapshot.judge || null,
        }
      : null,
    controlState,
    unwindProgress,
    exitEvidence,
    protocolReadback: getCachedLiveProtocolReadback(pinned),
    receipts,
    walletTxHistory: txHistory,
  }, `${policy?.name || "policy"}-${pinned.slice(0, 8)}-ledger`, "Exported live policy ledger JSON.");

  trackEvent("live_ledger_exported", {
    hasReceipts: receipts.length > 0,
    hasWalletTx: txHistory.length > 0,
    hasControlState: controlState.updatedAt > 0,
    hasUnwindProgress: unwindProgress.updatedAt > 0,
    hasSnapshot: Boolean(snapshot),
  });
}

function exportLiveUnwindBrief(policyId) {
  const pinned = normalizeLiveHistoryText(policyId);
  if (!pinned) {
    setStatus("Pick a live policy first.", true);
    return;
  }

  const policy = getLivePolicyRecord(pinned);
  const receipts = getReceiptsForPolicyFromWorkspace(pinned);
  const txHistory = getPolicyWalletTxHistory(pinned);
  const controlState = getPolicyLocalControlState(pinned);
  const unwindProgress = getPolicyLocalUnwindProgress(pinned);
  const snapshot = findLatestModeledSnapshotForPolicy(pinned);
  const exitEvidence = buildLiveExitEvidence({
    receipts,
    controlState,
    unwindProgress,
  });
  const brief = buildLiveUnwindBrief({
    policy,
    snapshot,
    receipts,
    txHistory,
    controlState,
    unwindProgress,
    exitEvidence,
  });

  downloadJsonArtifact({
    exportedAt: new Date().toISOString(),
    ...brief,
  }, `${policy?.name || "policy"}-${pinned.slice(0, 8)}-exit`, "Exported exit brief JSON.");

  trackEvent("live_unwind_brief_exported", {
    hasSnapshot: Boolean(snapshot),
    hasReceipts: receipts.length > 0,
    hasWalletTx: txHistory.length > 0,
    controlMode: controlState.mode || "active",
    checklistDone: getLiveUnwindProgressSummary(unwindProgress).done,
  });
}

function exportLiveUnwindMarkdown(policyId) {
  const pinned = normalizeLiveHistoryText(policyId);
  if (!pinned) {
    setStatus("Pick a live policy first.", true);
    return;
  }

  const policy = getLivePolicyRecord(pinned);
  const receipts = getReceiptsForPolicyFromWorkspace(pinned);
  const txHistory = getPolicyWalletTxHistory(pinned);
  const controlState = getPolicyLocalControlState(pinned);
  const unwindProgress = getPolicyLocalUnwindProgress(pinned);
  const snapshot = findLatestModeledSnapshotForPolicy(pinned);
  const exitEvidence = buildLiveExitEvidence({
    receipts,
    controlState,
    unwindProgress,
  });
  const brief = buildLiveUnwindBrief({
    policy,
    snapshot,
    receipts,
    txHistory,
    controlState,
    unwindProgress,
    exitEvidence,
  });

  downloadTextArtifact(
    renderLiveUnwindMarkdown(brief),
    `${policy?.name || "policy"}-${pinned.slice(0, 8)}-handoff`,
    "Exported exit handoff markdown."
  );

  trackEvent("live_unwind_markdown_exported", {
    hasSnapshot: Boolean(snapshot),
    hasReceipts: receipts.length > 0,
    hasWalletTx: txHistory.length > 0,
    controlMode: controlState.mode || "active",
    checklistDone: getLiveUnwindProgressSummary(unwindProgress).done,
  });
}

function renderWorkspacePolicyCard(policy, receipts) {
  const cfg = getRuntimeConfig();
  const name = policy.name || "Untitled policy";
  const mode = policy.mode || "—";
  const collateral = policy.collateralSymbol || "BTC";
  const rail = policy.selectedRail || "";
  const railLabel = getRailDisplay(rail) || rail || "—";
  const version = Number(policy.version) || 0;
  const targetLowPct = ((Number(policy.targetLtvLowBps) || 0) / 100).toFixed(1);
  const targetHighPct = ((Number(policy.targetLtvHighBps) || 0) / 100).toFixed(1);
  const shortId = policy.id ? shortenMiddle(policy.id, 8, 6) : "";
  const explorer = policy.id ? buildSuiExplorerUrl("object", policy.id, cfg) : "";
  const controlState = getPolicyLocalControlState(policy?.id || "");
  const unwindProgress = getPolicyLocalUnwindProgress(policy?.id || "");
  const snapshot = findLatestModeledSnapshotForPolicy(policy?.id || "");
  const snapshotDraft = snapshot?.draft || {};
  const stableSymbol = snapshotDraft?.stableAssetSymbol || "USDC";

  const allReceipts = Array.isArray(receipts) ? receipts : [];
  const ordered = allReceipts
    .slice()
    .sort((a, b) => (Number(b.createdAtMs) || 0) - (Number(a.createdAtMs) || 0));
  const exitEvidence = buildLiveExitEvidence({
    receipts: ordered,
    controlState,
    unwindProgress,
  });
  const lifecycle = buildLivePolicyStatus({
    policy,
    receipts: ordered,
    controlState,
    unwindProgress,
    snapshot,
    exitEvidence,
  });

  const lastWhen = ordered.length && ordered[0].createdAtMs
    ? dateTimeFormatter.format(new Date(ordered[0].createdAtMs))
    : "";
  const receiptMeta = ordered.length
    ? `${ordered.length} receipt${ordered.length === 1 ? "" : "s"}${lastWhen ? ` · last ${lastWhen}` : ""}`
    : "No receipts";
  const snapshotReport = snapshot?.report || null;
  const snapshotSummary = snapshotReport?.summary || null;
  const snapshotCollateralUsd = asNumber(snapshotDraft.btcUnits) * asNumber(snapshotDraft.btcPriceUsd);
  const snapshotDebtUsd = asNumber(snapshotDraft.debtUsd);
  const snapshotBufferUsd = asNumber(snapshotDraft.stableBufferUsd);
  const snapshotLtv = Number(snapshotSummary?.currentLtv);
  const snapshotHealth = Number(snapshotSummary?.averageHealthScore);
  const hasSnapshotCollateral = snapshotCollateralUsd > 0;
  const hasSnapshotDebt = snapshotDebtUsd > 0;
  const hasSnapshotLtv = Number.isFinite(snapshotLtv) && snapshotLtv > 0;
  const hasSnapshotHealth = Number.isFinite(snapshotHealth) && snapshotHealth > 0;

  const liveHref = buildLivePolicyHref(policy.id || "", { id: snapshot?.sourceScenarioId || "" });
  const readoutHref = buildLivePolicyHref(policy.id || "", { id: snapshot?.sourceScenarioId || "" });
  const setupHref = buildSetupHref(snapshot?.sourceScenarioId || "", { policy: policy.id || "" });

  // Render live policies as list rows under the aggregate cockpit. They
  // share the card grammar with drafts/sims, but stay lighter than the
  // portfolio aggregate so the first live object reads as a record, not
  // a second hero.
  return `
    <article class="ws-position-card surface" data-entry-type="live" data-policy-id="${escapeHtml(policy.id || "")}">
      <div class="ws-position-head">
        <div class="ws-position-title">
          <div class="ws-badge-row">
            ${renderIconBadge("On-chain policy · testnet", {
              tone: "mint",
              iconName: "link",
              title: "Policy saved on Sui testnet; values remain modeled unless marked as read-back.",
            })}
            ${renderIconBadge(lifecycle.badge, {
              tone: "cyan",
              iconName: "anchor",
              title: lifecycle.copy,
            })}
            ${(() => {
              // Phase D.7 — control-posture chip surfaced on the workspace
              // card itself so an operator scanning the list can spot
              // paused / exit-planned policies without opening Readout.
              // Hidden when posture is plain "active" since that's the
              // implicit default and would clutter every card.
              const ctrlMode = controlState?.mode || "active";
              if (ctrlMode === "active") return "";
              const ctrlMeta = getLiveControlMeta(ctrlMode);
              const tone = ctrlMode === "paused" ? "amber"
                : ctrlMode === "unwound" ? ""
                : "violet";
              const iconName = ctrlMode === "paused" ? "alert-triangle"
                : ctrlMode === "unwound" ? "check"
                : "settings";
              return renderIconBadge(ctrlMeta.badge, { tone, iconName, title: ctrlMeta.status });
            })()}
            ${shortId
              ? `<a class="ws-id-chip ws-id-chip--muted" href="${escapeHtml(explorer)}" target="_blank" rel="noopener" title="Policy on SuiVision">#${escapeHtml(shortenMiddle(policy.id || "", 4, 4))} ↗</a>`
              : ""}
          </div>
          <strong>${escapeHtml(name)}</strong>
        </div>
        <div class="ws-position-meta">
          <span class="state-badge">v${version} · ${escapeHtml(mode)}</span>
          <span class="ws-position-date">${escapeHtml(receiptMeta)}</span>
        </div>
      </div>

      <div class="ws-position-metrics">
        <div>
          <span class="ws-dash-label">Collateral</span>
          ${hasSnapshotCollateral
            ? `<strong>${formatUsd(snapshotCollateralUsd)}</strong>
              <span class="ws-dash-sub ws-dash-asset-line">
                <span class="ws-dash-asset-amount">${asNumber(snapshotDraft.btcUnits).toFixed(3)}</span>
                ${renderTokenSubline(collateral, collateral)}
              </span>`
            : `<strong>${renderTokenChip(collateral)}</strong>`}
        </div>
        <div>
          <span class="ws-dash-label">Debt</span>
          ${hasSnapshotDebt ? `<strong>${formatUsd(snapshotDebtUsd)}</strong>` : `<strong class="ws-dash-empty">—</strong>`}
          ${hasSnapshotDebt ? renderTokenSubline(stableSymbol, stableSymbol) : ""}
        </div>
        <div>
          <span class="ws-dash-label">Debt pressure</span>
          ${hasSnapshotLtv
            ? `<strong class="ws-dash-strong--cyan">${(snapshotLtv * 100).toFixed(1)}%</strong>`
            : `<strong class="ws-dash-empty">—</strong>`}
          <span class="ws-dash-sub">${targetLowPct}–${targetHighPct}% target band</span>
        </div>
        <div>
          <span class="ws-dash-label">Buffer</span>
          <strong>${formatUsd(snapshotBufferUsd > 0 ? snapshotBufferUsd : policy.minBufferUsd)}</strong>
          ${renderTokenSubline(stableSymbol, stableSymbol)}
        </div>
        <div>
          <span class="ws-dash-label">Health</span>
          ${hasSnapshotHealth ? `<strong>${Math.round(snapshotHealth)}/100</strong>` : `<strong class="ws-dash-empty">—</strong>`}
        </div>
        <div>
          <span class="ws-dash-label">Payout floor</span>
          <strong class="ws-dash-strong--mint">${formatUsd(policy.payoutTargetUsd)}</strong>
          ${renderTokenSubline(stableSymbol, stableSymbol)}
        </div>
        <div>
          <span class="ws-dash-label">Route</span>
          ${railLabel && railLabel !== "—"
            ? `<strong class="ws-dash-protocol">${renderProtocolInline(railLabel, "", "sm")}</strong>`
            : `<strong class="ws-dash-empty">—</strong>`}
        </div>
      </div>

      <div class="ws-position-actions">
        <a class="button button-primary" href="${liveHref}">Open monitor</a>
        <a class="button button-secondary" href="${escapeHtml(buildLivePolicyHref(policy.id || "", { id: snapshot?.sourceScenarioId || "", hash: "live-monitor" }))}" title="Plan the exit: checklist, handoff doc, and final receipt.">Plan exit</a>
        <a class="button button-secondary" href="${escapeHtml(readoutHref)}">Readout</a>
        <a class="button button-ghost" href="${escapeHtml(setupHref)}">Open in Create</a>
      </div>
    </article>
  `;
}

function renderWorkspaceOrphanReceiptsCard(policyId, receipts) {
  const cfg = getRuntimeConfig();
  const list = Array.isArray(receipts) ? receipts.slice().sort((a, b) => (Number(b.createdAtMs) || 0) - (Number(a.createdAtMs) || 0)) : [];
  const shortPolicy = policyId ? shortenMiddle(policyId, 8, 6) : "(unknown)";
  const policyExplorer = policyId ? buildSuiExplorerUrl("object", policyId, cfg) : "";
  const visible = list.slice(0, 5);
  const remaining = list.length - visible.length;

  const lastWhen = list.length && list[0].createdAtMs
    ? dateTimeFormatter.format(new Date(list[0].createdAtMs))
    : "";

  return `
    <article class="ws-position-card surface" data-entry-type="live-orphan" data-policy-id="${escapeHtml(policyId || "")}">
      <div class="ws-position-head">
        <div class="ws-position-title">
          <div class="ws-badge-row">
            ${renderIconBadge("Detached receipts · testnet", {
              tone: "mint",
              iconName: "link",
              title: "Receipts whose parent policy is not visible from this wallet — policy may have been transferred or deleted.",
            })}
            ${policyExplorer
              ? `<a class="ws-id-chip ws-id-chip--muted" href="${escapeHtml(policyExplorer)}" target="_blank" rel="noopener" title="Policy on SuiVision">#${escapeHtml(shortPolicy)} ↗</a>`
              : ""}
          </div>
          <strong>Receipts without a local policy</strong>
        </div>
        <div class="ws-position-meta">
          <span class="state-badge">${list.length} receipt${list.length === 1 ? "" : "s"}</span>
          ${lastWhen ? `<span class="ws-position-date">last ${escapeHtml(lastWhen)}</span>` : ""}
        </div>
      </div>
      <p class="ws-policy-lifecycle-line">Policy ${escapeHtml(shortPolicy)} isn't in this wallet's owned objects — it may have been transferred or deleted. Receipts below remain verifiable on-chain.</p>
      ${list.length > 0 ? `
      <ul class="ws-orphan-history">
        ${visible.map(renderWorkspaceReceiptRow).join("")}
      </ul>
      ${remaining > 0 && policyExplorer
        ? `<a class="ws-orphan-more" href="${escapeHtml(policyExplorer)}" target="_blank" rel="noopener">View ${remaining} more on SuiVision ↗</a>`
        : ""}
      ` : ""}
    </article>
  `;
}

function getWorkspaceEntryBucket(entry) {
  if (!entry || typeof entry !== "object") return "simulation";
  if (entry.type === "live" || entry.type === "live-orphan" || entry.policy?.id || entry.onChainPolicy?.id) {
    return "live";
  }
  if (entry.type === "draft" || entry.type === "saved-draft") {
    return "draft";
  }
  return "simulation";
}

function renderWorkspaceSimulationCard(entry) {
  const ltvPct = (entry.ltv * 100).toFixed(1);
  const sourceLabel = entry.type === "saved"
    ? "Cloud · Saved"
    : entry.type === "current"
      ? "Local · Last run"
      : entry.type === "saved-draft"
        ? "Local · Saved draft"
        : "Local · Draft";
  const sourceChipTitle = entry.type === "saved"
    ? "Saved to your account. Synced across devices once signed in."
    : entry.type === "current"
      ? "Last simulation run in this browser. Stored locally only."
      : entry.type === "saved-draft"
        ? "Named draft template you saved from Create. Not yet simulated."
        : "Unrun draft of edits in this browser. Stored locally only.";
  const sourceTone = entry.type === "saved" ? "accent" : "";
  const sourceIcon = entry.type === "saved" ? "cloud" : "monitor";
  const typeTone = entry.type === "draft" || entry.type === "saved-draft"
    ? ""
    : entry.type === "current"
      ? "cyan"
      : "mint";
  const typeIcon = entry.type === "draft" || entry.type === "saved-draft"
    ? "info"
    : entry.type === "current"
      ? "zap"
      : "check";
  const dirtyChip = entry.type === "draft" && entry.isDirty
    ? renderIconBadge("Unsaved edits", {
        tone: "amber",
        iconName: "alert-triangle",
        title: "Draft has unsaved edits vs the last simulated run. Open Create to rerun, or discard the draft to go back to the last run.",
      })
    : "";
  const savedShortId = entry.type === "saved" && entry.id
    ? `<span class="ws-id-chip ws-id-chip--muted" title="${escapeHtml(entry.id)}">#${escapeHtml(shortenMiddle(entry.id, 4, 4))}</span>`
    : "";

  return `
    <article class="ws-position-card surface" data-entry-id="${escapeHtml(entry.id)}" data-entry-type="${escapeHtml(entry.type)}">
      <div class="ws-position-head">
        <div class="ws-position-title">
          <div class="ws-badge-row">
            ${renderIconBadge(sourceLabel, { tone: sourceTone, iconName: sourceIcon, title: sourceChipTitle })}
            ${renderIconBadge(entry.label, { tone: typeTone, iconName: typeIcon })}
            ${dirtyChip}
            ${savedShortId}
          </div>
          <strong>${escapeHtml(entry.name)}</strong>
        </div>
        <div class="ws-position-meta">
          <span class="state-badge">${escapeHtml(entry.mode)}</span>
          ${entry.date ? `<span class="ws-position-date">${escapeHtml(entry.date)}</span>` : ""}
        </div>
      </div>

      <div class="ws-position-metrics">
        <div>
          <span class="ws-dash-label">Collateral</span>
          <strong>${formatUsd(entry.collateralUsd)}</strong>
          <span class="ws-dash-sub ws-dash-asset-line">
            <span class="ws-dash-asset-amount">${entry.btcUnits.toFixed(3)}</span>
            ${renderTokenSubline(entry.collateralSymbol || "BTC", entry.collateralSymbol || "BTC")}
          </span>
        </div>
        <div>
          <span class="ws-dash-label">Debt</span>
          <strong>${formatUsd(entry.debtUsd)}</strong>
          ${renderTokenSubline(entry.stableSymbol || "USDC", entry.stableSymbol || "USDC")}
        </div>
        <div>
          <span class="ws-dash-label">Debt pressure</span>
          <strong class="ws-dash-strong--cyan">${ltvPct}%</strong>
          <span class="ws-dash-sub">${entry.targetLow.toFixed(0)}–${entry.targetHigh.toFixed(0)}% target band</span>
        </div>
        <div>
          <span class="ws-dash-label">Buffer</span>
          <strong>${formatUsd(entry.bufferUsd)}</strong>
          ${renderTokenSubline(entry.stableSymbol || "USDC", entry.stableSymbol || "USDC")}
        </div>
        <div>
          <span class="ws-dash-label">Health</span>
          ${entry.health !== null ? `<strong>${entry.health}/100</strong>` : `<strong class="ws-dash-empty">—</strong>`}
        </div>
        <div>
          <span class="ws-dash-label">Payout floor</span>
          ${entry.payoutUsd > 0 ? `<strong class="ws-dash-strong--mint">${formatUsd(entry.payoutUsd)}</strong>` : `<strong class="ws-dash-empty">—</strong>`}
          ${entry.payoutUsd > 0 ? renderTokenSubline(entry.stableSymbol || "USDC", entry.stableSymbol || "USDC") : ""}
        </div>
        <div>
          <span class="ws-dash-label">Route</span>
          ${entry.rail ? renderProtocolInline(entry.rail, "", "sm") : `<strong class="ws-dash-empty">—</strong>`}
        </div>
      </div>

      <div class="ws-position-actions">
        ${entry.type === "draft" ? `
          <button class="button button-primary" type="button" data-action="run-draft" title="Run a rehearsal on this draft and open the readout.">Run rehearsal</button>
          <a class="button button-secondary" href="${escapeHtml(buildSetupHref(""))}" title="Open Create to keep editing this draft">Edit</a>
          <button class="button button-ghost is-danger" type="button" data-action="discard" data-id="__draft__" title="Reset the form to defaults. Local only — nothing is sent anywhere.">Discard draft</button>
        ` : entry.type === "saved-draft" ? `
          <button class="button button-primary" type="button" data-action="run-saved-draft" data-id="${escapeHtml(entry.id)}" title="Load this draft into Create and run a rehearsal.">Run rehearsal</button>
          <a class="button button-secondary" href="${escapeHtml(buildSetupHref(entry.id))}" title="Load this template into Create as the working draft">Edit</a>
          <button class="button button-ghost is-danger" type="button" data-action="delete-draft" data-id="${escapeHtml(entry.id)}" title="Remove this saved draft template.">Remove</button>
        ` : entry.type === "current" ? `
          <a class="button button-primary" href="${escapeHtml(entry.href || "/results")}" title="Open this run's readout \u2014 verdict, execution panel, and evidence in one place">Readout</a>
          <a class="button button-secondary" href="${escapeHtml(buildSetupHref(appState.current?.sourceScenarioId || ""))}" title="Reopen the draft that produced this run in Create.">Open in Create</a>
          <button class="button button-ghost" type="button" data-action="duplicate-current" title="Save the inputs of this run as a new draft template you can iterate on without overwriting the current draft.">Duplicate to draft</button>
        ` : `
          <a class="button button-primary" href="${escapeHtml(entry.href || buildRunReadoutHref(entry.id))}" title="Open the full readout for this saved scenario">Readout</a>
          <a class="button button-secondary" href="${escapeHtml(buildSetupHref(entry.id))}" title="Load this saved scenario into Create. Edits and reruns stay pinned to this position id.">Open in Create</a>
          <button class="button button-ghost is-danger" type="button" data-action="delete" data-id="${escapeHtml(entry.id)}" title="Remove this saved scenario. Local only — on-chain policies are not affected.">Remove</button>
        `}
      </div>
    </article>
  `;
}

function renderWorkspacePage() {
  renderWorkspaceIdentity();

  const filterBar = $("#workspace-filter");
  const list = $("#workspace-list");
  const accountState = getAccountDataState(getWalletState());

  if (!filterBar && !list) {
    return;
  }

  if (!accountState.canViewWorkspaceScenarios) {
    if (filterBar) {
      safeReplaceChildren(filterBar, `
        <div class="ws-filter-row">
          <button class="ws-filter-btn is-active" type="button">All <span class="ws-filter-count">0</span></button>
          <button class="ws-filter-btn" type="button" disabled>Drafts <span class="ws-filter-count">0</span></button>
          <button class="ws-filter-btn" type="button" disabled>Simulations <span class="ws-filter-count">0</span></button>
          <button class="ws-filter-btn" type="button" disabled>Live <span class="ws-filter-count">0</span></button>
        </div>
      `);
    }

    if (list) {
      safeReplaceChildren(list, renderSectionEmpty(
        "Start with a rehearsal",
        "Run a policy check without connecting a wallet. Connect later to see wallet-owned policies, cloud sync, and on-chain receipts.",
        "Run first rehearsal",
        "/setup"
      ));
    }

    return;
  }

  const current = appState.current;
  const draft = appState.draft;
  const saved = appState.saved;
  const savedDrafts = Array.isArray(appState.drafts) ? appState.drafts : [];
  const onchainPolicies = getMergedWorkspacePolicies();
  const onchainReceipts = getMergedWorkspaceReceipts();
  const livePolicyIds = new Set(
    onchainPolicies
      .map((policy) => normalizeLiveHistoryText(policy?.id))
      .filter(Boolean)
  );

  // ── Collect all position entries ──
  // Order: on-chain first (authoritative), then local sims.
  const entries = [];

  // Group receipts by parent policy id. Receipts pin policy_id at mint,
  // so they belong inside their Live policy card as execution history —
  // not as a separate top-level bucket.
  const receiptsByPolicy = new Map();
  for (const receipt of onchainReceipts) {
    const pid = receipt.policyId || "__orphan__";
    if (!receiptsByPolicy.has(pid)) receiptsByPolicy.set(pid, []);
    receiptsByPolicy.get(pid).push(receipt);
  }

  // Live = on-chain policy + its receipts (one living scenario per card).
  for (const policy of onchainPolicies) {
    const receipts = receiptsByPolicy.get(policy.id) || [];
    entries.push({
      type: "live",
      source: "On-chain",
      id: policy.id || "",
      policy,
      receipts,
    });
    receiptsByPolicy.delete(policy.id);
  }

  // Orphan receipts (parent policy not owned / deleted). Still on-chain
  // artifacts, still worth surfacing under Live.
  for (const [policyId, receipts] of receiptsByPolicy) {
    if (policyId === "__orphan__") continue;
    entries.push({
      type: "live-orphan",
      source: "On-chain",
      id: `orphan:${policyId}`,
      policyId,
      receipts,
    });
  }

  // Draft (form-backed working copy). Skip entirely when identical to the
  // Last run — showing both would duplicate the same parameters twice.
  // When they differ, mark the draft "dirty" so the user sees they have
  // unsaved edits since the last Run.
  if (draft) {
    const draftSig = serializeDraftForCompare(draft);
    const currentSig = current ? serializeDraftForCompare(current.draft) : null;
    const draftMatchesCurrent = currentSig !== null && draftSig === currentSig;

    if (!draftMatchesCurrent) {
      const d = draft;
      const collateral = asNumber(d.btcUnits) * asNumber(d.btcPriceUsd);
      const ltv = collateral > 0 ? asNumber(d.debtUsd) / collateral : 0;
      entries.push({
        type: "draft",
        label: "Draft",
        isDirty: currentSig !== null,
        name: d.scenarioName || "Untitled draft",
        mode: MODE_LABELS[d.mode] || d.mode,
        collateralUsd: collateral,
        btcUnits: asNumber(d.btcUnits),
        collateralSymbol: getCollateralAssetSymbol(d),
        stableSymbol: d.stableAssetSymbol || "USDC",
        debtUsd: asNumber(d.debtUsd),
        bufferUsd: asNumber(d.stableBufferUsd),
        ltv,
        targetLow: asNumber(d.targetLtvLowPct),
        targetHigh: asNumber(d.targetLtvHighPct),
        payoutUsd: asNumber(d.monthlyPayoutTargetUsd),
        health: null,
        rail: null,
        date: null,
        id: "__draft__",
        href: "/setup",
        hrefLabel: "Edit",
      });
    }
  }

  // Explicitly saved drafts (via "Save as draft" on Create). Named templates
  // of form configuration that have NOT been simulated — no run metrics yet.
  for (const record of savedDrafts) {
    const sd = record.draft || {};
    const collateral = asNumber(sd.btcUnits) * asNumber(sd.btcPriceUsd);
    const ltv = collateral > 0 ? asNumber(sd.debtUsd) / collateral : 0;
    entries.push({
      type: "saved-draft",
      label: "Saved draft",
      name: record.name || sd.scenarioName || "Untitled draft",
      mode: MODE_LABELS[sd.mode] || sd.mode,
      collateralUsd: collateral,
      btcUnits: asNumber(sd.btcUnits),
      collateralSymbol: getCollateralAssetSymbol(sd),
      stableSymbol: sd.stableAssetSymbol || "USDC",
      debtUsd: asNumber(sd.debtUsd),
      bufferUsd: asNumber(sd.stableBufferUsd),
      ltv,
      targetLow: asNumber(sd.targetLtvLowPct),
      targetHigh: asNumber(sd.targetLtvHighPct),
      payoutUsd: asNumber(sd.monthlyPayoutTargetUsd),
      health: null,
      rail: null,
      date: record.createdAt ? dateTimeFormatter.format(new Date(record.createdAt)) : null,
      id: record.id,
      href: null,
      hrefLabel: null,
    });
  }

  // Current (last simulation run) — skip if autosave already landed an
  // identical entry in the Saved list, otherwise the user sees the same
  // scenario twice with only the saved copy being removable.
  const currentSig = current ? serializeDraftForCompare(current.draft) : "";
  const currentIsInSaved = currentSig
    ? saved.some((s) => serializeDraftForCompare(s.draft) === currentSig)
    : false;
  const currentPolicyId = normalizeLiveHistoryText(current?.onChainPolicy?.id);
  if (current && !currentIsInSaved && !livePolicyIds.has(currentPolicyId)) {
    const cd = current.draft;
    const summary = current.report?.summary;
    const collateral = asNumber(cd.btcUnits) * asNumber(cd.btcPriceUsd);
    entries.push({
      type: "current",
      label: "Last run",
      name: cd.scenarioName || "Untitled",
      mode: MODE_LABELS[cd.mode] || cd.mode,
      collateralUsd: collateral,
      btcUnits: asNumber(cd.btcUnits),
      collateralSymbol: getCollateralAssetSymbol(cd),
      stableSymbol: cd.stableAssetSymbol || "USDC",
      debtUsd: asNumber(cd.debtUsd),
      bufferUsd: asNumber(cd.stableBufferUsd),
      ltv: summary?.currentLtv || 0,
      targetLow: asNumber(cd.targetLtvLowPct),
      targetHigh: asNumber(cd.targetLtvHighPct),
      payoutUsd: summary?.survivablePayoutBandLowUsd || 0,
      health: summary?.averageHealthScore || null,
      rail: summary?.primaryRailName || null,
      date: current.report?.baseline?.result ? dateTimeFormatter.format(new Date(current.report.generatedAt)) : null,
      id: "__current__",
      href: buildRunReadoutHref(current.sourceScenarioId || ""),
      hrefLabel: "Readout",
    });
  }

  // Saved scenarios
  for (const scenario of saved) {
    const savedPolicyId = normalizeLiveHistoryText(scenario?.onChainPolicy?.id);
    if (savedPolicyId && livePolicyIds.has(savedPolicyId)) {
      continue;
    }
    const sd = scenario.draft;
    const summary = scenario.report?.summary;
    const collateral = asNumber(sd.btcUnits) * asNumber(sd.btcPriceUsd);
    entries.push({
      type: "saved",
      label: "Saved",
      name: scenario.name || sd.scenarioName || "Untitled",
      mode: MODE_LABELS[sd.mode] || sd.mode,
      collateralUsd: collateral,
      btcUnits: asNumber(sd.btcUnits),
      collateralSymbol: getCollateralAssetSymbol(sd),
      stableSymbol: sd.stableAssetSymbol || "USDC",
      debtUsd: asNumber(sd.debtUsd),
      bufferUsd: asNumber(sd.stableBufferUsd),
      ltv: summary?.currentLtv || 0,
      targetLow: asNumber(sd.targetLtvLowPct),
      targetHigh: asNumber(sd.targetLtvHighPct),
      payoutUsd: summary?.survivablePayoutBandLowUsd || 0,
      health: summary?.averageHealthScore || null,
      rail: summary?.primaryRailName || null,
      date: dateTimeFormatter.format(new Date(scenario.createdAt)),
      id: scenario.id,
      onChainPolicy: isPlainObject(scenario.onChainPolicy) ? clone(scenario.onChainPolicy) : null,
      href: buildRunReadoutHref(scenario.id),
      hrefLabel: "Readout",
    });
  }

  // ── Filter bar ──
  if (filterBar) {
    // Three top-level buckets match the user's mental model:
    //   Drafts      — unsaved edits in Create (appState.draft).
    //   Simulations — last run + explicitly saved scenarios.
    //   Live        — on-chain policies + their execution receipts,
    //                 one living scenario per card.
    const counts = { all: entries.length, draft: 0, simulation: 0, live: 0 };
    for (const e of entries) {
      counts[getWorkspaceEntryBucket(e)]++;
    }

    const onchainBusy = _workspaceOnChain.status === "loading";

    safeReplaceChildren(filterBar, `
      <div class="ws-filter-row" role="group" aria-label="Workspace filters">
        <button class="ws-filter-btn ${wsFilter === "all" ? "is-active" : ""}" type="button" aria-pressed="${wsFilter === "all"}" data-filter="all">All <span class="ws-filter-count">${counts.all}</span></button>
        <button class="ws-filter-btn ${wsFilter === "draft" ? "is-active" : ""}" type="button" aria-pressed="${wsFilter === "draft"}" data-filter="draft">Drafts <span class="ws-filter-count">${counts.draft}</span></button>
        <button class="ws-filter-btn ${wsFilter === "simulation" ? "is-active" : ""}" type="button" aria-pressed="${wsFilter === "simulation"}" data-filter="simulation">Simulations <span class="ws-filter-count">${counts.simulation}</span></button>
        <button class="ws-filter-btn ${wsFilter === "live" ? "is-active" : ""}" type="button" aria-pressed="${wsFilter === "live"}" data-filter="live">Live <span class="ws-filter-count">${counts.live}</span></button>
        <button class="button button-ghost button-sm ws-filter-refresh" type="button" data-action="ws-refresh-onchain" title="Refresh on-chain policies + receipts" ${onchainBusy ? "disabled" : ""}>
          ${icon("refresh-cw", "sm")}
          <span>${onchainBusy ? "Refreshing…" : "Refresh"}</span>
        </button>
      </div>
    `);

    if (!filterBar.dataset.boundFilterClick) {
      filterBar.addEventListener("click", (event) => {
        const refreshBtn = event.target.closest("[data-action='ws-refresh-onchain']");
        if (refreshBtn) {
          event.preventDefault();
          refreshWorkspaceOnChainState().catch(() => {});
          return;
        }
        const btn = event.target.closest("[data-filter]");
        if (!btn) return;
        wsFilter = btn.dataset.filter;
        renderWorkspacePage();
      });
      filterBar.dataset.boundFilterClick = "1";
    }
  }

  // ── Unified list (on-chain + simulations) ──
  if (list) {
    if (!list.dataset.boundScenarioAction) {
      list.addEventListener("click", handleSavedScenarioAction);
      list.dataset.boundScenarioAction = "1";
    }

    const filtered = wsFilter === "all"
      ? entries
      : wsFilter === "simulation"
        ? entries.filter(e => getWorkspaceEntryBucket(e) === "simulation")
        : wsFilter === "live"
          ? entries.filter(e => getWorkspaceEntryBucket(e) === "live")
          : wsFilter === "draft"
            ? entries.filter(e => getWorkspaceEntryBucket(e) === "draft")
            : entries.filter(e => e.type === wsFilter);

    if (filtered.length === 0) {
      const emptyCopy = wsFilter === "live"
        ? { title: "No live rehearsals yet", body: "Run a rehearsal first, then save the policy on-chain from Create. Receipts minted against it will show up here as history.", ctaLabel: "Run first rehearsal", ctaHref: "/setup" }
        : wsFilter === "draft"
          ? { title: "No drafts yet", body: "Open Create, set up the form, and hit Save as draft to keep it here as a named template. Edits you haven't saved live inside Create.", ctaLabel: "Open Create", ctaHref: "/setup" }
          : wsFilter === "simulation"
            ? { title: "No autopilot rehearsals yet", body: "Open Create to run your first one. Rehearsal is fully local — nothing touches your wallet until you save a policy on-chain.", ctaLabel: "Run first rehearsal", ctaHref: "/setup" }
            : { title: "Your workspace is empty", body: "Run your first rehearsal — no signing or capital needed. You can save the policy on-chain once it looks right.", ctaLabel: "Run first rehearsal", ctaHref: "/setup" };
      safeReplaceChildren(list, renderSectionEmpty(emptyCopy.title, emptyCopy.body, emptyCopy.ctaLabel, emptyCopy.ctaHref));
    } else {
      safeReplaceChildren(list, filtered.map(entry => {
        if (entry.type === "live") return renderWorkspacePolicyCard(entry.policy, entry.receipts);
        if (entry.type === "live-orphan") return renderWorkspaceOrphanReceiptsCard(entry.policyId, entry.receipts);
        return renderWorkspaceSimulationCard(entry);
      }).join(""));
    }
  }

}

function updateGuardrailDollarHints() {
  if (!form) return;
  const btcUnits = asNumber(form.elements.namedItem("btcUnits")?.value);
  const btcPrice = asNumber(form.elements.namedItem("btcPriceUsd")?.value);
  const collateral = btcUnits * btcPrice;
  if (collateral <= 0) return;

  const fields = [
    { name: "targetLtvLowPct", label: "debt" },
    { name: "targetLtvHighPct", label: "debt" },
    { name: "autoRepayLtvPct", label: "debt" },
    { name: "emergencyLtvPct", label: "debt" },
    { name: "maxLtvPct", label: "debt" },
  ];

  for (const { name, label } of fields) {
    const input = form.elements.namedItem(name);
    if (!input) continue;
    const field = input.closest(".field");
    if (!field) continue;
    const pct = asNumber(input.value);
    const debtAtThreshold = collateral * (pct / 100);
    let hint = field.querySelector(".field-dollar-hint");
    if (!hint) {
      hint = document.createElement("span");
      hint.className = "field-dollar-hint";
      field.appendChild(hint);
    }
    hint.textContent = pct > 0 ? `\u2248 ${formatUsd(debtAtThreshold)} ${label}` : "";
  }
}

function renderCreateScopeState() {
  if (!form) {
    return null;
  }

  let draft = readDraftFromForm();
  draft = syncPositionSupportFields(draft);
  const createScopeState = getCreateScopeState({
    draft,
    walletState: getWalletState(),
    proofContext: getCreateScopeProofContext(),
  });
  const panel = document.querySelector("[data-create-scope-panel]");
  const hint = document.querySelector("[data-create-scope-hint]");
  const liveNav = document.querySelector('[data-nav="live"] span');
  const runButton = document.querySelector("#run-sim-toolbar")
    || document.querySelector('[type="submit"][form="scenario-form"]');
  const railTitle = document.querySelector("[data-create-rail-title]");
  const railCopy = document.querySelector("[data-create-rail-copy]");
  const railChipPrimary = document.querySelector("[data-create-rail-chip-primary]");
  const railChipSecondary = document.querySelector("[data-create-rail-chip-secondary]");
  const railChipTertiary = document.querySelector("[data-create-rail-chip-tertiary]");
  const priceField = form?.elements?.namedItem?.("btcPriceUsd");

  if (panel) {
    panel.dataset.scope = createScopeState.scope;
    panel.classList.toggle("is-shadow", createScopeState.scope === "shadow");
    panel.classList.toggle("is-live", createScopeState.scope === "live");
    panel.classList.toggle("is-ready", createScopeState.scope === "live" && createScopeState.canRunSimulation && createScopeState.canOpenLive);
    panel.classList.toggle("is-blocked", createScopeState.scope === "live" && !createScopeState.canRunSimulation);
  }

  if (hint) {
    // Live-scope status lives on the rail panel; keep the inline hint only
    // for the positive "armed" confirmation so we don't plaster a persistent
    // red warning next to the amount field on first wallet connect.
    if (createScopeState.scope === "live" && createScopeState.canRunSimulation && createScopeState.canOpenLive) {
      hint.textContent = createScopeState.walletBacked
        ? `Testnet proof armed — ${formatBtcAmount(createScopeState.requested)} ${createScopeState.symbol || "BTC"} on wallet`
        : `Testnet proof armed — mock ${formatBtcAmount(createScopeState.requested)} ${createScopeState.symbol || "BTC"}`;
      hint.dataset.tone = "good";
      hint.hidden = false;
    } else {
      hint.textContent = "";
      hint.hidden = true;
    }
  }

  if (priceField && !isRadioGroup(priceField)) {
    priceField.readOnly = createScopeState.scope === "live";
    priceField.setAttribute("aria-readonly", createScopeState.scope === "live" ? "true" : "false");
  }

  if (railTitle && railCopy && railChipPrimary && railChipSecondary && railChipTertiary) {
    let title = "Rehearsal";
    let copy = "Manual or read-only wallet data. No signing.";
    let chips = ["Wallet optional", "Read-only inputs", "Run first"];

    if (createScopeState.scope === "live") {
      switch (createScopeState.reason) {
        case "live-ready":
        title = "Testnet proof ready";
          copy = `${formatBtcAmount(createScopeState.requested)} ${createScopeState.symbol || "BTC"} is covered by the connected wallet. Reference price is pinned to verified data.`;
          chips = ["Wallet-bound", `${formatBtcAmount(createScopeState.available)} available`, "Proof-ready"];
          break;
        case "proof-collateral-mock":
          title = "Testnet proof collateral";
          copy = createScopeState.available === null
            ? `Testnet rehearsal can arm ${createScopeState.symbol || "BTC"} before wallet balances finish syncing.`
            : `Mock ${createScopeState.symbol || "BTC"} collateral can run a local rehearsal only. Connect owned wBTC/xBTC before saving or minting.`;
          chips = ["Testnet rehearsal", "Mock collateral", "No live capital"];
          break;
        case "wallet-required":
          title = "Wallet required";
          copy = "Connect the wallet that owns the BTC wrapper and the stable buffer.";
          chips = ["Connect wallet", "Owned wrapper", "Proof locked"];
          break;
        case "balance-loading":
          title = "Syncing balances";
          copy = "Wallet session is active. TIDE is still reading wrappers before it can validate Live.";
          chips = ["Wallet-bound", "Reading wrappers", "Stand by"];
          break;
        case "wrapper-required":
          title = "Pick a wrapper";
          copy = "Testnet proof needs a wallet BTC wrapper, not a manual placeholder.";
          chips = ["Select wrapper", "Wallet-owned", "Proof blocked"];
          break;
        case "wrapper-not-owned":
          title = "Wrapper not owned";
          copy = `The connected wallet does not hold ${createScopeState.symbol || "the selected wrapper"}.`;
          chips = ["Choose owned asset", "Rehearsal still works", "Proof blocked"];
          break;
        case "unsupported-wrapper":
          title = "Read-only wrapper";
          copy = createScopeState.message || "This wallet asset is visible, but it is not supported by current testnet-proof rehearsal rails.";
          chips = ["Observed only", "Choose wBTC/xBTC", "Proof blocked"];
          break;
        case "amount-required":
          title = "Amount required";
          copy = "Testnet proof validates the exact collateral amount against the wallet.";
          chips = ["Enter amount", `${formatBtcAmount(createScopeState.available)} available`, "Proof blocked"];
          break;
        case "insufficient-balance":
          title = "Balance too low";
          copy = `Requested ${formatBtcAmount(createScopeState.requested)} ${createScopeState.symbol || "BTC"}, wallet has ${formatBtcAmount(createScopeState.available)}.`;
          chips = ["Lower amount", `${formatBtcAmount(createScopeState.available)} available`, "Proof blocked"];
          break;
        default:
          title = "Testnet proof validation";
          copy = createScopeState.message || "Testnet proof constrains the draft to what the connected wallet can actually execute.";
          chips = ["Wallet-bound", "Validated inputs", "Review first"];
          break;
      }
    }

    railTitle.textContent = title;
    railCopy.textContent = copy;
    railChipPrimary.textContent = chips[0] || "";
    railChipSecondary.textContent = chips[1] || "";
    railChipTertiary.textContent = chips[2] || "";
  }

  if (liveNav) {
    const disabled = !createScopeState.canOpenLive;
    liveNav.classList.toggle("is-disabled", disabled);
    liveNav.setAttribute("aria-disabled", String(disabled));
    liveNav.title = createScopeState.scope === "shadow"
      ? "Switch Create to Testnet proof to continue into wallet-backed review."
      : createScopeState.canOpenLive
        ? createScopeState.mockCollateral
          ? "Open the proof screen in testnet rehearsal mode. Capital movement stays disabled."
          : "Open the proof screen with this wallet-backed draft."
        : createScopeState.message;
  }

  const softLocked = isLiveSoftLockedFromSimulation(draft);
  const softLockMsg = "Rehearsal draft uses manual numbers. To arm testnet proof, start a new scenario from wallet data.";
  const liveRunBlocked = createScopeState.scope === "live" && !createScopeState.canRunSimulation;

  if (runButton) {
    const disabled = softLocked || liveRunBlocked;
    runButton.disabled = disabled;
    runButton.setAttribute("aria-disabled", String(disabled));
    runButton.title = softLocked
      ? softLockMsg
      : liveRunBlocked
        ? createScopeState.message
      : createScopeState.scope === "live"
        ? createScopeState.mockCollateral
          ? "Rehearse the policy against testnet rehearsal collateral before saving on-chain."
          : "Rehearse the policy against real wallet balances before saving on-chain."
        : "Run the simulation with the numbers entered above. No signing.";
    runButton.textContent = createScopeState.scope === "live"
      ? (liveRunBlocked ? "Fix proof inputs" : "Run testnet proof")
      : "Run rehearsal";
    syncActionDisabledHint(runButton, disabled ? runButton.title : "", runButton.id || "run-sim-toolbar");
  }

  syncTrustLabels();
  return createScopeState;
}

function getCreatePreviewTone(draft, metrics, createScopeState) {
  if (createScopeState?.scope === "live" && !createScopeState.canRunSimulation) {
    return "blocked";
  }

  if (metrics.collateralUsd <= 0) {
    return "neutral";
  }

  const ltv = metrics.ltv;
  if (ltv >= pctToDecimal(draft.emergencyLtvPct)) {
    return "critical";
  }
  if (ltv >= pctToDecimal(draft.autoRepayLtvPct)) {
    return "danger";
  }
  if (ltv >= pctToDecimal(draft.targetLtvHighPct)) {
    return "warn";
  }
  return "stable";
}

function renderCreatePreviewRail(draft, createScopeState = null) {
  const rail = document.querySelector("[data-create-preview-rail]");
  if (!rail) {
    return;
  }

  const state = createScopeState || getCreateScopeState({
    draft,
    walletState: getWalletState(),
    proofContext: getCreateScopeProofContext(),
  });
  const metrics = deriveDraftMetrics(draft);
  const symbol = String(draft.collateralAssetSymbol || "BTC").trim() || "BTC";
  // Fall back to starter-draft values so the preview rail never renders with
  // bare "--" placeholders on first visit or when the form hasn't loaded yet.
  const effBtcUnits = asNumber(draft.btcUnits) || asNumber(DEFAULT_DRAFT.btcUnits);
  const effSpot = asNumber(draft.btcPriceUsd) || asNumber(DEFAULT_DRAFT.btcPriceUsd);
  const effCollateralUsd = metrics.collateralUsd > 0
    ? metrics.collateralUsd
    : effBtcUnits * effSpot;
  const effDebtUsd = asNumber(draft.debtUsd) || asNumber(DEFAULT_DRAFT.debtUsd);
  const maxLtv = Math.max(pctToDecimal(draft.maxLtvPct), 0.0001);
  const projectedLtv = effCollateralUsd > 0
    ? Math.min(1, effDebtUsd / effCollateralUsd)
    : pctToDecimal(draft.targetLtvLowPct || DEFAULT_DRAFT.targetLtvLowPct);
  const fitScore = Math.max(0, Math.min(100, Math.round((1 - Math.min(projectedLtv / maxLtv, 1)) * 100)));
  const tone = getCreatePreviewTone(draft, metrics, state);
  const modeLabel = MODE_LABELS[draft.mode] || String(draft.mode || "Policy");
  const priorityLabel = PRIORITY_LABELS[draft.priority] || String(draft.priority || "Harbor");
  const scopeNode = rail.querySelector("[data-create-preview-scope]");
  const titleNode = rail.querySelector("[data-create-preview-title]");
  const copyNode = rail.querySelector("[data-create-preview-copy]");
  const nextNode = rail.querySelector("[data-create-preview-next]");
  const ringNode = rail.querySelector("[data-create-preview-ring]");
  const scoreNode = rail.querySelector("[data-create-preview-score]");
  const wrapperNode = rail.querySelector("[data-create-preview-wrapper]");
  const ltvNode = rail.querySelector("[data-create-preview-ltv]");
  const bufferNode = rail.querySelector("[data-create-preview-buffer]");
  const payoutNode = rail.querySelector("[data-create-preview-payout]");
  const debtNode = rail.querySelector("[data-create-preview-debt]");

  let title = "Rehearsal draft";
  let copy = `${priorityLabel}. ${formatCompactUsd(effCollateralUsd)} BTC collateral at ${(projectedLtv * 100).toFixed(1)}% debt pressure.`;
  let next = isLiveEnabled()
    ? "Run rehearsal first. If it survives, open Readout to save the policy and mint a receipt."
    : "Run rehearsal first. Receipt actions appear in Readout when a testnet wallet is available.";
  let scopeLabel = "Rehearsal";

  if (isLiveEnabled() && state.scope === "live") {
    scopeLabel = state.walletBacked ? "Wallet verified" : state.mockCollateral ? "Proof collateral" : "Proof blocked";
    if (state.walletBacked) {
      title = "Wallet-backed policy";
      copy = `${modeLabel} · ${priorityLabel}. ${formatBtcAmount(state.available)} ${state.symbol || symbol} is available for wallet-backed rehearsal.`;
      next = "Wallet-backed draft is ready for proof review. Run one final rehearsal pass, then continue to proof signing.";
    } else if (state.mockCollateral) {
      title = "Testnet proof draft";
      copy = `${modeLabel} · ${priorityLabel}. Connected wallet is real, but ${state.symbol || symbol} collateral is mocked for testnet rehearsal only.`;
      next = "Use this for a local rehearsal only. Connect owned wBTC/xBTC before saving a testnet policy or minting a receipt.";
    } else {
      title = "Fix proof inputs";
      copy = `${priorityLabel}. Testnet proof only works with owned BTC wrappers and wallet-backed balances.`;
      next = state.message || "Connect wallet, choose an owned BTC wrapper, and keep the amount within wallet balance.";
    }
  }

  rail.dataset.tone = tone;

  if (ringNode) {
    ringNode.style.setProperty("--preview-progress", `${Math.max(12, fitScore * 3.6)}deg`);
    ringNode.classList.remove("is-empty");
  }

  if (scoreNode) {
    scoreNode.textContent = String(fitScore);
  }

  if (scopeNode) {
    scopeNode.textContent = scopeLabel;
  }
  if (titleNode) {
    titleNode.textContent = title;
  }
  if (copyNode) {
    copyNode.textContent = copy;
  }
  if (nextNode) {
    nextNode.textContent = next;
  }

  if (wrapperNode) {
    wrapperNode.textContent = state.scope === "live"
      ? `${symbol} / ${draft.stableAssetSymbol || "USDC"} · Wallet`
      : `${symbol} / ${draft.stableAssetSymbol || "USDC"}`;
  }
  if (ltvNode) {
    ltvNode.textContent = `${(projectedLtv * 100).toFixed(1)}%`;
  }
  if (bufferNode) {
    const bufferUsd = asNumber(draft.stableBufferUsd) || asNumber(DEFAULT_DRAFT.stableBufferUsd);
    bufferNode.textContent = formatCompactUsd(bufferUsd);
  }
  if (payoutNode) {
    const payoutUsd = asNumber(draft.monthlyPayoutTargetUsd) || asNumber(DEFAULT_DRAFT.monthlyPayoutTargetUsd);
    payoutNode.textContent = formatCompactUsd(payoutUsd);
  }
  if (debtNode) {
    debtNode.textContent = formatCompactUsd(effDebtUsd);
  }

  updatePresetStatBadges();
}

// Preset cards keep the user's primary choice visible:
// monthly draw, runway, and debt-pressure band. Modeled debt is derived in
// the footer preview instead of replacing the cashflow metric on the cards.
function updatePresetStatBadges() {
  Object.entries(STRATEGY_PRESETS).forEach(([key, preset]) => {
    const fields = preset.fields || {};
    const payoutNode = document.querySelector(`[data-preset-stat="${key}-payout"]`);
    const payoutLabel = document.querySelector(`[data-preset-stat-label="${key}-payout"]`);
    const payoutSuffix = document.querySelector(`[data-preset-stat-suffix="${key}-payout"]`);
    const runwayNode = document.querySelector(`[data-preset-stat="${key}-runway"]`);
    const ltvNode = document.querySelector(`[data-preset-stat="${key}-ltv"]`);

    if (payoutNode) {
      payoutNode.textContent = formatCompactUsd(asNumber(fields.monthlyPayoutTargetUsd));
      if (payoutLabel) payoutLabel.textContent = "Monthly draw";
      if (payoutSuffix) payoutSuffix.textContent = "/mo";
      payoutNode.closest("span")?.removeAttribute("title");
    }
    if (runwayNode) {
      runwayNode.textContent = String(asNumber(fields.desiredRunwayMonths));
    }
    if (ltvNode) {
      const low = asNumber(fields.targetLtvLowPct);
      const high = asNumber(fields.targetLtvHighPct);
      ltvNode.innerHTML = `${low}&ndash;${high}%`;
    }
  });
}

function renderSetupPage() {
  const scenarioWorkbenchHost = $("#setup-scenario-workbench");

  if (!scenarioWorkbenchHost) {
    return;
  }

  if (!isLiveEnabled()) {
    const shadowScope = form?.querySelector('input[name="createScope"][value="shadow"]');
    if (shadowScope) {
      shadowScope.checked = true;
    }
  }

  const draft = readDraftFromForm();
  seedCreateScopeFieldState(draft);

  updateGuardrailDollarHints();

  // Sync header name with form hidden field
  const headerName = document.querySelector("[data-header-name]");
  const formName = form?.querySelector('[name="scenarioName"]');
  const commandStripNameEl = document.querySelector("[data-command-strip-name-text]");
  const commandStripDirty = document.querySelector("[data-command-strip-dirty]");
  const syncCommandStrip = () => {
    if (commandStripNameEl) {
      commandStripNameEl.textContent = (headerName && headerName.value) || draft.scenarioName || "Untitled scenario";
    }
    if (commandStripDirty) commandStripDirty.hidden = !draft.scenarioName ? false : !headerName?.value;
  };
  if (headerName && formName) {
    // Draft factories and preset handlers own auto-numbering. Rendering must
    // stay side-effect free so focus, typed names, and Simulation->Live
    // promotion are not mutated during paint.
    const headerOwnsFocus = document.activeElement === headerName;
    if (!headerOwnsFocus && headerName.value !== draft.scenarioName) {
      headerName.value = draft.scenarioName;
      formName.value = draft.scenarioName;
    } else if (headerOwnsFocus && formName.value !== headerName.value) {
      formName.value = headerName.value;
    }
    if (!headerName.dataset.bound) {
      headerName.dataset.bound = "1";
      headerName.addEventListener("input", () => {
        formName.value = headerName.value;
        syncCommandStrip();
        renderScenarioNameCollisionHint();
        persistDraft();
      });
    }
  }
  syncCommandStrip();
  renderScenarioNameCollisionHint();

  const modeCard = document.querySelector('[data-mode-card]');
  if (modeCard && !modeCard.dataset.bound) {
    modeCard.dataset.bound = "1";
    const opts = Array.from(modeCard.querySelectorAll(".mode-card__opt"));
    const syncActive = () => {
      opts.forEach((el) => {
        const radio = el.querySelector('input[type="radio"]');
        el.dataset.active = radio?.checked ? "true" : "false";
        el.setAttribute("role", "radio");
        el.setAttribute("aria-checked", radio?.checked ? "true" : "false");
        el.tabIndex = radio?.checked ? 0 : -1;
      });
      const originField = form?.elements?.namedItem("scenarioOrigin");
      const originEl = modeCard.querySelector('[data-mode-origin]');
      if (originEl) {
        const origin = originField?.value || "";
        originEl.textContent = origin ? `Scenario origin: ${origin[0].toUpperCase()}${origin.slice(1)}` : "";
      }
    };
    const activateModeOption = (label) => {
      if (label.getAttribute("aria-disabled") === "true") {
        setStatus(getDisabledLiveModeStatusCopy(), true);
        label.animate(
          [{ transform: "translateX(0)" }, { transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "translateX(0)" }],
          { duration: 220, iterations: 1 }
        );
        return;
      }
      const radio = label.querySelector('input[type="radio"]');
      if (!radio) return;
      const currentRadio = modeCard.querySelector('input[name="createScope"]:checked');
      const nextScopeKey = getCreateScopeKey(radio.value);
      const currentDraft = form ? readDraftFromForm() : null;
      captureCreateScopeFieldState(currentRadio?.value || "shadow");
      if (currentRadio?.value !== radio.value) {
        const currentUnits = Math.max(0, asNumber(currentDraft?.btcUnits));
        if (!(createScopeFieldState[nextScopeKey].btcUnits > 0) && currentUnits > 0) {
          createScopeFieldState[nextScopeKey].btcUnits = currentUnits;
        }
      }
      radio.checked = true;
      applyCreateScopeFieldState(radio.value);
      const originField = form?.elements?.namedItem("scenarioOrigin");
      if (originField) {
        originField.value = radio.value === "live" ? "live" : "simulation";
      }
      radio.dispatchEvent(new Event("change", { bubbles: true }));
      syncActive();
      persistDraft();
      renderCurrentPage();
    };
    opts.forEach((label) => {
      label.addEventListener("click", (e) => {
        e.preventDefault();
        activateModeOption(label);
      });
      label.addEventListener("keydown", (e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          activateModeOption(label);
          return;
        }
        if (!["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown", "Home", "End"].includes(e.key)) return;
        e.preventDefault();
        const currentIndex = Math.max(0, opts.indexOf(label));
        const direction = (e.key === "ArrowLeft" || e.key === "ArrowUp") ? -1 : 1;
        const nextIndex = e.key === "Home"
          ? 0
          : e.key === "End"
            ? opts.length - 1
            : Math.max(0, Math.min(opts.length - 1, currentIndex + direction));
        const nextLabel = opts[nextIndex] || label;
        nextLabel.focus?.({ preventScroll: true });
      });
    });
    syncActive();
    syncLiveModeCardAvailability();
  }

  // Mode / Priority segmented-control hints
  const modeHint = document.getElementById("mode-hint");
  const priorityHint = document.getElementById("priority-hint");

  if (modeHint) {
    const checkedMode = form?.querySelector('input[name="mode"]:checked');
    if (checkedMode) modeHint.textContent = MODE_HINTS[checkedMode.value] || "";

    if (!modeHint.dataset.bound) {
      modeHint.dataset.bound = "1";
      form?.querySelectorAll('input[name="mode"]').forEach((radio) => {
        radio.addEventListener("change", () => {
          modeHint.textContent = MODE_HINTS[radio.value] || "";
        });
      });
    }
  }

  if (priorityHint) {
    const checkedPriority = form?.querySelector('input[name="priority"]:checked');
    if (checkedPriority) priorityHint.textContent = PRIORITY_HINTS[checkedPriority.value] || "";

    if (!priorityHint.dataset.bound) {
      priorityHint.dataset.bound = "1";
      form?.querySelectorAll('input[name="priority"]').forEach((radio) => {
        radio.addEventListener("change", () => {
          priorityHint.textContent = PRIORITY_HINTS[radio.value] || "";
        });
      });
    }
  }

  bindStrategyPresets(form);

  syncPolicyActionButtons();
  refreshSetupCollateralSelector();
  const createScopeState = renderCreateScopeState();
  renderCreatePreviewRail(draft, createScopeState);
  renderIntentSwapUsd(draft);
  if (scenarioWorkbenchHost) {
    renderGuardrailsChart(scenarioWorkbenchHost, { draft, interactive: true });
  }
}

// ---------------------------------------------------------------------------
// Guardrails chart (replaces legacy scenario workbench)
// ---------------------------------------------------------------------------
const GUARDRAILS_STATE = { overlay: "your-stress", period: "1M" };
const GUARDRAILS_OVERLAYS = [
  { key: "your-stress", label: "Custom stress", sub: "Manual" },
  { key: "recent30d", label: "BTC replay", sub: "30D" },
  { key: "crash-2020-03", label: "Mar 2020", sub: "COVID −50%" },
  { key: "crash-2022-11", label: "Nov 2022", sub: "FTX −22%" },
  { key: "crash-2021-05", label: "May 2021", sub: "China −41%" },
  { key: "polymarket", label: "Polymarket", sub: "Public" },
  { key: "kalshi", label: "Kalshi", sub: "Public" },
];
const GUARDRAILS_PERIODS = [
  { key: "1W", days: 7, sub: "7d" },
  { key: "1M", days: 30, sub: "30d" },
  { key: "3M", days: 90, sub: "90d" },
  { key: "1Y", days: 365, sub: "365d" },
];
const KALSHI_FALLBACK_HORIZON_DAYS = 3;
const GUARDRAILS_THRESHOLDS = [
  { key: "targetLow", field: "targetLtvLowPct", label: "Target floor", tone: "mint" },
  { key: "targetHigh", field: "targetLtvHighPct", label: "Target ceiling", tone: "amber" },
  { key: "autoRepay", field: "autoRepayLtvPct", label: "Managed repay", tone: "amber" },
  { key: "emergency", field: "emergencyLtvPct", label: "Freeze", tone: "rose" },
];
let _guardrailsRafId = 0;
let _guardrailsDragging = false;

function formatGuardrailDurationLabel(days) {
  const safeDays = Math.max(1 / 24, Number(days) || 0);
  if (safeDays < 1) {
    return `${Math.max(1, Math.round(safeDays * 24))}h`;
  }
  if (safeDays < 10 && Math.abs(safeDays - Math.round(safeDays)) > 0.05) {
    return `${safeDays.toFixed(1)}d`;
  }
  return `${Math.max(1, Math.round(safeDays))}d`;
}

function getKalshiGuardrailPeriod(forecast = appState.kalshiForecast) {
  const observedAt = Date.parse(String(forecast?.observedAt || ""));
  const horizonAt = Date.parse(String(forecast?.horizonAt || ""));
  const days = Number.isFinite(observedAt) && Number.isFinite(horizonAt) && horizonAt > observedAt
    ? (horizonAt - observedAt) / 86400000
    : KALSHI_FALLBACK_HORIZON_DAYS;
  const safeDays = Number.isFinite(days) && days > 0 ? days : KALSHI_FALLBACK_HORIZON_DAYS;
  const sub = formatGuardrailDurationLabel(safeDays);
  return { key: "kalshi-horizon", days: safeDays, label: "Kalshi", sub };
}

function getActiveGuardrailsPeriod(state = GUARDRAILS_STATE) {
  if (state.overlay === "kalshi") {
    return getKalshiGuardrailPeriod();
  }
  return GUARDRAILS_PERIODS.find((p) => p.key === state.period) || GUARDRAILS_PERIODS[1];
}

function hashUnit32(input) {
  let x = Number(input) | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function hashNormalish(input) {
  return (
    (hashUnit32(input) * 2 - 1)
    + (hashUnit32(Number(input) + 0x9e3779b9) * 2 - 1)
    + (hashUnit32(Number(input) + 0x85ebca6b) * 2 - 1)
  ) / 3;
}

function getRecentBtcAnchorDay() {
  const updatedAt = Date.parse(String(appState.railPack?.market?.updatedAt || ""));
  if (Number.isFinite(updatedAt)) return Math.floor(updatedAt / 86400000);
  return Math.floor(Date.now() / 86400000);
}

function buildRecentBtcPath(livePrice, periodDays) {
  const days = Math.max(2, Math.round(Number(periodDays) || 30));
  const endDay = getRecentBtcAnchorDay();
  const startDay = endDay - days;
  const priceSeed = Math.max(1, Math.round(livePrice));
  const daily = [];
  let price = 1;
  daily.push({ day: startDay, price });
  for (let i = 1; i <= days; i += 1) {
    const day = startDay + i;
    const t = i / days;
    const seed = day ^ priceSeed ^ (days * 131);
    const baseVol = days >= 180
      ? 0.017
      : days >= 60
        ? 0.014
        : 0.0115;
    const cycle = Math.sin((day + (priceSeed % 37)) / 11) * 0.0028
      + Math.sin((day + (priceSeed % 97)) / 43) * 0.0022;
    const horizonShape = days >= 180
      ? Math.sin((t - 0.18) * Math.PI * 2.1) * 0.0034
        + Math.sin((t + 0.07) * Math.PI * 5.2) * 0.0018
      : days >= 60
        ? Math.sin((t + 0.15) * Math.PI * 1.35) * 0.0012
        : 0;
    const jump = hashUnit32(seed + 17) > 0.965
      ? hashNormalish(seed + 29) * 0.035
      : 0;
    const dailyReturn = hashNormalish(seed) * baseVol + cycle + horizonShape + jump;
    price *= Math.max(0.86, Math.min(1.14, 1 + dailyReturn));
    daily.push({ day, price });
  }
  const scale = livePrice / daily[daily.length - 1].price;
  daily.forEach((p) => { p.price *= scale; });
  const macroAmp = days >= 180 ? 0.075 : days >= 60 ? 0.032 : 0.012;
  if (macroAmp > 0) {
    const phase = ((priceSeed % 47) / 47) * Math.PI * 2;
    daily.forEach((p, index) => {
      const t = index / Math.max(1, daily.length - 1);
      const envelope = Math.sin(Math.PI * t); // anchors start/end exactly
      const wave = Math.sin(t * Math.PI * 2 + phase) * 0.65
        + Math.sin(t * Math.PI * 4.4 + phase / 2) * 0.35;
      p.price = Math.max(1, p.price * (1 + macroAmp * envelope * wave));
    });
    const endScale = livePrice / daily[daily.length - 1].price;
    daily.forEach((p) => { p.price *= endScale; });
  }

  const sampleCount = Math.max(12, Math.min(180, days + 1));
  const points = [];
  for (let i = 0; i < sampleCount; i += 1) {
    const index = Math.round((daily.length - 1) * (i / (sampleCount - 1)));
    points.push({ x: i / (sampleCount - 1), price: daily[index].price });
  }
  return points;
}

function smoothGuardrailsPricePoints(points, passes = 1) {
  if (!Array.isArray(points) || points.length < 4) {
    return Array.isArray(points) ? points : [];
  }
  let next = points.map((point) => ({ ...point }));
  const totalPasses = Math.max(0, Math.min(3, Math.round(Number(passes) || 0)));
  for (let pass = 0; pass < totalPasses; pass += 1) {
    next = next.map((point, index, list) => {
      if (index === 0 || index === list.length - 1) return point;
      const prev = list[index - 1];
      const cur = list[index];
      const following = list[index + 1];
      return {
        ...cur,
        price: prev.price * 0.18 + cur.price * 0.64 + following.price * 0.18,
      };
    });
  }
  return next;
}

function clampForecastPriceForChart(price, spot, {
  minFactor = 0.58,
  maxFactor = 1.38,
} = {}) {
  const basis = Math.max(1, Number(spot) || 0);
  const raw = Number(price);
  if (!Number.isFinite(raw) || raw <= 0) return basis;
  return Math.max(basis * minFactor, Math.min(basis * maxFactor, raw));
}

// Single-slot memo keyed on the inputs that actually change the output. Fetch
// triggers are deliberately out of this function — they live on the overlay
// chip handler and page init, so a re-render during drag never starts I/O.
let _guardrailsSeriesCache = { key: null, value: null };

function buildGuardrailsSeries(overlayKey, periodDays, draft) {
  const spot = Math.max(1, Number(draft?.btcPriceUsd) || 82500);
  const mf = appState.marketForecast;
  const kf = appState.kalshiForecast;
  const livePrice = Number(appState.railPack?.market?.btcPriceUsd)
    || Number(appState.current?.result?.input?.portfolio?.btcPriceUsd)
    || spot;
  const cacheKey = [
    overlayKey,
    periodDays,
    spot,
    livePrice,
    overlayKey === "your-stress"
      ? [
          draft?.marketRealizedVolPct,
          draft?.marketDailyMovePct,
          draft?.marketWeeklyDrawdownPct,
          draft?.marketTrendStrengthPct,
        ].join("|")
      : "",
    overlayKey === "recent30d" ? getRecentBtcAnchorDay() : "",
    appState.marketForecastStatus || "",
    mf ? `${mf.observedAt || ""}|${mf.horizonAt || ""}|${mf.strikes?.length || 0}|${mf.stale ? "s" : ""}` : "-",
    appState.kalshiForecastStatus || "",
    kf ? `${kf.observedAt || ""}|${kf.horizonAt || ""}|${kf.strikes?.length || 0}|${kf.stale ? "s" : ""}` : "-",
  ].join("||");
  if (_guardrailsSeriesCache.key === cacheKey) {
    return _guardrailsSeriesCache.value;
  }
  const value = _computeGuardrailsSeries(overlayKey, periodDays, draft, spot, mf, kf, livePrice);
  _guardrailsSeriesCache = { key: cacheKey, value };
  return value;
}

function buildForecastGuardrailsPoints(cdf, spot, blend, options = {}) {
  const quantiles = Array.isArray(options.quantiles) && options.quantiles.length
    ? options.quantiles
    : [0.10, 0.25, 0.50, 0.75, 0.90];
  const chartBounds = options.chartBounds || {};
  const safeBlend = Math.min(1, Math.max(0, Number(blend) || 0));
  const terminals = quantiles
    .map((q) => clampForecastPriceForChart(quantileFromCdf(cdf, q), spot, chartBounds))
    .filter((value) => Number.isFinite(value));
  if (!terminals.length) return [];
  const count = terminals.length;
  const pts = [{ x: 0, price: spot }];
  terminals.forEach((terminal, index) => {
    const price = spot + (terminal - spot) * safeBlend;
    pts.push({ x: (index + 1) / count, price });
  });
  return pts.length >= 2 ? pts : [];
}

function ensureVisibleForecastGuardrailsPoints(points, spot, options = {}) {
  if (!Array.isArray(points) || points.length < 2 || !Number.isFinite(spot) || spot <= 0) {
    return points;
  }
  const prices = points.map((point) => Number(point?.price)).filter((price) => Number.isFinite(price));
  if (prices.length < 2) return points;
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const minSpan = spot * (Number(options.minSpanPct) || 0.012);
  if (maxPrice - minPrice >= minSpan) return points;
  const lastDelta = Number(points[points.length - 1]?.price) - Number(points[0]?.price);
  const avgDelta = prices.reduce((sum, price) => sum + (price - spot), 0) / prices.length;
  const direction = Math.abs(lastDelta) > spot * 0.001
    ? Math.sign(lastDelta)
    : (avgDelta < 0 ? -1 : 1);
  const span = minSpan * direction;
  const denom = Math.max(1, points.length - 1);
  return points.map((point, index) => {
    const progress = Math.max(0, Math.min(1, index / denom));
    return {
      ...point,
      price: index === 0 ? spot : spot + span * progress,
    };
  });
}

function buildUnavailableForecastGuardrailsPoints(spot) {
  return [
    { x: 0, price: spot },
    { x: 0.45, price: spot * 0.994 },
    { x: 1, price: spot * 1.008 },
  ];
}

function buildSliderStressGuardrailsSeries(draft, spot, periodDays) {
  return buildStressEnvelopeSeries({ draft, spot, periodDays });
}

function _computeGuardrailsSeries(overlayKey, periodDays, draft, spot, mf, kf, livePrice) {
  if (overlayKey === "your-stress") {
    return buildSliderStressGuardrailsSeries(draft, spot, periodDays);
  }
  if (overlayKey === "polymarket") {
    // Wire real market forecast: derive a BTC price curve from the cdf
    // quantiles snapped by the ops worker. Each quantile gives an
    // implied price; we order from now -> horizon by sorting quantiles.
    const forecast = mf;
    if (forecast && Array.isArray(forecast.strikes) && forecast.strikes.length >= 2) {
      const cdf = buildCdfFromStrikes(forecast.strikes);
      const horizonDays = getForecastDurationDays(forecast);
      const viewDays = Math.min(periodDays, horizonDays);
      const blend = Math.min(1, Math.max(0.12, viewDays / Math.max(1, horizonDays)));
      const pts = ensureVisibleForecastGuardrailsPoints(buildForecastGuardrailsPoints(cdf, spot, blend, {
        // Polymarket BTC one-touch markets can carry very high strike tails
        // ($500k/$1M). The guardrails chart is a policy-readability surface,
        // so cap visual tails instead of letting one extreme strike flatten
        // every threshold and make the line look missing.
        quantiles: [0.10, 0.25, 0.50, 0.70, 0.82],
        chartBounds: { minFactor: 0.62, maxFactor: 1.34 },
      }), spot, { minSpanPct: 0.014 });
      const src = forecast.source || "consensus";
      const horizonLabel = horizonDays >= 1
        ? `${Math.round(horizonDays)}d`
        : `${Math.max(1, Math.round(horizonDays * 24))}h`;
      const periodLabel = periodDays > horizonDays
        ? `${Math.round(periodDays)}d view of ${horizonLabel} horizon`
        : `${Math.round(periodDays)}d slice of ${horizonLabel} horizon`;
      const note = `Polymarket public path · ${src} · ${periodLabel}`;
      if (pts.length >= 2) {
        return { points: pts, note, synthesized: false, stale: Boolean(forecast.stale) };
      }
      return {
        points: buildUnavailableForecastGuardrailsPoints(spot),
        note: "Polymarket public path · forecast strikes could not be mapped",
        synthesized: true,
        stale: Boolean(forecast.stale),
      };
    }
    if (appState.marketForecastStatus === "unavailable") {
      return {
        points: buildUnavailableForecastGuardrailsPoints(spot),
        note: "Polymarket public path · forecast unavailable",
        synthesized: true,
        stale: false,
      };
    }
    return {
      points: buildUnavailableForecastGuardrailsPoints(spot),
      note: "Polymarket public path · loading…",
      synthesized: true,
      stale: false,
    };
  }
  if (overlayKey === "kalshi") {
    // Kalshi BTC range markets resolve at a specific event close (hours to
    // a few days out). The overlay owns its x-axis; stretching a 3d forecast
    // over a 365d period makes the path read like a broken segment.
    const forecast = kf;
    if (forecast && Array.isArray(forecast.strikes) && forecast.strikes.length >= 2) {
      const cdf = buildCdfFromStrikes(forecast.strikes);
      const horizonDays = getKalshiGuardrailPeriod(forecast).days;
      const pts = ensureVisibleForecastGuardrailsPoints(buildForecastGuardrailsPoints(cdf, spot, 1, {
        quantiles: [0.10, 0.25, 0.50, 0.75, 0.90],
        chartBounds: { minFactor: 0.72, maxFactor: 1.18 },
      }), spot, { minSpanPct: 0.012 });
      const horizonLabel = formatGuardrailDurationLabel(horizonDays);
      const note = `Kalshi public path · ${horizonLabel} horizon · period locked`;
      if (pts.length >= 2) {
        return { points: pts, note, synthesized: false, stale: Boolean(forecast.stale) };
      }
      return {
        points: buildUnavailableForecastGuardrailsPoints(spot),
        note: "Kalshi public path · forecast strikes could not be mapped",
        synthesized: true,
        stale: Boolean(forecast.stale),
      };
    }
    if (appState.kalshiForecastStatus === "unavailable") {
      return {
        points: buildUnavailableForecastGuardrailsPoints(spot),
        note: "Kalshi public path · forecast unavailable",
        synthesized: true,
        stale: false,
      };
    }
    return {
      points: buildUnavailableForecastGuardrailsPoints(spot),
      note: "Kalshi public path · loading…",
      synthesized: true,
      stale: false,
    };
  }
  if (overlayKey === "recent30d") {
    // Deterministic daily path: different period tabs are different windows,
    // not the same normalized squiggle stretched across 7/30/90/365 days.
    const pts = buildRecentBtcPath(livePrice, periodDays);
    const src = appState.railPack?.market?.source || "allocator median";
    return { points: pts, note: `Recent ${periodDays}d · anchored to ${src} ($${Math.round(livePrice).toLocaleString("en-US")})`, synthesized: false };
  }
  const idMap = {
    "crash-2020-03": "covid-2020-03",
    "crash-2022-11": "ftx-2022-11",
    "crash-2021-05": "china-2021-06",
  };
  const ref = (typeof HISTORICAL_REFERENCE_SCENARIOS !== "undefined"
    ? HISTORICAL_REFERENCE_SCENARIOS
    : []).find((r) => r.id === idMap[overlayKey]);
  if (!ref) return { points: [{ x: 0, price: spot }, { x: 1, price: spot }], note: "No data", synthesized: true };
  const anchorPriceUsd = Math.max(1, Number(ref.anchorPriceUsd) || spot);
  const replaySpotUsd = spot;
  const start = replaySpotUsd;
  const refDays = Math.max(1, Number(ref.durationDays) || 30);
  // Prefer the full real-price timeline (contextPath, days relative to event
  // start) when we have it — it carries the actual pre/post-event BTC move.
  // Fall back to pathPoints (event-only, normalized 0..1) if contextPath is
  // missing, and to a V-synth if neither is provided.
  let byDays = null;
  if (Array.isArray(ref.contextPath) && ref.contextPath.length >= 2) {
    byDays = ref.contextPath
      .map((pt) => ({ d: Number(pt.xDays), drawdown: Number(pt.drawdownPct) }))
      .filter((pt) => Number.isFinite(pt.d) && Number.isFinite(pt.drawdown))
      .sort((a, b) => a.d - b.d);
  } else if (Array.isArray(ref.pathPoints) && ref.pathPoints.length) {
    byDays = ref.pathPoints.map((pt) => ({
      d: Number(pt.x) * refDays,
      drawdown: Number(pt.drawdownPct),
    }));
  } else {
    const dd = Number(ref.drawdownPct) || 0;
    byDays = [
      { d: 0, drawdown: 0 },
      { d: refDays * 0.55, drawdown: dd },
      { d: refDays, drawdown: dd * 0.55 },
    ];
  }

  // Sample the timeline at N evenly-spaced day offsets across the chart
  // window. The event stays centered: chart-x=0.5 aligns with the event
  // midpoint (refDays/2), and the window spans ±periodDays/2 around it.
  const interp = (d) => {
    if (d <= byDays[0].d) return byDays[0].drawdown;
    if (d >= byDays[byDays.length - 1].d) return byDays[byDays.length - 1].drawdown;
    for (let i = 1; i < byDays.length; i += 1) {
      const a = byDays[i - 1];
      const b = byDays[i];
      if (d >= a.d && d <= b.d) {
        const span = b.d - a.d;
        const f = span > 0 ? (d - a.d) / span : 0;
        return a.drawdown + (b.drawdown - a.drawdown) * f;
      }
    }
    return byDays[byDays.length - 1].drawdown;
  };

  const windowCenterDay = refDays / 2;
  const windowStartDay = windowCenterDay - periodDays / 2;
  const windowEndDay = windowCenterDay + periodDays / 2;
  const sampleCount = Math.max(32, Math.min(140, Math.round(periodDays / 2)));
  const points = [];
  // Always include the exact key days inside the window so the event's shape
  // stays crisp, then fill with an even sweep.
  const keyDays = new Set();
  byDays.forEach((pt) => {
    if (pt.d >= windowStartDay && pt.d <= windowEndDay) keyDays.add(pt.d);
  });
  for (let i = 0; i < sampleCount; i += 1) {
    keyDays.add(windowStartDay + (windowEndDay - windowStartDay) * (i / (sampleCount - 1)));
  }
  Array.from(keyDays)
    .sort((a, b) => a - b)
    .forEach((day) => {
      const frac = (day - windowStartDay) / (windowEndDay - windowStartDay || 1);
      points.push({ x: Math.max(0, Math.min(1, frac)), price: start * (1 - interp(day)) });
    });

  const anchorCopy = ref.anchorLabel
    ? `${ref.anchorLabel} shape`
    : "historical BTC shape";
  const displayNote = periodDays >= refDays
    ? `Historical replay model · ${ref.label} · relative BTC path replayed from current spot, ${refDays}d event inside ${periodDays}d window · ${anchorCopy}`
    : `Historical replay model · ${ref.label} · relative BTC path replayed from current spot, ${periodDays}d slice of ${refDays}d event · ${anchorCopy}`;
  const formatEventDayLabel = (day) => {
    const rounded = Math.round(day);
    if (rounded === 0) return "event start";
    return rounded > 0 ? `event +${rounded}d` : `event ${rounded}d`;
  };
  return {
    points,
    note: displayNote,
    synthesized: false,
    historical: true,
    referencePriceUsd: replaySpotUsd,
    historicalAnchorPriceUsd: anchorPriceUsd,
    referenceLabel: ref.anchorLabel || ref.label,
    timelineLabels: [
      formatEventDayLabel(windowStartDay),
      formatEventDayLabel((windowStartDay + windowEndDay) / 2),
      formatEventDayLabel(windowEndDay),
    ],
  };
}

// Strip window zooms to fit thresholds + currentLtv so pills don't overlap in
// a narrow range. Keep a min 8% span for usable drag resolution. Extracted so
// syncThreshold can recompute on every drag frame from fresh form state —
// otherwise the closure-captured stripLo/stripSpan go stale when the user
// pulls a threshold outside the render-time window, clamping other thumbs to
// left:0 and producing the "clumped" look.
function computeStripWindow(draft) {
  const currentLtv = Math.max(0, Math.min(100, Number(draft?.currentLtvPct) || 0));
  const thrPcts = GUARDRAILS_THRESHOLDS.map((t) => Math.max(0, Math.min(100, Number(draft?.[t.field]) || 0)));
  const minThr = Math.min(...thrPcts);
  const maxThr = Math.max(...thrPcts);
  const stripPad = Math.max(2, (maxThr - minThr) * 0.3);
  let stripLo = Math.max(0, minThr - stripPad);
  let stripHi = Math.min(100, maxThr + stripPad);
  if (currentLtv > 0) {
    stripLo = Math.max(0, Math.min(stripLo, currentLtv - 1));
    stripHi = Math.min(100, Math.max(stripHi, currentLtv + 1));
  }
  if (stripHi - stripLo < 8) {
    const mid = (stripHi + stripLo) / 2;
    stripLo = Math.max(0, mid - 4);
    stripHi = Math.min(100, mid + 4);
  }
  const stripSpan = Math.max(0.0001, stripHi - stripLo);
  return { stripLo, stripHi, stripSpan, currentLtv };
}

function renderGuardrailsChart(host, { draft, interactive = true } = {}) {
  if (!host) return;
  // Skip re-render while the user is actively dragging a threshold/strip
  // handle — the pointer capture lives on an SVG node that would vanish if
  // we replaced innerHTML mid-drag.
  if (_guardrailsDragging) return;
  const effectiveDraft = draft || (form ? readDraftFromForm() : null) || {};
  const state = GUARDRAILS_STATE;
  const period = getActiveGuardrailsPeriod(state);
  const kalshiLockedPeriod = state.overlay === "kalshi";
  const series = buildGuardrailsSeries(state.overlay, period.days, effectiveDraft);
  const points = series.points;
  const spot = Math.max(1, Number(effectiveDraft?.btcPriceUsd) || 82500);
  const referenceSpot = Math.max(1, Number(series.referencePriceUsd) || spot);
  const thresholds = GUARDRAILS_THRESHOLDS.map((t) => ({
    ...t,
    ltvPct: Number(effectiveDraft?.[t.field]) || 0,
    priceUsd: calculateTriggerPriceUsd(effectiveDraft, effectiveDraft?.[t.field]) || 0,
  })).filter((t) => t.priceUsd > 0);
  // Axis stretches to include BTC path, spot, AND every operator threshold
  // price so no slider clamps onto an edge. Historical overlays replay the
  // event path, but our guardrail levels remain the operator's absolute
  // current trigger prices.
  const pathThresholds = thresholds;
  const axisPrices = points.map((p) => p.price).concat([referenceSpot]).concat(pathThresholds.map((t) => t.priceUsd));
  let pMin = Math.min(...axisPrices);
  let pMax = Math.max(...axisPrices);
  const pad = (pMax - pMin) * 0.05 || pMax * 0.02;
  pMin -= pad;
  pMax += pad;
  const W = 920, H = 260, padL = 62, padR = 88, padT = 16, padB = 42;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const xToPx = (x) => padL + x * plotW;
  const priceToY = (p) => padT + (1 - (p - pMin) / (pMax - pMin || 1)) * plotH;
  const clampY = (y) => Math.max(padT, Math.min(padT + plotH, y));
  const fmtUsd = (v) => `$${Math.round(v).toLocaleString("en-US")}`;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((r) => {
    const p = pMin + r * (pMax - pMin);
    const y = priceToY(p);
    return `<line x1="${padL}" x2="${W - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--guardrails-grid)" stroke-width="0.45"/><text x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="var(--guardrails-axis-text)" font-size="9" font-weight="500" letter-spacing="0.02em">${fmtUsd(p)}</text>`;
  }).join("");

  const displayPoints = smoothGuardrailsPricePoints(points, state.overlay === "kalshi" ? 1 : 2);
  const pxPoints = displayPoints.map((p) => ({ x: xToPx(p.x), y: priceToY(p.price) }));
  const pathD = buildRoundedSvgPath(pxPoints, { radius: 16, precision: 1 });
  const lineStroke = state.overlay === "kalshi"
    ? "var(--chart-cyan)"
    : state.overlay === "your-stress"
      ? "var(--chart-amber)"
      : "var(--chart-accent)";
  const lineHtml = pathD && !series.synthesized
    ? `<path d="${pathD}" fill="none" stroke="${lineStroke}" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"${series.synthesized ? ' stroke-dasharray="2 4" opacity="0.7"' : ''}/>`
    : "";
  const bandHtml = (() => {
    const low = Array.isArray(series.band?.low) ? series.band.low : [];
    const high = Array.isArray(series.band?.high) ? series.band.high : [];
    if (low.length < 2 || high.length < 2) return "";
    const lower = smoothGuardrailsPricePoints(low, 1).map((p) => ({ x: xToPx(p.x), y: priceToY(p.price) }));
    const upper = smoothGuardrailsPricePoints(high, 1).map((p) => ({ x: xToPx(p.x), y: priceToY(p.price) })).reverse();
    const area = lower.concat(upper);
    if (area.length < 4) return "";
    const d = area
      .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
      .join(" ");
    return `<path class="guardrails-chart__stress-envelope" d="${d} Z" fill="color-mix(in srgb, var(--chart-amber) 16%, transparent)" stroke="color-mix(in srgb, var(--chart-amber) 28%, transparent)" stroke-width="0.65"/>`;
  })();

  // Find every point where the BTC path crosses a threshold price so we can
  // mark the intersection on the chart — these are the moments where the
  // guardrail would trip given the historical/forecast trajectory.
  const intersect = (priceUsd) => {
    const hits = [];
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      const above = (a.price - priceUsd) * (b.price - priceUsd);
      if (above > 0) continue;
      const span = b.price - a.price;
      const frac = Math.abs(span) < 1e-6 ? 0 : (priceUsd - a.price) / span;
      const xx = a.x + (b.x - a.x) * frac;
      hits.push(xx);
    }
    return hits;
  };

  const PILL_W = 40;
  const PILL_H = 16;
  const thresholdShortLabel = (key) => key === "targetLow" ? "LOW"
    : key === "targetHigh" ? "DE-RISK"
      : key === "autoRepay" ? "REPAY"
      : "FREEZE";
  const thrLinesHtml = pathThresholds.map((t) => {
    const y = clampY(priceToY(t.priceUsd));
    const tone = t.tone === "rose" ? "var(--chart-rose)" : t.tone === "amber" ? "var(--chart-amber)" : "var(--chart-mint)";
    const pillX = W - padR + 4;
    const crossings = intersect(t.priceUsd)
      .map((x) => `<circle class="guardrails-chart__cross" cx="${xToPx(x).toFixed(1)}" cy="${y.toFixed(1)}" r="2.4" fill="${tone}"/>`)
      .join("");
    // Phase D.10.5 — threshold lines now match the canonical
    // event-chart aesthetic: dashed (6 6) at 60% opacity, weight 1.
    // Visual kinship with /design-system §Charts (event-chart level
    // lines), so the corridor reads as a sibling primitive instead of
    // its own filled-zone language. Pills stay as draggable handles
    // (the corridor's interactive contract requires them) but are
    // visually softer than the line.
    return `<g data-guardrail-threshold="${t.field}" data-tone="${t.tone}" data-price-usd="${t.priceUsd.toFixed(2)}" style="cursor:${interactive ? "ns-resize" : "default"}">
      <line x1="${padL}" x2="${W - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${tone}" stroke-width="1" stroke-dasharray="6 6" opacity="0.6"/>
      ${crossings}
      ${interactive
        ? `<rect class="guardrails-chart__handle" x="${pillX}" y="${(y - PILL_H / 2).toFixed(1)}" width="${PILL_W}" height="${PILL_H}" rx="4" fill="${tone}"/>
          <text class="guardrails-chart__handle-text" x="${(pillX + PILL_W / 2).toFixed(1)}" y="${(y + 3.2).toFixed(1)}" text-anchor="middle" fill="var(--guardrails-pill-text)" font-size="9.2" font-weight="700">${t.ltvPct.toFixed(1)}%</text>`
        : `<text class="guardrails-chart__static-label" x="${(W - padR + 6).toFixed(1)}" y="${(y + 3.2).toFixed(1)}" fill="${tone}" font-size="8.6" font-weight="700">${thresholdShortLabel(t.key)} ${t.ltvPct.toFixed(1)}%</text>`}
    </g>`;
  }).join("");

  const spotY = priceToY(referenceSpot);
  const spotHtml = `<g><line x1="${padL}" x2="${W - padR}" y1="${spotY.toFixed(1)}" y2="${spotY.toFixed(1)}" stroke="var(--chart-accent)" stroke-opacity="0.38" stroke-dasharray="2 3"/><circle cx="${(W - padR).toFixed(1)}" cy="${spotY.toFixed(1)}" r="2.4" fill="var(--chart-accent)"/></g>`;

  // Stress zones: contiguous x-ranges where the BTC path drops below the
  // rose (emergency/liquidation) threshold price. Rendered as landing-style
  // faint red rectangles with dashed boundaries so the eye lands on the
  // moments where the policy's emergency guardrail would have tripped.
  const roseThreshold = pathThresholds.find((t) => t.tone === "rose");
  const stressZoneHtml = (() => {
    if (!roseThreshold || points.length < 2) return "";
    const roseY = roseThreshold.priceUsd;
    const ranges = [];
    let entryX = null;
    for (let i = 0; i < points.length; i += 1) {
      const inStress = points[i].price <= roseY;
      if (inStress && entryX === null) entryX = points[i].x;
      if ((!inStress || i === points.length - 1) && entryX !== null) {
        const endX = inStress ? points[i].x : points[i - 1].x;
        if (endX >= entryX) ranges.push([entryX, endX]);
        entryX = null;
      }
    }
    if (!ranges.length) return "";
    return ranges
      .map(([x1, x2]) => {
        const px1 = xToPx(x1);
        const px2 = Math.max(xToPx(x2), px1 + 3);
        const width = px2 - px1;
        return `<g class="guardrails-chart__stress">
          <rect x="${px1.toFixed(1)}" y="${padT}" width="${width.toFixed(1)}" height="${plotH}" fill="var(--guardrails-stress-fill)" rx="3"/>
          <line x1="${px1.toFixed(1)}" x2="${px1.toFixed(1)}" y1="${padT}" y2="${(padT + plotH).toFixed(1)}" stroke="var(--guardrails-stress-line-strong)" stroke-width="0.6" stroke-dasharray="4 3"/>
          <line x1="${px2.toFixed(1)}" x2="${px2.toFixed(1)}" y1="${padT}" y2="${(padT + plotH).toFixed(1)}" stroke="var(--guardrails-stress-line-soft)" stroke-width="0.45" stroke-dasharray="4 3"/>
          <text x="${((px1 + px2) / 2).toFixed(1)}" y="${(padT + 11).toFixed(1)}" fill="var(--guardrails-stress-text)" font-size="7.8" text-anchor="middle" font-weight="700" letter-spacing="0.12em">STRESS</text>
        </g>`;
      })
      .join("");
  })();

  const xLabels = [0, 0.5, 1].map((r, index) => {
    const label = Array.isArray(series.timelineLabels) && series.timelineLabels[index]
      ? series.timelineLabels[index]
      : r === 0 ? "now" : `+${formatGuardrailDurationLabel(period.days * r)}`;
    return `<text x="${xToPx(r).toFixed(1)}" y="${(H - 7).toFixed(1)}" text-anchor="middle" fill="var(--guardrails-axis-text)" font-size="9" letter-spacing="0.04em">${label}</text>`;
  }).join("");

  // Phase D.6 — chip-rows now compose the canonical .segmented +
  // .segmented__option primitive. The .guardrails-chart__chip class
  // hooks stay so existing JS (delegated click handlers) still match,
  // but visual styling comes from the canonical .segmented. Sub-labels
  // (LIVE PATH / 7D / 30D) get the same wrapper class for spacing.
  const chipHtml = (group, items, active) => items.map((it) => {
    const sub = it.sub ? `<span class="guardrails-chart__chip-sub">${escapeHtml(it.sub)}</span>` : "";
    const isActive = it.key === active;
    const isDisabled = Boolean(it.disabled);
    const cls = `segmented__option guardrails-chart__chip${isActive ? " is-active" : ""}${isDisabled ? " is-disabled" : ""}`;
    const disabledAttr = isDisabled ? ' disabled aria-disabled="true"' : "";
    return `<button type="button" role="radio" aria-checked="${isActive}" data-guardrail-group="${group}" data-guardrail-value="${it.key}" class="${cls}"${disabledAttr}><span class="guardrails-chart__chip-label">${escapeHtml(it.label || it.key)}</span>${sub}</button>`;
  }).join("");
  const periodItems = kalshiLockedPeriod
    ? [{ key: period.key, label: period.label || "Kalshi", sub: period.sub, disabled: true }]
    : GUARDRAILS_PERIODS.map((p) => ({ key: p.key, label: p.key, sub: p.sub }));

  // Window computed fresh on every drag frame (see computeStripWindow) so
  // thumbs don't clump at left:0 when the drag pushes a threshold past the
  // window bounds captured at render time.
  const initialWindow = computeStripWindow(effectiveDraft);
  let { stripLo, stripHi, stripSpan, currentLtv } = initialWindow;
  const pctToX = (pct, lo = stripLo, span = stripSpan) =>
    Math.min(100, Math.max(0, ((pct - lo) / span) * 100));
  // Colored zones between thresholds, sorted ascending by LTV
  const sortedStrip = GUARDRAILS_THRESHOLDS
    .map((t) => ({ ...t, pct: Math.max(0, Math.min(100, Number(effectiveDraft?.[t.field]) || 0)) }))
    .sort((a, b) => a.pct - b.pct);
  const stripZones = sortedStrip.map((t, i) => {
    const x1 = pctToX(i === 0 ? stripLo : sortedStrip[i - 1].pct);
    const x2 = pctToX(t.pct);
    return `<div class="guardrails-chart__strip-zone guardrails-chart__strip-zone--${t.tone}" style="left:${x1.toFixed(2)}%;width:${(x2 - x1).toFixed(2)}%"></div>`;
  }).join("") + `<div class="guardrails-chart__strip-zone guardrails-chart__strip-zone--rose" style="left:${pctToX(sortedStrip[sortedStrip.length - 1]?.pct || 0).toFixed(2)}%;right:0;width:auto"></div>`;
  const thumbSpec = GUARDRAILS_THRESHOLDS.map((t) => {
    const pct = Math.max(0, Math.min(100, Number(effectiveDraft?.[t.field]) || 0));
    return {
      threshold: t,
      pct,
      x: pctToX(pct),
      short: t.key === "targetLow" ? "LOW" : t.key === "targetHigh" ? "HIGH" : t.key === "autoRepay" ? "REPAY" : "EMG",
      row: 0,
    };
  });
  thumbSpec
    .slice()
    .sort((a, b) => a.x - b.x)
    .reduce((rows, spec) => {
      const collisionGap = 12;
      const row = rows.findIndex((lastX) => Math.abs(spec.x - lastX) >= collisionGap);
      const nextRow = row >= 0 ? row : rows.length;
      spec.row = Math.min(nextRow, 1);
      rows[spec.row] = spec.x;
      return rows;
    }, []);
  const stripRowCount = Math.max(1, ...thumbSpec.map((spec) => spec.row + 1));
  const stripThumbs = thumbSpec.map((spec) => {
    const { threshold: t, pct, x, short, row } = spec;
    const valueText = `${t.label}: ${pct.toFixed(1)}% debt pressure`;
    return `<button type="button" role="slider" class="guardrails-chart__strip-thumb guardrails-chart__strip-thumb--${t.tone}" data-guardrail-strip="${t.field}" style="left:${x.toFixed(2)}%;--strip-row:${row}" title="${escapeHtml(valueText)}" aria-label="${escapeHtml(t.label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct.toFixed(1)}" aria-valuetext="${escapeHtml(valueText)}">
      <span class="guardrails-chart__strip-label">${short}</span>
      <span class="guardrails-chart__strip-pct">${pct.toFixed(1)}%</span>
    </button>`;
  }).join("");
  const zoneLegend = !interactive
    ? `<div class="guardrails-chart__zones" aria-label="Risk zones">
        <span class="legend-chip legend-chip--mint">Target ≤ ${((Number(effectiveDraft?.targetLtvLowPct) || 0)).toFixed(1)}%</span>
        <span class="legend-chip legend-chip--amber">De-risk ${((Number(effectiveDraft?.targetLtvHighPct) || 0)).toFixed(1)}%</span>
        <span class="legend-chip legend-chip--amber">Repay ${((Number(effectiveDraft?.autoRepayLtvPct) || 0)).toFixed(1)}%</span>
        <span class="legend-chip legend-chip--rose">Freeze ${((Number(effectiveDraft?.emergencyLtvPct) || 0)).toFixed(1)}%</span>
      </div>`
    : "";
  const stripCurrent = currentLtv > 0
    ? `<div class="guardrails-chart__strip-now" style="left:${pctToX(currentLtv).toFixed(2)}%" title="Current debt pressure ${currentLtv.toFixed(1)}%"></div>`
    : "";
  const seriesPrices = points
    .map((point) => Number(point?.price))
    .filter((price) => Number.isFinite(price) && price > 0);
  const seriesMinPrice = seriesPrices.length ? Math.min(...seriesPrices) : spot;
  const seriesMaxPrice = seriesPrices.length ? Math.max(...seriesPrices) : spot;
  const seriesStartPrice = seriesPrices.length ? seriesPrices[0] : spot;
  const seriesAnchorPrice = Math.max(1, Number(series.referencePriceUsd) || spot);
  const focusedStripField = interactive && host.contains(document.activeElement)
    ? document.activeElement?.getAttribute?.("data-guardrail-strip") || ""
    : "";

  host.innerHTML = `
    <div class="guardrails-chart guardrails-chart--${interactive ? "edit" : "view"}" data-overlay="${escapeHtml(state.overlay)}" data-series-start-price-usd="${seriesStartPrice.toFixed(2)}" data-series-min-price-usd="${seriesMinPrice.toFixed(2)}" data-series-max-price-usd="${seriesMaxPrice.toFixed(2)}" data-series-reference-price-usd="${seriesAnchorPrice.toFixed(2)}">
      <div class="guardrails-chart__top">
        <div class="segmented segmented--exclusive guardrails-chart__chips" role="radiogroup" aria-label="Overlay">${chipHtml("overlay", GUARDRAILS_OVERLAYS, state.overlay)}</div>
        <div class="segmented segmented--exclusive guardrails-chart__chips guardrails-chart__chips--period" role="radiogroup" aria-label="Period">${chipHtml("period", periodItems, kalshiLockedPeriod ? period.key : state.period)}</div>
      </div>
      <svg class="guardrails-chart__svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Guardrails corridor chart">
        ${gridLines}
        ${stressZoneHtml}
        ${bandHtml}
        ${spotHtml}
        ${lineHtml}
        ${thrLinesHtml}
        ${xLabels}
      </svg>
      ${zoneLegend}
      ${interactive ? `
      <div class="guardrails-chart__strip" aria-label="Debt pressure scale — drag markers to adjust thresholds" style="--strip-rows:${stripRowCount}">
        <div class="guardrails-chart__strip-track">${stripZones}</div>
        ${stripCurrent}
        ${stripThumbs}
        <div class="guardrails-chart__strip-axis">
          <span>${stripLo.toFixed(1)}%</span><span>${((stripLo + stripHi) / 2).toFixed(1)}%</span><span>${stripHi.toFixed(1)}%</span>
        </div>
      </div>` : ""}
      <p class="guardrails-chart__note">${escapeHtml(series.note || "")}${series.stale ? ' <span class="guardrails-chart__stale" title="Forecast older than its freshness window">· stale</span>' : ""}</p>
    </div>
  `;

  // Bind chip clicks
  host.querySelectorAll("[data-guardrail-group]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const g = btn.dataset.guardrailGroup;
      const v = btn.dataset.guardrailValue;
      if (g === "overlay") {
        state.overlay = v;
        // Overlay picker owns fetch initiation — buildGuardrailsSeries is
        // now pure. Kick off forecast loads only on the transition, and
        // rerender once resolved so the chart leaves its loading state.
        if (v === "polymarket" && ["idle", "unavailable"].includes(appState.marketForecastStatus)) {
          ensureScenarioForecastLoaded().finally(() => rerenderScenarioChecksForCurrentPage());
        } else if (v === "kalshi" && ["idle", "unavailable"].includes(appState.kalshiForecastStatus)) {
          ensureKalshiForecastLoaded().finally(() => rerenderScenarioChecksForCurrentPage());
        }
      } else if (g === "period" && state.overlay !== "kalshi") state.period = v;
      if (_guardrailsRafId) cancelAnimationFrame(_guardrailsRafId);
      _guardrailsRafId = requestAnimationFrame(() => renderGuardrailsChart(host, { draft: form ? readDraftFromForm() : effectiveDraft, interactive }));
    });
  });

  // Bind threshold dragging. During a drag we mutate SVG attributes in place
  // and update the form input silently; dispatching the "input" event would
  // trigger renderSetupPage → full HTML rebuild and kill pointer capture.
  if (interactive) {
    // Phase D.36 strip-jitter root fix — when a strip-thumb drag is in flight,
    // freeze the stripLo/stripSpan window for the WHOLE syncThreshold pass
    // so the thumb's visual position (computed as
    // ((pctVal - stripLo) / stripSpan) * 100) doesn't jitter as the live
    // window reflows around the changing field value. Cleared on pointerup.
    let stripDragFrozenWindow = null;
    // Mirror one threshold change onto every DOM view of it: chart line + pill,
    // strip thumb, intersection markers.
    const syncThreshold = (field, ltvPct, priceUsd) => {
      const g = host.querySelector(`[data-guardrail-threshold="${field}"]`);
      if (g) {
        const y = clampY(priceToY(priceUsd));
        const line = g.querySelector("line");
        const rectHandle = g.querySelector("rect.guardrails-chart__handle");
        const pctText = g.querySelector("text.guardrails-chart__handle-text");
        if (line) { line.setAttribute("y1", y.toFixed(1)); line.setAttribute("y2", y.toFixed(1)); }
        if (rectHandle) rectHandle.setAttribute("y", (y - PILL_H / 2).toFixed(1));
        if (pctText) {
          pctText.setAttribute("y", (y + 3.6).toFixed(1));
          pctText.textContent = `${ltvPct.toFixed(1)}%`;
        }
        g.querySelectorAll(".guardrails-chart__cross").forEach((n) => n.remove());
        const tone = g.dataset.tone === "rose" ? "var(--chart-rose)" : g.dataset.tone === "amber" ? "var(--chart-amber)" : "var(--chart-mint)";
        const anchor = rectHandle || line;
        intersect(priceUsd).forEach((xFrac) => {
          const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          c.setAttribute("class", "guardrails-chart__cross");
          c.setAttribute("cx", xToPx(xFrac).toFixed(1));
          c.setAttribute("cy", y.toFixed(1));
          c.setAttribute("r", "3.4");
          c.setAttribute("fill", tone);
          if (anchor) g.insertBefore(c, anchor); else g.appendChild(c);
        });
      }
      // Recompute the window fresh from current form values every frame so
      // other thumbs reposition when the drag pushes a threshold past the
      // render-time window — otherwise they'd clamp to left:0 and clump.
      // EXCEPTION: while a strip-thumb drag is in flight (Phase D.36 jitter
      // root fix), keep the captured window so the dragged thumb's position
      // doesn't jitter as the window reflows around the live value. The
      // chart-axis drag still recomputes (its bounds let the threshold push
      // far enough that other thumbs would clump without rewindowing).
      const liveDraft = form ? readDraftFromForm() : effectiveDraft;
      if (stripDragFrozenWindow) {
        stripLo = stripDragFrozenWindow.lo;
        stripHi = stripDragFrozenWindow.hi;
        stripSpan = stripDragFrozenWindow.span;
      } else {
        const win = computeStripWindow(liveDraft);
        stripLo = win.stripLo; stripHi = win.stripHi; stripSpan = win.stripSpan;
      }
      const refreshStripThumb = (t, pctVal) => {
        const el = host.querySelector(`[data-guardrail-strip="${t.field}"]`);
        if (!el) return;
        const x = Math.min(100, Math.max(0, ((pctVal - stripLo) / stripSpan) * 100));
        el.style.left = `${x.toFixed(2)}%`;
        const valueText = `${t.label}: ${pctVal.toFixed(1)}% debt pressure`;
        el.setAttribute("aria-valuenow", pctVal.toFixed(1));
        el.setAttribute("aria-valuetext", valueText);
        el.title = valueText;
        const lbl = el.querySelector(".guardrails-chart__strip-pct");
        if (lbl) lbl.textContent = `${pctVal.toFixed(1)}%`;
      };
      GUARDRAILS_THRESHOLDS.forEach((t) => {
        const pctVal = t.field === field ? ltvPct
          : Math.max(0, Math.min(100, Number(liveDraft?.[t.field]) || 0));
        refreshStripThumb(t, pctVal);
      });
      // Refresh axis labels so they track the zoomed window during drag.
      const axis = host.querySelector(".guardrails-chart__strip-axis");
      if (axis) {
        const spans = axis.querySelectorAll("span");
        if (spans[0]) spans[0].textContent = `${stripLo.toFixed(1)}%`;
        if (spans[1]) spans[1].textContent = `${((stripLo + stripHi) / 2).toFixed(1)}%`;
        if (spans[2]) spans[2].textContent = `${stripHi.toFixed(1)}%`;
      }
      reflowStripRows();
    };

    // Single-row layout: give the pill closer to the center of the strip a
    // higher z-index so its label stays readable when thumbs overlap.
    const reflowStripRows = () => {
      const wrapper = host.querySelector(".guardrails-chart__strip");
      const thumbs = Array.from(host.querySelectorAll("[data-guardrail-strip]"));
      if (thumbs.length === 0 || !wrapper) return;
      thumbs.forEach((node) => {
        node.style.setProperty("--strip-row", "0");
        const pct = parseFloat(node.style.left) || 0;
        node.style.zIndex = String(100 - Math.abs(pct - 50));
      });
      wrapper.style.setProperty("--strip-rows", "1");
    };

    reflowStripRows();

    host.querySelectorAll("[data-guardrail-threshold]").forEach((g) => {
      const field = g.dataset.guardrailThreshold;
      g.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        g.setPointerCapture?.(ev.pointerId);
        _guardrailsDragging = true;
        const svg = host.querySelector(".guardrails-chart__svg");
        const rect = svg.getBoundingClientRect();
        const input = form?.elements?.namedItem(field);
        if (!input) { _guardrailsDragging = false; return; }
        // Clamp drag to the field's allowed bounds (e.g. emergency ≤ maxLtv −
        // gap) so the handle doesn't visually overshoot and snap back when the
        // change event re-clamps on release.
        const fieldBounds = getGuardrailBoundsForField(effectiveDraft, field);
        let latestLtv = Number(input.value) || 0;
        const onMove = (e) => {
          const ratio = (e.clientY - rect.top) / rect.height;
          const yPx = Math.max(padT, Math.min(padT + plotH, ratio * H));
          const rawPrice = pMin + (1 - (yPx - padT) / plotH) * (pMax - pMin);
          if (!(rawPrice > 0)) return;
          const ltv = calculateLtvPctForPriceUsd(effectiveDraft, rawPrice);
          if (!Number.isFinite(ltv)) return;
          const clamped = Math.max(fieldBounds.min, Math.min(fieldBounds.max, ltv));
          const smoothed = Math.round(clamped * 10) / 10;
          latestLtv = smoothed;
          input.value = smoothed.toFixed(1);
          const smoothedPrice = calculateTriggerPriceUsd(effectiveDraft, smoothed) || rawPrice;
          syncThreshold(field, smoothed, smoothedPrice);
        };
        const onUp = (e) => {
          try { g.releasePointerCapture?.(e.pointerId); } catch (_) {}
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onUp);
          _guardrailsDragging = false;
          input.value = latestLtv.toFixed(1);
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
      });
    });

    host.querySelectorAll("[data-guardrail-strip]").forEach((btn) => {
      const field = btn.dataset.guardrailStrip;
      btn.addEventListener("keydown", (ev) => {
        const input = form?.elements?.namedItem(field);
        if (!input) return;
        const bounds = getGuardrailBoundsForField(form ? readDraftFromForm() : effectiveDraft, field);
        const current = Number(input.value) || 0;
        const baseStep = Math.max(0.5, Number(input.step) || 0.5);
        let next = current;
        if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") next = current - baseStep;
        else if (ev.key === "ArrowRight" || ev.key === "ArrowUp") next = current + baseStep;
        else if (ev.key === "PageDown") next = current - 5;
        else if (ev.key === "PageUp") next = current + 5;
        else if (ev.key === "Home") next = bounds.min;
        else if (ev.key === "End") next = bounds.max;
        else return;

        ev.preventDefault();
        const clamped = Math.max(bounds.min, Math.min(bounds.max, next));
        const smoothed = Math.round(clamped * 10) / 10;
        input.value = smoothed.toFixed(1);
        const nextDraft = form ? readDraftFromForm() : effectiveDraft;
        const priceAtLtv = calculateTriggerPriceUsd(nextDraft, smoothed) || 0;
        syncThreshold(field, smoothed, priceAtLtv);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });

      btn.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        btn.setPointerCapture?.(ev.pointerId);
        _guardrailsDragging = true;
        const strip = host.querySelector(".guardrails-chart__strip");
        const rect = strip.getBoundingClientRect();
        const input = form?.elements?.namedItem(field);
        if (!input) { _guardrailsDragging = false; return; }
        const fieldBounds = getGuardrailBoundsForField(effectiveDraft, field);
        let latestLtv = Number(input.value) || 0;
        // Phase D.36 jitter root fix — freeze the strip window for both
        // the LTV value calculation AND the thumb visual positioning
        // (refreshStripThumb in syncThreshold reads stripDragFrozenWindow
        // when set). Cleared on pointerup; chart-axis drag is unaffected
        // because it never sets the freeze flag.
        stripDragFrozenWindow = { lo: stripLo, hi: stripHi, span: stripSpan, field };
        const dragStripLo = stripLo;
        const dragStripSpan = stripSpan;
        const onMove = (e) => {
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          const ltv = dragStripLo + ratio * dragStripSpan;
          const clamped = Math.max(fieldBounds.min, Math.min(fieldBounds.max, ltv));
          const smoothed = Math.round(clamped * 10) / 10;
          latestLtv = smoothed;
          input.value = smoothed.toFixed(1);
          const priceAtLtv = calculateTriggerPriceUsd(effectiveDraft, smoothed) || 0;
          syncThreshold(field, smoothed, priceAtLtv);
        };
        const onUp = (e) => {
          try { btn.releasePointerCapture?.(e.pointerId); } catch (_) {}
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onUp);
          _guardrailsDragging = false;
          stripDragFrozenWindow = null;
          input.value = latestLtv.toFixed(1);
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
      });
    });

    if (focusedStripField) {
      const nextFocusedStrip = Array.from(host.querySelectorAll("[data-guardrail-strip]"))
        .find((node) => node.getAttribute("data-guardrail-strip") === focusedStripField);
      if (nextFocusedStrip instanceof HTMLElement) {
        requestAnimationFrame(() => nextFocusedStrip.focus({ preventScroll: true }));
      }
    }
  }
}

// Reference historical scenarios. `drawdownPct` is the peak downside we replay
// through the simulator, while `rawDrawdownPct` can stay closer to the
// terminal move if the real window rebounded before it closed.
// `contextPath` is the real BTC trajectory stored as drawdowns relative to the
// event-start price, with `xDays` counted from event start (negative = before).
// The chart uses it to fill the window with the actual historical move instead
// of painting flat/random pads around the event.
const HISTORICAL_REFERENCE_SCENARIOS = [
  {
    id: "covid-2020-03",
    label: "Mar 2020 · COVID",
    note: "BTC -50% in 48h, vol past 150%.",
    drawdownPct: 0.50,
    rawDrawdownPct: 0.50,
    horizonKey: "shock",
    durationDays: 2,
    sourceLabel: "Historical replay",
    anchorPriceUsd: 7900,
    anchorLabel: "Mar 11 2020",
    // Event-start anchor: Mar 11 2020 close ~$7,900. Drawdowns vs that anchor.
    contextPath: [
      { xDays: -90, drawdownPct: -0.032 },
      { xDays: -60, drawdownPct: -0.177 },
      { xDays: -30, drawdownPct: -0.253 },
      { xDays: -14, drawdownPct: -0.203 },
      { xDays: -7, drawdownPct: -0.089 },
      { xDays: 0, drawdownPct: 0 },
      { xDays: 1, drawdownPct: 0.266 },
      { xDays: 2, drawdownPct: 0.500 },
      { xDays: 3, drawdownPct: 0.380 },
      { xDays: 7, drawdownPct: 0.329 },
      { xDays: 14, drawdownPct: 0.177 },
      { xDays: 30, drawdownPct: 0.127 },
      { xDays: 60, drawdownPct: -0.101 },
      { xDays: 90, drawdownPct: -0.165 },
      { xDays: 180, drawdownPct: -0.367 },
    ],
  },
  {
    id: "terra-2022-05",
    label: "May 2022 · Terra",
    note: "LUNA/UST unwind week.",
    drawdownPct: 0.31,
    rawDrawdownPct: 0.31,
    horizonKey: "week",
    durationDays: 7,
    sourceLabel: "Historical replay",
    anchorPriceUsd: 34000,
    anchorLabel: "May 8 2022",
    // Event-start anchor: May 8 2022 ~$34,000.
    contextPath: [
      { xDays: -90, drawdownPct: -0.360 },
      { xDays: -60, drawdownPct: -0.341 },
      { xDays: -30, drawdownPct: -0.276 },
      { xDays: -14, drawdownPct: -0.162 },
      { xDays: -7, drawdownPct: -0.074 },
      { xDays: 0, drawdownPct: 0 },
      { xDays: 2, drawdownPct: 0.118 },
      { xDays: 4, drawdownPct: 0.235 },
      { xDays: 5, drawdownPct: 0.300 },
      { xDays: 7, drawdownPct: 0.103 },
      { xDays: 14, drawdownPct: 0.141 },
      { xDays: 30, drawdownPct: 0.088 },
      { xDays: 60, drawdownPct: 0.365 },
      { xDays: 90, drawdownPct: 0.321 },
      { xDays: 180, drawdownPct: 0.412 },
    ],
  },
  {
    id: "ftx-2022-11",
    label: "Nov 2022 · FTX",
    note: "FTX insolvency contagion.",
    drawdownPct: 0.22,
    rawDrawdownPct: 0.22,
    horizonKey: "week",
    durationDays: 7,
    sourceLabel: "Historical replay",
    anchorPriceUsd: 21200,
    anchorLabel: "Nov 6 2022",
    // Event-start anchor: Nov 6 2022 ~$21,200.
    contextPath: [
      { xDays: -90, drawdownPct: 0.085 },
      { xDays: -60, drawdownPct: 0.084 },
      { xDays: -30, drawdownPct: 0.059 },
      { xDays: -14, drawdownPct: 0.082 },
      { xDays: -7, drawdownPct: 0.033 },
      { xDays: 0, drawdownPct: 0 },
      { xDays: 2, drawdownPct: 0.128 },
      { xDays: 3, drawdownPct: 0.252 },
      { xDays: 5, drawdownPct: 0.197 },
      { xDays: 7, drawdownPct: 0.216 },
      { xDays: 14, drawdownPct: 0.236 },
      { xDays: 30, drawdownPct: 0.198 },
      { xDays: 60, drawdownPct: 0.200 },
      { xDays: 90, drawdownPct: -0.085 },
      { xDays: 180, drawdownPct: -0.321 },
    ],
  },
  {
    id: "tariff-2025-10",
    label: "Oct 2025 · Tariff whipsaw",
    note: "Oct 10-13 tariff shock: BTC flushed fast, then recovered most of the move.",
    drawdownPct: 0.17,
    rawDrawdownPct: 0.07,
    horizonKey: "shock",
    durationDays: 4,
    sourceLabel: "Historical replay",
    anchorPriceUsd: 121000,
    anchorLabel: "Oct 10 2025",
    pathPoints: [
      { x: 0, drawdownPct: 0 },
      { x: 0.14, drawdownPct: 0.04 },
      { x: 0.3, drawdownPct: 0.17 },
      { x: 0.56, drawdownPct: 0.11 },
      { x: 0.78, drawdownPct: 0.08 },
      { x: 1, drawdownPct: 0.07 },
    ],
    // Event-start anchor: Oct 10 2025 ~$121k.
    contextPath: [
      { xDays: -90, drawdownPct: 0.050 },
      { xDays: -60, drawdownPct: 0.008 },
      { xDays: -30, drawdownPct: -0.066 },
      { xDays: -14, drawdownPct: -0.033 },
      { xDays: -7, drawdownPct: -0.008 },
      { xDays: 0, drawdownPct: 0 },
      { xDays: 0.6, drawdownPct: 0.04 },
      { xDays: 1.2, drawdownPct: 0.17 },
      { xDays: 2.2, drawdownPct: 0.11 },
      { xDays: 3.1, drawdownPct: 0.08 },
      { xDays: 4, drawdownPct: 0.07 },
      { xDays: 7, drawdownPct: 0.083 },
      { xDays: 14, drawdownPct: 0.050 },
      { xDays: 30, drawdownPct: 0.140 },
      { xDays: 60, drawdownPct: 0.174 },
      { xDays: 90, drawdownPct: 0.215 },
      { xDays: 180, drawdownPct: 0.190 },
    ],
  },
  {
    id: "china-2021-06",
    label: "May-Jun 2021 · China unwind",
    note: "Mining ban and deleveraging month. BTC bled hard before stabilizing.",
    drawdownPct: 0.41,
    rawDrawdownPct: 0.41,
    horizonKey: "month",
    durationDays: 30,
    sourceLabel: "Historical replay",
    anchorPriceUsd: 49000,
    anchorLabel: "May 15 2021",
    pathPoints: [
      { x: 0, drawdownPct: 0 },
      { x: 0.16, drawdownPct: 0.11 },
      { x: 0.34, drawdownPct: 0.26 },
      { x: 0.56, drawdownPct: 0.41 },
      { x: 0.78, drawdownPct: 0.35 },
      { x: 1, drawdownPct: 0.41 },
    ],
    // Event-start anchor: May 15 2021 ~$49,000.
    contextPath: [
      { xDays: -120, drawdownPct: 0.018 },
      { xDays: -90, drawdownPct: -0.175 },
      { xDays: -60, drawdownPct: -0.173 },
      { xDays: -30, drawdownPct: -0.122 },
      { xDays: -14, drawdownPct: -0.306 },
      { xDays: -7, drawdownPct: -0.051 },
      { xDays: 0, drawdownPct: 0 },
      { xDays: 5, drawdownPct: 0.11 },
      { xDays: 10, drawdownPct: 0.26 },
      { xDays: 17, drawdownPct: 0.41 },
      { xDays: 23, drawdownPct: 0.35 },
      { xDays: 30, drawdownPct: 0.41 },
      { xDays: 60, drawdownPct: 0.195 },
      { xDays: 90, drawdownPct: 0.040 },
      { xDays: 180, drawdownPct: -0.163 },
    ],
  },
  {
    id: "bear-2022",
    label: "2022 · Bear market",
    note: "Rate shock, Terra, and insolvencies. Full-year structural drawdown.",
    drawdownPct: 0.65,
    rawDrawdownPct: 0.65,
    horizonKey: "year",
    durationDays: 365,
    sourceLabel: "Historical replay",
    anchorPriceUsd: 46200,
    anchorLabel: "Jan 1 2022",
    pathPoints: [
      { x: 0, drawdownPct: 0 },
      { x: 0.12, drawdownPct: 0.16 },
      { x: 0.28, drawdownPct: 0.28 },
      { x: 0.42, drawdownPct: 0.49 },
      { x: 0.58, drawdownPct: 0.58 },
      { x: 0.76, drawdownPct: 0.65 },
      { x: 1, drawdownPct: 0.65 },
    ],
    // Event-start anchor: Jan 1 2022 ~$46,200.
    contextPath: [
      { xDays: -60, drawdownPct: -0.233 },
      { xDays: -30, drawdownPct: -0.035 },
      { xDays: 0, drawdownPct: 0 },
      { xDays: 45, drawdownPct: 0.16 },
      { xDays: 100, drawdownPct: 0.28 },
      { xDays: 155, drawdownPct: 0.49 },
      { xDays: 210, drawdownPct: 0.58 },
      { xDays: 275, drawdownPct: 0.65 },
      { xDays: 365, drawdownPct: 0.65 },
      { xDays: 425, drawdownPct: 0.500 },
      { xDays: 485, drawdownPct: 0.500 },
      { xDays: 545, drawdownPct: 0.407 },
    ],
  },
];

function getForecastDurationDays(forecast) {
  const observedAt = Date.parse(String(forecast?.observedAt || ""));
  const horizonAt = Date.parse(String(forecast?.horizonAt || ""));
  if (Number.isFinite(observedAt) && Number.isFinite(horizonAt) && horizonAt > observedAt) {
    // Fractional days allowed: Kalshi event markets often resolve in hours,
    // and the hours-label branch in buildGuardrailsSeries depends on this.
    return (horizonAt - observedAt) / 86400000;
  }
  return 90;
}


function bindStrategyPresets(form) {
  if (!form) return;
  const buttons = Array.from(form.querySelectorAll(".strategy-preset"));
  if (!buttons.length) return;
  const advanced = form.querySelector("[data-strategy-advanced]");
  const presetHint = form.querySelector("[data-strategy-preset-hint]");

  const syncPressed = () => {
    const draft = readDraftFromForm();
    const matchedKey = detectStrategyPreset(draft);
    const matched = matchedKey ? STRATEGY_PRESETS[matchedKey] : null;
    if (matchedKey) syncStrategyPresetField(form, matchedKey);
    const activePresetKey = String(form.elements.namedItem("strategyPreset")?.value || "").trim() || matchedKey;
    buttons.forEach((btn) => {
      const isActive = btn.dataset.preset === activePresetKey;
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
      const modifiedChip = btn.querySelector('[data-preset-modified]');
      if (modifiedChip) {
        modifiedChip.hidden = !(isActive && !matched);
      }
    });
    if (presetHint) {
      presetHint.textContent = matched
        ? `Preset: ${matched.label}`
        : "Preset overridden";
    }
    if (advanced && !matched && !advanced.open) {
      advanced.open = true;
    }
    // Phase D.36 — auto-tag scenario name as "{preset} modified" when fields
    // drift from the preset baseline. Fires only when the current name is the
    // canonical preset Base Case (e.g. "Harbor Base Case"); any name the user
    // actually typed is preserved. Inverse is not auto-reverted — the user
    // can re-pick the preset to restore the Base Case name.
    if (activePresetKey && !matched) {
      const presetCanonical = PRESET_DEFAULT_NAMES[activePresetKey];
      const presetLabel = STRATEGY_PRESETS[activePresetKey]?.label;
      if (presetCanonical && presetLabel) {
        const headerField = document.querySelector("[data-header-name]");
        const currentName = String(headerField?.value || "").trim();
        const { root } = splitScenarioNameRoot(currentName);
        if (root.toLowerCase() === presetCanonical.toLowerCase()) {
          const modifiedBase = `${presetLabel} modified`;
          const uniqueModified = makeUniqueScenarioName(
            modifiedBase,
            collectOwnedScenarioNames(appState.activeDraftId),
          );
          writeScenarioNameToForm(uniqueModified);
          if (appState.draft && typeof appState.draft === "object") {
            appState.draft.scenarioName = uniqueModified;
          }
          renderScenarioNameCollisionHint();
        }
      }
    }
  };

  if (!form.dataset.presetsBound) {
    form.dataset.presetsBound = "1";
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        applyStrategyPreset(form, btn.dataset.preset);
        syncPressed();
      });
    });
    form.querySelectorAll('input[name="mode"], input[name="priority"], input[name="monthlyPayoutTargetUsd"], input[name="desiredRunwayMonths"], input[name="minStableBufferUsd"], input[name="maxLtvPct"], input[name="targetLtvLowPct"], input[name="targetLtvHighPct"], input[name="autoRepayLtvPct"], input[name="emergencyLtvPct"], input[name="allowPayoutPauseInStress"], input[name="allowNewBorrowInStress"], input[name="allowNewBorrowInCrisis"]').forEach((radio) => {
      radio.addEventListener("change", syncPressed);
    });
  }

  syncPressed();
}

function renderIntentSwapUsd(draft) {
  renderCollateralAmountValidation(draft);
  renderBtcPriceMeta(draft);
}

function renderCollateralAmountValidation(draft) {
  const input = document.querySelector('input[name="btcUnits"]');
  if (!input) return;
  const errEl = document.querySelector("[data-collateral-amount-error]");
  const scope = String(draft?.createScope || "shadow").toLowerCase() === "live" ? "live" : "shadow";
  if (scope !== "live") {
    input.classList.remove("is-over-balance");
    if (errEl) { errEl.hidden = true; errEl.textContent = ""; }
    input.removeAttribute("max");
    return;
  }
  const wallet = getWalletState();
  const balances = Array.isArray(wallet?.btcBalances) ? wallet.btcBalances : [];
  const sym = String(draft?.collateralAssetSymbol || "BTC").toUpperCase();
  const coinType = String(draft?.collateralCoinType || "").toLowerCase();
  let match = null;
  if (coinType) match = balances.find((b) => String(b?.coinType || "").toLowerCase() === coinType) || null;
  if (!match) match = balances.find((b) => String(b?.symbol || "").toUpperCase() === sym) || null;
  const available = Number(match?.display) || 0;
  if (available > 0) input.max = String(available);
  const requested = Number(draft?.btcUnits) || 0;
  const over = available > 0 && requested > available + 1e-8;
  input.classList.toggle("is-over-balance", over);
  if (errEl) {
    if (over) {
      errEl.textContent = `Exceeds wallet balance: ${available.toFixed(4)} ${sym}`;
      errEl.hidden = false;
    } else {
      errEl.textContent = "";
      errEl.hidden = true;
    }
  }
}

let _btcPriceMetaTimer = null;

function renderBtcPriceMeta(draft) {
  if (!form) return;
  const input = form.elements.namedItem("btcPriceUsd");
  if (!input || !(input instanceof HTMLInputElement)) return;
  const meta = document.querySelector("[data-btc-price-meta]");
  const reset = document.querySelector("[data-btc-price-reset]");
  const wrapperSymbol = getCollateralAssetSymbol(draft);
  const livePrice = getPreferredLiveWrapperPriceUsd(wrapperSymbol);
  const globalLivePrice = getPreferredLiveBtcPriceUsd();
  const scope = String(draft?.createScope || "shadow").toLowerCase() === "live" ? "live" : "shadow";

  // On wrapper change drop any "user-edited" marker so the spot input snaps
  // back to the new wrapper's live price — a price manually set for xBTC
  // doesn't carry any meaning once the user switches to WBTC.
  const lastWrapper = String(input.dataset.wrapperSymbol || "");
  const wrapperChanged = Boolean(lastWrapper && lastWrapper !== wrapperSymbol);
  if (wrapperChanged) {
    delete input.dataset.liveAutoFilled;
    delete input.dataset.userEditedPrice;
  }
  input.dataset.wrapperSymbol = wrapperSymbol;

  if (scope === "live") {
    input.readOnly = true;
    input.dataset.liveLocked = "1";
    if (livePrice > 0 && Math.abs(Number(input.value || 0) - livePrice) > 0.5) {
      input.value = String(Math.round(livePrice));
    }
  } else {
    input.readOnly = false;
    delete input.dataset.liveLocked;
    if (livePrice > 0) {
      // Keep the spot input in sync with live as long as the user hasn't
      // manually edited it. We track the last auto-filled value in a dataset
      // marker; a real keystroke clears it (see input listener below), which
      // pins the current value until the user hits "Reset to reference".
      const cur = Number(input.value || 0);
      const lastAuto = Number(input.dataset.liveAutoFilled || 0);
      const defaultPrice = asNumber(DEFAULT_DRAFT.btcPriceUsd);
      const matchesAutoSeed = (value) => (
        value > 0 && (
          Math.abs(value - lastAuto) < 0.5
          || Math.abs(value - defaultPrice) < 0.5
          || (globalLivePrice > 1_000 && Math.abs(value - globalLivePrice) < 0.5)
        )
      );
      const userEdited = input.dataset.userEditedPrice === "true"
        || (cur > 0 && !wrapperChanged && !matchesAutoSeed(cur));
      const rounded = Math.round(livePrice);
      if ((wrapperChanged || !userEdited) && cur !== rounded) {
        input.value = String(rounded);
        input.dataset.liveAutoFilled = String(rounded);
        delete input.dataset.userEditedPrice;
      } else if (!userEdited && !input.dataset.liveAutoFilled) {
        input.dataset.liveAutoFilled = String(rounded);
      }
    }
  }

  if (meta) {
    if (livePrice > 0) {
      const ts = appState.btcPriceUpdatedAt ? Math.floor((Date.now() - appState.btcPriceUpdatedAt) / 1000) : 0;
      meta.textContent = `Verified price snapshot · $${Math.round(livePrice).toLocaleString("en-US")} · updated ${ts}s ago`;
    } else {
      meta.textContent = "";
    }
  }

  if (reset && livePrice > 0) {
    const cur = Number(input.value) || 0;
    const driftPct = cur > 0 ? Math.abs(cur - livePrice) / livePrice : 0;
    reset.hidden = !(scope !== "live" && driftPct > 0.005);
  } else if (reset) {
    reset.hidden = true;
  }

  if (!input.dataset.priceBound) {
    input.dataset.priceBound = "1";
    input.addEventListener("input", (ev) => {
      if (input.dataset.liveLocked) return;
      if (ev.isTrusted) {
        delete input.dataset.liveAutoFilled;
        input.dataset.userEditedPrice = "true";
      }
      renderBtcPriceMeta(readDraftFromForm());
    });
  }

  if (reset && !reset.dataset.bound) {
    reset.dataset.bound = "1";
    reset.addEventListener("click", (ev) => {
      ev.preventDefault();
      const currentDraft = readDraftFromForm();
      const lp = getPreferredLiveWrapperPriceUsd(getCollateralAssetSymbol(currentDraft));
      if (lp <= 0) return;
      const rounded = Math.round(lp);
      input.value = String(rounded);
      input.dataset.liveAutoFilled = String(rounded);
      delete input.dataset.userEditedPrice;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  if (!_btcPriceMetaTimer && currentPage === "setup") {
    _btcPriceMetaTimer = setInterval(() => {
      try {
        syncMarketPriceIntoState();
        if (form) renderBtcPriceMeta(readDraftFromForm());
      } catch (_) {}
    }, 60_000);
  }
}

function buildRecommendationSummary(draft, report) {
  const baseline = report.baseline;
  const summary = report.summary;
  const health = summary.averageHealthScore;
  const state = baseline.operatingState;
  const ltv = summary.currentLtv * 100;
  const targetHigh = asNumber(draft.targetLtvHighPct);
  const emergency = asNumber(draft.emergencyLtvPct);
  const bufferDays = summary.bufferCoverageDays;
  const payoutLow = summary.survivablePayoutBandLowUsd;
  const payoutTarget = asNumber(draft.monthlyPayoutTargetUsd);
  const collateral = asNumber(draft.btcUnits) * asNumber(draft.btcPriceUsd);
  const debtUsd = asNumber(draft.debtUsd);

  const bullets = [];

  // Modeled operator notes. Keep these non-advisory: the user still decides and signs.
  if (state === "StressLockdown") {
    const repayAmount = Math.round(debtUsd - collateral * (targetHigh / 100));
    bullets.push({ tone: "rose", text: `Modeled lockdown gap: ~${formatUsd(Math.max(0, repayAmount))} debt reduction or added collateral would bring debt pressure back inside policy.` });
  } else if (state === "DeRisk") {
    bullets.push({ tone: "amber", text: `Modeled debt pressure is above the ${targetHigh}% ceiling; operator review can compare debt reduction, added BTC, or wider thresholds.` });
  } else if (state === "BuildBuffer") {
    const bufferNeeded = Math.round(asNumber(draft.minStableBufferUsd) - asNumber(draft.stableBufferUsd));
    bullets.push({ tone: "amber", text: bufferNeeded > 0 ? `Modeled buffer gap: ~${formatUsd(bufferNeeded)} stable reserve before the minimum floor is restored.` : "The model keeps monthly draws paused until buffer returns above the safety floor." });
  }

  if (bufferDays < 30) {
    bullets.push({ tone: "amber", text: `Modeled runway is ${bufferDays} days; operator review can test a higher reserve floor before any payout approval.` });
  }

  if (payoutLow < payoutTarget * 0.5 && payoutTarget > 0) {
    bullets.push({ tone: "amber", text: `Under stress, modeled income band falls to ${formatUsd(payoutLow)}/mo. Review can test a lower ${formatUsd(payoutTarget)} target or higher collateral.` });
  }

  if (ltv >= emergency) {
    bullets.push({ tone: "rose", text: `Debt pressure is at or above the ${emergency}% emergency line; the model marks this as an operator-review boundary.` });
  } else if (ltv > targetHigh) {
    bullets.push({ tone: "amber", text: `Debt pressure is ${ltv.toFixed(1)}%, above the ${targetHigh}% ceiling; monitor the next price move before approval.` });
  }

  if (health >= 70 && bullets.length === 0) {
    bullets.push({ tone: "mint", text: "The model stays inside policy across the stress ladder." });
  } else if (health < 40) {
    bullets.push({ tone: "rose", text: "The model is fragile across the ladder; review guardrails and debt-pressure targets before approval." });
  }

  return bullets;
}

function buildHeroVerdict({ healthScore, stressSurvived, bufferDays, breakwaterTriggerPct }) {
  const score = Number(healthScore) || 0;
  const days = Math.max(0, Math.round(Number(bufferDays) || 0));
  const trigger = Math.round(Number(breakwaterTriggerPct) || 0);
  const triggerTxt = trigger > 0 ? `Breakwater trips at \u2212${trigger}% BTC` : "Breakwater is disarmed";
  if (!stressSurvived) {
    return {
      tone: "rose",
      line: `Policy breaks in the 2020\u20132022 replay \u2014 buffer runs out before the drawdown is over. Raise the buffer floor or tighten debt pressure before going live.`,
    };
  }
  // Phase D.8 \u2014 verdict copy now leads with the quantitative fact
  // (health score + buffer days) instead of hedge-words like
  // "barely survives". Operators read the number first; tone follows.
  if (score >= 75) {
    return {
      tone: "mint",
      line: `Health ${score}/100 \u00b7 buffer covers ${days} days of payout. Survives 2020\u20132022 replay; ${triggerTxt}.`,
    };
  }
  if (score >= 50) {
    return {
      tone: "amber",
      line: `Health ${score}/100 \u00b7 buffer covers ${days} days. Replay survives but any extra drawdown or missed refill eats the floor. ${triggerTxt}.`,
    };
  }
  return {
    tone: "amber",
    line: `Health ${score}/100 \u00b7 buffer covers only ${days} days. Replay survives marginally; ${triggerTxt.toLowerCase()}. Tighten thresholds before testnet proof.`,
  };
}

function buildResultsVerdict(resultsActionState, current) {
  const latestReceiptLink = getLatestProofReceiptLink();
  const latestReceiptSecondary = latestReceiptLink
    ? {
        secondaryCtaLabel: "Verify latest receipt",
        secondaryCtaHref: latestReceiptLink.href,
        secondaryCtaTitle: latestReceiptLink.selectedRail
          ? `Open the latest testnet receipt verifier (${latestReceiptLink.selectedRail})`
          : "Open the latest testnet receipt verifier",
      }
    : {};
  const createHref = buildSetupHref(
    current?.sourceScenarioId || readRouteScenarioIdFromUrl(),
    { policy: current?.onChainPolicy?.id || readRoutePolicyIdFromUrl() },
  );
  const proofCreateHref = buildSetupHref(
    current?.sourceScenarioId || readRouteScenarioIdFromUrl(),
    {
      policy: current?.onChainPolicy?.id || readRoutePolicyIdFromUrl(),
      proof: true,
      draft: current?.draft,
    },
  );
  const testnetCreateHref = buildTestnetSetupHref(
    "",
    { proof: true, draft: current?.draft },
  );
  if (!current?.report) {
    return {
      tone: "neutral",
      title: "No simulation run yet",
      // Phase D.32 → D.33 (G-4 + G-7) — operator-action voice with the
      // canonical verbs seeded before the operator must act on them.
      // "Save" is the publish-on-chain verb introduced here so it is
      // not first encountered as a button label without context.
      copy: "Author a policy in Create and run the simulation. The readout will show whether it survives the stress paths and what action to take. Save it on-chain when ready.",
      ctaLabel: "Open Create",
      ctaHref: createHref,
    };
  }

  if (resultsActionState.canExecuteLive) {
    const hasPolicy = Boolean(current?.onChainPolicy?.id);
    const hasReceipt = Boolean(current?.onChainReceipt?.id);
    const mintReadinessBlocker = hasPolicy && !hasReceipt
      ? getReceiptMintReadinessBlocker()
      : null;
    if (mintReadinessBlocker) {
      return {
        tone: "amber",
        title: "Refresh evidence before receipt",
        copy: mintReadinessBlocker.message,
        ctaLabel: "Refresh evidence",
        ctaAction: "readout-refresh-evidence",
        ctaHref: createHref,
        ...latestReceiptSecondary,
      };
    }
    return {
      tone: "mint",
      title: hasReceipt
        ? "Receipt is ready"
        : hasPolicy
          ? "Policy saved. Mint the receipt next"
          : "Run is ready to save",
      copy: hasReceipt
        ? "The policy and receipt are saved on testnet. Open the verifier to check what was decided and what evidence was pinned."
        : hasPolicy
          ? "Mint a receipt to make this decision shareable and verifiable."
          : "Save the policy on testnet first. After that, mint a receipt and open the verifier.",
      ctaLabel: hasReceipt
        ? "Open verifier"
        : hasPolicy
          ? "Mint receipt"
          : "Save on testnet",
      ctaAction: hasReceipt
        ? ""
        : hasPolicy
          ? "readout-mint-receipt"
          : "readout-save-policy",
      ctaHref: hasReceipt
        ? buildReceiptReadOnlyUrl(current.onChainReceipt, { config: getRuntimeConfig() })
        : "/results#readout-actions",
    };
  }

  switch (resultsActionState.liveReason) {
    case "live-disabled":
      return {
        tone: "amber",
        title: "Open this run on testnet",
        copy: "This environment is read-only. Continue the same draft on testnet to save the policy and mint a receipt.",
        ctaLabel: "Open testnet proof",
        ctaHref: testnetCreateHref,
        ...latestReceiptSecondary,
      };
    case "rerun-required":
      return {
        tone: "amber",
        variant: "compact",
        kicker: "Draft state",
        title: "Re-run before saving",
        copy: "Create changed after the last simulation. Run the current draft again before saving or minting receipts.",
        ctaLabel: "Open Create",
        ctaHref: createHref,
      };
    case "wallet-required":
      return {
        tone: "amber",
        title: "Connect wallet to save",
        copy: "The simulation is ready. Connect a Sui testnet wallet in Create to save this policy and mint a receipt. You can also inspect the latest canonical receipt now.",
        ctaLabel: "Open Create to connect wallet",
        ctaHref: createHref,
        ...latestReceiptSecondary,
      };
    case "live-scope-required":
      return {
        tone: "amber",
        title: "Switch to Testnet proof",
        copy: "This readout is still a local simulation. Switch the same draft to Testnet proof, connect wallet, then run it again before saving and minting. You can also inspect the latest canonical receipt now.",
        ctaLabel: "Arm Testnet proof",
        ctaHref: proofCreateHref,
        ...latestReceiptSecondary,
      };
    case "verified-live-data-required":
      return {
        tone: "amber",
        title: "Refresh market evidence",
        copy: "Receipt signing needs a verified rail and market snapshot. Open the Rail & venue section, refresh evidence, then run the proof again.",
        ctaLabel: "Refresh rail data in Create",
        ctaHref: appendHashToHref(createHref, "rail-data"),
        ...latestReceiptSecondary,
      };
    default:
      return {
        tone: "amber",
        title: "Review before proof",
        copy: resultsActionState.liveScopeState?.message || "This readout is usable for diagnosis, but not yet ready for testnet proof signing.",
        ctaLabel: "Open Create",
        ctaHref: createHref,
      };
  }
}

function renderResultsPage() {
  // Unified Readout structure: status, position hero, action ribbon,
  // autopilot ledger, stress, route, execute, position details, evidence.
  const status = $("#readout-status");
  const hero = $("#readout-hero");
  const action = $("#readout-action");
  const demoFrame = $("#results-demo-frame");
  const autopilot = $("#readout-autopilot");
  const positionCenter = currentPage === "live"
    ? $("#live-position-center")
    : $("#results-execution");
  const evidence = $("#results-market-forecast");
  const review = $("#results-review");
  const route = $("#results-route");
  const scenarios = $("#results-scenarios");
  const actionLog = $("#action-log");
  const healthNotes = $("#health-notes");
  const saveButton = $("#save-current");
  const exportButton = $("#export-current");

  const syncReadoutButtonReason = (button, reason, key) => {
    syncActionDisabledHint(button, reason, key || button?.id || "readout-action");
  };

  if (!status && !hero && !action && !demoFrame && !autopilot && !positionCenter && !evidence && !review && !route && !scenarios && !actionLog && !healthNotes) {
    return;
  }

  const routeRunId = readRouteRunIdFromUrl();
  const routePolicyId = readRoutePolicyIdFromUrl();
  const routeRunMatchesCurrent = Boolean(
    normalizeLiveHistoryText(routeRunId) &&
    normalizeLiveHistoryText(appState.current?.sourceScenarioId) === normalizeLiveHistoryText(routeRunId)
  );
  const routePolicyMatchesCurrent = Boolean(
    normalizeLiveHistoryText(routePolicyId) &&
    normalizeLiveHistoryText(appState.current?.onChainPolicy?.id) === normalizeLiveHistoryText(routePolicyId)
  );
  const routeReadoutMatchesSavedPolicy = Boolean(
    (currentPage === "results" || currentPage === "live") &&
    routePolicyMatchesCurrent &&
    appState.current?.draft &&
    appState.current?.report
  );
  const actionStateDraft = routeRunMatchesCurrent || routeReadoutMatchesSavedPolicy
    ? appState.current?.draft
    : appState.draft;
  const liveTrustState = getLiveDataTrustState(appState.current);
  const resultsActionState = getResultsActionState({
    current: appState.current,
    walletState: getWalletState(),
    draft: actionStateDraft,
    liveEnabled: isLiveEnabled(),
    liveDataVerified: liveTrustState.verified,
    proofContext: getCreateScopeProofContext(),
  });

  if (saveButton) {
    saveButton.hidden = !resultsActionState.connected && currentPage === "results";
    saveButton.disabled = !resultsActionState.canSaveScenario;
    const saveReason = !resultsActionState.hasCurrentRun
      ? "Run a simulation first"
      : resultsActionState.saveReason === "wallet-required"
        ? "Connect wallet to save this run to your account"
        : "Save the current run to your account";
    saveButton.title = saveReason;
    saveButton.setAttribute("aria-disabled", String(!resultsActionState.canSaveScenario));
    saveButton.textContent = "Save to account";
    syncReadoutButtonReason(saveButton, saveButton.hidden ? "" : saveReason, "save-current");
  }

  if (exportButton) {
    exportButton.disabled = !resultsActionState.canExportJson;
    const exportReason = resultsActionState.canExportJson ? "Export the current run as JSON" : "Run a simulation first";
    exportButton.title = exportReason;
    exportButton.setAttribute("aria-disabled", String(!resultsActionState.canExportJson));
    syncReadoutButtonReason(exportButton, exportReason, "export-current");
  }

  syncPolicyActionButtons();
  syncMintReceiptButton();
  syncReadoutEditCreateLinks(appState.current);

  const currentPolicyId = appState.current?.onChainPolicy?.id || "";
  const livePolicyLoadedNoReport = currentPage === "live"
    && routePolicyId
    && normalizeLiveHistoryText(routePolicyId) === normalizeLiveHistoryText(currentPolicyId)
    && !appState.current?.report;
  const livePolicyMissing = currentPage === "live" && !currentPolicyId;
  const livePolicyStillHydrating = currentPage === "live"
    && routePolicyId
    && normalizeLiveHistoryText(routePolicyId) !== normalizeLiveHistoryText(currentPolicyId);
  const showEmptyReadout = !appState.current?.report || livePolicyMissing || livePolicyStillHydrating;

  if (showEmptyReadout) {
    if (hero) {
      const emptyTitle = routeRunId && routePolicyId
        ? "Policy/run link mismatch"
        : routeRunId
          ? "Saved run not found"
          : livePolicyLoadedNoReport
            ? "Policy loaded read-only"
          : routePolicyId
            ? "Preparing live readout"
            : currentPage === "live" ? "No saved policy selected" : "No simulation run yet";
      const emptyCopy = routeRunId && routePolicyId
        ? "That link combines an on-chain policy with a modeled run that was not saved for the same policy."
        : routeRunId
          ? "That readout link points to a saved run that is no longer in this wallet workspace."
          : livePolicyLoadedNoReport
          ? "The on-chain policy is loaded. Connect wallet or open Create to rebuild the modeled snapshot before any signing action."
          : routePolicyId
          ? "This policy is on-chain, but the browser is rebuilding the modeled snapshot before showing the readout."
          : currentPage === "live"
          ? "Open Workspace to pick a live policy, then return here to monitor position."
          : "Author a policy in Create and run the simulation. The readout shows stress survival, position context, and the next modeled action.";
      const emptyCtaHref = livePolicyLoadedNoReport
        ? buildSetupHref("", { policy: currentPolicyId })
        : routeRunId || currentPage === "live" || routePolicyId ? "/" : "/setup";
      const emptyCtaLabel = livePolicyLoadedNoReport
        ? "Open Create"
        : routeRunId || currentPage === "live" || routePolicyId ? "Open Workspace" : "Open Create";
      // Empty-state hero — placed inside the new #readout-hero slot.
      safeReplaceChildren(hero, `
        <div class="empty-results-hero">
          <div class="empty-results-icon">
            <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">
              <circle cx="24" cy="24" r="20" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.4"/>
              <path d="M24 14v12M18 20l6-6 6 6" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <circle cx="24" cy="32" r="1.5" fill="var(--muted)"/>
            </svg>
          </div>
          <h2>${escapeHtml(emptyTitle)}</h2>
          <p class="surface-copy">${escapeHtml(emptyCopy)}</p>
          <div class="action-cluster workspace-actions">
            <a class="button button-primary" href="${escapeHtml(emptyCtaHref)}">${escapeHtml(emptyCtaLabel)}</a>
          </div>
        </div>
      `);
    }
    if (status) status.textContent = "";
    if (action) action.textContent = "";
    if (demoFrame) {
      demoFrame.textContent = "";
      demoFrame.hidden = true;
    }
    if (autopilot) autopilot.textContent = "";
    if (evidence) evidence.textContent = "";
    if (positionCenter) positionCenter.textContent = "";
    if (review) review.textContent = "";
    if (route) route.textContent = "";
    if (scenarios) scenarios.textContent = "";
    if (actionLog) actionLog.textContent = "";
    if (healthNotes) healthNotes.textContent = "";
    return;
  }

  const { draft, report } = appState.current;
  const summary = report.summary;
  const baseline = report.baseline;
  const baselineAllocation = baseline.allocation;
  const operatorReview = appState.current.operatorReview || buildOperatorReview(draft, report);
  const verdict = buildResultsVerdict(resultsActionState, appState.current);

  const recBullets = buildRecommendationSummary(draft, report);
  const onChainPolicyForReadout = appState.current?.onChainPolicy || null;
  const isLiveMode = Boolean(onChainPolicyForReadout?.id);
  const policyExplorerUrl = isLiveMode ? buildSuiExplorerUrl("object", onChainPolicyForReadout.id, getRuntimeConfig()) : "";
  const shortPolicyIdReadout = isLiveMode ? shortenMiddle(onChainPolicyForReadout.id, 6, 4) : "";
  const judgeMode = appState.current?.judge?.mode || resolveJudgeDemoMode(window.location.search);
  const judgeContext = appState.current?.judge || buildJudgeRunContext(judgeMode);
  const oracleReadback = getCurrentPythOracleReadback(judgeMode);

  // Mode-conditional page framing. The copy stays explicit that live is
  // still a rehearsed/read-only surface unless the wallet signs an action.
  const eyebrowEl = document.querySelector('[data-page-eyebrow]');
  if (eyebrowEl) {
    eyebrowEl.textContent = isLiveMode ? "Monitor" : "Readout";
  }
  const pageHeading = document.querySelector(".page-heading");
  const pageTitleEl = pageHeading?.querySelector("h1");
  const pageCopyEl = pageHeading?.querySelector(".page-copy");
  if (pageTitleEl) {
    pageTitleEl.textContent = isLiveMode ? "Policy Monitor" : "Readout";
  }
  if (pageCopyEl) {
    const cfg = getRuntimeConfig();
    const proofAvailable = cfg?.executionProof?.allowSigning === true && isExecutionReceiptsConfigured(cfg);
    pageCopyEl.textContent = isLiveMode
      ? "Review the saved policy, modeled position, receipts, and operator checklist. Testnet/read-only: nothing moves without your signature."
      : proofAvailable
        ? "Review the simulation output, inspect the evidence, then choose whether to save the policy or mint a receipt."
        : "Review the simulation output and inspect the evidence. This environment is read-only: no policy signing or proof minting.";
  }

  // ── Status strip — slim row of mode chip + scenario name + trust
  // posture + operator state. Replaces the old glance head's chips
  // row; lives at the very top of the page now so the operator's
  // first eye-line is "where am I and what mode is this".
  if (status) {
    const modeChipText = isLiveMode ? "On-chain policy · testnet" : "Simulation · modeled";
    const modeLabel = MODE_LABELS[draft.mode] || String(draft.mode || "Policy");
    const priorityLabel = PRIORITY_LABELS[draft.priority] || String(draft.priority || "Harbor");
    const trustVerified = liveTrustState?.verified;
    const trustChipText = trustVerified ? "Signed feed" : (liveTrustState?.mode === "fixture" ? "Fixture data" : "Unsigned feed");
    const oracleBadgeMeta = getPythOracleBadge(oracleReadback);
    const oracleBadge = oracleReadback?.source && oracleReadback.source !== "missing"
      ? renderIconBadge(oracleBadgeMeta.text, oracleBadgeMeta)
      : "";
    const modeBadge = renderIconBadge(modeChipText, {
      tone: isLiveMode ? "mint" : "cyan",
      iconName: isLiveMode ? "link" : "activity",
      title: isLiveMode ? "Saved policy readout; position values remain modeled unless marked as read-back." : "Modeled simulation readout; no signing happened.",
    });
    const policyIdChip = isLiveMode && shortPolicyIdReadout
      ? `<a class="ws-id-chip ws-id-chip--muted" href="${escapeHtml(policyExplorerUrl)}" target="_blank" rel="noopener">${escapeHtml(shortPolicyIdReadout)} ↗</a>`
      : "";
    const runId = normalizeLiveHistoryText(appState.current?.sourceScenarioId || readRouteRunIdFromUrl());
    const runIdChip = runId
      ? `<span class="ws-id-chip ws-id-chip--muted" title="${escapeHtml(runId)}">run ${escapeHtml(shortenMiddle(runId, 4, 4))}</span>`
      : "";
    const trustBadge = renderIconBadge(trustChipText, {
      tone: trustVerified ? "mint" : "amber",
      iconName: trustVerified ? "check" : "alert-triangle",
      title: trustVerified ? "Signed live feed is verified." : "Data is not backed by a signed live feed.",
    });
    // Phase D.22 — operator-state badge surfaces in saved-policy readout. The
    // badge says what the cockpit's local control posture is right
    // now (Active review / Paused / Exit planned / Closed locally).
    // It used to live BELOW the fold inside the execution panel; the
    // operator who arrived in crisis had to scroll past 6 surfaces
    // before they saw whether they themselves had paused approvals.
    // Now sits in the status strip next to the trust chip — the most
    // prominent state-signal row on the page.
    let postureBadge = "";
    if (isLiveMode) {
      const ctrlState = getPolicyLocalControlState(onChainPolicyForReadout.id);
      const ctrlMode = ctrlState?.mode || "active";
      const ctrlMeta = getLiveControlMeta(ctrlMode);
      const tone = ctrlMode === "paused" ? "amber"
        : ctrlMode === "unwound" ? ""
        : ctrlMode === "unwind-planned" ? "violet"
        : "cyan";
      const iconName = ctrlMode === "paused" ? "alert-triangle"
        : ctrlMode === "unwound" ? "check"
        : ctrlMode === "unwind-planned" ? "settings"
        : "activity";
      postureBadge = renderIconBadge(ctrlMeta.badge, { tone, iconName, title: ctrlMeta.status });
    }

    safeReplaceChildren(status, `
      ${modeBadge}
      ${policyIdChip}
      ${runIdChip}
      <span class="readout-status-name">${escapeHtml(draft.scenarioName)}</span>
      <span class="readout-status-meta">${escapeHtml(modeLabel)} · ${escapeHtml(priorityLabel)} · ${escapeHtml(dateTimeFormatter.format(new Date(report.generatedAt)))}</span>
      <span class="readout-status-spacer"></span>
      ${postureBadge}
      ${oracleBadge}
      ${trustBadge}
      <span class="readout-status-rail">${escapeHtml(summary.primaryRailName || "Pending rail")}</span>
    `);
  }

  // ── Position hero — paired charts on the left, KPI tiles on the
  // right. Two charts read as "one chart in two registers" (BTC price
  // axis + LTV axis), then the KPI column carries the numeric anchors
  // (Payout / Buffer / Breakwater / Health) so the hero answers "where
  // am I" and "what are the numbers" in one scan. In saved-policy readout the
  // chart inputs come from the on-chain collateral/debt; in sim mode
  // they use the draft's modeled values.
  if (hero) {
    const healthScore = summary.averageHealthScore;
    const stressSurvived = Number(summary.survivablePayoutBandLowUsd) > 0;
    const heroVerdict = buildHeroVerdict({
      healthScore,
      stressSurvived,
      bufferDays: summary.bufferCoverageDays,
      breakwaterTriggerPct: summary.breakwaterTriggerDrawdownPct,
    });
    const heroBtcPrice = getEffectiveBtcPriceUsd(draft);
    const heroCollateralBtc = asNumber(draft?.btcUnits);
    const heroDebtUsd = asNumber(draft?.debtUsd);
    const heroLtv = summary.currentLtv;
    const heroTargetLow = pctToDecimal(draft.targetLtvLowPct);
    const heroTargetHigh = pctToDecimal(draft.targetLtvHighPct);
    const heroMaxLtv = pctToDecimal(draft.maxLtvPct) || 0.6;

    safeReplaceChildren(hero, `
      <p class="readout-hero-verdict readout-hero-verdict--${heroVerdict.tone}">
        <span class="readout-hero-verdict__dot" aria-hidden="true"></span>
        <span class="readout-hero-verdict__text">${escapeHtml(heroVerdict.line)}</span>
      </p>

      <div class="readout-hero-grid">
        <div class="readout-hero-charts">
          <div class="scale-pair">
            <div class="scale-pair__head">
              <span class="section-label">Position context</span>
              <span class="route-card-meta-hint">${escapeHtml(getBtcPriceContextLabel({ oracleReadback }))}${escapeHtml(heroBtcPrice ? `$${Math.round(heroBtcPrice).toLocaleString()}` : "—")}</span>
            </div>
            ${renderPriceScale({
              currentPrice: heroBtcPrice,
              debtUsd: heroDebtUsd,
              collateralBtc: heroCollateralBtc,
              targetLow: heroTargetLow,
              targetHigh: heroTargetHigh,
              maxLtv: heroMaxLtv,
              label: "BTC drawdown sensitivity",
              live: isLiveMode,
            })}
            ${renderPositionScale(heroLtv, heroTargetLow, heroTargetHigh, heroMaxLtv, {
              label: "Debt pressure vs thresholds",
              live: isLiveMode,
            })}
          </div>
        </div>

        <div class="readout-hero-kpis">
          <div class="rg-cell">
            <span class="rg-label">Draw band</span>
            <strong>${formatUsdRange(summary.survivablePayoutBandLowUsd, summary.survivablePayoutBandHighUsd)}</strong>
            ${renderPayoutRangeBar(summary.survivablePayoutBandLowUsd, summary.survivablePayoutBandHighUsd, asNumber(draft.monthlyPayoutTargetUsd))}
          </div>
          <div class="rg-cell">
            <span class="rg-label">Buffer</span>
            <strong>${summary.bufferCoverageDays} days</strong>
            <span class="rg-sub">runway</span>
          </div>
          <div class="rg-cell">
            <span class="rg-label">Breakwater</span>
            <strong>${formatDrawdown(summary.breakwaterTriggerDrawdownPct)}</strong>
            <span class="rg-sub">modeled trigger</span>
          </div>
          <div class="rg-cell">
            <span class="rg-label">Health</span>
            <strong>${healthScore}/100</strong>
            <span class="rg-sub">${escapeHtml(baseline.health.label)}</span>
          </div>
        </div>
      </div>
    `);
  }

  // ── Action ribbon — slim full-width strip with verdict copy + tone
  // bullets + CTAs. The proof-timeline (when an on-chain receipt
  // exists) and the model-drag / fee-preview footnotes ride
  // underneath in a quieter type so they're discoverable but don't
  // compete with the verdict.
  if (action) {
    const inlineBulletCount = verdict.tone === "ready" ? 2 : 3;
    const inlineBullets = recBullets.slice(0, inlineBulletCount);
    const compactAction = verdict.variant === "compact";
    const chosenDecision = baseline?.result?.decision?.chosen || {};
    const rationaleLabel = resultsActionState.liveReason === "rerun-required"
      ? "Last modeled decision"
      : "Decision engine";
    const rationaleState = baseline?.operatingState
      ? formatOperatingStateLabel(baseline.operatingState)
      : "Modeled";
    const rationaleAction = chosenDecision?.type
      ? formatActionTypeLabel(chosenDecision.type)
      : "Decision pending";
    const rationaleCopy = chosenDecision?.explanation || chosenDecision?.reason || "Run a simulation to produce a decision rationale for this policy state.";
    const actionClasses = [
      "readout-action-card",
      `readout-action-card--${verdict.tone}`,
      compactAction ? "readout-action-card--compact" : "",
    ].filter(Boolean).join(" ");
    safeReplaceChildren(action, `
      <div class="${escapeHtml(actionClasses)}">
        <div class="readout-action-copy">
          <p class="section-label">${escapeHtml(verdict.kicker || "Policy verdict")}</p>
          ${compactAction
            ? `<p class="readout-action-line"><strong>${escapeHtml(verdict.title)}</strong><span>${escapeHtml(verdict.copy)}</span></p>`
            : `<h2>${escapeHtml(verdict.title)}</h2>
              <p class="surface-copy">${escapeHtml(verdict.copy)}</p>`}
          ${!compactAction && inlineBullets.length > 0
            ? `<ul class="results-verdict-bullets">
                ${inlineBullets.map((b) => `<li class="results-verdict-bullet results-verdict-bullet--${escapeHtml(b.tone)}">${escapeHtml(b.text)}</li>`).join("")}
              </ul>`
            : ""}
          <div class="readout-decision-rationale">
            <span>${escapeHtml(rationaleLabel)}</span>
            <strong>${escapeHtml(rationaleState)} · ${escapeHtml(rationaleAction)}</strong>
            <p>${escapeHtml(rationaleCopy)}</p>
          </div>
        </div>
        <div class="readout-action-cta">
          ${verdict.ctaAction
            ? `<button class="button button-primary" type="button" data-action="${escapeHtml(verdict.ctaAction)}">${escapeHtml(verdict.ctaLabel)}</button>`
            : `<a class="button button-primary" href="${escapeHtml(verdict.ctaHref)}">${escapeHtml(verdict.ctaLabel)}</a>`}
          ${verdict.secondaryCtaHref
            ? `<a class="button button-secondary" href="${escapeHtml(verdict.secondaryCtaHref)}"${verdict.secondaryCtaTitle ? ` title="${escapeHtml(verdict.secondaryCtaTitle)}"` : ""}>${escapeHtml(verdict.secondaryCtaLabel || "Verify latest receipt")}</a>`
            : ""}
        </div>
      </div>
      ${renderReceiptEvidencePanel({
        current: appState.current,
        policy: appState.current?.onChainPolicy || null,
      })}
      ${renderMarketPayoutBand(report, appState.current.marketBand)}
      <details class="readout-action-footnotes">
        <summary>Model drag · Fee preview · Policy status</summary>
        <p class="section-footnote">Baseline ${Math.max(1, Number(summary.baselineHorizonDays) || 30)}-day run includes ${formatUsd(Number(summary.baselineCarryCostUsd) || 0)} debt carry and ${formatUsd(Number(summary.baselineRebalanceCostUsd) || 0)} rebalance drag. Worst-case danger-zone penalty: ${formatUsd(Number(summary.worstCaseLiquidationPenaltyUsd) || 0)}${summary.liquidationScenarioLabel ? ` in ${escapeHtml(summary.liquidationScenarioLabel)}` : ""}.</p>
        <p class="section-footnote">${asNumber(summary.projectedTideFeeBpsAnnual) || 75} bps / yr platform fee preview on modeled debt ≈ ${formatUsd(Number(summary.projectedTideFeeUsd30d) || 0)} in a 30-day window (${formatPercentDecimal(Number(summary.projectedTideFeePctOfPayout) || 0)} of the monthly payout target).</p>
        <p class="section-footnote">${escapeHtml(renderPolicyStatusCopy())}</p>
      </details>
    `);
    markFirstPaintShimmer(action, `readout-action:${currentPage}:${report.generatedAt || ""}:${verdict.title || ""}`);
  }

  if (demoFrame) {
    if (judgeMode) {
      safeReplaceChildren(demoFrame, renderJudgeDemoFrame(judgeMode, judgeContext));
      demoFrame.hidden = false;
    } else {
      demoFrame.textContent = "";
      demoFrame.hidden = true;
    }
  }

  // ── Actions — run-scoped activity ledger. This sits near the top of
  // the readout because once a policy is saved, the activity tied to
  // this exact run is more important than route diagnostics or archived
  // decision traces. Policy-wide/export feeds stay available elsewhere;
  // this surface intentionally rejects unrelated wallet/user history.
  if (autopilot) {
    const currentReadoutScenarioId = getCurrentReadoutScenarioId(appState.current);
    if (isLiveMode) {
      const liveReceiptsForLedger = getReceiptsForPolicyRunFromWorkspace(onChainPolicyForReadout.id, currentReadoutScenarioId);
      const liveTxForLedger = getPolicyRunWalletTxHistory(onChainPolicyForReadout.id, currentReadoutScenarioId);
      const liveControlForLedger = getPolicyLocalControlState(onChainPolicyForReadout.id);
      const liveUnwindForLedger = getPolicyLocalUnwindProgress(onChainPolicyForReadout.id);
      const ledgerEvents = buildLiveActivityEvents(onChainPolicyForReadout, liveReceiptsForLedger, liveTxForLedger, liveControlForLedger, liveUnwindForLedger);
      const ledgerFilter = getActivityLedgerFilter();
      const onChainLedgerCount = ledgerEvents.filter(isOnChainActivityEvent).length;
      const visibleLedgerEvents = filterActivityLedgerEvents(ledgerEvents, ledgerFilter);
      if (ledgerEvents.length === 0) {
        safeReplaceChildren(autopilot, `
          <div class="section-head section-head-compact">
            <div>
              <p class="section-label">Actions</p>
              <h2>Run activity</h2>
            </div>
          </div>
          <p class="surface-copy">Policy is saved on-chain. Actions tied to this run appear here; unrelated wallet history stays out of the readout.</p>
        `);
      } else {
        safeReplaceChildren(autopilot, `
          <div class="section-head section-head-compact">
            <div>
              <p class="section-label">Actions</p>
              <h2>Run activity</h2>
            </div>
            <div class="activity-ledger-head-actions">
              ${renderActivityLedgerFilter(ledgerFilter, ledgerEvents.length, onChainLedgerCount)}
              <span class="state-badge">${visibleLedgerEvents.length} event${visibleLedgerEvents.length === 1 ? "" : "s"}</span>
            </div>
          </div>
          ${visibleLedgerEvents.length > 0
            ? `<ol class="tx-feed" aria-label="Run activity ledger">
                ${renderActivityLedgerRows(visibleLedgerEvents)}
              </ol>`
            : `<p class="surface-copy">No on-chain activity is recorded for this run yet. Switch to All to see local operator events and checklist progress.</p>`}
        `);
      }
    } else {
      // Phase D.8 — even in sim mode, surface failed wallet txs from
      // loadTxHistory so an operator who tried to anchor/mint and got
      // an error sees it on Readout instead of having to detour to
      // Workspace. Only renders the rows when at least one failed
      // entry exists for this exact run; otherwise the friendly
      // empty-state stays.
      const wallet = getWalletState();
      const failedTx = wallet.connected && wallet.address
        ? (loadTxHistory(wallet.address) || [])
          .filter((entry) => entry && entry.ok === false)
          .filter((entry) => currentReadoutScenarioId && normalizeLiveHistoryText(entry.sourceScenarioId) === currentReadoutScenarioId)
          .slice(0, 5)
        : [];
      if (failedTx.length > 0) {
        const fmtTime = (ts) => {
          if (!ts) return "—";
          try {
            const d = new Date(ts);
            return d.toLocaleDateString([], { month: "short", day: "2-digit" }) + " · " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          } catch (_) { return "—"; }
        };
        const failedRows = failedTx.map((entry) => `
          <li class="tx-row tx-row--danger">
            <span class="tx-row__time">${escapeHtml(fmtTime(entry.timestamp))}</span>
            <span class="tx-row__kind tx-row__kind--danger">Failed</span>
            <div class="tx-row__body">
              <strong>${escapeHtml(formatLiveActivityLabel(entry.description || entry.action, "Wallet tx failed"))}</strong>
              <span>${escapeHtml(entry.protocol || "Sui")}${entry.txId ? ` · ${renderProofTimelineHash({ kind: "tx", value: shortenMiddle(entry.txId, 6, 4), rawValue: entry.txId })}` : ""}</span>
            </div>
            ${entry.txId
              ? `<a class="tx-row__link" href="${escapeHtml(buildSuiExplorerUrl("tx", entry.txId, getRuntimeConfig()))}" target="_blank" rel="noopener">Open ↗</a>`
              : `<span class="tx-row__link tx-row__link--quiet">—</span>`}
          </li>
        `).join("");
        safeReplaceChildren(autopilot, `
          <div class="section-head section-head-compact">
            <div>
              <p class="section-label">Actions</p>
              <h2>${failedTx.length} failed wallet tx${failedTx.length === 1 ? "" : "s"} · this run</h2>
            </div>
            <span class="state-badge state-badge--amber">Needs attention</span>
          </div>
          <p class="surface-copy">No on-chain policy is saved yet, but this run recorded failed wallet transactions. Resolve them before saving.</p>
          <ol class="tx-feed" aria-label="Failed wallet transactions">
            ${failedRows}
          </ol>
        `);
      } else {
        // Phase D.27 — in sim mode with no failed tx, leave the
        // autopilot surface empty so the :empty CSS rule hides it.
        // The placeholder ("No actions yet · simulation mode") used
        // to render here interrupted the verdict→evidence reading
        // flow with a card containing only "this surface stays empty"
        // copy — meta-narration of an absent state. The page-stack
        // is tighter without the placeholder; operator goes from
        // verdict → autopilot (only when something happened) →
        // credibility uninterrupted.
        safeReplaceChildren(autopilot, "");
      }
    }
  }

  if (evidence) {
    // Scenario-checks chart — promoted out of Evidence into the
    // primary credibility row above. Now uses a compact section-head
    // since it sits as a peer surface, not as a P3 diagnostic.
    safeReplaceChildren(evidence, `
      <div class="section-head section-head-compact">
        <div>
          <p class="section-label">Stress credibility</p>
          <h2>Scenario checks · BTC paths vs thresholds</h2>
        </div>
      </div>
      ${renderPythOracleReadbackStrip(oracleReadback)}
      <div id="results-guardrails-chart" class="guardrails-chart-host"></div>
    `);
    renderGuardrailsChart(document.getElementById("results-guardrails-chart"), { draft, interactive: false });
  }

  if (route) {
    if (!baselineAllocation?.primary) {
      safeReplaceChildren(route, renderSectionEmpty("Route unavailable", "No rail allocation was returned for the current run."));
    } else {
      safeReplaceChildren(route, `
        <div class="section-head">
          <div>
            <p class="section-label">Rail</p>
            <h2>Why this modeled rail ranked first</h2>
          </div>
        </div>

        <div class="route-grid">
          ${renderRouteCard("Primary", baselineAllocation.primary)}
          ${baselineAllocation.backup ? renderRouteCard("Backup", baselineAllocation.backup) : ""}
        </div>

        <p class="section-footnote"><strong>Route pressure:</strong> ${escapeHtml(baselineAllocation.warnings[0] || "Current route is aligned with the selected policy envelope.")}</p>
      `);
    }
  }

  if (review) {
    safeReplaceChildren(review, renderOperatorReviewPanel(operatorReview, draft, report));
  }

  if (scenarios) {
    // Phase D.20 — stress credibility merged into ONE composed surface.
    // Was: #results-scenarios (sparkline + scenario grid) + #results-
    // operating (chosen action + flow chips) as TWO separate surfaces
    // side-by-side. Operator had to visually stitch the engine's
    // decision to the stress ladder it came out of. Now one block:
    //   section-head (Stress credibility / Stress ladder)
    //   ↓ sparkline (drawdown ladder visual)
    //   ↓ compact scenario strip aligned to the same stress scale
    //   ↓ engine-summary (chosen action + operating ladder + worst state)
    const flowStates = ["Observe", "Maintain", "BuildBuffer", "DeRisk", "StressLockdown"];
    const flowChips = flowStates.map((key) => {
      const isActive = key === baseline.operatingState;
      const isWorst = key === summary.worstOperatingState;
      const cls = isActive ? "is-active" : isWorst ? "is-worst" : "";
      return `<span class="engine-flow-chip ${cls}" data-flow-state="${escapeHtml(key)}">${escapeHtml(formatOperatingStateLabel(key))}</span>`;
    }).join('<span class="engine-flow-sep" aria-hidden="true">·</span>');

    safeReplaceChildren(scenarios, `
      <div class="section-head section-head-compact">
        <div>
          <p class="section-label">Stress credibility</p>
          <h2>Stress ladder · decision engine</h2>
        </div>
        <span class="state-badge">${escapeHtml(baseline.result.decision.regime)}</span>
      </div>

      <div class="stress-ladder" style="--scenario-count:${report.scenarios.length}">
        <div class="stress-ladder__track">
          ${renderStressSparkline(report.scenarios)}
          ${renderStressScenarioStrip(report.scenarios)}
        </div>
      </div>

      <div class="engine-summary">
        <div class="engine-summary__decision">
          <p class="section-label">Current action</p>
          <div class="engine-decision-head">
            <span>${escapeHtml(formatOperatingStateLabel(baseline.operatingState))}</span>
            <strong>${escapeHtml(formatActionTypeLabel(baseline.result.decision.chosen.type))}</strong>
          </div>
          <p>${escapeHtml(baseline.result.decision.chosen.explanation)}</p>
        </div>
        <div class="engine-summary__ladder">
          <p class="section-label">Operating ladder</p>
          <div class="engine-flow" aria-label="Operating state ladder">
            ${flowChips}
          </div>
          <p class="engine-summary__worst"><strong>Worst state:</strong> ${escapeHtml(formatOperatingStateLabel(summary.worstOperatingState))} across the drawdown ladder.</p>
        </div>
      </div>
    `);
    bindSparkBarClicks(scenarios, report.scenarios);
  }

  if (actionLog) {
    safeReplaceChildren(actionLog, `
      <div class="section-head">
        <div>
          <p class="section-label">Log</p>
          <h2>Decision trail</h2>
        </div>
      </div>

      <div class="page-stack">
        ${report.scenarios.map((outcome) => `
          <article class="log-card" data-state="${escapeHtml(outcome.operatingState)}">
            <div class="log-card-head">
              <div>
                <span>${escapeHtml(outcome.scenario.label)} • ${escapeHtml(formatOperatingStateLabel(outcome.operatingState))}</span>
                <strong>${escapeHtml(outcome.result.decision.chosen.reason)}</strong>
              </div>
              <span class="state-badge">${escapeHtml(formatActionTypeLabel(outcome.result.decision.chosen.type))}</span>
            </div>
            <p>${escapeHtml(outcome.result.decision.chosen.explanation)}</p>
          </article>
        `).join("")}
      </div>
    `);
  }

  if (healthNotes) {
    // Pressure points lives in the primary flow now (was Evidence). To
    // avoid the layout cost of rendering 8+ note cards on every Readout
    // first paint, cap to 4 with an inline "Show all" details toggle —
    // matches the user's progressive-disclosure pattern from Workspace
    // (saved cards) without hiding anything in a separate accordion.
    const allNotes = collectUniqueNotes(report);
    const headNotes = allNotes.slice(0, 4);
    const tailNotes = allNotes.slice(4);
    const renderNote = (item) => `
      <article class="note-card">
        <span>${escapeHtml(item.label)}</span>
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.copy)}</p>
      </article>
    `;
    safeReplaceChildren(healthNotes, `
      <div class="section-head section-head-compact">
        <div>
          <p class="section-label">What to watch</p>
          <h2>Pressure points</h2>
        </div>
        ${allNotes.length === 0 ? `<span class="state-badge">All clear</span>` : `<span class="state-badge">${allNotes.length} note${allNotes.length === 1 ? "" : "s"}</span>`}
      </div>

      ${allNotes.length === 0
        ? `<p class="surface-copy">No pressure points flagged in the current run. The policy held its envelope across the stress ladder.</p>`
        : `
          <div class="page-stack">
            ${headNotes.map(renderNote).join("")}
            ${tailNotes.length > 0
              ? `<details class="press-points-more">
                  <summary>Show ${tailNotes.length} more pressure point${tailNotes.length === 1 ? "" : "s"}</summary>
                  <div class="page-stack">${tailNotes.map(renderNote).join("")}</div>
                </details>`
              : ""}
          </div>
        `}
    `);
  }

  renderExecutionSurfaces();

  if (positionCenter && appState.current?.onChainPolicy?.id) {
    const livePolicy = appState.current.onChainPolicy;
    const livePolicyId = normalizeLiveHistoryText(livePolicy.id);
    const liveReceipts = getReceiptsForPolicyFromWorkspace(livePolicyId);
    const policyTxHistory = getPolicyWalletTxHistory(livePolicyId);
    const liveControlState = getPolicyLocalControlState(livePolicyId);
    const liveUnwindProgress = getPolicyLocalUnwindProgress(livePolicyId);
    const liveSnapshot = findLatestModeledSnapshotForPolicy(livePolicyId) || {
      kind: "current",
      label: "Current readout",
      draft,
      report,
      judge: isPlainObject(appState.current?.judge) ? appState.current.judge : null,
      moment: getWorkspaceScenarioMoment(appState.current),
    };
    const liveExitEvidence = buildLiveExitEvidence({
      receipts: liveReceipts,
      controlState: liveControlState,
      unwindProgress: liveUnwindProgress,
    });
    const liveLifecycle = buildLivePolicyStatus({
      policy: livePolicy,
      receipts: liveReceipts,
      controlState: liveControlState,
      unwindProgress: liveUnwindProgress,
      snapshot: liveSnapshot,
      exitEvidence: liveExitEvidence,
    });
    const modeledFacts = buildLivePositionFacts(liveSnapshot.draft, liveSnapshot.report);
    const modeledMeta = liveSnapshot.moment
      ? `${liveSnapshot.label} · ${dateTimeFormatter.format(new Date(liveSnapshot.moment))}`
      : liveSnapshot.label;

    // Live rehearsal readout — full-width surface that reads top-down: a
    // prominent horizontal Position-scale chart (LTV positioning with
    // target band, warn corridor, max, and current-needle) sits at
    // the top so an operator's eye lands on it first; then the
    // Position center route-card head with checklist / exit / receipts
    // as a 3-cell hero-grid; then collateral / debt / buffer as a
    // tight metric row (LTV is now in the chart above, no inline arc
    // gauge); then the recent-activity slim card; then the action-
    // critical control + exit panels. The block runs full width
    // because the old 2-col with the route card on the right left a
    // lopsided gap (left column ended at half the height of the right).
    const railSymbol = livePolicy.selectedRail || "";
    const railLabel = getRailDisplay(railSymbol) || railSymbol || "—";
    const shortPolicyId = livePolicy.id ? shortenMiddle(livePolicy.id, 6, 4) : "";
    const policyExplorer = livePolicy.id ? buildSuiExplorerUrl("object", livePolicy.id, getRuntimeConfig()) : "";
    const readbackContext = buildLiveReadbackContext({
      policy: livePolicy,
      snapshot: liveSnapshot,
      portfolio: _lastPortfolioState,
      railPack: getActiveRailPack(),
    });
    const protocolReadback = buildLiveProtocolReadbackModel({
      railId: railSymbol,
      latestReceipt: liveReceipts[0] || null,
      latestReadback: getCachedLiveProtocolReadback(livePolicyId),
    });
    const protocolBalanceSource = String(protocolReadback?.balanceReadback?.source || "").trim().toLowerCase();
    const protocolBalanceReadback = protocolBalanceSource === "live" || protocolBalanceSource === "live-mainnet-readonly"
      ? protocolReadback.balanceReadback
      : null;
    const protocolBalanceSourceLabel = protocolBalanceSource === "live-mainnet-readonly"
      ? "Mainnet RPC snapshot"
      : "Fresh RPC snapshot";
    const protocolBalanceFactsHtml = protocolBalanceReadback ? `
              <div>
                <span>Protocol collateral</span>
                <strong>${escapeHtml(formatCompactUsd(protocolBalanceReadback.collateralUsd))}</strong>
                <em>${escapeHtml(protocolBalanceReadback.obligationId ? `Suilend ${shortenMiddle(protocolBalanceReadback.obligationId, 6, 4)}` : "Suilend obligation read-back")}</em>
              </div>
              <div>
                <span>Protocol debt</span>
                <strong>${escapeHtml(formatCompactUsd(protocolBalanceReadback.debtUsd))}</strong>
                <em>${protocolBalanceReadback.stale ? "Stale RPC snapshot" : protocolBalanceSourceLabel}</em>
              </div>
              <div>
                <span>Protocol debt pressure</span>
                <strong>${escapeHtml(formatPercentDecimal(protocolBalanceReadback.ltvBps / 10_000))}</strong>
                <em>${escapeHtml(protocolBalanceReadback.trustLabel || "Live read-back. Not execution.")}</em>
              </div>
    ` : "";
    const modeledFactHtml = modeledFacts.slice(0, 3).map((fact) => `
      <div>
        <span>${escapeHtml(fact.label)}</span>
        <strong>${escapeHtml(fact.value)}</strong>
        <em>${escapeHtml(fact.copy)}</em>
      </div>
    `).join("");
    const readbackUpdated = readbackContext.fetchedAt
      ? `Updated ${formatRelativeTimestamp(readbackContext.fetchedAt)}`
      : "Not refreshed in this session";

    const checklistDone = liveLifecycle.progressSummary.done;
    const checklistTotal = Math.max(0, liveLifecycle.progressSummary.total || 0);
    const checklistDots = checklistTotal > 0
      ? Array.from({ length: checklistTotal }, (_, i) =>
          `<span class="pip ${i < checklistDone ? "pip--done" : ""}" aria-hidden="true"></span>`
        ).join("")
      : '<span class="pip-dots__empty">—</span>';

    const draftSnap = liveSnapshot.draft || draft;
    const reportSnap = liveSnapshot.report || report;
    const summarySnap = reportSnap?.summary || null;
    const collateralBtc = asNumber(draftSnap?.btcUnits);
    const collateralSym = getCollateralAssetSymbol(draftSnap) || "BTC";
    const collateralUsd = collateralBtc * getEffectiveBtcPriceUsd(draftSnap);
    const debtUsd = asNumber(draftSnap?.debtUsd);
    const ltv = summarySnap?.currentLtv ?? safeDiv(debtUsd, collateralUsd);
    const targetLowDec = pctToDecimal(draftSnap?.targetLtvLowPct);
    const targetHighDec = pctToDecimal(draftSnap?.targetLtvHighPct);
    const maxLtvDec = pctToDecimal(draftSnap?.maxLtvPct) || 0.6;
    const bufferDays = Math.max(0, Number(summarySnap?.bufferCoverageDays) || 0);
    const desiredRunwayDays = Math.max(30, asNumber(draftSnap?.desiredRunwayMonths) * 30);
    const bufferPct = Math.min(1, bufferDays / desiredRunwayDays);
    const bufferTone = bufferDays >= desiredRunwayDays
      ? "good"
      : bufferDays >= desiredRunwayDays * 0.6
        ? "warn"
        : "bad";

    const livePositionCenterHtml = `
      <article class="route-card route-card--readout">
        <div class="route-card-head">
          <div class="route-card-head-main">
            <div class="route-card-meta">
              <span class="route-role">Live rehearsal</span>
              <span class="route-score">${escapeHtml(liveLifecycle.badge || "Modeled")}</span>
            </div>
            <p class="route-card-why">${escapeHtml(liveLifecycle.copy)}</p>
          </div>
          <div class="route-card-title">
            <strong>Position center</strong>
            <span class="route-card-meta-hint">${escapeHtml(railLabel)}${shortPolicyId
              ? ` · <a href="${escapeHtml(policyExplorer)}" target="_blank" rel="noopener">${escapeHtml(shortPolicyId)} ↗</a>`
              : ""}</span>
          </div>
        </div>

        ${renderPositionScale(ltv, targetLowDec, targetHighDec, maxLtvDec, { label: "Position · debt pressure vs thresholds", live: true })}

        <div class="live-boundary-grid" aria-label="Modeled snapshot and observed read-back boundary">
          <section class="live-boundary-card">
            <div class="live-boundary-card__head">
              <span>Latest modeled snapshot</span>
              <strong>${escapeHtml(modeledMeta)}</strong>
            </div>
            <div class="live-boundary-facts">${modeledFactHtml}</div>
          </section>
          <section class="live-boundary-card">
            <div class="live-boundary-card__head">
              <span>Observed wallet / rail</span>
              <strong>${escapeHtml(readbackUpdated)}</strong>
            </div>
            <div class="live-boundary-facts">
              <div>
                <span>Wallet collateral</span>
                <strong>${escapeHtml(readbackContext.collateral.balanceDisplay)} ${escapeHtml(readbackContext.collateral.symbol)}</strong>
                <em>${readbackContext.collateral.matched ? "Matching wrapper found in wallet" : "No matching wrapper balance found"}</em>
              </div>
              <div>
                <span>Wallet stable</span>
                <strong>${escapeHtml(readbackContext.stable.balanceDisplay)} ${escapeHtml(readbackContext.stable.symbol)}</strong>
                <em>${readbackContext.stable.aggregate ? "Aggregate stable read-back" : "Matching stable found in wallet"}</em>
              </div>
              <div>
                <span>Rail posture</span>
                <strong>${escapeHtml(protocolReadback.badge || "Proof-led")}</strong>
                <em>${escapeHtml(protocolReadback.truthBoundary || "Rail UI remains source of truth for live protocol balances.")}</em>
              </div>
              ${protocolBalanceFactsHtml}
            </div>
          </section>
        </div>

        <div class="live-position-summary-grid">
          <div class="readout-hero-cell">
            <span class="readout-hero-label">Checklist</span>
            <strong>${checklistDone}/${checklistTotal}</strong>
            <div class="pip-dots pip-dots--${checklistTotal > 0 ? (checklistDone === checklistTotal ? "done" : "partial") : "empty"}">
              ${checklistDots}
            </div>
          </div>
          <div class="readout-hero-cell">
            <span class="readout-hero-label">Exit evidence</span>
            <strong>${escapeHtml(liveExitEvidence.label)}</strong>
            <span class="readout-hero-sub">${escapeHtml(liveExitEvidence.copy)}</span>
          </div>
          <div class="readout-hero-cell">
            <span class="readout-hero-label">Receipts</span>
            <strong>${liveReceipts.length}</strong>
            <span class="readout-hero-sub">${liveReceipts.length === 0 ? "No receipts minted yet" : "Receipts"}</span>
          </div>
        </div>

        <div class="route-metrics route-metrics--readout">
          <div>
            <span>Collateral</span>
            <strong>${collateralBtc.toFixed(2)} ${escapeHtml(collateralSym)}</strong>
            <span class="readout-metric-sub">${formatCompactUsd(collateralUsd)}</span>
          </div>
          <div>
            <span>Debt</span>
            <strong>${formatCompactUsd(debtUsd)}</strong>
            <span class="readout-metric-sub">stable</span>
          </div>
          <div class="readout-metric-with-viz">
            <span>Buffer</span>
            <strong>${bufferDays} days</strong>
            <div class="readout-bar readout-bar--${bufferTone}" role="img" aria-label="Buffer ${bufferDays} of ${Math.round(desiredRunwayDays)} runway days">
              <div class="readout-bar__fill" style="width:${(bufferPct * 100).toFixed(0)}%"></div>
            </div>
            <span class="readout-metric-sub">target ${Math.round(desiredRunwayDays)} days</span>
          </div>
        </div>

        ${policyExplorer || livePolicy.id
          ? `<div class="route-card-actions">
              <a class="button button-secondary" href="${currentPage === "live" ? "#live-monitor" : `/live?policy=${encodeURIComponent(livePolicy.id || "")}#live-monitor`}">Open exit monitor →</a>
            </div>`
          : ""}
      </article>
    `;
    const liveControlDetailsHtml = `
      ${renderLiveControlPanel(livePolicy)}
      ${renderLiveUnwindPanel(livePolicy, liveSnapshot, liveReceipts, policyTxHistory, liveControlState, liveUnwindProgress)}
    `;

    safeReplaceChildren(positionCenter, currentPage === "live"
      ? livePositionCenterHtml
      : `${livePositionCenterHtml}${liveControlDetailsHtml}`);
    if (currentPage === "live" && hero) {
      safeReplaceChildren(hero, liveControlDetailsHtml);
    }
  }
}

function renderScenarioComparePanel(host, options = {}) {
  if (!host) {
    return;
  }

  const {
    emptyTitle = "Pick a saved run above",
    emptyCopy = "Selecting one shows route, health, payout, and breakwater deltas vs the current baseline.",
    missingTitle = "Comparison missing",
    missingCopy = "The saved run selected for comparison no longer exists.",
    minSavedTitle = "Save at least two runs",
    minSavedCopy = "Keep a baseline, then save a second run to compare route, health, and payout changes here.",
  } = options;

  if (!appState.current || !appState.compareId) {
    safeReplaceChildren(host, appState.saved.length >= 2
      ? renderSectionEmpty(emptyTitle, emptyCopy)
      : renderSectionEmpty(minSavedTitle, minSavedCopy));
    return;
  }

  const savedScenario = appState.saved.find((scenario) => scenario.id === appState.compareId);

  if (!savedScenario) {
    safeReplaceChildren(host, renderSectionEmpty(missingTitle, missingCopy));
    return;
  }

  const currentSummary = appState.current.report.summary;
  const previousSummary = savedScenario.report.summary;
  const payoutDelta = formatDelta(
    currentSummary.survivablePayoutBandLowUsd - previousSummary.survivablePayoutBandLowUsd,
    (value) => formatUsd(value)
  );
  const healthDelta = formatDelta(
    currentSummary.averageHealthScore - previousSummary.averageHealthScore,
    (value) => `${Math.round(value)} pts`
  );
  const bufferDelta = formatDelta(
    currentSummary.bufferCoverageDays - previousSummary.bufferCoverageDays,
    (value) => `${Math.round(value)} days`
  );

  safeReplaceChildren(host, `
    <div class="compare-header">
      <span class="micro-label">vs ${escapeHtml(savedScenario.name)}</span>
    </div>
    <div class="fact-row-grid">
      <div class="fact-row">
        <span>Draw floor</span>
        <strong>${formatUsd(currentSummary.survivablePayoutBandLowUsd)}</strong>
        <p>${payoutDelta.text}</p>
      </div>
      <div class="fact-row">
        <span>Health</span>
        <strong>${currentSummary.averageHealthScore}/100</strong>
        <p>${healthDelta.text}</p>
      </div>
      <div class="fact-row">
        <span>Buffer</span>
        <strong>${currentSummary.bufferCoverageDays}d</strong>
        <p>${bufferDelta.text}</p>
      </div>
      <div class="fact-row">
        <span>Breakwater</span>
        <strong>${escapeHtml(formatDrawdown(currentSummary.breakwaterTriggerDrawdownPct))}</strong>
        <p>was ${escapeHtml(formatDrawdown(previousSummary.breakwaterTriggerDrawdownPct))}</p>
      </div>
    </div>
  `);
}

function renderLibraryPage() {
  const baseline = $("#library-baseline");
  const savedRoot = $("#saved-scenarios");
  const emptySaved = $("#empty-saved");
  const comparePanel = $("#compare-panel");
  const accountState = getAccountDataState(getWalletState());

  if (!baseline && !savedRoot && !comparePanel) {
    return;
  }

  if (!accountState.canViewLibraryScenarios) {
    if (baseline) {
      safeReplaceChildren(baseline, renderSectionEmpty(
        "Connect wallet to load your library",
        "Saved scenarios are account-bound. Authorize with the wallet that created them to view baseline history and comparisons."
      ));
    }

    if (savedRoot) {
      safeReplaceChildren(savedRoot, "");
    }

    if (emptySaved) {
      emptySaved.hidden = false;
      emptySaved.textContent = "Wallet not connected. Connect wallet to load saved scenarios for this account.";
    }

    if (comparePanel) {
      safeReplaceChildren(comparePanel, renderSectionEmpty(
        "Wallet authorization required",
        "Comparisons are available only after loading saved scenarios from the connected wallet account."
      ));
    }

    return;
  }

  if (baseline) {
    if (!appState.current) {
      safeReplaceChildren(baseline, renderSectionEmpty(
        "No baseline loaded",
        "Run a scenario first so saved comparisons have a current reference point."
      ));
    } else {
      const summary = appState.current.report.summary;
      const compareScenario = appState.compareId ? appState.saved.find((s) => s.id === appState.compareId) : null;

      safeReplaceChildren(baseline, `
        <div class="section-head">
          <div>
            <p class="section-label">Baseline</p>
            <h2>${escapeHtml(appState.current.draft.scenarioName)}</h2>
          </div>
        </div>
        <div class="fact-row-grid">
          <div class="fact-row"><span>Draw floor</span><strong>${formatUsd(summary.survivablePayoutBandLowUsd)}</strong></div>
          <div class="fact-row"><span>Health</span><strong>${summary.averageHealthScore}/100</strong></div>
          <div class="fact-row"><span>Buffer</span><strong>${summary.bufferCoverageDays}d runway</strong></div>
          <div class="fact-row"><span>Breakwater</span><strong>${formatDrawdown(summary.breakwaterTriggerDrawdownPct)}</strong></div>
        </div>
      `);
    }
  }

  if (savedRoot) {
    safeReplaceChildren(savedRoot, appState.saved.map((scenario) => {
      const summary = scenario.report.summary;
      const compared = appState.compareId === scenario.id;
      const review = getOperatorReviewStatus(scenario.operatorReview || buildOperatorReview(scenario.draft, scenario.report), scenario.report);
      // C.2.1 UX-L1: review status is the P1 scan target on a saved
      // card — promote it from the meta line to a tone-coded chip on
      // the card head (mint = approved, amber = needs review, rose =
      // flagged). Mode badge moves into the meta line as supporting
      // context.
      const reviewToneByLabel = (label) => {
        const k = String(label || "").toLowerCase();
        if (k.includes("approve")) return "mint";
        if (k.includes("flag") || k.includes("block")) return "rose";
        if (k.includes("review") || k.includes("pending")) return "amber";
        return "muted";
      };
      const reviewTone = reviewToneByLabel(review.label);
      const modeLabel = MODE_LABELS[scenario.draft.mode] || scenario.draft.mode;
      // C.2.1 UX-L5: mode chip carries tone — Live = cyan, Shadow /
      // Sim = muted (neutral baseline).
      const modeTone = String(scenario.draft.mode).toLowerCase().includes("live") ? "cyan" : "muted";

      return `
        <article class="saved-card">
          <div class="saved-card-head">
            <div>
              <strong>${escapeHtml(scenario.name)}</strong>
              <p>${escapeHtml(dateTimeFormatter.format(new Date(scenario.createdAt)))}</p>
            </div>
            <span class="state-badge state-badge--${reviewTone}">${escapeHtml(review.label)}</span>
          </div>

          <div class="saved-card-meta">
            <span class="state-badge state-badge--${modeTone}">${escapeHtml(modeLabel)}</span>
            <span>${formatUsd(summary.survivablePayoutBandLowUsd)} floor</span>
            <span>${summary.averageHealthScore}/100 health</span>
            <span>${escapeHtml(summary.primaryRailName || "Pending route")}</span>
          </div>

          <div class="action-cluster action-cluster-compact">
            <a class="button button-secondary" href="${escapeHtml(buildRunReadoutHref(scenario.id))}" aria-label="Open Readout for ${escapeHtml(scenario.name)}">Readout</a>
            <a class="button button-secondary" href="${escapeHtml(buildSetupHref(scenario.id))}" aria-label="Edit ${escapeHtml(scenario.name)}">Edit</a>
            <button class="button ${compared ? "button-primary" : "button-secondary"}" type="button" data-action="compare" data-id="${scenario.id}" aria-label="${compared ? "Stop comparing" : "Compare"} ${escapeHtml(scenario.name)}">
              ${compared ? "Comparing" : "Compare"}
            </button>
            <button class="button button-ghost is-danger" type="button" data-action="delete" data-id="${scenario.id}" aria-label="Delete ${escapeHtml(scenario.name)}">Delete</button>
          </div>
        </article>
      `;
    }).join(""));

    if (emptySaved) {
      if (appState.saved.length === 0) {
        // C.2.1 L10 + UX-L2: replace the bare empty-copy text with
        // the .empty-panel primitive carrying a CTA back to Create.
        // The CTA gives new operators an explicit next step.
        safeReplaceChildren(emptySaved, renderSectionEmpty(
          "No saved runs yet",
          "Simulate a policy in Create, then save it from Readout to start building a reusable library.",
          "Open Create",
          "/setup",
        ));
      }
      emptySaved.hidden = appState.saved.length > 0;
    }
  }

  if (comparePanel) {
    // C.2.1 UX-L2: branch the empty copy on save count so two
    // sections don't show conflicting next-step instructions when
    // the operator has zero saves.
    const noSaves = appState.saved.length === 0;
    renderScenarioComparePanel(comparePanel, {
      emptyTitle: noSaves ? "No saved runs yet" : "Select a saved scenario",
      emptyCopy: noSaves
        ? "Save a run from Readout first, then come back here to compare it against another."
        : "Choose any saved run to compare it against the current baseline.",
      minSavedTitle: "Save a second scenario to compare",
      minSavedCopy: "Keep this baseline, then run + save another scenario to compare route, health, and payout changes here.",
    });
  }
}

function renderRouteCard(role, scorecard) {
  const rail = scorecard.rail;
  const roleKey = normalizeEntityKey(role);
  const whyCopy = scorecard.reasons[0] || "Route matches the requested operating corridor.";
  const hasKink =
    typeof rail.irBaseApr === "number" &&
    typeof rail.irKinkUtilization === "number";
  const utilisationPct = typeof rail.utilizationRate === "number"
    ? `${(rail.utilizationRate * 100).toFixed(0)}%`
    : null;

  // Extra metrics tiles only render when the rail snapshot carries the
  // data — keeps the card clean for unsigned/fixture rails.
  const extraMetrics = [
    utilisationPct ? `<div><span>Utilisation</span><strong>${utilisationPct}</strong></div>` : "",
    hasKink ? `<div><span>IR kink</span><strong>${(rail.irKinkUtilization * 100).toFixed(0)}%</strong></div>` : "",
  ].filter(Boolean).join("");

  return `
    <article class="route-card route-card-${escapeHtml(roleKey)}">
      <div class="route-card-head">
        <div class="route-card-head-main">
          <div class="route-card-meta">
            <span class="route-role">${escapeHtml(role)}</span>
            <span class="route-score">${scorecard.score}/100</span>
          </div>
          <p class="route-card-why">${escapeHtml(whyCopy)}</p>
        </div>
        <div class="route-card-title">
          ${renderProtocolInline(rail.name, "Selected rail")}
        </div>
      </div>
      <div class="token-row">
        ${renderTokenChips(rail.wrapper)}
        ${renderTokenChips(rail.stableAsset)}
      </div>
      <div class="route-metrics">
        <div>
          <span>Max debt pressure</span>
          <strong>${formatPercentDecimal(rail.maxLtv)}</strong>
        </div>
        <div>
          <span>Borrow rate</span>
          <strong>${(rail.borrowApr * 100).toFixed(1)}%</strong>
        </div>
        <div>
          <span>Rebalance</span>
          <strong>${rail.rebalanceCostBps} bps</strong>
        </div>
        ${extraMetrics}
      </div>
    </article>
  `;
}

// Design-system playground — renders every reusable component with
// mock data into #ds-root. Open /design-system to see the live
// catalogue. Updates to a component must update its example here in
// the same commit so the playground never drifts from reality.
function renderDesignSystemPage() {
  const root = $("#ds-root");
  if (!root) return;

  const mockRail = (overrides = {}) => ({
    name: "NAVI Protocol",
    wrapper: "xBTC",
    stableAsset: "USDC",
    maxLtv: 0.67,
    borrowApr: 0.038,
    rebalanceCostBps: 14,
    irBaseApr: 0.022,
    irKinkUtilization: 0.78,
    utilizationRate: 0.62,
    ...overrides,
  });
  const mockScorecard = (role, score, rail) => ({
    role,
    score,
    rail,
    reasons: ["Rail can support the requested operating corridor."],
  });
  const mockScenario = (label, drawdown, state, healthScore, healthLabel) => ({
    scenario: { label, drawdownPct: drawdown },
    operatingState: state,
    health: { score: healthScore, label: healthLabel },
    payoutBandLowUsd: 837,
    payoutBandHighUsd: 900,
    bufferCoverageDays: 162,
    result: { decision: { risk: { ltv: 0.186 }, chosen: { type: "BorrowForBuffer" } } },
  });
  const scenarios = [
    mockScenario("Current setup", 0, "BuildBuffer", 69, "Guarded"),
    mockScenario("-20% drawdown", -0.2, "BuildBuffer", 52, "Fragile"),
    mockScenario("-35% drawdown", -0.35, "StressLockdown", 29, "Critical"),
    mockScenario("-50% drawdown", -0.5, "StressLockdown", 26, "Critical"),
  ];

  // ── Hero — page anchor with display-number + spark + meta strip ──
  // Matches the Momentum / Aave / Hyperliquid pattern: one big tabular
  // number lands first, then a spark, then a strip of monospace meta.
  // Anchors the page; everything below is "vocabulary that composes
  // into THIS feeling".
  const heroSection = `
    <section class="surface surface-hero ds-hero" aria-labelledby="ds-hero-eyebrow">
      <div class="ds-hero__head">
        <p class="section-label" id="ds-hero-eyebrow">Aggregate treasury under cockpit</p>
        <div class="ds-form-row" style="gap:0.5rem;flex-wrap:wrap">
          <span class="network-badge network-badge--testnet">
            <span class="network-badge__dot" aria-hidden="true"></span>Sui Testnet
          </span>
          <a class="button button-primary ds-hero__cta" href="/" rel="noopener">Open the cockpit ${icon("external-link", "sm")}</a>
        </div>
      </div>
      <div class="ds-hero__body">
        <div>
          <div class="ds-hero__amount">$8,955,349<span class="ds-hero__amount-decimals">.19</span></div>
          <!-- B.16.5 D1: hero used to render an inline .delta-chip
               here; that was a dup of the canonical 5-variant chip
               row in densitySection. Now plain monospace + mint
               colour. The hero is the page anchor, not a chip demo. -->
          <div class="ds-hero__sub">
            <span class="ds-hero__sub-delta">▲ 2.1%</span>
            <span class="ds-hero__sub-meta">vs 30d · across 12 policies</span>
          </div>
        </div>
        <div class="ds-hero__chart">
          ${renderInlineSpark([8.4, 8.55, 8.62, 8.71, 8.69, 8.83, 8.95, 8.92, 8.96, 8.95], { tone: "mint", width: 280, height: 60 })}
        </div>
      </div>
      <dl class="ds-hero__meta">
        <div><dt>Active policies</dt><dd>12</dd></div>
        <div><dt>BTC under cockpit</dt><dd>116.234</dd></div>
        <div><dt>Receipts minted · 30d</dt><dd>4,287</dd></div>
        <div><dt>Operators online</dt><dd>3</dd></div>
      </dl>
    </section>
  `;

  // sectionShell — derive a stable slug id from the label so the
  // chip-row TOC can anchor-link to each section. Label "On-chain
  // attributes" → id "ds-on-chain-attributes".
  const slugify = (s) => String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  // Phase B.16.2 — A+5 section-head category icons. Each section
  // gets a 14 px glyph next to the section-label that summarises
  // the section's role at a glance (Linear's docs use this pattern).
  // Painted with var(--muted) at rest; flips to var(--accent) on
  // .ds-section:hover, matching the # anchor permalink affordance.
  // Tone manifesto stays untouched — icons are never tone-coloured.
  // Icon names map to the section label (the slug derived from it
  // would also work, but the label is the stable anchor).
  const SECTION_ICON = {
    "Foundations":                     "palette",
    "Iconography":                     "image",
    "Section heads":                   "pen-line",
    "Inline chips · keyboard hints":   "info",
    "Charts":                          "trending-up",
    "Lists":                           "list",
    "Data-density atoms":              "filter",
    "Surfaces":                        "archive",
    "Cards":                           "layers",
    "Trust banner":                    "shield-check",
    "Layout grids":                    "filter",
    "Buttons · state badges":          "zap",
    "Form fields":                     "pen-line",
    "Choice controls":                 "check",
    "Segmented · select trigger":      "chevron-down",
    "Range slider":                    "settings",
    "Thresholds rail":                 "anchor",
    "Search · date · calendar · file drop": "search",
    "Loading & progress":              "refresh-cw",
    "Failure surfaces":                "alert-triangle",
    "Toast":                           "info",
    "Modal":                           "external-link",
    "Tooltip":                         "info",
    "On-chain attributes":             "key",
    "Composer":                        "refresh-cw",
    "Transactions":                    "activity",
    "Status timeline":                 "check",
    "Navigation":                      "compass",
    "Don't do this":                   "alert-octagon",
  };

  const sectionShell = (label, h2, body, snippet) => {
    const id = `ds-${slugify(label)}`;
    const iconName = SECTION_ICON[label];
    const iconHtml = iconName ? icon(iconName, "sm", { className: "ds-section__icon" }) : "";
    return `
    <section class="surface ds-section" id="${id}" aria-labelledby="${id}-h2">
      <div class="section-head section-head-compact">
        <div class="ds-section__head-text">
          <p class="section-label">${iconHtml}<span>${escapeHtml(label)}</span></p>
          <h2 id="${id}-h2">${escapeHtml(h2)}</h2>
        </div>
        <a class="ds-section__anchor" href="#${id}" aria-label="Permalink to ${escapeHtml(label)}">#</a>
      </div>
      <div class="ds-section__body">${body}</div>
      ${snippet
        ? `<details class="ds-snippet"><summary>Markup snippet</summary><pre><code>${escapeHtml(snippet)}</code></pre></details>`
        : ""}
    </section>
  `;
  };

  const tones = [
    ["accent", "Primary action / focus / link"],
    ["mint", "Healthy / target / success"],
    ["amber", "Warn / fragile / unsigned"],
    ["rose", "Danger / liquidation / critical"],
    ["cyan", "Live data / position-scale needle"],
    ["violet", "Control posture (operator state)"],
    ["muted", "Labels, footnotes (neutral)"],
  ];
  const swatches = tones.map(([key, copy]) => `
    <div class="ds-swatch">
      <div class="ds-swatch__chip" style="background:var(--${key})"></div>
      <div class="ds-swatch__meta">
        <strong>--${key}</strong>
        <span>${escapeHtml(copy)}</span>
      </div>
    </div>
  `).join("");

  const radii = [
    ["pill", "4px"], ["xs", "8px"], ["sm", "10px"], ["md", "14px"], ["lg", "16px"], ["xl", "24px"],
  ];
  const radiiSwatches = radii.map(([key, px]) => `
    <div class="ds-radius">
      <div class="ds-radius__chip" style="border-radius:var(--radius-${key})"></div>
      <strong>--radius-${key}</strong>
      <span>${px}</span>
    </div>
  `).join("");

  const fontSizes = ["2xs","xs","sm","base","md","lg","xl"];
  const typeRows = fontSizes.map((key) => `
    <div class="ds-type-row">
      <strong style="font-size:var(--fs-${key})">Tide policy ${key}</strong>
      <span>--fs-${key}</span>
    </div>
  `).join("");

  const tokensSection = sectionShell("Foundations", "Color, radius, type tokens — the seven-tone semantic grammar TIDE doesn't repurpose for vibe", `
    <div class="ds-token-grid">
      <div>
        <p class="section-micro-label">Tone palette</p>
        <div class="ds-swatches">${swatches}</div>
      </div>
      <div>
        <p class="section-micro-label">Radius scale</p>
        <div class="ds-radii">${radiiSwatches}</div>
      </div>
      <div>
        <p class="section-micro-label">Type scale (Manrope body, Sora display)</p>
        <div class="ds-type">${typeRows}</div>
      </div>
    </div>
    <p class="ds-tone-manifesto">
      <strong>Mint = healthy · amber = warn · rose = danger · cyan = live data · violet = control · accent = primary action.</strong>
      Tones are not for vibe; they encode meaning. The anti-pattern list at shelf VII Discipline tracks every place this rule was tested.
    </p>
  `, "border-radius: var(--radius-md);\nfont-size: var(--fs-sm);\ncolor: var(--accent);");

  // ── Iconography ───────────────────────────────────────────────
  // 25 vendored Lucide glyphs + 5-step token-mark scale + size scale.
  // Renderer = icon(name, size, opts). Token marks = renderTokenMark(symbol, size).
  const iconNames = Object.keys(ICON_PATHS);
  const iconRows = iconNames.map((n) => `
    <div class="ds-icon-cell" title="${escapeHtml(n)}">
      ${icon(n, "lg")}
      <span>${escapeHtml(n)}</span>
    </div>
  `).join("");

  const iconSizes = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl"];
  const iconSizeRows = iconSizes.map((s) => `
    <div class="ds-icon-size-row">
      ${icon("anchor", s)}
      <span>--icon-${s}</span>
    </div>
  `).join("");

  const tokenSamples = ["btc", "wbtc", "xbtc", "usdc", "usdb", "hasui"];
  const tokenMarkSizes = ["xs", "sm", "md", "lg", "xl"];
  const tokenMarkScale = tokenMarkSizes.map((s) => `
    <div class="ds-token-mark-cell">
      ${renderTokenMark("btc", s)}
      <span>${s}</span>
    </div>
  `).join("");
  const tokenMarkRow = tokenSamples.map((sym) => `
    <div class="ds-token-mark-cell">
      ${renderTokenMark(sym, "md")}
      <span>${sym.toUpperCase()}</span>
    </div>
  `).join("");

  const iconographySection = sectionShell("Iconography", "Icons + token marks · 25 Lucide glyphs · 5-size circular wrapper", `
    <div class="ds-token-grid">
      <div>
        <p class="section-micro-label">Glyph library (25)</p>
        <div class="ds-icon-grid">${iconRows}</div>
      </div>
      <div>
        <p class="section-micro-label">Size scale</p>
        <div class="ds-icon-sizes">${iconSizeRows}</div>
      </div>
      <div>
        <p class="section-micro-label">Token marks · sample</p>
        <div class="ds-token-marks">${tokenMarkRow}</div>
        <p class="section-micro-label" style="margin-top:0.6rem">Size scale</p>
        <div class="ds-token-marks">${tokenMarkScale}</div>
      </div>
    </div>
  `, '// glyph\nicon("anchor")            // default md\nicon("external-link","sm")\nicon("alert-triangle","lg",{ariaLabel:"Warning"})\n\n// circular token mark\nrenderTokenMark("btc","lg")\nrenderTokenMark("usdc","md")');

  const surfacesSection = sectionShell("Surfaces", "Surface variants", `
    <div class="ds-surfaces">
      <section class="surface">
        <div class="section-head section-head-compact">
          <div><p class="section-label">Default</p><h2>.surface</h2></div>
        </div>
        <p class="surface-copy">Body. 1 px border, 0.95rem padding, no shadow.</p>
      </section>
      <section class="surface surface-hero">
        <div class="section-head section-head-compact">
          <div><p class="section-label">Hero</p><h2>.surface .surface-hero</h2></div>
        </div>
        <p class="surface-copy">3 px accent left edge. Once per page at the top.</p>
      </section>
      <details class="surface-evidence">
        <summary class="surface-evidence__summary">
          <span class="section-label">Evidence</span>
          <strong>P3 archive — collapsed by default</strong>
          <span class="surface-evidence__hint">Open</span>
        </summary>
        <div class="surface-evidence__body">
          <p class="surface-copy">Tinted body, accordion-style. Reserve for content the operator opens occasionally.</p>
        </div>
      </details>
    </div>
  `, '<section class="surface">…</section>\n<section class="surface surface-hero">…</section>\n<details class="surface-evidence">…</details>');

  const primaryCard = renderRouteCard("Primary", mockScorecard("Primary", 95, mockRail()));
  const backupCard = renderRouteCard("Backup", mockScorecard("Backup", 90, mockRail({ name: "Suilend", maxLtv: 0.6, borrowApr: 0.061, rebalanceCostBps: 13 })));
  const metricTile = renderMetricCard("Buffer", "162 days", "runway");
  const metricMint = renderMetricCard("Health", "69/100", "Guarded", "mint");
  const metricWarn = renderMetricCard("Drawdown", "-35%", "Trigger", "warn");
  const noteCard = `
    <article class="note-card">
      <span>Buffer</span>
      <strong>Stretch by ~$600</strong>
      <p>Add to stable buffer to reach the minimum runway floor.</p>
    </article>`;
  const logCard = `
    <article class="log-card" data-state="BuildBuffer">
      <div class="log-card-head">
        <div><span>-20% drawdown · Build buffer</span><strong>Borrow $1.2k stable</strong></div>
        <span class="state-badge">Borrow to rebuild buffer</span>
      </div>
      <p>Health holds at 52/100; runway extends 18 days.</p>
    </article>`;
  const emptyPanel = renderSectionEmpty("Nothing here yet", "Create a draft to see saved scenarios.", "Open Create", "/setup");

  // Phase D.8.5 — DS showcase additions: workspace-card, readout-
  // action-card, tx-row (feed row). These are the most-
  // used compositional patterns in the product; without them the
  // playground left developers with no canonical reference for
  // workspace + readout chrome. Mock data only — no live state.
  const workspaceCardDemo = `
    <article class="ws-position-card surface" data-entry-type="live">
      <div class="ws-position-head">
        <div class="ws-position-title">
          <div class="ws-badge-row">
            ${renderIconBadge("On-chain policy · testnet", { tone: "mint", iconName: "link" })}
            ${renderIconBadge("Saved", { tone: "accent", iconName: "anchor" })}
            ${renderIconBadge("Exit planned", { tone: "violet", iconName: "settings" })}
            <span class="ws-id-chip ws-id-chip--muted">#0x12…ab78</span>
          </div>
          <strong>Treasury Q2 Harbor</strong>
        </div>
        <div class="ws-position-meta">
          <span class="state-badge">v3 · Income</span>
          <span class="ws-position-date">2 May 2026, 08:10</span>
        </div>
      </div>
      <div class="ws-position-metrics">
        <div><span class="ws-dash-label">Collateral</span><strong>$237,690</strong><span class="ws-dash-sub">3.000 xBTC</span></div>
        <div><span class="ws-dash-label">Debt</span><strong>$59,423</strong><span class="ws-dash-sub">USDC</span></div>
        <div><span class="ws-dash-label">Debt pressure</span><strong class="ws-dash-strong--cyan">25.1%</strong><span class="ws-dash-sub">22–28% target band</span></div>
        <div><span class="ws-dash-label">Buffer</span><strong>$4,800</strong><span class="ws-dash-sub">USDC</span></div>
        <div><span class="ws-dash-label">Health</span><strong>60/100</strong></div>
        <div><span class="ws-dash-label">Payout floor</span><strong class="ws-dash-strong--mint">$461</strong><span class="ws-dash-sub">USDC</span></div>
        <div><span class="ws-dash-label">Route</span>${renderProtocolInline("NAVI Protocol", "", "sm")}</div>
      </div>
    </article>`;

  const readoutActionCardDemo = `
    <div class="readout-action-card readout-action-card--mint">
      <div class="readout-action-copy">
        <p class="section-label">Policy verdict</p>
        <h2>Ready to save</h2>
        <p class="surface-copy">Health 78/100 · buffer covers 162 days. Survives 2020–2022 replay.</p>
      </div>
      <div class="readout-action-cta">
        <a class="button button-primary" href="#">Save on Sui</a>
      </div>
    </div>`;

  const txRowDemo = `
    <ol class="tx-feed" aria-label="Activity ledger demo">
      <li class="tx-row tx-row--receipt">
        <span class="tx-row__time">Apr 24 · 14:02</span>
        <span class="tx-row__kind tx-row__kind--receipt">Receipt</span>
        <div class="tx-row__body"><strong>Saved policy on Sui</strong><span>0x12…ab78</span></div>
        <a class="tx-row__link" href="#">Open ↗</a>
      </li>
      <li class="tx-row tx-row--control">
        <span class="tx-row__time">Apr 24 · 14:08</span>
        <span class="tx-row__kind tx-row__kind--control">Control</span>
        <div class="tx-row__body"><strong>Marked exit planned</strong><span>operator</span></div>
        <span class="tx-row__link tx-row__link--quiet">—</span>
      </li>
    </ol>`;

  const cardsSection = sectionShell("Cards", "Variants on .surface — accent left edge encodes meaning. Workspace card + readout action card + activity-ledger row are the highest-traffic patterns in the product; the playground demos them with mock data so developers have a canonical reference instead of building bespoke variants.", `
    <div class="ds-cards">
      ${primaryCard}
      ${backupCard}
    </div>
    <div class="ds-cards ds-cards--metrics">
      ${metricTile}
      ${metricMint}
      ${metricWarn}
    </div>
    <div class="ds-cards">
      ${noteCard}
      ${logCard}
      ${emptyPanel}
    </div>
    <div class="ds-cards">
      ${workspaceCardDemo}
    </div>
    <div class="ds-cards">
      ${readoutActionCardDemo}
    </div>
    <div class="ds-cards">
      ${txRowDemo}
    </div>
  `, '<article class="route-card route-card-primary">…</article>\n<article class="metric-card metric-card-mint">…</article>\n<article class="note-card">…</article>\n<article class="log-card" data-state="BuildBuffer">…</article>\n<article class="ws-position-card surface">…</article>\n<div class="readout-action-card readout-action-card--mint">…</div>\n<ol class="tx-feed"><li class="tx-row tx-row--receipt">…</li></ol>');

  const chartPair = `
    <div class="scale-pair">
      <div class="scale-pair__head">
        <span class="section-label">Position context</span>
        <span class="route-card-meta-hint">Modeled BTC $77,586</span>
      </div>
      ${renderPriceScale({
        currentPrice: 77586,
        debtUsd: 287700,
        collateralBtc: 20,
        targetLow: 0.16,
        targetHigh: 0.21,
        maxLtv: 0.30,
        label: "BTC drawdown sensitivity",
      })}
      ${renderPositionScale(0.186, 0.16, 0.21, 0.30, { label: "Debt pressure vs thresholds" })}
    </div>
  `;
  const sparkline = renderStressSparkline(scenarios);

  // 30-day BTC walk for the .event-chart demo. Points are deterministic
  // mock data (not a random walk) so the playground renders identically
  // every load. Polymarket-style: price curve + horizontal level lines
  // (liq / re-tune / target) + vertical event markers (anchor / receipt
  // / re-tune / RPC outage / stress survived).
  const eventChartPoints = [
    { t: 0,  price: 76200 }, { t: 1,  price: 76800 }, { t: 2,  price: 77500 },
    { t: 3,  price: 78200 }, { t: 4,  price: 79100 }, { t: 5,  price: 78700 },
    { t: 6,  price: 78200 }, { t: 7,  price: 77600 }, { t: 8,  price: 77000 },
    { t: 9,  price: 76400 }, { t: 10, price: 75500 }, { t: 11, price: 74800 },
    { t: 12, price: 74100 }, { t: 13, price: 73600 }, { t: 14, price: 73900 },
    { t: 15, price: 74700 }, { t: 16, price: 75500 }, { t: 17, price: 76300 },
    { t: 18, price: 77200 }, { t: 19, price: 76800 }, { t: 20, price: 76100 },
    { t: 21, price: 75200 }, { t: 22, price: 76000 }, { t: 23, price: 76800 },
    { t: 24, price: 77400 }, { t: 25, price: 78200 }, { t: 26, price: 78900 },
    { t: 27, price: 79400 }, { t: 28, price: 79800 }, { t: 29, price: 79100 },
    { t: 30, price: 79500 },
  ];
  const eventChartEvents = [
    { t: 4,  label: "Save",            tone: "accent" },
    { t: 8,  label: "Receipt",         tone: "mint" },
    { t: 14, label: "Re-tune",         tone: "cyan" },
    { t: 21, label: "RPC outage",      tone: "rose" },
    { t: 26, label: "Stress survived", tone: "mint" },
  ];
  const eventChartLevels = [
    { value: 63000, label: "Liq $63k",      tone: "rose" },
    { value: 74000, label: "Re-tune $74k",  tone: "amber" },
    { value: 82000, label: "Target $82k",   tone: "mint" },
  ];
  const eventChartHtml = renderEventChart({
    points: eventChartPoints,
    events: eventChartEvents,
    levels: eventChartLevels,
    width: 720,
    height: 240,
    tone: "accent",
    label: "BTC · 30d with policy events",
    xLabels: ["Mar 26", "Apr 02", "Apr 09", "Apr 16", "Apr 23"],
  });

  // UX 4th-pass #46: every chart on the densest section gets a one-
  // sentence "Reads as …" caption above it. The caption is the
  // operator's quick-grok of how to read the visual; doubles
  // scan-time efficiency on the section the title literally calls
  // "TIDE moat".
  const chartsSection = sectionShell("Charts", "Paired position-scale + price-scale (TIDE-unique two-needle primitive) · event chart (price curve + level lines + decision markers, Polymarket-style) · stress sparkline · allocation bar · health ring", `
    <p class="ds-chart-reads-as">Reads as <strong>where am I against the corridor</strong> — top needle is current debt pressure vs target band; bottom is BTC price at the corresponding liquidation distance.</p>
    ${chartPair}
    <div class="ds-spacer"></div>
    <div class="ds-form-cell">
      <span class="section-micro-label">.event-chart — 30d BTC price · 3 horizontal levels · 5 vertical event markers</span>
      <p class="ds-chart-reads-as">Reads as <strong>price journey + decision trail</strong> — the curve is BTC; horizontal lines are policy levels (liq / re-tune / target); vertical markers are operator + system events along the way.</p>
      ${eventChartHtml}
    </div>
    <div class="ds-spacer"></div>
    <p class="ds-chart-reads-as">Reads as <strong>did this policy survive</strong> — each bar is one stress scenario; height = post-stress health (mint = healthy, amber = fragile, rose = liquidated).</p>
    ${sparkline}
    <div class="ds-spacer"></div>
    <div class="ds-form-grid">
      <div class="ds-form-cell">
        <span class="section-micro-label">Allocation bar — collateral split</span>
        <p class="ds-chart-reads-as">Reads as <strong>what's behind the collateral</strong> — proportional segments by token, ordered by weight; legend labels carry the percent.</p>
        <div class="allocation-bar">
          <div class="allocation-bar__track">
            <span class="allocation-bar__seg" style="width:48%; background: var(--accent);"></span>
            <span class="allocation-bar__seg" style="width:22%; background: color-mix(in srgb, var(--accent) 70%, var(--surface));"></span>
            <span class="allocation-bar__seg" style="width:18%; background: color-mix(in srgb, var(--accent) 45%, var(--surface));"></span>
            <span class="allocation-bar__seg" style="width:12%; background: color-mix(in srgb, var(--accent) 25%, var(--surface));"></span>
          </div>
          <div class="allocation-bar__legend">
            <span class="allocation-bar__legend-item"><span class="allocation-bar__legend-dot" style="background:var(--accent)"></span>BTC <strong>48%</strong></span>
            <span class="allocation-bar__legend-item"><span class="allocation-bar__legend-dot" style="background:color-mix(in srgb, var(--accent) 70%, var(--surface))"></span>haSUI <strong>22%</strong></span>
            <span class="allocation-bar__legend-item"><span class="allocation-bar__legend-dot" style="background:color-mix(in srgb, var(--accent) 45%, var(--surface))"></span>USDC <strong>18%</strong></span>
            <span class="allocation-bar__legend-item"><span class="allocation-bar__legend-dot" style="background:color-mix(in srgb, var(--accent) 25%, var(--surface))"></span>WBTC <strong>12%</strong></span>
          </div>
        </div>
      </div>
      <div class="ds-form-cell">
        <span class="section-micro-label">Health ring (renderMiniHealthRing)</span>
        <p class="ds-chart-reads-as">Reads as <strong>how close to the edge</strong> — single 0–100 score; ring fill + tone tell the operator without numbers.</p>
        <div class="ds-form-row" style="gap:1.2rem">
          <div style="display:flex;flex-direction:column;align-items:center;gap:0.35rem">
            ${renderMiniHealthRing(82, 56)}
            <span style="font-size:var(--fs-2xs);color:var(--mint-text);font-family:var(--ff-mono)">healthy</span>
          </div>
          <div style="display:flex;flex-direction:column;align-items:center;gap:0.35rem">
            ${renderMiniHealthRing(54, 56)}
            <span style="font-size:var(--fs-2xs);color:var(--amber-text);font-family:var(--ff-mono)">fragile</span>
          </div>
          <div style="display:flex;flex-direction:column;align-items:center;gap:0.35rem">
            ${renderMiniHealthRing(28, 56)}
            <span style="font-size:var(--fs-2xs);color:var(--rose-text);font-family:var(--ff-mono)">critical</span>
          </div>
        </div>
      </div>
    </div>
  `, 'renderPriceScale({ currentPrice, debtUsd, collateralBtc, targetLow, targetHigh, maxLtv })\nrenderPositionScale({ currentLtv, targetLow, targetHigh, maxLtv })\nrenderStressSparkline(scenarios)\nrenderMiniHealthRing(score, size)\n\nrenderEventChart({\n  points: [{ t: 0, price: 76200 }, { t: 1, price: 76800 }, …],\n  events: [{ t: 4, label: "Save", tone: "accent" }, …],\n  levels: [{ value: 63000, label: "Liq $63k", tone: "rose" }, …],\n  width: 720, height: 240, tone: "accent",\n  xLabels: ["Mar 26", "Apr 02", "Apr 09", "Apr 16", "Apr 23"],\n})\n\n<div class="allocation-bar">\n  <div class="allocation-bar__track">\n    <span class="allocation-bar__seg" style="width:48%; background: var(--accent)"></span>\n    …\n  </div>\n</div>');

  const scenarioCards = `
    <div class="scenario-grid" style="--scenario-count:${scenarios.length}">
      ${scenarios.map((outcome, index) => `
        <article class="scenario-card" data-state="${escapeHtml(outcome.operatingState)}">
          <div class="scenario-card__head">
            ${renderMiniHealthRing(outcome.health.score, 40)}
            <div class="scenario-card__title">
              <span class="scenario-card__index">#${index + 1}</span>
              <strong>${escapeHtml(outcome.scenario.label)}</strong>
              <span class="scenario-card__state">${escapeHtml(formatOperatingStateLabel(outcome.operatingState))}</span>
            </div>
            <span class="state-badge">${escapeHtml(outcome.health.label)}</span>
          </div>
          <div class="scenario-card__metrics">
            <div><span>Payout</span><strong>$${outcome.payoutBandLowUsd}–$${outcome.payoutBandHighUsd}</strong></div>
            <div><span>Runway</span><strong>${Math.round(outcome.bufferCoverageDays)}d</strong></div>
            <div><span>Debt pressure</span><strong>${(outcome.result.decision.risk.ltv * 100).toFixed(1)}%</strong></div>
            <div><span>Action</span><strong>${escapeHtml(formatActionTypeLabel(outcome.result.decision.chosen.type))}</strong></div>
          </div>
        </article>
      `).join("")}
    </div>
  `;

  // Keep the transaction-feed demo in the Transactions section to avoid
  // duplicate mock ledgers on the workspace surface.

  const factListItems = [
    { label: "Lifecycle", value: "Awaiting final receipt", copy: "Checklist complete; mint the closing receipt." },
    { label: "Last receipt", value: "Receipt minted", copy: "Apr 25, 2026 · 10:42" },
    { label: "Last wallet tx", value: "Mint receipt", copy: "Apr 25, 2026 · 10:38" },
    { label: "Activity · 7d", value: "8 events", copy: "8 total recorded" },
  ];
  const factListDefault = renderFactList(factListItems);
  const factListCompact = renderFactList(factListItems, "fact-list-compact");

  // B.16.5 V7: previously the section showed two labels (.fact-list +
  // .fact-list-compact) but only rendered the compact variant — the
  // .fact-list label pointed at nothing. Now both labels carry their
  // own demo, so click-to-copy lands on a real example for each.
  const listsSection = sectionShell("Lists", "Scenario card grid · fact list (default + compact). TX feed lives in shelf VI Crypto & ops (Transactions section).", `
    <p class="section-micro-label">.scenario-grid (auto-fit minmax(220px, 1fr))</p>
    ${scenarioCards}
    <div class="ds-spacer"></div>
    <div class="ds-form-grid">
      <div class="ds-form-cell">
        <span class="section-micro-label">.fact-list</span>
        ${factListDefault}
      </div>
      <div class="ds-form-cell">
        <span class="section-micro-label">.fact-list-compact</span>
        ${factListCompact}
      </div>
    </div>
  `, '<div class="scenario-grid">…</div>\nrenderFactList(items)\nrenderFactList(items, "fact-list-compact")');

  const buttonsSection = sectionShell("Buttons · state badges", "Reach for .button-primary on the surface's single load-bearing action; .button-secondary for everything else. .state-badge is the mid-tier chip that names a count or status without claiming attention. Tone-coded inline chips → .icon-badge (shelf I) · chart-axis chips → .legend-chip (next to charts).", `
    <div class="ds-cluster">
      <button type="button" class="button button-primary">Primary action</button>
      <button type="button" class="button button-secondary">Secondary</button>
      <button type="button" class="button button-secondary" disabled>Disabled</button>
      <!-- UX 4th-pass #26: frozen-hover demo lets a designer read the
           hover paint without losing it on mouse-out. data-hover-frozen
           pins the hover treatment. -->
      <button type="button" class="button button-secondary" data-hover-frozen="true" aria-label="Secondary button — frozen hover state for screenshot">Hover (frozen)</button>
    </div>
    <div class="ds-spacer"></div>
    <div class="ds-cluster">
      <span class="state-badge">8 events</span>
      <span class="state-badge">Guarded</span>
      <span class="state-badge">4 scenarios</span>
    </div>
  `, '<button class="button button-primary">…</button>\n<span class="state-badge">8 events</span>\n\n<!-- For tone-coded inline chips use .icon-badge (shelf I).\n     For chart legend chips use .legend-chip (next to chart). -->');

  // ── Form fields (text / stepper / textarea) ─────────────────────
  // Raw <input type="number"> demo dropped per user dedup — its
  // native hover-only spin buttons are tap-hostile + functionally
  // identical to .stepper-input. Stepper is the canonical numeric
  // input; raw type="number" lives inside it.
  const fieldsSection = sectionShell("Form fields", "Text · stepper · textarea — built on .field. Numeric inputs live inside .stepper-input as the canonical wrapper; raw <input type=\"number\"> by itself is not a primitive on its own.", `
    <div class="ds-form-grid">
      <label class="field ds-form-cell">
        <span>Label</span>
        <input type="text" placeholder="e.g. Conservative HODL" />
        <small>Helper copy explains what this field gates.</small>
      </label>
      <div class="ds-form-cell">
        <span class="section-micro-label" id="ds-stepper-label">Stepper input — canonical numeric input</span>
        <div class="stepper-input">
          <button type="button" class="stepper-input__btn" aria-label="− Decrement Stepper input">−</button>
          <input type="number" value="3" min="0" max="20" inputmode="numeric" aria-labelledby="ds-stepper-label" />
          <button type="button" class="stepper-input__btn" aria-label="+ Increment Stepper input">+</button>
        </div>
      </div>
      <!-- UX 4th-pass #22: at-min and at-max boundary states.
           Operators encounter both regularly when picking corridor-
           bound LTV / buffer / horizon values. -->
      <div class="ds-form-cell">
        <span class="section-micro-label" id="ds-stepper-min-label">At minimum (− disabled)</span>
        <div class="stepper-input">
          <button type="button" class="stepper-input__btn" aria-label="− Decrement (at minimum)" disabled>−</button>
          <input type="number" value="0" min="0" max="20" inputmode="numeric" aria-labelledby="ds-stepper-min-label" />
          <button type="button" class="stepper-input__btn" aria-label="+ Increment">+</button>
        </div>
      </div>
      <div class="ds-form-cell">
        <span class="section-micro-label" id="ds-stepper-max-label">At maximum (+ disabled)</span>
        <div class="stepper-input">
          <button type="button" class="stepper-input__btn" aria-label="− Decrement">−</button>
          <input type="number" value="20" min="0" max="20" inputmode="numeric" aria-labelledby="ds-stepper-max-label" />
          <button type="button" class="stepper-input__btn" aria-label="+ Increment (at maximum)" disabled>+</button>
        </div>
      </div>
      <label class="field ds-form-cell" style="grid-column: 1 / -1;">
        <span>Textarea</span>
        <textarea class="text-area" rows="3" placeholder="Free-form rationale that ships with the receipt."></textarea>
      </label>
    </div>
  `, '<label class="field"><span>Label</span><input type="text" /></label>\n<div class="stepper-input">\n  <button class="stepper-input__btn">−</button>\n  <input type="number" value="3" />\n  <button class="stepper-input__btn">+</button>\n</div>');

  // ── Choice controls (checkbox / radio / toggle-switch) ─────────
  const choiceSection = sectionShell("Choice controls", "Reach for these when the operator picks one or several from a small fixed set. Checkbox = on/off independent · radio = mutually-exclusive within a group · toggle-switch = single immediate setting (live/quiet hours).", `
    <div class="ds-form-row">
      <label class="choice-row">
        <input type="checkbox" checked />
        <span>Auto-mint receipt on confirm</span>
      </label>
      <label class="choice-row">
        <input type="checkbox" />
        <span>Stream operator notifications</span>
      </label>
      <label class="choice-row">
        <input type="checkbox" disabled />
        <span>Disabled checkbox</span>
      </label>
    </div>
    <div class="ds-spacer"></div>
    <div class="ds-form-row">
      <label class="choice-row">
        <input type="radio" name="ds-radio" checked />
        <span>Harbor profile</span>
      </label>
      <label class="choice-row">
        <input type="radio" name="ds-radio" />
        <span>Steady profile</span>
      </label>
      <label class="choice-row">
        <input type="radio" name="ds-radio" />
        <span>Sentinel profile</span>
      </label>
    </div>
    <div class="ds-spacer"></div>
    <div class="ds-form-row">
      <label class="toggle-switch">
        <input type="checkbox" checked />
        <span class="toggle-switch__track"><span class="toggle-switch__thumb"></span></span>
        <span>Live data feed</span>
      </label>
      <label class="toggle-switch">
        <input type="checkbox" />
        <span class="toggle-switch__track"><span class="toggle-switch__thumb"></span></span>
        <span>Quiet hours</span>
      </label>
      <label class="toggle-switch">
        <input type="checkbox" disabled />
        <span class="toggle-switch__track"><span class="toggle-switch__thumb"></span></span>
        <span>Disabled toggle</span>
      </label>
    </div>
  `, '<label class="choice-row">\n  <input type="checkbox" />\n  <span>Auto-mint receipt</span>\n</label>\n\n<label class="toggle-switch">\n  <input type="checkbox" />\n  <span class="toggle-switch__track"><span class="toggle-switch__thumb"></span></span>\n  <span>Live data feed</span>\n</label>');

  // ── Range / slider ─────────────────────────────────────────────
  const rangeSection = sectionShell("Range slider", "Single-thumb · accent-tinted track shows current value", `
    <div class="ds-form-grid">
      <div class="ds-form-cell">
        <span class="section-micro-label" id="ds-range-ltv-label">Debt pressure target</span>
        <div class="range-slider" style="--range-fill: 35%">
          <div class="range-slider__head">
            <span>10%</span>
            <span><strong style="color:var(--text-strong)">35%</strong></span>
            <span>60%</span>
          </div>
          <input type="range" min="10" max="60" value="35" aria-labelledby="ds-range-ltv-label" />
        </div>
      </div>
      <div class="ds-form-cell">
        <span class="section-micro-label" id="ds-range-buffer-label">Buffer ratio</span>
        <div class="range-slider" style="--range-fill: 70%">
          <div class="range-slider__head">
            <span>0%</span>
            <span><strong style="color:var(--text-strong)">70%</strong></span>
            <span>100%</span>
          </div>
          <input type="range" min="0" max="100" value="70" aria-labelledby="ds-range-buffer-label" />
        </div>
      </div>
      <!-- UX 4th-pass #23: disabled state for the slider so operators
           recognise the dimmed-track contract on read-only surfaces. -->
      <div class="ds-form-cell">
        <span class="section-micro-label" id="ds-range-disabled-label">Disabled (read-only mirror)</span>
        <div class="range-slider" style="--range-fill: 50%">
          <div class="range-slider__head">
            <span>0</span>
            <span><strong style="color:var(--muted)">50</strong></span>
            <span>100</span>
          </div>
          <input type="range" min="0" max="100" value="50" disabled aria-labelledby="ds-range-disabled-label" />
        </div>
      </div>
    </div>
  `, '<div class="range-slider" style="--range-fill: 35%">\n  <div class="range-slider__head">\n    <span>10%</span><span>35%</span><span>60%</span>\n  </div>\n  <input type="range" min="10" max="60" value="35" />\n</div>');

  // ── Thresholds rail — multi-thumb tone-coded slider ─────────────
  // The .guardrails-chart__strip primitive consumed on /setup as the
  // policy-thresholds editor. Static demo here; real binding lives
  // inside renderGuardrailsChart (drag → form input → re-render).
  // 4 thumbs (LOW / HIGH / REPAY / EMG) over a tone-zoned debt-pressure axis;
  // a "now" indicator marks current pressure between thumbs.
  const thresholdsRailSection = sectionShell(
    "Thresholds rail",
    "Multi-thumb tone-coded slider — 4 policy guardrails (LOW · HIGH · REPAY · EMG) along a debt-pressure axis. Drag-to-set on /setup; static here. Tone zones (mint target · amber warn · rose liq) reflect zone semantics, not pill colours.",
    `
    <div class="ds-form-cell">
      <span class="section-micro-label">.thresholds-rail · 14.1% – 34.9% debt-pressure axis with anchored allocator median</span>
      <div class="guardrails-chart__strip" aria-label="Debt pressure scale — drag markers to adjust thresholds" style="--strip-rows:1">
        <div class="guardrails-chart__strip-track">
          <div class="guardrails-chart__strip-zone guardrails-chart__strip-zone--mint" style="left:0%;width:42%"></div>
          <div class="guardrails-chart__strip-zone guardrails-chart__strip-zone--amber" style="left:42%;width:39%"></div>
          <div class="guardrails-chart__strip-zone guardrails-chart__strip-zone--rose" style="left:81%;right:0;width:auto"></div>
        </div>
        <div class="guardrails-chart__strip-now" style="left: 24%;" title="Current debt pressure 18.6%"></div>
        <button type="button" class="guardrails-chart__strip-thumb guardrails-chart__strip-thumb--mint" style="left:18.8%;--strip-row:0" title="Target floor: 18.0%" aria-label="Target floor">
          <span class="guardrails-chart__strip-label">LOW</span>
          <span class="guardrails-chart__strip-pct">18.0%</span>
        </button>
        <button type="button" class="guardrails-chart__strip-thumb guardrails-chart__strip-thumb--amber" style="left:42.6%;--strip-row:0" title="Target ceiling: 23.0%" aria-label="Target ceiling">
          <span class="guardrails-chart__strip-label">HIGH</span>
          <span class="guardrails-chart__strip-pct">23.0%</span>
        </button>
        <button type="button" class="guardrails-chart__strip-thumb guardrails-chart__strip-thumb--amber" style="left:61.7%;--strip-row:0" title="Auto-repay: 27.0%" aria-label="Auto-repay">
          <span class="guardrails-chart__strip-label">REPAY</span>
          <span class="guardrails-chart__strip-pct">27.0%</span>
        </button>
        <button type="button" class="guardrails-chart__strip-thumb guardrails-chart__strip-thumb--rose" style="left:80.8%;--strip-row:0" title="Emergency: 31.0%" aria-label="Emergency">
          <span class="guardrails-chart__strip-label">EMG</span>
          <span class="guardrails-chart__strip-pct">31.0%</span>
        </button>
        <div class="guardrails-chart__strip-axis">
          <span>14.1%</span><span>24.5%</span><span>34.9%</span>
        </div>
      </div>
      <p style="margin-top: 0.85rem; font-size: var(--fs-xs); color: var(--muted); line-height: 1.5;">
        Recent 30d, anchored to allocator median ($75,668). Drag a pill to adjust the threshold; the zone behind it re-tunes. EMG sits in the rose zone — the operator can preview a stress-band move without re-entering the corridor math.
      </p>
    </div>
  `,
    `<div class="guardrails-chart__strip" aria-label="Debt pressure scale" style="--strip-rows:1">
  <div class="guardrails-chart__strip-track">
    <div class="guardrails-chart__strip-zone guardrails-chart__strip-zone--mint" style="…"></div>
    <div class="guardrails-chart__strip-zone guardrails-chart__strip-zone--amber" style="…"></div>
    <div class="guardrails-chart__strip-zone guardrails-chart__strip-zone--rose" style="…"></div>
  </div>
  <div class="guardrails-chart__strip-now" style="left: 24%"></div>
  <button class="guardrails-chart__strip-thumb guardrails-chart__strip-thumb--mint" style="left: 18.8%">
    <span class="guardrails-chart__strip-label">LOW</span>
    <span class="guardrails-chart__strip-pct">18.0%</span>
  </button>
  …
  <div class="guardrails-chart__strip-axis"><span>14.1%</span> …</div>
</div>`
  );

  // ── Segmented + select-trigger ─────────────────────────────────
  const selectSection = sectionShell("Segmented · select trigger", "Toggle-buttons (.segmented · aria-pressed) for non-exclusive filters · radiogroup (.segmented--exclusive · aria-checked) for mutually-exclusive choices · chevron picker. Pick the variant that matches the ARIA semantic.", `
    <div class="ds-form-cell" style="margin-bottom:0.85rem">
      <span class="section-micro-label">.segmented (preset group · aria-pressed)</span>
      <div class="ds-form-row">
        <div class="segmented" role="group" aria-label="Preset">
          <button type="button" class="segmented__option" aria-pressed="false">25%</button>
          <button type="button" class="segmented__option" aria-pressed="true">50%</button>
          <button type="button" class="segmented__option" aria-pressed="false">75%</button>
          <button type="button" class="segmented__option" aria-pressed="false">Max</button>
          <!-- UX 4th-pass #20: disabled option (e.g. Mainnet preset on
               testnet-locked builds). -->
          <button type="button" class="segmented__option" aria-pressed="false" disabled title="Disabled — example boundary state">Locked</button>
        </div>
      </div>
      <div class="ds-spacer"></div>
      <span class="section-micro-label">.segmented--exclusive (mode selector · aria-checked / radiogroup)</span>
      <div class="ds-form-row">
        <div class="segmented segmented--exclusive" role="radiogroup" aria-label="Mode">
          <button type="button" class="segmented__option" role="radio" aria-checked="true" tabindex="0">Simulation</button>
          <button type="button" class="segmented__option" role="radio" aria-checked="false" tabindex="-1">Live</button>
        </div>
        <div class="segmented segmented--exclusive" role="radiogroup" aria-label="Network">
          <button type="button" class="segmented__option" role="radio" aria-checked="true" tabindex="0">Testnet</button>
          <button type="button" class="segmented__option" role="radio" aria-checked="false" tabindex="-1">Mainnet</button>
        </div>
      </div>
      <div class="ds-spacer"></div>
      <span class="section-micro-label">.strategy-preset (starter profile cards · aria-pressed)</span>
      <div class="strategy-presets strategy-presets--profiles" role="group" aria-label="Starter profiles">
        <button type="button" class="strategy-preset" aria-pressed="true">
          <span class="strategy-preset__topline">
            <span class="strategy-preset__name"><strong>Harbor</strong></span>
            <span class="strategy-preset__cue">Start here</span>
          </span>
          <em>Conservative. Holds through a -40% week.</em>
          <span class="strategy-preset__stats">
            <span><small>Payout</small><b>$1.2k</b><span>/mo</span></span>
            <span><small>Runway</small><b>4</b><span>mo</span></span>
            <span><small>Debt pressure</small><b>18-24%</b></span>
          </span>
        </button>
        <button type="button" class="strategy-preset" aria-pressed="false">
          <span class="strategy-preset__topline">
            <span class="strategy-preset__name"><strong>Breakwater</strong></span>
            <span class="strategy-preset__cue">Defense</span>
          </span>
          <em>Defense first. Holds through a -60% week.</em>
          <span class="strategy-preset__stats">
            <span><small>Payout</small><b>$0.9k</b><span>/mo</span></span>
            <span><small>Runway</small><b>6</b><span>mo</span></span>
            <span><small>Debt pressure</small><b>16-21%</b></span>
          </span>
        </button>
        <button type="button" class="strategy-preset" aria-pressed="false">
          <span class="strategy-preset__topline">
            <span class="strategy-preset__name"><strong>Drift</strong></span>
            <span class="strategy-preset__cue">Accumulate</span>
          </span>
          <em>Lower draw, longer runway. Keeps more BTC exposure.</em>
          <span class="strategy-preset__stats">
            <span><small>Payout</small><b>$0.6k</b><span>/mo</span></span>
            <span><small>Runway</small><b>8</b><span>mo</span></span>
            <span><small>Debt pressure</small><b>22-28%</b></span>
          </span>
        </button>
      </div>
    </div>
    <div class="ds-form-grid">
      <div class="ds-form-cell">
        <span class="section-micro-label">.select-trigger (collateral picker)</span>
        <button type="button" class="select-trigger">
          ${renderTokenMark("btc", "sm")}
          <span>BTC · native wrap</span>
          <span class="select-trigger__icon">${icon("chevron-down", "sm")}</span>
        </button>
      </div>
      <div class="ds-form-cell">
        <span class="section-micro-label">.select-trigger (rail picker)</span>
        <button type="button" class="select-trigger">
          <span>SuiLend · main pool</span>
          <span class="select-trigger__icon">${icon("chevron-down", "sm")}</span>
        </button>
      </div>
      <div class="ds-form-cell">
        <span class="section-micro-label">disabled</span>
        <button type="button" class="select-trigger" disabled>
          <span>No vaults available</span>
          <span class="select-trigger__icon">${icon("chevron-down", "sm")}</span>
        </button>
      </div>
      <!-- UX 4th-pass #21: aria-expanded=true open-state. Chevron
           rotates 180° via the existing CSS rule; listbox demo shows
           the sibling primitive that today is undefined elsewhere. -->
      <div class="ds-form-cell" style="grid-column: 1 / -1">
        <span class="section-micro-label">.select-trigger[aria-expanded="true"] + .listbox</span>
        <div class="ds-listbox-host">
          <button type="button" class="select-trigger" aria-haspopup="listbox" aria-expanded="true" aria-controls="ds-listbox-demo">
            ${renderTokenMark("btc", "sm")}
            <span>BTC · native wrap</span>
            <span class="select-trigger__icon">${icon("chevron-down", "sm")}</span>
          </button>
          <ul id="ds-listbox-demo" class="listbox" role="listbox" aria-label="Collateral source">
            <li class="listbox__option" role="option" aria-selected="true">${renderTokenMark("btc", "xs")}<span>BTC · native wrap</span></li>
            <li class="listbox__option" role="option" aria-selected="false">${renderTokenMark("hasui", "xs")}<span>haSUI · staked</span></li>
            <li class="listbox__option" role="option" aria-selected="false">${renderTokenMark("usdc", "xs")}<span>USDC · stable</span></li>
            <li class="listbox__option" role="option" aria-selected="false" aria-disabled="true">WBTC · wrapped (unavailable)</li>
          </ul>
        </div>
      </div>
    </div>
  `, '<div class="segmented" role="group">\n  <button class="segmented__option" aria-pressed="true">50%</button>\n  …\n</div>\n\n<button class="select-trigger"\n        aria-haspopup="listbox" aria-expanded="false"\n        aria-controls="my-listbox">\n  <span>BTC · native wrap</span>\n  <span class="select-trigger__icon">${icon("chevron-down","sm")}</span>\n</button>\n<ul id="my-listbox" class="listbox" role="listbox">\n  <li class="listbox__option" role="option" aria-selected="true">BTC</li>\n  …\n</ul>');

  // ── Spinner / skeleton / progress ─────────────────────────────
  const loadingSection = sectionShell("Loading & progress", "Spinner · skeleton · progress bar — keep operators oriented while data is in flight", `
    <div class="ds-state-grid">
      <div class="ds-state-cell">
        <span class="section-micro-label">.spinner (4 sizes)</span>
        <div class="ds-form-row" style="color:var(--accent); font-size:var(--fs-md)">
          <span class="spinner spinner--xs"></span>
          <span class="spinner spinner--sm"></span>
          <span class="spinner spinner--md"></span>
          <span class="spinner spinner--lg"></span>
        </div>
        <div class="ds-form-row">
          <button type="button" class="button button-primary" disabled>
            <span class="spinner spinner--sm" aria-hidden="true"></span>
            <span style="margin-left:0.45rem">Saving policy…</span>
          </button>
        </div>
      </div>
      <div class="ds-state-cell">
        <span class="section-micro-label">.skeleton — self-driving demo · cycles every 25 s</span>
        <!-- B.16.4 / UI 4th-pass A+4: skeletons resolve one-at-a-time
             into real content (4 s per row), pause 1.5 s with all
             content visible, then reset. step-end timing so flips
             feel like a real load, not a fade sweep. Reduced-motion
             gate locks the first frame (all skeletons visible). -->
        <div class="ds-skeleton-demo">
          <div class="ds-skeleton-demo__row" data-step="1">
            <span class="skeleton skeleton--line ds-skeleton-demo__skel" style="width:62%"></span>
            <span class="ds-skeleton-demo__real">Harbor v3 · Conservative HODL</span>
          </div>
          <div class="ds-skeleton-demo__row" data-step="2">
            <span class="skeleton skeleton--line ds-skeleton-demo__skel" style="width:88%"></span>
            <span class="ds-skeleton-demo__real">12.5 BTC collateral · 28% debt-pressure target</span>
          </div>
          <div class="ds-skeleton-demo__row" data-step="3">
            <span class="skeleton skeleton--line ds-skeleton-demo__skel" style="width:74%"></span>
            <span class="ds-skeleton-demo__real">4 stress scenarios · 0 liquidations</span>
          </div>
          <div class="ds-skeleton-demo__row ds-skeleton-demo__row--media" data-step="4">
            <span class="ds-skeleton-demo__skel ds-skeleton-demo__skel--media">
              <span class="skeleton skeleton--circle"></span>
              <span class="skeleton skeleton--line" style="flex:1"></span>
            </span>
            <span class="ds-skeleton-demo__real ds-skeleton-demo__real--media">
              <span class="ds-avatar-circle">${icon("anchor", "sm")}</span>
              <span style="flex:1">Saved on Sui Testnet · checkpoint 175,283,940</span>
            </span>
          </div>
          <div class="ds-skeleton-demo__row" data-step="5">
            <span class="skeleton skeleton--block ds-skeleton-demo__skel"></span>
            <span class="ds-skeleton-demo__real ds-skeleton-demo__real--block">Receipt 8tWUmA…sovVk · proof pinned at 13:42 UTC</span>
          </div>
        </div>
      </div>
      <div class="ds-state-cell">
        <span class="section-micro-label">.progress</span>
        <div class="ds-skeleton-stack">
          <div>
            <p class="section-micro-label" style="margin-bottom:0.25rem">35% · accent</p>
            <span class="progress" style="--progress: 35%"></span>
          </div>
          <div>
            <p class="section-micro-label" style="margin-bottom:0.25rem">68% · mint</p>
            <span class="progress progress--mint" style="--progress: 68%"></span>
          </div>
          <div>
            <p class="section-micro-label" style="margin-bottom:0.25rem">indeterminate</p>
            <span class="progress progress--indeterminate"></span>
          </div>
        </div>
      </div>
    </div>
  `, '<span class="spinner spinner--md"></span>\n\n<span class="skeleton skeleton--line"></span>\n<span class="skeleton skeleton--block"></span>\n\n<span class="progress" style="--progress: 35%"></span>\n<span class="progress progress--indeterminate"></span>');

  // ── Failure surfaces (empty / error / validation / confirm / diff) ──
  const statesSection = sectionShell("Failure surfaces", "Empty · not-connected · error · field validation · confirm-banner · diff. Operator-grade dashboards spend ~30% of their time in these states; treat as first-class.", `
    <div class="ds-form-grid">
      <div class="ds-form-cell">
        <span class="section-micro-label">.empty-state — no data</span>
        <div class="empty-state empty-state--no-data">
          <span class="empty-state__icon">${icon("archive", "lg")}</span>
          <p class="empty-state__title">No receipts yet</p>
          <p class="empty-state__copy">When the cockpit mints its first receipt, it will land here. Run a scenario in Create to start the activity ledger.</p>
          <div class="empty-state__cta">
            <a href="#" class="button button-primary">${icon("zap","sm")}<span style="margin-left:0.4rem">Open Create</span></a>
          </div>
        </div>
      </div>
      <div class="ds-form-cell">
        <span class="section-micro-label">.empty-state--not-connected</span>
        <div class="empty-state empty-state--not-connected">
          <!-- B.16.5 V6: was shield-check (looked identical to no-data
               at scan distance). alert-triangle paints amber per the
               existing tone override and reads as "warn / wallet not
               connected" instantly. -->
          <span class="empty-state__icon">${icon("alert-triangle", "lg")}</span>
          <p class="empty-state__title">Wallet not connected</p>
          <p class="empty-state__copy">Live cockpit needs a Sui wallet to read your policies. Connect to view positions; nothing signs without explicit approval.</p>
          <div class="empty-state__cta">
            <button type="button" class="button button-primary" data-aspirational="true" title="Aspirational — wired to real wallet flow on a future commit">${icon("zap","sm")}<span style="margin-left:0.4rem">Connect wallet</span></button>
          </div>
        </div>
      </div>
      <div class="ds-form-cell">
        <span class="section-micro-label">.empty-state--error (with retry)</span>
        <div class="empty-state empty-state--error">
          <span class="empty-state__icon">${icon("alert-octagon", "lg")}</span>
          <p class="empty-state__title">Couldn't reach the rail</p>
          <p class="empty-state__copy">SuiLend RPC is not responding. Live data is paused; modeled scenarios still work. We retry every 30 seconds.</p>
          <div class="empty-state__cta">
            <button type="button" class="button button-secondary">${icon("refresh-cw","sm")}<span style="margin-left:0.4rem">Retry now</span></button>
          </div>
        </div>
      </div>
    </div>
    <div class="ds-spacer"></div>
    <div class="ds-form-grid">
      <label class="field ds-form-cell field--warn">
        <span>Field — warn</span>
        <input type="text" value="Harbor v3" aria-invalid="false" aria-describedby="ds-field-warn-hint" />
        <small id="ds-field-warn-hint">Profile name already used; saving creates v4.</small>
      </label>
      <label class="field ds-form-cell field--error">
        <span>Field — error</span>
        <input type="number" value="98" min="0" max="80" aria-invalid="true" aria-describedby="ds-field-error-hint" />
        <small id="ds-field-error-hint">Debt-pressure target above the rail's max collateral factor (80%).</small>
      </label>
      <label class="field ds-form-cell field--valid">
        <span>Field — valid</span>
        <input type="text" value="0xae3bf821cd9e22b09c4f7a8d3e1bc02d5f60a91e8b34cd219f8a05c7e3b8d4f2c" aria-invalid="false" aria-describedby="ds-field-valid-hint" />
        <small id="ds-field-valid-hint">Address checksum verified.</small>
      </label>
    </div>
    <div class="ds-spacer"></div>
    <div class="ds-stack" style="display:flex;flex-direction:column;gap:0.7rem">
      <span class="section-micro-label">.confirm-banner (3 tones — default rose / warn amber / accent cobalt)</span>
      <section class="confirm-banner">
        <span class="confirm-banner__icon">${icon("alert-octagon", "sm")}</span>
        <div class="confirm-banner__copy">
          <p class="confirm-banner__title">This save is public on testnet</p>
          <p class="confirm-banner__detail">Once saved, the policy is public. You can tear it down, but the on-chain history will reference this id.</p>
        </div>
        <div class="confirm-banner__action">
          <button type="button" class="button button-secondary">Cancel</button>
          <button type="button" class="button button-primary">Save</button>
        </div>
      </section>
      <section class="confirm-banner confirm-banner--warn">
        <span class="confirm-banner__icon">${icon("alert-triangle", "sm")}</span>
        <div class="confirm-banner__copy">
          <p class="confirm-banner__title">Modeled · not yet on-chain</p>
          <p class="confirm-banner__detail">Switch the rail mode to "Live" only after a receipt is minted. Until then, payouts are projections.</p>
        </div>
        <div class="confirm-banner__action">
          <button type="button" class="button button-secondary">Got it</button>
        </div>
      </section>
      <section class="confirm-banner confirm-banner--accent">
        <span class="confirm-banner__icon">${icon("info", "sm")}</span>
        <div class="confirm-banner__copy">
          <p class="confirm-banner__title">Policy revision will require a new receipt</p>
          <p class="confirm-banner__detail">Saving these changes mints a fresh receipt and supersedes Harbor v3. Old receipts remain valid for prior periods.</p>
        </div>
        <div class="confirm-banner__action">
          <button type="button" class="button button-primary">Save revision</button>
        </div>
      </section>
    </div>
    <div class="ds-spacer"></div>
    <div class="ds-form-grid">
      <div class="ds-form-cell">
        <span class="section-micro-label">.diff-row — policy revision preview</span>
        <div class="diff-row diff-row--up">
          <div>
            <p class="diff-row__label">Debt-pressure target</p>
            <span class="diff-row__before">36.4%</span>
          </div>
          <span class="diff-row__arrow">${icon("chevron-right", "sm")}</span>
          <span class="diff-row__after">42.0%</span>
        </div>
        <div class="diff-row diff-row--down">
          <div>
            <p class="diff-row__label">Liq. boundary</p>
            <span class="diff-row__before">78.0%</span>
          </div>
          <span class="diff-row__arrow">${icon("chevron-right", "sm")}</span>
          <span class="diff-row__after">75.0%</span>
        </div>
        <div class="diff-row diff-row--neutral">
          <div>
            <p class="diff-row__label">Rail</p>
            <span class="diff-row__before">SuiLend · main</span>
          </div>
          <span class="diff-row__arrow">${icon("chevron-right", "sm")}</span>
          <span class="diff-row__after">NAVI · prime</span>
        </div>
      </div>
    </div>
  `, '<div class="empty-state empty-state--error">\n  <span class="empty-state__icon">${icon("alert-octagon","lg")}</span>\n  <p class="empty-state__title">Couldn\\u0027t reach the rail</p>\n  <p class="empty-state__copy">…</p>\n  <button class="button button-secondary">Retry now</button>\n</div>\n\n<label class="field field--error">\n  <span>Debt-pressure target</span>\n  <input type="number" />\n  <small>Above max collateral factor.</small>\n</label>\n\n<section class="confirm-banner">…</section>\n\n<div class="diff-row diff-row--up">\n  <span class="diff-row__before">36.4%</span>\n  <span class="diff-row__arrow">${icon("chevron-right","sm")}</span>\n  <span class="diff-row__after">42.0%</span>\n</div>');

  // ── More primitives — search · kbd · timeline · icon-badge · drop · date ──
  // ── Chips (shelf I Foundations) — icon-badge + kbd ─────────────
  // Per UX second pass: kbd + icon-badge belong with Foundations, not
  // in a meta-named "More primitives" grab-bag.
  const chipsKbdSection = sectionShell("Inline chips · keyboard hints", ".icon-badge — canonical tone-coded inline label (7 tones) · .kbd — keyboard shortcut chip", `
    <div class="ds-form-grid">
      <div class="ds-form-cell">
        <span class="section-micro-label">.icon-badge (7 tones)</span>
        <div class="ds-form-row" style="gap:0.4rem">
          <span class="icon-badge">${icon("info","xs")} draft</span>
          <span class="icon-badge icon-badge--mint">${icon("check","xs")} live</span>
          <span class="icon-badge icon-badge--amber">${icon("alert-triangle","xs")} stale</span>
          <span class="icon-badge icon-badge--rose">${icon("alert-octagon","xs")} liq risk</span>
          <span class="icon-badge icon-badge--cyan">${icon("zap","xs")} on-chain</span>
          <span class="icon-badge icon-badge--violet">${icon("settings","xs")} guarded</span>
          <span class="icon-badge icon-badge--accent">${icon("anchor","xs")} saved</span>
        </div>
      </div>
      <div class="ds-form-cell">
        <span class="section-micro-label">.kbd <span style="font-weight:400;color:var(--muted);text-transform:none;letter-spacing:0">— press a key on the page to flash the matching chip</span></span>
        <p style="font-size:var(--fs-sm); line-height:1.7; margin:0">
          Open command palette: <span class="kbd" data-kbd-key="Meta">⌘</span> <span class="kbd" data-kbd-key="K">K</span> · search: <span class="kbd" data-kbd-key="/">/</span> · close modal: <span class="kbd" data-kbd-key="Escape">Esc</span> · cycle tabs: <span class="kbd" data-kbd-key="ArrowLeft">←</span> <span class="kbd" data-kbd-key="ArrowRight">→</span>.
        </p>
      </div>
    </div>
  `, '<span class="icon-badge icon-badge--mint">${icon("check","xs")} live</span>\n<span class="icon-badge icon-badge--amber">${icon("alert-triangle","xs")} stale</span>\n\n<span class="kbd">⌘</span> <span class="kbd">K</span>');

  // ── Inputs extra (shelf IV) — search · date · calendar · drop ──
  const inputsExtraSection = sectionShell("Search · date · calendar · file drop", ".search-field · .date-field · .calendar (TIDE-on-brand month grid that replaces the un-stylable native browser popup) · .drop-zone", `
    <div class="ds-form-grid">
      <div class="ds-form-cell">
        <span class="section-micro-label">.search-field</span>
        <label class="search-field">
          <span class="search-field__icon" aria-hidden="true">${icon("search","sm")}</span>
          <input type="search" placeholder="Search receipts, policies, addresses…" aria-label="Search receipts, policies, addresses" />
          <span class="kbd" aria-hidden="true">⌘ K</span>
        </label>
        <label class="search-field" style="margin-top:0.5rem">
          <span class="search-field__icon" aria-hidden="true">${icon("filter","sm")}</span>
          <input type="search" placeholder="Filter activity…" value="receipt" aria-label="Filter activity" />
          <button type="button" class="search-field__clear" aria-label="Clear filter">${icon("x","xs")}</button>
        </label>
      </div>
      <div class="ds-form-cell">
        <span class="section-micro-label">.date-field — trigger (popup is browser-native, system locale)</span>
        <div class="date-field">
          <span class="date-field__icon" aria-hidden="true">${icon("calendar","sm")}</span>
          <input type="date" value="2026-04-25" aria-label="Receipt date" />
        </div>
        <small style="color:var(--muted); font-size: var(--fs-2xs); line-height: 1.5; margin-top: 0.4rem; display:block;">
          The trigger above is ours. Native &lt;input type="date"&gt; opens the system picker which we can't style. Real flows mount the .calendar primitive (right) instead.
        </small>
      </div>
      <div class="ds-form-cell">
        <span class="section-micro-label">.calendar — TIDE-on-brand month grid (replaces the system popup)</span>
        <div class="calendar" role="group" aria-label="Calendar — April 2026">
          <div class="calendar__head">
            <h4 class="calendar__title">April 2026</h4>
            <div class="calendar__nav">
              <button type="button" class="calendar__nav-btn" aria-label="Previous month">${icon("chevron-left","xs")}</button>
              <button type="button" class="calendar__nav-btn" aria-label="Next month">${icon("chevron-right","xs")}</button>
            </div>
          </div>
          <div class="calendar__weekdays" aria-hidden="true">
            <span class="calendar__weekday">Mon</span>
            <span class="calendar__weekday">Tue</span>
            <span class="calendar__weekday">Wed</span>
            <span class="calendar__weekday">Thu</span>
            <span class="calendar__weekday">Fri</span>
            <span class="calendar__weekday">Sat</span>
            <span class="calendar__weekday">Sun</span>
          </div>
          <div class="calendar__grid" role="grid">
            <button type="button" class="calendar__day calendar__day--outside" tabindex="-1">30</button>
            <button type="button" class="calendar__day calendar__day--outside" tabindex="-1">31</button>
            <button type="button" class="calendar__day">1</button>
            <button type="button" class="calendar__day">2</button>
            <button type="button" class="calendar__day">3</button>
            <button type="button" class="calendar__day">4</button>
            <button type="button" class="calendar__day">5</button>
            <button type="button" class="calendar__day">6</button>
            <button type="button" class="calendar__day">7</button>
            <button type="button" class="calendar__day">8</button>
            <button type="button" class="calendar__day">9</button>
            <button type="button" class="calendar__day">10</button>
            <button type="button" class="calendar__day">11</button>
            <button type="button" class="calendar__day">12</button>
            <button type="button" class="calendar__day">13</button>
            <button type="button" class="calendar__day">14</button>
            <button type="button" class="calendar__day">15</button>
            <button type="button" class="calendar__day">16</button>
            <button type="button" class="calendar__day">17</button>
            <button type="button" class="calendar__day">18</button>
            <button type="button" class="calendar__day">19</button>
            <button type="button" class="calendar__day">20</button>
            <button type="button" class="calendar__day">21</button>
            <button type="button" class="calendar__day calendar__day--in-range">22</button>
            <button type="button" class="calendar__day calendar__day--in-range">23</button>
            <button type="button" class="calendar__day calendar__day--in-range">24</button>
            <button type="button" class="calendar__day calendar__day--selected" aria-selected="true">25</button>
            <button type="button" class="calendar__day calendar__day--today" aria-current="date">26</button>
            <button type="button" class="calendar__day">27</button>
            <button type="button" class="calendar__day">28</button>
            <button type="button" class="calendar__day">29</button>
            <button type="button" class="calendar__day">30</button>
            <button type="button" class="calendar__day calendar__day--disabled" disabled tabindex="-1">1</button>
            <button type="button" class="calendar__day calendar__day--disabled" disabled tabindex="-1">2</button>
            <button type="button" class="calendar__day calendar__day--disabled" disabled tabindex="-1">3</button>
          </div>
          <div class="calendar__foot">
            <button type="button" class="calendar__foot-btn">Clear</button>
            <button type="button" class="calendar__foot-btn">Today</button>
          </div>
        </div>
        <small style="color:var(--muted); font-size: var(--fs-2xs); line-height: 1.5; margin-top: 0.4rem; display:block;">
          States: outside-month (muted), today (cobalt ring), selected (filled accent), in-range (tinted), disabled (line-through).
        </small>
      </div>
      <div class="ds-form-cell">
        <span class="section-micro-label">.drop-zone — idle</span>
        <div class="drop-zone" tabindex="0" role="button" aria-label="Drop pack file here or click to browse">
          <span class="drop-zone__icon" aria-hidden="true">${icon("upload","lg")}</span>
          <span class="drop-zone__title">Drop a Create pack here</span>
          <span class="drop-zone__sub">JSON only · paste from clipboard with <span class="kbd">⌘ V</span> or click to browse</span>
        </div>
      </div>
      <div class="ds-form-cell">
        <span class="section-micro-label">.drop-zone--dragging — file over zone</span>
        <div class="drop-zone drop-zone--dragging" tabindex="0" role="button" aria-label="Release to import">
          <span class="drop-zone__icon" aria-hidden="true">${icon("download","lg")}</span>
          <span class="drop-zone__title">Release to import</span>
          <span class="drop-zone__sub">harbor-conservative-v3.json (4.2 KB)</span>
        </div>
      </div>
    </div>
  `, '<label class="search-field">\n  <span class="search-field__icon">${icon("search","sm")}</span>\n  <input type="search" />\n  <span class="kbd">⌘ K</span>\n</label>\n\n<div class="date-field">\n  <span class="date-field__icon">${icon("calendar","sm")}</span>\n  <input type="date" />\n</div>\n\n<div class="drop-zone" tabindex="0" role="button">…</div>\n<div class="drop-zone drop-zone--dragging" tabindex="0" role="button">…</div>');

  // ── Status timeline (shelf VI Crypto & ops) ─────────────────────
  const timelineSection = sectionShell("Status timeline", ".status-timeline — multi-step progress for wallet signing flow + onboarding wizard. Owns the full 7-stage journey; .signing-state is the single-state inline surface. State coverage: done / current / pending / failed.", `
    <div class="ds-form-grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
      <div class="ds-form-cell">
        <span class="section-micro-label">Happy path · 4 done · 1 current · 2 pending</span>
        <ol class="status-timeline" aria-label="Signing flow status">
      <li class="status-timeline__step status-timeline__step--done">
        <span class="status-timeline__dot">${icon("check","xs")}</span>
        <div class="status-timeline__copy">
          <span class="status-timeline__title">Pre-check passed</span>
          <span class="status-timeline__sub">policy + balance OK · 14:18:02</span>
        </div>
      </li>
      <li class="status-timeline__step status-timeline__step--done">
        <span class="status-timeline__dot">${icon("check","xs")}</span>
        <div class="status-timeline__copy">
          <span class="status-timeline__title">Wallet approved</span>
          <span class="status-timeline__sub">0xae3bf821…8d4f2c · 14:18:14</span>
        </div>
      </li>
      <li class="status-timeline__step status-timeline__step--done">
        <span class="status-timeline__dot">${icon("check","xs")}</span>
        <div class="status-timeline__copy">
          <span class="status-timeline__title">Signed</span>
          <span class="status-timeline__sub">tx 8tWUmA…sovVk · 14:18:15</span>
        </div>
      </li>
      <li class="status-timeline__step status-timeline__step--done">
        <span class="status-timeline__dot">${icon("check","xs")}</span>
        <div class="status-timeline__copy">
          <span class="status-timeline__title">Broadcast</span>
          <span class="status-timeline__sub">RPC accepted · 14:18:16</span>
        </div>
      </li>
      <li class="status-timeline__step status-timeline__step--current">
        <span class="status-timeline__dot"><span class="spinner spinner--xs" aria-hidden="true"></span></span>
        <div class="status-timeline__copy">
          <span class="status-timeline__title">Confirming</span>
          <span class="status-timeline__sub">awaiting checkpoint…</span>
        </div>
      </li>
      <li class="status-timeline__step status-timeline__step--pending">
        <span class="status-timeline__dot"></span>
        <div class="status-timeline__copy">
          <span class="status-timeline__title">Verify Move execution</span>
          <span class="status-timeline__sub">queued</span>
        </div>
      </li>
      <li class="status-timeline__step status-timeline__step--pending">
        <span class="status-timeline__dot"></span>
        <div class="status-timeline__copy">
          <span class="status-timeline__title">Mint receipt</span>
          <span class="status-timeline__sub">queued</span>
        </div>
      </li>
        </ol>
      </div>
      <div class="ds-form-cell">
        <span class="section-micro-label">Failure path · 2 done · 1 failed (Move abort) · 4 unreachable</span>
        <ol class="status-timeline" aria-label="Signing flow with failure">
          <li class="status-timeline__step status-timeline__step--done">
            <span class="status-timeline__dot">${icon("check","xs")}</span>
            <div class="status-timeline__copy">
              <span class="status-timeline__title">Pre-check passed</span>
              <span class="status-timeline__sub">policy + balance OK · 14:18:02</span>
            </div>
          </li>
          <li class="status-timeline__step status-timeline__step--done">
            <span class="status-timeline__dot">${icon("check","xs")}</span>
            <div class="status-timeline__copy">
              <span class="status-timeline__title">Wallet approved</span>
              <span class="status-timeline__sub">0xae3bf821…8d4f2c · 14:18:14</span>
            </div>
          </li>
          <li class="status-timeline__step status-timeline__step--failed">
            <span class="status-timeline__dot">${icon("x","xs")}</span>
            <div class="status-timeline__copy">
              <span class="status-timeline__title">Move abort · execution failed on-chain</span>
              <span class="status-timeline__sub">tx 8tWUmA…sovVk · 14:18:17 · ENotEnoughCollateral</span>
            </div>
          </li>
          <li class="status-timeline__step status-timeline__step--pending">
            <span class="status-timeline__dot"></span>
            <div class="status-timeline__copy">
              <span class="status-timeline__title">Confirming</span>
              <span class="status-timeline__sub">unreachable</span>
            </div>
          </li>
          <li class="status-timeline__step status-timeline__step--pending">
            <span class="status-timeline__dot"></span>
            <div class="status-timeline__copy">
              <span class="status-timeline__title">Verify Move execution</span>
              <span class="status-timeline__sub">unreachable</span>
            </div>
          </li>
          <li class="status-timeline__step status-timeline__step--pending">
            <span class="status-timeline__dot"></span>
            <div class="status-timeline__copy">
              <span class="status-timeline__title">Mint receipt</span>
              <span class="status-timeline__sub">unreachable</span>
            </div>
          </li>
        </ol>
      </div>
    </div>
  `, '<ol class="status-timeline">\n  <li class="status-timeline__step status-timeline__step--done">\n    <span class="status-timeline__dot">${icon("check","xs")}</span>\n    <div class="status-timeline__copy">\n      <span class="status-timeline__title">Step</span>\n    </div>\n  </li>\n  <li class="status-timeline__step status-timeline__step--current">…</li>\n  <li class="status-timeline__step status-timeline__step--failed">…</li>\n</ol>');

  // ── Toast ─────────────────────────────────────────────────────
  const toastSection = sectionShell("Toast", "Reach for a toast when the system needs to acknowledge an action without blocking the operator. Use mint for success (receipt minted), amber for warn (stale feed), rose for failure (wallet rejected, role=alert) — never for primary affordances.", `
    <div class="toast-region toast-region--demo" role="region" aria-label="Notifications" aria-live="polite">
      <div class="toast" role="status">
        <span class="toast__icon">${icon("info", "sm")}</span>
        <div class="toast__body">
          <p class="toast__title">Policy saved</p>
          <p class="toast__copy">Object 0xae3bf821…8d4f2c is live on testnet. Receipts will reference this policy from now on.</p>
        </div>
        <button type="button" class="toast__close" aria-label="Dismiss">${icon("x", "sm")}</button>
      </div>
      <div class="toast toast--mint" role="status">
        <span class="toast__icon">${icon("check", "sm")}</span>
        <div class="toast__body">
          <p class="toast__title">Receipt minted</p>
          <p class="toast__copy">Content digest is pinned on testnet. Walrus evidence is attached when the runtime publisher returns a blob; otherwise the receipt shows an explicit stub boundary.</p>
        </div>
        <button type="button" class="toast__close" aria-label="Dismiss">${icon("x", "sm")}</button>
      </div>
      <div class="toast toast--amber" role="status">
        <span class="toast__icon">${icon("alert-triangle", "sm")}</span>
        <div class="toast__body">
          <p class="toast__title">Feed is stale</p>
          <p class="toast__copy">Last price update was 4 min ago. Live monitor will block execution until the feed recovers.</p>
        </div>
        <button type="button" class="toast__close" aria-label="Dismiss">${icon("x", "sm")}</button>
      </div>
      <div class="toast toast--rose" role="alert" aria-live="assertive">
        <span class="toast__icon">${icon("alert-octagon", "sm")}</span>
        <div class="toast__body">
          <p class="toast__title">Wallet rejected sign</p>
          <p class="toast__copy">User cancelled the transaction. No on-chain state changed.</p>
        </div>
        <button type="button" class="toast__close" aria-label="Dismiss">${icon("x", "sm")}</button>
      </div>
    </div>
  `, '<div class="toast toast--mint" role="status">\n  <span class="toast__icon">${icon("check","sm")}</span>\n  <div class="toast__body">\n    <p class="toast__title">Receipt minted</p>\n    <p class="toast__copy">Content digest is pinned on-chain.</p>\n  </div>\n  <button class="toast__close">${icon("x","sm")}</button>\n</div>');

  // ── Modal ─────────────────────────────────────────────────────
  // UX 4th-pass #10/#11/#44 + UI P9: order flipped to preview → trigger,
  // sub-eyebrows over each, role=dialog + aria-modal stripped from the
  // static preview (it's chrome only, not modal — the lie misannounced
  // it as a focus-trapped dialog), Cancel inside the static preview is
  // now correctly disabled (it had no handler — silent dead-click). The
  // live <dialog> is unchanged.
  const modalSection = sectionShell("Modal", "Reach for a modal when the operator must decide before the surface continues. Native <dialog> + .showModal() gives focus-trap + ESC + click-outside + accessibility tree for free.", `
    <div style="display:flex;flex-direction:column;align-items:stretch;gap:1.1rem">
      <div style="display:flex;flex-direction:column;align-items:center;gap:0.55rem">
        <span class="section-micro-label">Static preview · chrome only</span>
        <div class="modal modal--static" aria-hidden="true">
          <div class="modal__head">
            <h3 class="modal__title">Save policy on testnet?</h3>
            <p class="modal__sub">Object will be public + immutable until you tear it down.</p>
          </div>
          <div class="modal__body">
            <p>Saving writes the policy bytes you saw on the previous step to Sui. Until you mint a receipt, no execution can reference this policy yet.</p>
          </div>
          <div class="modal__foot">
            <button type="button" class="button button-secondary" disabled>Cancel</button>
            <button type="button" class="button button-primary" data-aspirational="true" disabled title="Aspirational — wired to real save flow on a future commit">Save policy</button>
          </div>
        </div>
      </div>
      <hr class="ds-section-divider" aria-hidden="true" />
      <div style="display:flex;flex-direction:column;align-items:center;gap:0.55rem">
        <span class="section-micro-label">Live trigger · &lt;dialog&gt;.showModal()</span>
        <button type="button" class="button button-primary" data-modal-open="ds-modal-live">${icon("zap","sm")}<span style="margin-left:0.4rem">Open live &lt;dialog&gt;</span></button>
        <p class="ds-modal-hint">Try Tab inside the dialog — focus stays in. Press ESC or click outside to dismiss.</p>
      </div>
    </div>
    <dialog id="ds-modal-live" class="modal" aria-labelledby="ds-modal-live-title" aria-describedby="ds-modal-live-body">
      <div class="modal__head">
        <h3 class="modal__title" id="ds-modal-live-title">Save policy on testnet?</h3>
        <p class="modal__sub">Object will be public + immutable until you tear it down. Press ESC, click outside, or use Cancel to close.</p>
      </div>
      <div class="modal__body" id="ds-modal-live-body">
        <p>This is the same .modal chrome mounted inside a real &lt;dialog&gt;. Browser handles focus trap, backdrop click-outside, and ESC dismiss. Per third-pass UI+frontend 2/3 consensus.</p>
      </div>
      <div class="modal__foot">
        <button type="button" class="button button-secondary" data-modal-close="ds-modal-live">Cancel</button>
        <button type="button" class="button button-primary" data-aspirational="true" data-modal-close="ds-modal-live" title="Aspirational — real flow would block the dialog while the save RPC is pending and only close on receipt mint">Save policy</button>
      </div>
    </dialog>
  `, '<dialog class="modal" id="save-policy">\n  <div class="modal__head">…</div>\n  <div class="modal__body">…</div>\n  <div class="modal__foot">\n    <button class="button button-secondary" data-modal-close>Cancel</button>\n    <button class="button button-primary">Confirm</button>\n  </div>\n</dialog>\n\n<button class="button button-primary"\n        data-modal-open="save-policy">Open dialog</button>\n\n// JS — real flow blocks the dialog until receipt mints\ndoc.querySelector(\'[data-modal-open]\').onclick = () =>\n  doc.getElementById(\'save-policy\').showModal();');

  // ── Tooltip ───────────────────────────────────────────────────
  const tooltipSection = sectionShell("Tooltip", "[data-tooltip] — hover/focus reveal · 220 px max width · radius-xs", `
    <p style="font-size:var(--fs-sm); line-height:1.6; max-width:48ch">
      The
      <span class="ds-tooltip-host"><span data-tooltip="Debt pressure is the LTV math: debt ÷ collateral × 100. Boundary corridor sets when re-tune fires.">Debt-pressure boundary</span></span>
      is monitored against the
      <span class="ds-tooltip-host"><span data-tooltip="The signed price feed used for liquidation math. Must be < 60 s old.">live feed</span></span>;
      if the corridor is breached, the
      <span class="ds-tooltip-host"><span data-tooltip="Operator-defined posture. Mint = healthy, amber = warn, rose = danger.">posture badge</span></span>
      flips and a
      <span class="ds-tooltip-host"><span data-tooltip="Re-aim moves the debt-pressure target back inside the corridor. Re-tune adjusts the corridor itself.">re-aim or re-tune</span></span>
      action queues.
    </p>
  `, '<span data-tooltip="Debt pressure is the LTV math: debt ÷ collateral × 100">Debt-pressure boundary</span>');

  // ── Data-density atoms ───────────────────────────────────────
  const densitySection = sectionShell("Data-density atoms", "Delta chip · inline spark · token-amount row · meta line — bits dense surfaces compose into rows", `
    <div class="ds-density-grid">
      <div class="ds-density-cell">
        <span class="section-micro-label">.delta-chip</span>
        <div class="ds-form-row">
          <span class="delta-chip delta-chip--up"><span class="delta-chip__arrow">▲</span> 1.2%</span>
          <span class="delta-chip delta-chip--up"><span class="delta-chip__arrow">▲</span> +$1.4k</span>
          <span class="delta-chip delta-chip--down"><span class="delta-chip__arrow">▼</span> 3.4%</span>
          <span class="delta-chip delta-chip--down"><span class="delta-chip__arrow">▼</span> -$840</span>
          <span class="delta-chip">flat</span>
        </div>
      </div>
      <div class="ds-density-cell">
        <span class="section-micro-label">.spark-inline (4 tones)</span>
        <div class="ds-form-row" style="gap:1rem">
          ${renderInlineSpark([3,5,4,7,6,9,8,11], { tone: "mint" })}
          <span style="font-family:var(--ff-mono);font-size:var(--fs-xs);color:var(--mint-text)">+24.6%</span>
        </div>
        <div class="ds-form-row" style="gap:1rem">
          ${renderInlineSpark([11,9,9,7,8,5,6,4], { tone: "rose" })}
          <span style="font-family:var(--ff-mono);font-size:var(--fs-xs);color:var(--rose-text)">-18.2%</span>
        </div>
        <div class="ds-form-row" style="gap:1rem">
          ${renderInlineSpark([5,6,5,7,5,6,5,6], { tone: "cyan" })}
          <span style="font-family:var(--ff-mono);font-size:var(--fs-xs);color:var(--cyan-text)">live · 8h</span>
        </div>
      </div>
    </div>
    <div class="ds-spacer"></div>
    <div class="ds-density-grid">
      <div class="ds-density-cell">
        <span class="section-micro-label">.token-amount-row</span>
        <div class="token-amount-row">
          ${renderTokenMark("btc", "sm")}
          <span class="token-amount-row__sym">BTC</span>
          <span class="token-amount-row__name">native</span>
          <span class="token-amount-row__amount">12.5000 <small>$962,500.00</small></span>
        </div>
        <div class="token-amount-row">
          ${renderTokenMark("usdc", "sm")}
          <span class="token-amount-row__sym">USDC</span>
          <span class="token-amount-row__name">debt</span>
          <span class="token-amount-row__amount">140,000.00 <small>$140,000.00</small></span>
        </div>
        <div class="token-amount-row">
          ${renderTokenMark("hasui", "sm")}
          <span class="token-amount-row__sym">haSUI</span>
          <span class="token-amount-row__name">staked</span>
          <span class="token-amount-row__amount">8,500.000 <small>$25,500.00</small></span>
        </div>
      </div>
      <div class="ds-density-cell">
        <span class="section-micro-label">.meta-line</span>
        <div>
          <div class="meta-line">
            <span class="meta-line__label">tx</span>
            <span class="meta-line__value">8tWUmA…sovVk</span>
            <span class="meta-line__time">2026-04-25 14:18 UTC</span>
          </div>
          <div class="meta-line">
            <span class="meta-line__label">policy</span>
            <span class="meta-line__value">harbor-conservative · v3</span>
            <span class="meta-line__time">2 min ago</span>
          </div>
          <div class="meta-line">
            <span class="meta-line__label">checkpoint</span>
            <span class="meta-line__value">175,283,940</span>
            <span class="meta-line__time">finalized</span>
          </div>
          <div class="meta-line">
            <span class="meta-line__label">walrus</span>
            <span class="meta-line__value">blob-id: qVQGc8iZ…wXa9</span>
            <span class="meta-line__time">epoch 612</span>
          </div>
        </div>
      </div>
    </div>
  `, '<span class="delta-chip delta-chip--up"><span class="delta-chip__arrow">▲</span> 1.2%</span>\n\nrenderInlineSpark([3,5,4,7,6,9,8,11], { tone: "mint" })\n\n<div class="token-amount-row">\n  ${renderTokenMark("btc","sm")}\n  <span class="token-amount-row__sym">BTC</span>\n  <span class="token-amount-row__amount">12.5000 <small>$962,500.00</small></span>\n</div>');

  // ── Navigation ───────────────────────────────────────────────
  const navigationSection = sectionShell("Navigation", "Reach for breadcrumb when the operator needs to retrace a deep path · tabs when one surface holds peer views (overview / scenarios / evidence) · pagination when a list is long enough that scrolling alone hurts orientation.", `
    <div class="ds-nav-stack">
      <div class="ds-nav-cell">
        <span class="section-micro-label">.breadcrumb</span>
        <nav class="breadcrumb" aria-label="Breadcrumb">
          <span class="breadcrumb__item"><a href="#">Workspace</a></span>
          <span class="breadcrumb__sep">${icon("chevron-right", "xs")}</span>
          <span class="breadcrumb__item"><a href="#">Policies</a></span>
          <span class="breadcrumb__sep">${icon("chevron-right", "xs")}</span>
          <span class="breadcrumb__item"><a href="#">Harbor · v3</a></span>
          <span class="breadcrumb__sep">${icon("chevron-right", "xs")}</span>
          <span class="breadcrumb__item breadcrumb__item--current" aria-current="page">Receipt 8tWUmA…sovVk</span>
        </nav>
      </div>
      <div class="ds-nav-cell">
        <span class="section-micro-label">.tabs (with count badges)</span>
        <div class="tabs" role="tablist" aria-label="Receipt sections">
          <button type="button" class="tabs__option" role="tab" aria-selected="true" tabindex="0">Overview</button>
          <button type="button" class="tabs__option" role="tab" aria-selected="false" tabindex="-1">Scenarios <span class="tabs__count" aria-label="12 scenarios">12</span></button>
          <button type="button" class="tabs__option" role="tab" aria-selected="false" tabindex="-1">Evidence <span class="tabs__count" aria-label="4 items">4</span></button>
          <button type="button" class="tabs__option" role="tab" aria-selected="false" tabindex="-1">Activity <span class="tabs__count" aria-label="87 events">87</span></button>
          <button type="button" class="tabs__option" role="tab" aria-selected="false" tabindex="-1" disabled>Disabled</button>
          <!-- UX 4th-pass #24: aria-busy=true loading-tab. Real flow:
               Activity tab pulls tx history; busy state prevents
               double-click while the fetch is in flight. -->
          <button type="button" class="tabs__option" role="tab" aria-selected="false" tabindex="-1" aria-busy="true">Loading <span class="spinner spinner--xs" aria-hidden="true"></span></button>
        </div>
      </div>
      <div class="ds-nav-cell">
        <span class="section-micro-label">.pagination</span>
        <nav class="pagination" aria-label="Pagination">
          <button type="button" class="pagination__btn" aria-label="Previous page">${icon("chevron-left", "xs")}</button>
          <button type="button" class="pagination__btn">1</button>
          <button type="button" class="pagination__btn" aria-current="page">2</button>
          <button type="button" class="pagination__btn">3</button>
          <button type="button" class="pagination__btn">4</button>
          <span class="pagination__ellipsis" aria-hidden="true">…</span>
          <button type="button" class="pagination__btn">12</button>
          <button type="button" class="pagination__btn" aria-label="Next page">${icon("chevron-right", "xs")}</button>
        </nav>
        <!-- UX 4th-pass #25: boundary state — at page 1, Previous is
             disabled; at last page, Next is disabled. Demo shows the
             page-1 boundary so operators recognise the contract. -->
        <span class="section-micro-label" style="margin-top:0.65rem">.pagination at page 1 (Previous disabled)</span>
        <nav class="pagination" aria-label="Pagination at first page">
          <button type="button" class="pagination__btn" aria-label="Previous page (disabled — at first page)" disabled>${icon("chevron-left", "xs")}</button>
          <button type="button" class="pagination__btn" aria-current="page">1</button>
          <button type="button" class="pagination__btn">2</button>
          <button type="button" class="pagination__btn">3</button>
          <span class="pagination__ellipsis" aria-hidden="true">…</span>
          <button type="button" class="pagination__btn">12</button>
          <button type="button" class="pagination__btn" aria-label="Next page">${icon("chevron-right", "xs")}</button>
        </nav>
      </div>
    </div>
  `, '<nav class="breadcrumb" aria-label="Breadcrumb">\n  <span class="breadcrumb__item"><a href="#">Workspace</a></span>\n  <span class="breadcrumb__sep">${icon("chevron-right","xs")}</span>\n  <span class="breadcrumb__item breadcrumb__item--current" aria-current="page">Harbor · v3</span>\n</nav>\n\n<div class="tabs" role="tablist">\n  <button class="tabs__option" role="tab" aria-selected="true">Overview</button>\n  <button class="tabs__option" role="tab" aria-selected="false">Scenarios <span class="tabs__count">12</span></button>\n</div>\n\n<nav class="pagination">\n  <button class="pagination__btn" aria-current="page">2</button>\n</nav>');

  // ── Crypto attributes ────────────────────────────────────────
  // UX 4th-pass #45: section packs 5 primitive families. Sub-eyebrows
  // (Identity / Telemetry / Lifecycle) anchor the three clusters so
  // the densest section on the page can be scanned without reading
  // every micro-label.
  const cryptoSection = sectionShell("On-chain attributes", "Wallet · tx · object · network · gas · signing — bits that mark a screen as actually on-chain. Truncation convention: address 8+6 hex, tx digest 6+4 base58, Walrus blob 8+4 base64url. Full payload always carried on data-copy.", `
    <div class="ds-crypto-grid">
      <div class="ds-crypto-cell">
        <p class="ds-sub-eyebrow">Identity · who and what is on-chain</p>
        <span class="section-micro-label">.hash-pill (wallet · tx · object · Walrus blob)</span>
        <span class="hash-pill">
          <span class="hash-pill__dot" aria-hidden="true"></span>
          <span class="hash-pill__value">0xae3bf821…8d4f2c</span>
          <button type="button" class="hash-pill__btn" aria-label="Copy wallet address 0xae3bf821…8d4f2c" data-copy="0xae3bf821cd9e22b09c4f7a8d3e1bc02d5f60a91e8b34cd219f8a05c7e3b8d4f2c">${icon("copy", "xs")}</button>
          <button type="button" class="hash-pill__btn" aria-label="Open wallet 0xae3bf821…8d4f2c in explorer">${icon("external-link", "xs")}</button>
        </span>
        <span class="hash-pill hash-pill--tx">
          <span class="hash-pill__dot" aria-hidden="true"></span>
          <span class="hash-pill__value">tx · 8tWUmA…sovVk</span>
          <button type="button" class="hash-pill__btn" aria-label="Copy tx digest 8tWUmA…sovVk" data-copy="8tWUmAt9c5GG1ehKJxQ5Ekei9PQjxPsMVu7mHdqsovVk">${icon("copy", "xs")}</button>
          <button type="button" class="hash-pill__btn" aria-label="Open tx 8tWUmA…sovVk in explorer">${icon("external-link", "xs")}</button>
        </span>
        <span class="hash-pill hash-pill--object">
          <span class="hash-pill__dot" aria-hidden="true"></span>
          <span class="hash-pill__value">obj · 0x8c41a219…d3b07f</span>
          <button type="button" class="hash-pill__btn" aria-label="Copy object id 0x8c41a219…d3b07f" data-copy="0x8c41a219b62e7f048a5d6b1c930e4f7e2a8b95d6c3f01e8d5a4b09c7f6e3d3b07f">${icon("copy", "xs")}</button>
        </span>
        <span class="hash-pill hash-pill--walrus">
          <span class="hash-pill__dot" aria-hidden="true"></span>
          <span class="hash-pill__value">walrus · qVQGc8iZ…wXa9</span>
          <button type="button" class="hash-pill__btn" aria-label="Copy Walrus blob id qVQGc8iZ…wXa9" data-copy="qVQGc8iZmKLpRsT_dHe5nZ8YoE-3wXa9ZbKJ4uNxYpA">${icon("copy", "xs")}</button>
        </span>
        <span class="hash-pill hash-pill--signed">
          <span class="hash-pill__dot" aria-hidden="true"></span>
          <span class="hash-pill__value">signed · 0x4d7eb09a…1fc385</span>
        </span>
        <span class="hash-pill hash-pill--failed">
          <span class="hash-pill__dot" aria-hidden="true"></span>
          <span class="hash-pill__value">failed · 0x73c2a106…5f5a8b</span>
        </span>
      </div>
      <div class="ds-crypto-cell">
        <p class="ds-sub-eyebrow">Telemetry · network · chain state · balances</p>
        <span class="section-micro-label">.network-badge (testnet · mainnet · devnet · rpc-down · no-wallet)</span>
        <div class="ds-cluster">
          <span class="network-badge network-badge--testnet">
            <span class="network-badge__dot" aria-hidden="true"></span>Sui Testnet
          </span>
          <span class="network-badge network-badge--mainnet" data-aspirational="true" title="Aspirational — TIDE ships Sui Testnet only until mainnet exec lands">
            <span class="network-badge__dot" aria-hidden="true"></span>Sui Mainnet
          </span>
          <span class="network-badge network-badge--devnet">
            <span class="network-badge__dot" aria-hidden="true"></span>Sui Devnet
          </span>
          <span class="network-badge network-badge--rpc-down">
            <span class="network-badge__dot" aria-hidden="true"></span>RPC down
          </span>
          <span class="network-badge network-badge--no-wallet">
            <span class="network-badge__dot" aria-hidden="true"></span>Wallet not connected
          </span>
        </div>
        <span class="section-micro-label" style="margin-top:0.5rem">.crypto-pill (checkpoint · gas · epoch · finality)</span>
        <div class="ds-cluster">
          <span class="crypto-pill"><span class="crypto-pill__icon">${icon("anchor", "xs")}</span>checkpoint <strong>175,283,940</strong></span>
          <span class="crypto-pill"><span class="crypto-pill__icon">${icon("zap", "xs")}</span>gas <strong>0.0042 SUI</strong></span>
          <span class="crypto-pill">epoch <strong>612</strong></span>
          <span class="crypto-pill"><span class="crypto-pill__icon">${icon("shield-check", "xs")}</span>finalized</span>
        </div>
        <span class="section-micro-label" style="margin-top:0.5rem">.balance-pill</span>
        <div class="ds-cluster">
          <span class="balance-pill">
            ${renderTokenMark("btc", "xs")}
            <span class="balance-pill__amount">12.5000</span>
            <span class="balance-pill__sym">BTC</span>
          </span>
          <span class="balance-pill">
            ${renderTokenMark("usdc", "xs")}
            <span class="balance-pill__amount">140,000.00</span>
            <span class="balance-pill__sym">USDC</span>
          </span>
          <span class="balance-pill">
            ${renderTokenMark("hasui", "xs")}
            <span class="balance-pill__amount">8,500.000</span>
            <span class="balance-pill__sym">haSUI</span>
          </span>
        </div>
      </div>
      <div class="ds-crypto-cell" style="grid-column: 1 / -1">
        <p class="ds-sub-eyebrow">Lifecycle · signing → signed → receipt</p>
        <span class="section-micro-label">.signing-state — 5 canonical chips (pending · signing · signed · receipt · failed). Full 7-stage journey lives in shelf VI .status-timeline; signing-state is the inline single-state surface. UX 4th-pass #28: split signed (signature applied) from receipt (proof pinned on-chain) — they are two different lifecycle moments.</span>
        <div class="ds-cluster">
          <span class="signing-state signing-state--pending">
            <span class="signing-state__icon">${icon("info", "sm")}</span>
            Awaiting wallet approval
          </span>
          <span class="signing-state signing-state--signing">
            <span class="signing-state__icon"><span class="spinner spinner--sm"></span></span>
            Signing transaction…
          </span>
          <span class="signing-state signing-state--signed">
            <span class="signing-state__icon">${icon("check", "sm")}</span>
            Signed · awaiting receipt
          </span>
          <span class="signing-state signing-state--receipt">
            <span class="signing-state__icon">${icon("anchor", "sm")}</span>
            Receipt minted · proof pinned
          </span>
          <span class="signing-state signing-state--failed">
            <span class="signing-state__icon">${icon("alert-octagon", "sm")}</span>
            Wallet declined the transaction. Nothing was sent.
          </span>
        </div>
      </div>
    </div>
  `, '<span class="hash-pill">\n  <span class="hash-pill__dot"></span>\n  <span class="hash-pill__value">0xae3bf821…8d4f2c</span>\n  <button class="hash-pill__btn" aria-label="Copy wallet address 0xae3bf821…8d4f2c"\n          data-copy="0xae3bf821cd9e22b09c4f7a…d4f2c">${icon("copy","xs")}</button>\n</span>\n\n<span class="network-badge network-badge--testnet">\n  <span class="network-badge__dot"></span>Sui Testnet\n</span>\n\n<span class="signing-state signing-state--signing">\n  <span class="signing-state__icon"><span class="spinner spinner--sm"></span></span>\n  Broadcasting to Sui RPC…\n</span>');

  // ── Composer (swap-card pattern) ─────────────────────────────
  const composerSection = sectionShell("Composer", "Input → output orchestrated row · token picker + amount + preset segments + summary", `
    <div class="ds-form-grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
      <div class="composer">
        <div class="composer__row">
          <div class="composer__label" id="ds-composer-1-collat-label"><span>Collateral</span><small>12.5000 BTC available</small></div>
          <input class="composer__amount" type="number" value="5.0" step="0.1" inputmode="decimal" aria-labelledby="ds-composer-1-collat-label" />
          <div class="composer__usd">≈ $385,000.00</div>
          <button type="button" class="select-trigger">
            ${renderTokenMark("btc", "sm")}
            <span>BTC</span>
            <span class="select-trigger__icon">${icon("chevron-down", "sm")}</span>
          </button>
        </div>
        <div class="ds-form-row" style="justify-content:flex-end">
          <div class="segmented" role="group" aria-label="Preset">
            <button type="button" class="segmented__option" aria-pressed="false">25%</button>
            <button type="button" class="segmented__option" aria-pressed="true">40%</button>
            <button type="button" class="segmented__option" aria-pressed="false">75%</button>
            <button type="button" class="segmented__option" aria-pressed="false">Max</button>
          </div>
        </div>
        <div class="composer__divider">
          <button type="button" aria-label="Flip direction">${icon("refresh-cw", "xs")}</button>
        </div>
        <div class="composer__row">
          <div class="composer__label" id="ds-composer-1-borrow-label"><span>Borrow</span><small>SuiLend · 36.4% debt-pressure target</small></div>
          <input class="composer__amount" type="number" value="140000" step="1000" inputmode="decimal" aria-labelledby="ds-composer-1-borrow-label" />
          <div class="composer__usd">≈ $140,000.00</div>
          <button type="button" class="select-trigger">
            ${renderTokenMark("usdc", "sm")}
            <span>USDC</span>
            <span class="select-trigger__icon">${icon("chevron-down", "sm")}</span>
          </button>
        </div>
        <dl class="composer__summary">
          <dt>Debt-pressure target</dt><dd>36.4%</dd>
          <dt>Liq. boundary</dt><dd>78.0%</dd>
          <dt>Buffer days</dt><dd>142d</dd>
          <dt>Network fee</dt><dd>0.0042 SUI</dd>
        </dl>
        <div class="composer__cta ds-form-row">
          <button type="button" class="button button-primary" style="flex:1">${icon("zap", "sm")}<span style="margin-left:0.4rem">Compose policy</span></button>
        </div>
      </div>
      <div class="composer">
        <div class="composer__row">
          <div class="composer__label" id="ds-composer-2-repay-label"><span>Repay</span><small>Outstanding $140,000.00</small></div>
          <input class="composer__amount" type="number" value="70000" step="1000" inputmode="decimal" aria-labelledby="ds-composer-2-repay-label" />
          <div class="composer__usd">≈ $70,000.00 · 50%</div>
          <button type="button" class="select-trigger">
            ${renderTokenMark("usdc", "sm")}
            <span>USDC</span>
            <span class="select-trigger__icon">${icon("chevron-down", "sm")}</span>
          </button>
        </div>
        <div class="composer__divider"><button type="button" aria-label="Stack repay above withdraw">${icon("chevron-down", "xs")}</button></div>
        <div class="composer__row">
          <div class="composer__label" id="ds-composer-2-withdraw-label"><span>Withdraw</span><small>Frees 0.910 BTC</small></div>
          <input class="composer__amount" type="number" value="0.910" step="0.01" inputmode="decimal" aria-labelledby="ds-composer-2-withdraw-label" />
          <div class="composer__usd">≈ $70,070.00</div>
          <button type="button" class="select-trigger">
            ${renderTokenMark("btc", "sm")}
            <span>BTC</span>
            <span class="select-trigger__icon">${icon("chevron-down", "sm")}</span>
          </button>
        </div>
        <dl class="composer__summary">
          <dt>New debt pressure</dt><dd>22.2%</dd>
          <dt>Buffer days</dt><dd>256d</dd>
        </dl>
        <div class="composer__cta ds-form-row">
          <button type="button" class="button button-secondary" style="flex:1">Cancel</button>
          <button type="button" class="button button-primary" style="flex:1" data-aspirational="true" title="Aspirational — cosmetic in playground; real flow uses pre-sign-form pattern">Sign & broadcast</button>
        </div>
      </div>
    </div>
  `, '<div class="composer">\n  <div class="composer__row">\n    <div class="composer__label"><span>Collateral</span><small>12.5000 BTC available</small></div>\n    <input class="composer__amount" type="number" />\n    <div class="composer__usd">≈ $385,000.00</div>\n    <button class="select-trigger">…</button>\n  </div>\n  <div class="composer__divider"><button>${icon("refresh-cw","xs")}</button></div>\n  <div class="composer__row">…</div>\n  <dl class="composer__summary">\n    <dt>Debt-pressure target</dt><dd>36.4%</dd>\n  </dl>\n</div>');

  // ── Transactions ────────────────────────────────────────────
  const txDemoEvents = [
    { time: "10:42", tone: "receipt", badge: "Receipt", title: "Receipt minted", detail: "Content digest pinned on-chain · qVQGc8iZ…wXa9", hash: "8tWUmA…sovVk" },
    { time: "10:38", tone: "wallet",  badge: "Wallet",  title: "Mint receipt",   detail: "Signed by 0x9c41a219…d3b07f · gas 0.0042 SUI",   hash: "Eg6QGGHn…2k4P" },
    { time: "10:35", tone: "control", badge: "Control", title: "Marked active",         detail: "TIDE allowed to keep modeling · funds untouched", hash: "" },
    { time: "10:28", tone: "pause",   badge: "Paused",  title: "Held next approval",    detail: "Snapshot review queued by operator",              hash: "" },
  ];
  const txCanonicalRows = txDemoEvents.map((e) => `
    <li class="tx-row tx-row--${escapeHtml(e.tone)}">
      <span class="tx-row__time">${escapeHtml(e.time)}</span>
      <span class="tx-row__kind tx-row__kind--${escapeHtml(e.tone)}">${escapeHtml(e.badge)}</span>
      <div class="tx-row__body">
        <strong>${escapeHtml(e.title)}</strong>
        <span>${escapeHtml(e.detail)}</span>
      </div>
      ${e.hash
        ? `<a class="tx-row__link" href="#" target="_blank" rel="noopener">${escapeHtml(e.hash)} ↗</a>`
        : ""}
    </li>
  `).join("");

  const transactionsSection = sectionShell("Transactions", "Tx feed row · receipt mint card. Canonical names .tx-feed / .tx-row*.", `
    <div class="ds-form-grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
      <div class="ds-form-cell">
        <span class="section-micro-label">.tx-feed · 4-tone feed</span>
        <ol class="tx-feed" aria-label="Sample TX feed">${txCanonicalRows}</ol>
      </div>
      <div class="ds-form-cell">
        <span class="section-micro-label">.tx-receipt-card · composes .hash-pill + .crypto-pill from shelf VI</span>
        <article class="tx-receipt-card">
          <!-- B.16.5: dropped network-badge (D3, testnet was a 3rd
               instance of the badge already canonicalised in shelf VI)
               and the right-column spark + "+18.4% · 7d" + "off-chain
               context" filler (D2, dup of densitySection mint spark).
               Receipt card now reads as: title → amount → meta —
               which is the canonical contract this primitive teaches. -->
          <div class="tx-receipt-card__head">
            <h3 class="tx-receipt-card__title">
              <span class="tx-receipt-card__title-icon">${icon("check", "sm")}</span>
              Receipt minted
            </h3>
          </div>
          <div>
            <div class="tx-receipt-card__amount">$385,000<span style="color:var(--muted);font-size:0.5em;font-weight:600">.00</span></div>
            <div class="tx-receipt-card__usd">collateral pinned · 5.0 BTC</div>
          </div>
          <div class="tx-receipt-card__meta">
            <span class="hash-pill hash-pill--tx">
              <span class="hash-pill__dot" aria-hidden="true"></span>
              <span class="hash-pill__value">tx · 8tWUmA…sovVk</span>
              <button type="button" class="hash-pill__btn" aria-label="Copy tx digest 8tWUmA…sovVk" data-copy="8tWUmAt9c5GG1ehKJxQ5Ekei9PQjxPsMVu7mHdqsovVk">${icon("copy", "xs")}</button>
              <button type="button" class="hash-pill__btn" aria-label="Open tx 8tWUmA…sovVk in explorer">${icon("external-link", "xs")}</button>
            </span>
            <span class="crypto-pill"><span class="crypto-pill__icon">${icon("anchor", "xs")}</span>checkpoint <strong>175,283,940</strong></span>
            <span class="crypto-pill"><span class="crypto-pill__icon">${icon("zap", "xs")}</span>gas <strong>0.0042 SUI</strong></span>
          </div>
        </article>
      </div>
    </div>
  `, '<ol class="tx-feed">\n  <li class="tx-row tx-row--receipt">…</li>\n  <li class="tx-row tx-row--wallet">…</li>\n</ol>\n\n<article class="tx-receipt-card">\n  <div class="tx-receipt-card__head">…</div>\n  <div class="tx-receipt-card__amount">$385,000</div>\n  <div class="tx-receipt-card__meta">…</div>\n</article>');

  const headsSection = sectionShell("Section heads", "Every surface in TIDE opens with one. Default for standalone surfaces with their own breathing room; .section-head-compact when paired or nested so the eyebrow + title don't double-stack the parent's vertical rhythm.", `
    <div class="ds-stack">
      <div class="surface">
        <div class="section-head">
          <div><p class="section-label">Stress credibility</p><h2>Stress ladder</h2></div>
          <span class="state-badge">4 scenarios</span>
        </div>
        <p class="surface-copy">.section-head — top of any standalone surface.</p>
      </div>
      <div class="surface">
        <div class="section-head section-head-compact">
          <div><p class="section-label">Diagnostics</p><h2>Decision engine</h2></div>
          <span class="state-badge">Maintain</span>
        </div>
        <p class="surface-copy">.section-head + .section-head-compact — tighter, for nested or paired surfaces.</p>
      </div>
    </div>
  `, '<div class="section-head">…</div>\n<div class="section-head section-head-compact">…</div>');

  const bannersSection = sectionShell("Trust banner", "Conditional top-of-page warning · only when a P1 trust condition fails", `
    <section class="surface trust-banner trust-banner--warn">
      <div class="trust-banner__copy">
        <p class="section-label">Trust posture</p>
        <strong>Live feed is not signature-verified</strong>
        <span>Monitoring stays available; execution stays blocked until the rail feed is signed end-to-end.</span>
      </div>
      <a class="button button-secondary" href="#">Reload pack in Create</a>
    </section>
    <div class="ds-spacer"></div>
    <section class="surface trust-banner trust-banner--neutral">
      <div class="trust-banner__copy">
        <p class="section-label">No run loaded</p>
        <strong>This monitor needs a Create run</strong>
        <span>Live mirrors a Create run's policy decision. Run a scenario in Create, then return here.</span>
      </div>
      <a class="button button-secondary" href="#">Open Create</a>
    </section>
  `, '<section class="surface trust-banner trust-banner--warn">…</section>');

  const layoutsSection = sectionShell("Layout grids", "Per-section named grids — no .grid-60-40 utilities", `
    <p class="section-micro-label">.readout-hero-grid — minmax(0, 1.5fr) minmax(280px, 1fr)</p>
    <div class="ds-grid-demo ds-grid-demo--hero">
      <div class="ds-grid-cell">Charts pair (60%)</div>
      <div class="ds-grid-cell ds-grid-cell--alt">KPI tiles (40%)</div>
    </div>
    <div class="ds-spacer"></div>
    <p class="section-micro-label">.readout-credibility — 3fr / 2fr</p>
    <div class="ds-grid-demo ds-grid-demo--credibility">
      <div class="ds-grid-cell">Stress ladder (3fr)</div>
      <div class="ds-grid-cell ds-grid-cell--alt">Decision engine (2fr)</div>
    </div>
    <div class="ds-spacer"></div>
    <p class="section-micro-label">.readout-position-details — 2fr / 3fr</p>
    <div class="ds-grid-demo ds-grid-demo--details">
      <div class="ds-grid-cell">Pressure points (2fr)</div>
      <div class="ds-grid-cell ds-grid-cell--alt">Operator review (3fr)</div>
    </div>
    <div class="ds-spacer"></div>
    <p class="section-micro-label">.setup-layout — minmax(0, 1fr) / minmax(320px, 380px)</p>
    <div class="ds-grid-demo ds-grid-demo--setup">
      <div class="ds-grid-cell">setup-main (fluid)</div>
      <div class="ds-grid-cell ds-grid-cell--alt">setup-aside (320–380 px)</div>
    </div>
  `, '.readout-hero-grid       { grid-template-columns: minmax(0, 1.5fr) minmax(280px, 1fr); }\n.readout-credibility     { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); }\n.readout-position-details { grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); }\n.setup-layout            { grid-template-columns: minmax(0, 1fr) minmax(320px, 380px); }');

  const antiPatternsSection = sectionShell("Don't do this", "Mistakes the codebase made and corrected", `
    <ul class="ds-anti-list">
      <li><strong>Don't bury P2 content under &lt;details&gt;.</strong> If something is sometimes useful, promote it to primary flow.</li>
      <li><strong>Don't show the same fact in 3+ places.</strong> Pick one canonical surface; reference from others by chip or label.</li>
      <li><strong>Don't use generic .grid-60-40 utilities.</strong> Name the section's grid so intent is preserved.</li>
      <li><strong>Don't 2-col surfaces of unequal density.</strong> One side will sausage; stack vertically full-width instead.</li>
      <li><strong>Don't add decorative charts.</strong> Every chart must answer a specific operator question.</li>
      <li><strong>Don't let rows stretch on ultrawide.</strong> Cap pages at 1440 px or pair lists into multi-column.</li>
      <li><strong>Don't repurpose a tone.</strong> Mint = healthy, amber = warn, rose = danger, cyan = live, violet = control. Forever.</li>
    </ul>
  `, "");

  // 7-shelf IA per UX §1.1. Hero before all shelves; Data display
  // promoted to shelf II so the unique paired-needle primitive lands
  // immediately after Foundations (per master synthesis #9 + Q5).
  const shelf = (numeral, title, sub) => `
    <header class="ds-shelf__header" id="ds-shelf-${slugify(title)}">
      <span class="ds-shelf__numeral">${escapeHtml(numeral)}</span>
      <h2 class="ds-shelf__title">${escapeHtml(title)}</h2>
      ${sub ? `<span class="ds-shelf__sub">${escapeHtml(sub)}</span>` : ""}
    </header>
  `;
  // Chip-row TOC. Numeral on the left, label in the middle, count
  // pill on the right. The count is the number of primitive sections
  // under each shelf — proves at a glance "this shelf has 7 inputs"
  // without scrolling. Labels are abbreviated for row balance on
  // mid-width viewports ("Surfaces & layout" → "Surfaces", "Feedback
  // & state" → "Feedback"). Per UI fourth-pass P10 + R8.
  const tocSection = `
    <nav class="ds-toc" aria-label="Sections of the design system">
      <a href="#ds-shelf-foundations" class="ds-toc__chip"><span class="ds-toc__chip-numeral">I</span>Foundations<span class="ds-toc__chip-count">4</span></a>
      <a href="#ds-shelf-data-display" class="ds-toc__chip"><span class="ds-toc__chip-numeral">II</span>Data display<span class="ds-toc__chip-count">3</span></a>
      <a href="#ds-shelf-surfaces-layout" class="ds-toc__chip"><span class="ds-toc__chip-numeral">III</span>Surfaces<span class="ds-toc__chip-count">4</span></a>
      <a href="#ds-shelf-inputs" class="ds-toc__chip"><span class="ds-toc__chip-numeral">IV</span>Inputs<span class="ds-toc__chip-count">7</span></a>
      <a href="#ds-shelf-feedback-state" class="ds-toc__chip"><span class="ds-toc__chip-numeral">V</span>Feedback<span class="ds-toc__chip-count">5</span></a>
      <a href="#ds-shelf-crypto-ops" class="ds-toc__chip"><span class="ds-toc__chip-numeral">VI</span>Crypto &amp; ops<span class="ds-toc__chip-count">5</span></a>
      <a href="#ds-shelf-discipline" class="ds-toc__chip"><span class="ds-toc__chip-numeral">VII</span>Discipline<span class="ds-toc__chip-count">1</span></a>
    </nav>
  `;

  const html = [
    tocSection,
    heroSection,
    // Shelf I — Foundations gets section-head primer (every section
    // uses it; UX COV-44) + chips/kbd (UX COV-2: kbd + icon-badge
    // belong here, not in a meta "More primitives" grab-bag).
    shelf("I", "Foundations", "tokens · iconography · section heads · inline chips"),
    tokensSection,
    iconographySection,
    headsSection,
    chipsKbdSection,
    shelf("II", "Data display", "TIDE moat · paired needles"),
    chartsSection,
    listsSection,
    densitySection,
    // UX 4th-pass #39: bannersSection (.trust-banner) is surface
    // grammar — a tone-tinted .surface — so it belongs adjacent to
    // Cards on shelf III, not orphaned on the closing essay shelf.
    shelf("III", "Surfaces & layout", "card chrome · grids · trust banner"),
    surfacesSection,
    cardsSection,
    bannersSection,
    layoutsSection,
    // UX 4th-pass #40: pickers grouped (choice + select), then
    // value-on-axis (range + thresholds-rail), then the catch-all.
    // Previous order interleaved picker → axis → axis → picker.
    shelf("IV", "Inputs", "buttons · fields · pickers · range · thresholds · search · date · drop"),
    buttonsSection,
    fieldsSection,
    choiceSection,
    selectSection,
    rangeSection,
    thresholdsRailSection,
    inputsExtraSection,
    shelf("V", "Feedback & state", "loading · failure · notifications"),
    loadingSection,
    statesSection,
    toastSection,
    modalSection,
    tooltipSection,
    shelf("VI", "Crypto & ops", "wallet · composer · transactions · timeline · nav"),
    cryptoSection,
    composerSection,
    transactionsSection,
    timelineSection,
    navigationSection,
    // UX 4th-pass #43: shelf VII subtitle becomes "the closing essay"
    // now that bannersSection moved to shelf III. Shelf id stays
    // ds-shelf-discipline so existing TOC anchor + deep-links don't
    // break — only the subtitle copy is rewritten.
    shelf("VII", "Discipline", "closing essay — what we don't ship"),
    antiPatternsSection,
  ].join("");
  safeReplaceChildren(root, html);

  // Bind the sparkline so the playground bars are clickable like the
  // real one — proves the component is alive, not a dead screenshot.
  const sparkHost = root.querySelector(".stress-spark")?.closest(".ds-section__body");
  if (sparkHost) bindSparkBarClicks(sparkHost, scenarios);

  // Range sliders — keep the accent fill in sync with the value, and
  // update the readout strong-text in the head row. Pure DOM, no state.
  root.querySelectorAll(".range-slider").forEach((wrap) => {
    const input = wrap.querySelector('input[type="range"]');
    const readout = wrap.querySelector('.range-slider__head strong');
    if (!input) return;
    const update = () => {
      const min = Number(input.min || 0);
      const max = Number(input.max || 100);
      const val = Number(input.value);
      const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
      wrap.style.setProperty("--range-fill", `${pct}%`);
      if (readout) readout.textContent = `${val}%`;
    };
    input.addEventListener("input", update);
    update();
  });

  // Segmented — two ARIA flavours per Phase-C Q8 / frontend §24:
  //   role="group" + aria-pressed         — non-exclusive toggles
  //   role="radiogroup" + aria-checked    — mutually exclusive choices
  // The radiogroup variant also gets roving tabindex + arrow keys
  // per W3C APG Radio Group Pattern.
  root.querySelectorAll(".segmented").forEach((group) => {
    const isRadioGroup = group.getAttribute("role") === "radiogroup";
    const stateAttr = isRadioGroup ? "aria-checked" : "aria-pressed";
    const options = () => Array.from(group.querySelectorAll(".segmented__option:not([disabled])"));
    const select = (btn) => {
      group.querySelectorAll(".segmented__option").forEach((b) => {
        b.setAttribute(stateAttr, "false");
        if (isRadioGroup) b.setAttribute("tabindex", "-1");
      });
      btn.setAttribute(stateAttr, "true");
      if (isRadioGroup) {
        btn.setAttribute("tabindex", "0");
        btn.focus();
      }
    };
    group.addEventListener("click", (event) => {
      const btn = event.target.closest(".segmented__option");
      if (!btn || btn.disabled) return;
      select(btn);
    });
    if (isRadioGroup) {
      group.addEventListener("keydown", (event) => {
        const all = options();
        const idx = all.indexOf(document.activeElement);
        if (idx < 0) return;
        let next = -1;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (idx + 1) % all.length;
        else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (idx - 1 + all.length) % all.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = all.length - 1;
        if (next < 0) return;
        event.preventDefault();
        select(all[next]);
      });
    }
  });

  // Tabs — APG-compliant roving tabindex + arrow keyboard. Click or
  // arrow-nav flips aria-selected; only the selected tab is in the
  // tab order (tabindex=0), siblings are tabindex=-1. Home/End jump.
  root.querySelectorAll('.tabs[role="tablist"]').forEach((list) => {
    const tabs = () => Array.from(list.querySelectorAll('.tabs__option[role="tab"]:not([disabled])'));
    const select = (tab) => {
      list.querySelectorAll('.tabs__option[role="tab"]').forEach((t) => {
        t.setAttribute("aria-selected", "false");
        t.setAttribute("tabindex", "-1");
      });
      tab.setAttribute("aria-selected", "true");
      tab.setAttribute("tabindex", "0");
      tab.focus();
    };
    list.addEventListener("click", (event) => {
      const tab = event.target.closest('.tabs__option[role="tab"]');
      if (!tab || tab.disabled) return;
      select(tab);
    });
    list.addEventListener("keydown", (event) => {
      const all = tabs();
      const idx = all.indexOf(document.activeElement);
      if (idx < 0) return;
      let next = -1;
      if (event.key === "ArrowRight") next = (idx + 1) % all.length;
      else if (event.key === "ArrowLeft") next = (idx - 1 + all.length) % all.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = all.length - 1;
      if (next < 0) return;
      event.preventDefault();
      select(all[next]);
    });
  });

  // Pagination — click flips aria-current within the nav.
  root.querySelectorAll(".pagination").forEach((nav) => {
    nav.addEventListener("click", (event) => {
      const btn = event.target.closest(".pagination__btn");
      if (!btn || btn.disabled) return;
      // Only number buttons mark themselves current; arrow buttons stay aria-label-only.
      if (btn.hasAttribute("aria-label")) return;
      nav.querySelectorAll(".pagination__btn").forEach((b) => b.removeAttribute("aria-current"));
      btn.setAttribute("aria-current", "page");
    });
  });

  // Hash-pill copy buttons — write the hash to clipboard, then flash
  // a copied-state for 1.2s (icon → check, mint tint, aria-live ack).
  // Per third-pass 3/3 consensus (UI U1 + UX §3 + frontend LIVE-9):
  // silent copy is a dark pattern; this gives explicit confirmation
  // without spawning a toast. Reduced-motion users still get the
  // state flip — only the transition is suppressed via the global
  // @media block on .hash-pill__btn (covered by the existing
  // tightening list).
  const COPY_FLASH_MS = 1200;
  root.querySelectorAll(".hash-pill__btn[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const value = btn.getAttribute("data-copy") || "";
      let ok = false;
      try { await navigator.clipboard?.writeText(value); ok = true; } catch {}
      if (!ok) return;
      btn.setAttribute("data-state", "copied");
      // Announce on the page-level region; reuses the toast-region
      // aria-live wrapper so screen readers hear "Copied".
      const liveRegion = root.querySelector(".toast-region--demo");
      if (liveRegion) {
        const ack = document.createElement("span");
        ack.className = "sr-only";
        ack.textContent = `Copied ${value.slice(0, 12)}…`;
        liveRegion.appendChild(ack);
        setTimeout(() => ack.remove(), COPY_FLASH_MS + 300);
      }
      setTimeout(() => btn.removeAttribute("data-state"), COPY_FLASH_MS);
    });
  });

  // Toast dismiss buttons — fade and remove from the demo region.
  // Per frontend HYG-6: respect prefers-reduced-motion (the inline
  // transition would otherwise run regardless of the global media
  // block since CSS @media doesn't override inline style).
  const reducedMotion = typeof window !== "undefined"
    && window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  root.querySelectorAll(".toast-region--demo .toast__close").forEach((btn) => {
    btn.addEventListener("click", () => {
      const toast = btn.closest(".toast");
      if (!toast) return;
      if (reducedMotion) {
        toast.remove();
        return;
      }
      toast.style.transition = "opacity 180ms ease, transform 180ms ease";
      toast.style.opacity = "0";
      toast.style.transform = "translateX(8px)";
      setTimeout(() => toast.remove(), 200);
    });
  });

  // Stepper inputs — +/- buttons clamp to min/max. Use valueAsNumber
  // (locale-safe) instead of Number(input.value) — per i18n §28 + debug
  // §5: Number("0,25") returns NaN on de-DE / ru-RU / fr-FR locales,
  // so the previous String/Number cast quietly broke ±1 on those
  // locales. valueAsNumber respects the input's actual numeric state.
  root.querySelectorAll(".stepper-input").forEach((wrap) => {
    const input = wrap.querySelector('input[type="number"]');
    const [dec, inc] = wrap.querySelectorAll(".stepper-input__btn");
    if (!input) return;
    const min = input.min !== "" ? Number(input.min) : -Infinity;
    const max = input.max !== "" ? Number(input.max) : Infinity;
    // Per frontend HYG-4: Math.abs() guards against negative step
    // attribute (HTML allows it but the +/- buttons should always
    // increment/decrement by the magnitude).
    const step = Math.abs(
      input.step && input.step !== "any" ? Number(input.step) || 1 : 1
    );
    dec?.addEventListener("click", () => {
      const current = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : 0;
      input.valueAsNumber = Math.max(min, current - step);
    });
    inc?.addEventListener("click", () => {
      const current = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : 0;
      input.valueAsNumber = Math.min(max, current + step);
    });
  });

  // Click-to-copy on .section-micro-label whose text starts with a
   // selector token (".foo-bar"). Auto-promotes the label to an
   // interactive copy chip — copy hint glyph appears on hover, mint
   // flash on success. Per third-pass 2/3 consensus (UI U1 +
   // frontend LIVE-9 family). Skips labels that don't lead with a
   // selector so prose labels stay non-interactive.
  const SELECTOR_RE = /^(\.[a-z][a-z0-9_-]*(?:--[a-z0-9-]+)?(?:__[a-z0-9-]+)?)/i;
  const COPY_SELECTOR_FLASH_MS = 1200;
  root.querySelectorAll(".section-micro-label").forEach((label) => {
    const text = label.textContent.trim();
    const match = text.match(SELECTOR_RE);
    if (!match) return;
    const selector = match[1];
    label.setAttribute("data-copy-selector", selector);
    label.setAttribute("role", "button");
    label.setAttribute("tabindex", "0");
    label.setAttribute("aria-label", `Copy selector ${selector}`);
    label.setAttribute("title", `Click to copy “${selector}”`);
    const doCopy = async () => {
      let ok = false;
      try { await navigator.clipboard?.writeText(selector); ok = true; } catch {}
      if (!ok) return;
      label.setAttribute("data-state", "copied");
      const liveRegion = root.querySelector(".toast-region--demo");
      if (liveRegion) {
        const ack = document.createElement("span");
        ack.className = "sr-only";
        ack.textContent = `Copied ${selector}`;
        liveRegion.appendChild(ack);
        setTimeout(() => ack.remove(), COPY_SELECTOR_FLASH_MS + 300);
      }
      setTimeout(() => label.removeAttribute("data-state"), COPY_SELECTOR_FLASH_MS);
    };
    label.addEventListener("click", doCopy);
    label.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        doCopy();
      }
    });
  });

  // Live <dialog> demo — data-modal-open id wires a button to a
  // <dialog id>.showModal(); data-modal-close id closes it.
  // Per third-pass 2/3 consensus (UI implicit + frontend LIVE-3):
  // browser handles focus trap, ESC, click-outside via the native
  // element. Backdrop click closes (not a default — added handler).
  root.querySelectorAll("[data-modal-open]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-modal-open");
      const dlg = id && root.querySelector(`#${CSS.escape(id)}`);
      if (dlg && typeof dlg.showModal === "function") dlg.showModal();
    });
  });
  root.querySelectorAll("[data-modal-close]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-modal-close");
      const dlg = id && root.querySelector(`#${CSS.escape(id)}`);
      if (dlg && typeof dlg.close === "function") dlg.close();
    });
  });
  // Backdrop-click close — when the user clicks outside the .modal
  // body but inside the dialog (i.e. on the backdrop pseudo-element).
  root.querySelectorAll("dialog.modal").forEach((dlg) => {
    dlg.addEventListener("click", (event) => {
      if (event.target === dlg) dlg.close();
    });
  });

  // TOC scroll-spy — IntersectionObserver flips aria-current="location"
  // on the chip whose shelf is currently in viewport. Per third-pass
  // 3/3 consensus (UI U6 + UX §1-2 + frontend LIVE-10). Watches the
  // 7 shelf headers (.ds-shelf__header[id]); top-most-visible wins.
  const tocChips = root.querySelectorAll(".ds-toc__chip");
  const shelfHeaders = root.querySelectorAll(".ds-shelf__header[id]");
  if (tocChips.length && shelfHeaders.length && typeof IntersectionObserver !== "undefined") {
    const visibleShelves = new Map();
    const setActive = (id) => {
      tocChips.forEach((chip) => {
        const href = chip.getAttribute("href") || "";
        const matches = href === `#${id}`;
        if (matches) chip.setAttribute("aria-current", "location");
        else chip.removeAttribute("aria-current");
      });
    };
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) visibleShelves.set(entry.target.id, entry.boundingClientRect.top);
          else visibleShelves.delete(entry.target.id);
        });
        if (visibleShelves.size === 0) return;
        // Pick the shelf nearest the top of the viewport (smallest top
        // offset). Falls back gracefully when none intersect (do nothing).
        let bestId = null;
        let bestTop = Infinity;
        for (const [id, top] of visibleShelves) {
          if (top < bestTop) { bestTop = top; bestId = id; }
        }
        if (bestId) setActive(bestId);
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: 0 }
    );
    shelfHeaders.forEach((h) => io.observe(h));
  }

  // B.16.3 — A+3 live kbd press-state. Press a key while the page
  // is focused (no input has focus) and every .kbd chip with a
  // matching data-kbd-key flashes the accent paint for 220 ms.
  // Linear's command-palette pattern: discoverable, no resting
  // chrome. Bails on form fields so we don't intercept text input.
  // Single global listener; idempotently re-bound by stamping the
  // hostname onto window so re-renders don't stack listeners.
  if (!window.__tideKbdPressBound) {
    window.__tideKbdPressBound = true;
    document.addEventListener("keydown", (event) => {
      if (document.body?.dataset.page !== "design-system") return;
      // Don't intercept text input or activation keys on buttons/links.
      if (event.target.closest("input,textarea,select,[contenteditable]")) return;
      // Map event.key to the data-kbd-key attribute. event.key already
      // carries the canonical name for special keys ("Escape",
      // "ArrowLeft", "Meta", "/", "K") — no normalisation needed beyond
      // upper-casing single letters so "k" matches data-kbd-key="K".
      const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
      const chips = document.querySelectorAll(`.kbd[data-kbd-key="${CSS.escape(key)}"]`);
      if (!chips.length) return;
      chips.forEach((chip) => {
        chip.classList.add("kbd--pressed");
        setTimeout(() => chip.classList.remove("kbd--pressed"), 220);
      });
    });
  }
}

function dismissBootSkeleton() {
  document.body.dataset.appReady = "true";
  document.querySelectorAll("[data-boot-skeleton]").forEach((node) => {
    node.hidden = true;
  });
}

function bindGlobalHashPillCopy() {
  if (window.__tideHashPillCopyBound) return;
  window.__tideHashPillCopyBound = true;
  document.addEventListener("click", async (event) => {
    const btn = event.target?.closest?.(".hash-pill__btn[data-copy]");
    if (!btn) return;
    if (document.body?.dataset.page === "design-system" && btn.closest("#ds-root")) return;
    event.preventDefault();
    event.stopPropagation();
    const value = btn.getAttribute("data-copy") || "";
	    let ok = false;
	    try {
	      await navigator.clipboard?.writeText(value);
	      ok = true;
	    } catch {}
	    if (!ok) {
	      btn.setAttribute("data-state", "copy-failed");
	      setStatus("Copy failed. Select the hash text manually.", true);
	      setTimeout(() => btn.removeAttribute("data-state"), 1600);
	      return;
	    }
    btn.setAttribute("data-state", "copied");
    setStatus(`Copied ${value.slice(0, 12)}${value.length > 12 ? "…" : ""}`);
    setTimeout(() => btn.removeAttribute("data-state"), 1200);
  });
}

let _setupDeepLinkTargetOpened = "";
function openSetupDeepLinkTarget() {
  if (currentPage !== "setup") return;
  let hash = "";
  try {
    hash = decodeURIComponent(String(window.location.hash || "").replace(/^#/, ""));
  } catch (_) {
    hash = String(window.location.hash || "").replace(/^#/, "");
  }
  if (hash !== "rail-data") return;
  const target = document.getElementById(hash);
  if (!target) return;
  if (target instanceof HTMLDetailsElement) {
    target.open = true;
  }
  if (_setupDeepLinkTargetOpened === hash) return;
  _setupDeepLinkTargetOpened = hash;
  void refreshProofEvidence({ silent: true, rerun: false });
  window.setTimeout(() => {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 80);
}

function syncSetupFooterDocking() {
  const body = document.body;
  if (!body) return;
  if (currentPage !== "setup") {
    body.classList.remove("is-setup-footer-docked");
    return;
  }

  let shouldDock = true;
  try {
    const isMobile = window.matchMedia?.("(max-width: 760px)")?.matches === true;
    if (isMobile) {
      shouldDock = window.scrollY > 24;
    }
  } catch (_) {
    shouldDock = true;
  }
  body.classList.toggle("is-setup-footer-docked", shouldDock);
}

function renderCurrentPage() {
  pruneDraftsPromotedToSavedRuns();
  renderShell();

  if (currentPage === "workspace" || currentPage === "overview") {
    renderWorkspacePage();
    syncPolicyActionButtons();
    dismissBootSkeleton();
    return;
  }

  if (currentPage === "setup") {
    renderSetupPage();
    syncSetupFooterDocking();
    syncPolicyActionButtons();
    openSetupDeepLinkTarget();
    dismissBootSkeleton();
    return;
  }

  if (currentPage === "live" || currentPage === "results") {
    // Live + Readout merged — both routes render the same mode-aware
    // Readout surface. /live URL stays as a stable bookmark target
    // for operators returning to a published policy.
    renderResultsPage();
    syncTrustLabels();
    syncPolicyActionButtons();
    dismissBootSkeleton();
    return;
  }

  if (currentPage === "design-system") {
    renderDesignSystemPage();
    dismissBootSkeleton();
    return;
  }

  if (currentPage === "library") {
    renderLibraryPage();
  }

  syncPolicyActionButtons();
  dismissBootSkeleton();
}

function renderResultsReviewOnly() {
  const root = $("#results-review");

  if (!root || !appState.current?.operatorReview) {
    return;
  }

  safeReplaceChildren(root, renderOperatorReviewPanel(appState.current.operatorReview, appState.current.draft, appState.current.report));
}

function enforceGuardrailOrdering() {
  if (!form) return;
  const get = (n) => asNumber(form.elements.namedItem(n)?.value);
  const set = (n, v) => {
    const el = form.elements.namedItem(n);
    if (!el) return;
    const rounded = Math.round(v * 10) / 10; // snap to 0.1 — matches the input step, so a 23.7% pick stays 23.7%
    if (Math.abs(asNumber(el.value) - rounded) < 0.01) return;
    el.value = rounded.toFixed(1);
    // The hidden input's parent has .range-combo as a sibling child
    const combo = el.parentElement?.querySelector(".range-combo");
    if (combo) {
      const range = combo.querySelector('input[type="range"]');
      const numInput = combo.querySelector('input[type="number"]');
      if (range) range.value = rounded;
      if (numInput) numInput.value = rounded.toFixed(1);
      syncRangeComboFill(combo);
    }
  };
  const next = clampGuardrailSnapshot({
    targetLtvLowPct: get("targetLtvLowPct"),
    targetLtvHighPct: get("targetLtvHighPct"),
    autoRepayLtvPct: get("autoRepayLtvPct"),
    emergencyLtvPct: get("emergencyLtvPct"),
    maxLtvPct: get("maxLtvPct"),
  });

  set("targetLtvLowPct", next.targetLtvLowPct);
  set("targetLtvHighPct", next.targetLtvHighPct);
  set("autoRepayLtvPct", next.autoRepayLtvPct);
  set("emergencyLtvPct", next.emergencyLtvPct);
  set("maxLtvPct", next.maxLtvPct);

  updateGuardrailSliderLimits();
}

function updateGuardrailSliderLimits() {
  if (!form) return;
  const get = (n) => asNumber(form.elements.namedItem(n)?.value);

  const low = get("targetLtvLowPct");
  const high = get("targetLtvHighPct");
  const autoRepay = get("autoRepayLtvPct");
  const emergency = get("emergencyLtvPct");
  const max = get("maxLtvPct");

  const limits = {
    targetLtvLowPct:  { min: GUARDRAIL_MIN_GAP_PCT, max: high - GUARDRAIL_MIN_GAP_PCT },
    targetLtvHighPct: { min: low + GUARDRAIL_MIN_GAP_PCT, max: autoRepay - GUARDRAIL_MIN_GAP_PCT },
    autoRepayLtvPct:  { min: high + GUARDRAIL_MIN_GAP_PCT, max: emergency - GUARDRAIL_MIN_GAP_PCT },
    emergencyLtvPct:  { min: autoRepay + GUARDRAIL_MIN_GAP_PCT, max: max - GUARDRAIL_MIN_GAP_PCT },
    maxLtvPct:        { min: emergency + GUARDRAIL_MIN_GAP_PCT, max: 100 },
  };

  for (const [name, bound] of Object.entries(limits)) {
    const el = form.elements.namedItem(name);
    if (!el) continue;
    const combo = el.parentElement?.querySelector(".range-combo");
    if (!combo) continue;
    const range = combo.querySelector('input[type="range"]');
    const numInput = combo.querySelector('input[type="number"]');
    const lo = Math.max(0, bound.min).toFixed(1);
    const hi = Math.min(100, bound.max).toFixed(1);
    if (range) {
      range.min = lo;
      range.max = hi;
      range.value = el.value;
    }
    if (numInput) {
      numInput.min = lo;
      numInput.max = hi;
      numInput.value = el.value;
    }
    syncRangeComboFill(combo);
  }
}

function ensureScenarioOriginStamped() {
  if (!form) return;
  const originField = form.elements.namedItem("scenarioOrigin");
  if (!originField) return;
  const current = String(originField.value || "").trim().toLowerCase();
  if (current === "live" || current === "simulation" || current.startsWith("testnet-rehearsal:")) return;
  // Backfill legacy/blank drafts. Default to the *initial* scope at draft birth —
  // which for untouched forms is simulation. This preserves the soft-lock semantic:
  // later scope→live flips are correctly flagged as simulation-origin drift.
  const scopeRadio = form.querySelector('input[name="createScope"]:checked');
  const scope = scopeRadio?.value === "live" ? "live" : "shadow";
  originField.value = scope === "live" ? "live" : "simulation";
}

function isLiveSoftLockedFromSimulation(draft) {
  const origin = String(draft?.scenarioOrigin || "").trim().toLowerCase();
  const scope = String(draft?.createScope || "").trim().toLowerCase();
  return scope === "live" && origin === "simulation";
}

function persistDraft(options = {}) {
  if (!form) {
    return;
  }

  const { skipRender = false } = options;
  ensureScenarioOriginStamped();
  const nextDraft = readDraftFromForm();
  captureCreateScopeFieldState(nextDraft.createScope, nextDraft);
  appState.draft = nextDraft;
  saveStorage(STORAGE_DRAFT_KEY, appState.draft);

  // Don't rebuild the setup shell while the user is mid-drag on the
  // guardrails chart — the pointer capture target would disappear.
  if (skipRender || _guardrailsDragging) {
    return;
  }

  renderSetupPage();
}

async function handleSetupSubmit(event, options = {}) {
  event?.preventDefault?.();

  if (_setupSubmitInProgress) {
    return;
  }

  const runNameProblem = getScenarioNameSubmitProblem();
  if (runNameProblem) {
    flagScenarioNameCollision();
    setStatus(
      runNameProblem === "empty"
        ? "Pick a scenario name before running."
        : "Pick a unique scenario name before running.",
      true,
    );
    return;
  }

  _setupSubmitInProgress = true;

  try {
    const draft = readDraftFromForm();
    const judgeMode = resolveRunJudgeMode(options.judgeMode);
    const result = await runSimulation(draft, { judgeMode });

    if (result) {
      syncDraftDirtyChip();
      window.location.assign(options.resultsPath || (judgeMode
        ? buildJudgeResultsPath(judgeMode)
        : buildRunReadoutHref(result.sourceScenarioId || "")));
    }
  } catch (error) {
    reportClientError(error, { action: "handleSetupSubmit" });
    setStatus(error instanceof Error ? error.message : "Simulation could not start.", true);
  } finally {
    _setupSubmitInProgress = false;
    _setupSubmitPrimed = false;
  }
}

function syncDraftDirtyChip() {
  // Keep the stale-run warning in the titlebar, not as a standalone
  // surface. It needs to stay visible, but it is not P1 enough to take a
  // full-width trust-banner slot above the composer.
  const banner = document.querySelector("[data-draft-dirty-banner]");
  if (banner) banner.hidden = !isDraftDirtyVsLastRun();
  // Phase D.32 (UX MED #17) — sibling stale-forecast banner. Same
  // sync cadence (every form mutation + page-render) keeps it cheap.
  const staleBanner = document.querySelector("[data-forecast-stale-banner]");
  if (staleBanner) {
    const stale = appState.current?.marketBand?.stale === true;
    staleBanner.hidden = !stale;
  }
}

function isDraftDirtyVsLastRun() {
  if (!form) return false;
  const lastDraft = appState.current?.draft;
  if (!lastDraft) return false;
  try {
    return JSON.stringify(readDraftFromForm()) !== JSON.stringify(lastDraft);
  } catch (_) {
    return false;
  }
}

function clearCurrentPolicyBinding(options = {}) {
  const { persist = true } = options;
  if (!appState.current) return false;

  let changed = false;
  if (appState.current.onChainPolicy) {
    appState.current.onChainPolicy = null;
    changed = true;
  }
  if (appState.current.onChainReceipt) {
    appState.current.onChainReceipt = null;
    changed = true;
  }
  if (appState.current.sourceScenarioId) {
    appState.current.sourceScenarioId = "";
    changed = true;
  }
  if (changed && persist) {
    persistCurrentState();
  }
  return changed;
}

// Phase D.37 — fresh-draft factory. Clones DEFAULT_DRAFT and auto-numbers
// the scenarioName so the very first paint of /setup never shows a
// collision hint when "New scenario" is already taken in the wallet's
// own scenario registry. Returns a draft ready for clone-into-state.
function buildFreshDraft() {
  const draft = clone(DEFAULT_DRAFT);
  draft.scenarioName = makeUniqueScenarioName(
    DEFAULT_SCENARIO_NAME,
    collectOwnedScenarioNames(""),
  );
  return draft;
}

function handleResetSetup() {
  if (!confirm("Reset all fields to defaults? This cannot be undone.")) return;
  appState.draft = buildFreshDraft();
  appState.activeDraftId = "";
  resetCreateScopeFieldState(appState.draft);
  hydrateForm(appState.draft);
  saveStorage(STORAGE_DRAFT_KEY, appState.draft);
  saveStorage(STORAGE_ACTIVE_DRAFT_KEY, "");
  replaceSetupRouteId("", { preservePolicy: false });
  // Unbind any on-chain policy carried over from prior work — a full
  // reset is semantically "new scenario", so the Save/Update CTA
  // must reflect that by reverting to "Save on testnet".
  clearCurrentPolicyBinding();
  updateGuardrailSliderLimits();
  renderShell();
  renderSetupPage();
  setStatus("Restored default scenario.");
}

// Wired to the Workspace "Start new draft" / "Create first policy" CTAs.
// Those actions must hand the user a truly fresh Create page — otherwise
// the persisted on-chain policy binding from a prior scenario makes the
// CTA read "Update testnet policy" for what the user thinks is a new policy.
function handleStartNewDraft() {
  appState.draft = buildFreshDraft();
  appState.activeDraftId = "";
  saveStorage(STORAGE_DRAFT_KEY, appState.draft);
  saveStorage(STORAGE_ACTIVE_DRAFT_KEY, "");
  clearCurrentPolicyBinding();
  window.location.assign(buildSetupHref(""));
}

// Flip the Save-as-draft button back to its idle (floppy) state. Called
// from the form input/change listeners so any edit after a successful
// save signals that the next save would be a new version / new draft.
function revertSaveAsDraftButtonToIdle() {
  const button = $("#save-as-draft-footer");
  if (!button) return;
  if (button.dataset.state !== "saved") return;
  button.dataset.state = "idle";
  button.title = "Save the current form as a named draft without running a simulation.";
}

async function handleSaveAsDraft() {
  const saveNameProblem = getScenarioNameSubmitProblem();
  if (saveNameProblem) {
    flagScenarioNameCollision();
    setStatus(
      saveNameProblem === "empty"
        ? "Pick a scenario name before saving."
        : "Pick a unique scenario name before saving.",
      true,
    );
    return;
  }

  const draft = form ? readDraftFromForm() : appState.draft;
  const record = await saveScenarioAsDraft(draft);
  if (!record) return;

  renderCurrentPage();

  const button = $("#save-as-draft-footer");
  if (button) {
    button.dataset.state = "saved";
    button.title = `Saved as “${record.name}”. Edit any field to start a new version.`;
  }
}

async function handleSaveCurrentAsDraft() {
  if (!getWalletState().connected) {
    setStatus("Connect wallet to save this run as a draft.", true);
    return;
  }

  if (!appState.current?.draft) {
    setStatus("No run to save — run a simulation first.", true);
    return;
  }

  const record = await saveScenarioAsDraft(clone(appState.current.draft));
  if (!record) return;

  renderCurrentPage();

  const button = $("#save-current");
  if (!button) return;
  const originalLabel = button.dataset.idleLabel || "Save as draft";
  button.dataset.idleLabel = originalLabel;
  button.dataset.state = "saved";
  button.textContent = `\u2713 Saved "${record.name}"`;
  button.title = `Draft "${record.name}" is now in your Workspace drafts list.`;
  setTimeout(() => {
    const refreshed = $("#save-current");
    if (!refreshed) return;
    refreshed.dataset.state = "idle";
    refreshed.textContent = refreshed.dataset.idleLabel || "Save as draft";
    refreshed.title = "Save the current run's inputs as a named draft";
  }, 2200);
}

async function refreshCurrentSimulationAfterRailChange() {
  const routeJudgeMode = getRouteJudgeMode();
  const draft = routeJudgeMode
    ? buildJudgeDraft(clone(DEFAULT_DRAFT), routeJudgeMode)
    : form ? readDraftFromForm() : appState.current?.draft || appState.draft;

  if (!draft) {
    renderCurrentPage();
    return;
  }

  await runSimulation(draft, {
    silent: true,
    judgeMode: routeJudgeMode,
    preserveJudgeMode: !routeJudgeMode,
  });
}

function handleSavedScenarioAction(event) {
  const button = event.target.closest("[data-action]");

  if (!button) {
    return;
  }

  const { action, id } = button.dataset;

  if (action === "export-live-history") {
    event.preventDefault();
    exportLivePolicyHistory(button.dataset.policyId || "");
    return;
  }

  if (action === "export-live-unwind") {
    event.preventDefault();
    exportLiveUnwindBrief(button.dataset.policyId || "");
    return;
  }

  if (action === "export-live-unwind-md") {
    event.preventDefault();
    exportLiveUnwindMarkdown(button.dataset.policyId || "");
    return;
  }

  if (action === "live-control") {
    event.preventDefault();
    applyPolicyControlState(
      button.dataset.policyId || "",
      button.dataset.controlMode || "active",
      "workspace"
    );
    return;
  }

  if (action === "toggle-live-unwind-step") {
    event.preventDefault();
    toggleLiveUnwindStep(
      button.dataset.policyId || "",
      button.dataset.stepId || "",
      button.dataset.stepComplete === "true",
      "workspace"
    );
    return;
  }

  if (action === "refresh-live-protocol") {
    event.preventDefault();
    void refreshLiveProtocolPosture(button.dataset.policyId || "", "workspace");
    return;
  }

  if (action === "refresh-ops-health") {
    event.preventDefault();
    void refreshOpsHealth({ silent: false });
    return;
  }

  if (action === "discard" && id === "__draft__") {
    const hasCurrent = Boolean(appState.current?.draft);
    const promptCopy = hasCurrent
      ? "Discard draft edits and revert to the last simulated run?"
      : "Discard draft? The form will reset to defaults.";
    if (!confirm(promptCopy)) return;
    appState.draft = hasCurrent ? clone(appState.current.draft) : buildFreshDraft();
    appState.activeDraftId = "";
    saveStorage(STORAGE_DRAFT_KEY, appState.draft);
    saveStorage(STORAGE_ACTIVE_DRAFT_KEY, "");
    renderCurrentPage();
    setStatus(hasCurrent ? "Draft reverted to last run." : "Draft discarded.");
    trackEvent("draft_discarded", { hadCurrent: hasCurrent });
    return;
  }

  if (action === "load-draft") {
    const record = (appState.drafts || []).find((d) => d.id === id);
    if (!record) return;
    appState.draft = clone(record.draft);
    appState.activeDraftId = record.id;
    saveStorage(STORAGE_DRAFT_KEY, appState.draft);
    saveStorage(STORAGE_ACTIVE_DRAFT_KEY, appState.activeDraftId);
    setStatus(`Loaded draft "${record.name}" into Create.`);
    trackEvent("draft_loaded_into_setup", { draftId: id });
    window.location.assign(buildSetupHref(id));
    return;
  }

  if (action === "delete-draft") {
    const record = (appState.drafts || []).find((d) => d.id === id);
    if (!record) return;
    if (!confirm(`Delete saved draft "${record.name}"?`)) return;
    appState.drafts = (appState.drafts || []).filter((d) => d.id !== id);
    saveStorage(STORAGE_DRAFTS_KEY, appState.drafts);
    if (appState.activeDraftId === id) {
      appState.activeDraftId = "";
      saveStorage(STORAGE_ACTIVE_DRAFT_KEY, "");
    }
    renderCurrentPage();
    setStatus(`Deleted draft "${record.name}".`);
    trackEvent("draft_deleted", { draftId: id });
    return;
  }

  if (action === "run-draft") {
    const draft = appState.draft;
    if (!draft) {
      setStatus("Nothing to run — the draft is empty.", true);
      return;
    }
    trackEvent("draft_run_from_workspace", { source: "scratch" });
    runSimulation(clone(draft)).then((result) => {
      if (result) window.location.assign(buildRunReadoutHref(result.sourceScenarioId || ""));
    });
    return;
  }

  if (action === "run-saved-draft") {
    const record = (appState.drafts || []).find((d) => d.id === id);
    if (!record) return;
    appState.draft = clone(record.draft);
    appState.activeDraftId = record.id;
    saveStorage(STORAGE_DRAFT_KEY, appState.draft);
    saveStorage(STORAGE_ACTIVE_DRAFT_KEY, appState.activeDraftId);
    trackEvent("draft_run_from_workspace", { source: "saved", draftId: id });
    runSimulation(clone(record.draft)).then((result) => {
      if (result) window.location.assign(buildRunReadoutHref(result.sourceScenarioId || ""));
    });
    return;
  }

  const savedScenario = appState.saved.find((scenario) => scenario.id === id);

  if (!savedScenario) {
    return;
  }

  if (action === "open") {
    setCurrentFromSaved(savedScenario);
    setStatus(`Opened "${savedScenario.name}".`);
    trackEvent("scenario_opened", { scenarioId: id });
    window.location.assign(buildRunReadoutHref(id));
    return;
  }

  if (action === "edit") {
    setCurrentFromSaved(savedScenario);
    setStatus(`Loaded "${savedScenario.name}" into setup.`);
    trackEvent("scenario_loaded_into_setup", { scenarioId: id });
    window.location.assign(buildSetupHref(id));
    return;
  }

  if (action === "duplicate-current") {
    // Phase D.31 — workspace "current" card now exposes Duplicate to
    // draft so an operator can fork the most-recent run without
    // overwriting it. Reuses the same save-as-draft path that the
    // /results "Save as draft" button uses.
    // Phase D.32 (UX MED) — added inline button-state feedback.
    // Without it the action was silent (write succeeded but the
    // button gave no acknowledgement; only the next list re-render
    // showed the new card). Now the button flashes a "Saved" label
    // for 1.6s, matching the same feedback pattern used by
    // #save-current on /results.
    const triggerBtn = button instanceof HTMLButtonElement ? button : null;
    const idleLabel = triggerBtn?.textContent ?? "Duplicate to draft";
    if (triggerBtn) {
      triggerBtn.disabled = true;
      triggerBtn.dataset.state = "saving";
      triggerBtn.textContent = "Saving…";
    }
    void handleSaveCurrentAsDraft().then((record) => {
      // Phase D.33 (G-1, G-21) — after the flash, re-render workspace
      // so the new draft card appears in the list. Also drop a status
      // line so the operator sees confirmation + destination.
      if (record) {
        renderCurrentPage();
        setStatus(`Draft saved to Workspace as "${record.name}".`);
      }
      if (!triggerBtn) return;
      // After re-render the original button may have been replaced by a
      // fresh DOM node. Look it up again before applying state.
      const liveBtn = document.querySelector('[data-action="duplicate-current"]');
      const flashBtn = liveBtn instanceof HTMLButtonElement ? liveBtn : triggerBtn;
      flashBtn.dataset.state = record ? "saved" : "idle";
      flashBtn.textContent = record ? "Saved" : idleLabel;
      flashBtn.disabled = false;
      window.setTimeout(() => {
        flashBtn.dataset.state = "idle";
        flashBtn.textContent = idleLabel;
      }, 1600);
    });
    return;
  }

  if (action === "compare") {
    appState.compareId = appState.compareId === id ? null : id;
    saveStorage(STORAGE_COMPARE_KEY, appState.compareId);
    renderCurrentPage();
    trackEvent("scenario_compare_toggled", {
      scenarioId: id,
      active: Boolean(appState.compareId),
    });
    return;
  }

  if (action === "delete") {
    appState.saved = appState.saved.filter((scenario) => scenario.id !== id);

    if (appState.compareId === id) {
      appState.compareId = null;
    }

    saveStorage(STORAGE_SAVED_KEY, appState.saved);
    saveStorage(STORAGE_COMPARE_KEY, appState.compareId);
    renderCurrentPage();
    setStatus(`Deleted scenario "${savedScenario.name}".`);
    trackEvent("scenario_deleted", { scenarioId: id });

    // Sync deletion to backend
    if (getWalletState().connected) {
      deleteRemoteScenario(id).catch((err) =>
        console.warn("[sync] delete failed:", err.message)
      );
    }
  }
}

function handleOperatorReviewInput(event) {
  if (!appState.current?.operatorReview) {
    return;
  }

  const field = event.target.closest("[data-review-field]");

  if (!field) {
    return;
  }

  const key = field.dataset.reviewField;
  appState.current.operatorReview[key] = field.value;
  persistCurrentState();
}

function handleOperatorReviewChange(event) {
  if (!appState.current?.operatorReview) {
    return;
  }

  const checkbox = event.target.closest("[data-review-check]");

  if (!checkbox) {
    return;
  }

  const item = appState.current.operatorReview.items.find((entry) => entry.id === checkbox.dataset.reviewCheck);

  if (!item) {
    return;
  }

  item.done = checkbox.checked;
  persistCurrentState();
  renderResultsReviewOnly();
}

function handleOperatorReviewAction(event) {
  if (!appState.current?.operatorReview) {
    return;
  }

  const button = event.target.closest("[data-review-action]");

  if (!button) {
    return;
  }

  if (button.dataset.reviewAction === "mark-critical") {
    appState.current.operatorReview.items = appState.current.operatorReview.items.map((item) => ({
      ...item,
      done: item.critical ? true : item.done,
    }));
    persistCurrentState();
    renderResultsReviewOnly();
    setStatus("Marked all critical review items as complete.");
    return;
  }

  if (button.dataset.reviewAction === "reset-review") {
    appState.current.operatorReview.items = appState.current.operatorReview.items.map((item) => ({
      ...item,
      done: false,
    }));
    appState.current.operatorReview.note = "";
    persistCurrentState();
    renderResultsReviewOnly();
    setStatus("Operator review was reset.");
  }
}

function bindEvents() {
  bindGlobalHashPillCopy();

  if (form) {
    form.addEventListener("submit", handleSetupSubmit);
    form.addEventListener("input", () => {
      enforceGuardrailOrdering();
      persistDraft({ skipRender: _setupSubmitPrimed });
      validateFieldsInline();
      renderIntentSwapUsd(readDraftFromForm());
      syncDraftDirtyChip();
      revertSaveAsDraftButtonToIdle();
      queueScenarioChecksRerender();
      syncPolicyActionButtons();
      syncMintReceiptButton();
    });
    form.addEventListener("change", () => {
      enforceGuardrailOrdering();
      persistDraft({
        skipRender: _setupSubmitPrimed,
      });
      validateFieldsInline();
      syncDraftDirtyChip();
      revertSaveAsDraftButtonToIdle();
      queueScenarioChecksRerender(60);
      syncPolicyActionButtons();
      syncMintReceiptButton();
    });

    form.querySelectorAll("[data-stepper-target][data-stepper-dir]").forEach((button) => {
      if (button.dataset.bound === "1") return;
      button.dataset.bound = "1";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const targetName = String(button.dataset.stepperTarget || "").trim();
        const direction = String(button.dataset.stepperDir || "").trim() === "down" ? -1 : 1;
        const target = form.elements.namedItem(targetName);
        if (!(target instanceof HTMLInputElement)) return;
        const step = Number.parseFloat(target.step || "1") || 1;
        const min = Number.parseFloat(target.min || "");
        const max = Number.parseFloat(target.max || "");
        const precision = String(target.step || "1").includes(".")
          ? String(target.step).split(".")[1].length
          : 0;
        let nextValue = asNumber(target.value) + direction * step;
        if (Number.isFinite(min)) nextValue = Math.max(min, nextValue);
        if (Number.isFinite(max)) nextValue = Math.min(max, nextValue);
        target.value = nextValue.toFixed(precision);
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });
  }

  // Persist details open/closed state
  document.querySelectorAll("details.disclosure[data-section]").forEach((details) => {
    const saved = loadStorage(STORAGE_DETAILS_KEY, {}, { global: true });
    const key = details.dataset.section;
    if (key && saved[key] !== undefined) {
      details.open = saved[key];
    }
    details.addEventListener("toggle", () => {
      const state = loadStorage(STORAGE_DETAILS_KEY, {}, { global: true });
      state[details.dataset.section] = details.open;
      saveStorage(STORAGE_DETAILS_KEY, state, { global: true });
    });
  });

  const saveCurrent = $("#save-current");
  if (saveCurrent) {
    saveCurrent.addEventListener("click", handleSaveCurrentAsDraft);
  }

  const exportCurrent = $("#export-current");
  if (exportCurrent) {
    exportCurrent.addEventListener("click", exportCurrentScenario);
  }

  const savePolicyCurrent = $("#save-policy-current");
  if (savePolicyCurrent && !savePolicyCurrent.dataset.bound) {
    savePolicyCurrent.dataset.bound = "1";
    savePolicyCurrent.addEventListener("click", () => { void handleSavePolicyOnChain(); });
  }

  const savePolicyToolbar = $("#save-policy-toolbar");
  if (savePolicyToolbar && !savePolicyToolbar.dataset.bound) {
    savePolicyToolbar.dataset.bound = "1";
    savePolicyToolbar.addEventListener("click", () => { void handleSavePolicyOnChain({ navigateToReadout: true }); });
  }

  const mintReceipt = $("#mint-receipt");
  if (mintReceipt && !mintReceipt.dataset.bound) {
    mintReceipt.dataset.bound = "1";
    mintReceipt.addEventListener("click", () => { void handleMintReceipt(); });
  }

  const saveAsDraftFooter = $("#save-as-draft-footer");
  if (saveAsDraftFooter && !saveAsDraftFooter.dataset.bound) {
    saveAsDraftFooter.dataset.bound = "1";
    saveAsDraftFooter.addEventListener("click", handleSaveAsDraft);
  }

  const runSimToolbar = $("#run-sim-toolbar");
  if (runSimToolbar && !runSimToolbar.dataset.bound) {
    runSimToolbar.dataset.bound = "1";
    runSimToolbar.type = "button";
    runSimToolbar.addEventListener("pointerdown", () => {
      _setupSubmitPrimed = true;
      setTimeout(() => {
        if (!_setupSubmitInProgress) {
          _setupSubmitPrimed = false;
        }
      }, 0);
    });
    runSimToolbar.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      void handleSetupSubmit(event);
    });
  }

  const resetFooterBtn = $("#reset-setup-footer");
  if (resetFooterBtn && !resetFooterBtn.dataset.bound) {
    resetFooterBtn.dataset.bound = "1";
    resetFooterBtn.addEventListener("click", handleResetSetup);
  }

  syncDraftDirtyChip();

  document.querySelectorAll("[data-amount-preset]").forEach((btn) => {
    if (btn.dataset.amountPresetBound) return;
    btn.dataset.amountPresetBound = "1";
    btn.addEventListener("click", (ev) => {
      const draft = readDraftFromForm();
      ev.preventDefault();
      const input = document.querySelector('input[name="btcUnits"]');
      if (!input) return;
      const wallet = getWalletState();
      const balances = Array.isArray(wallet?.btcBalances) ? wallet.btcBalances : [];
      const sym = String(draft?.collateralAssetSymbol || "BTC").toUpperCase();
      const coinType = String(draft?.collateralCoinType || "").toLowerCase();
      let match = null;
      if (coinType) match = balances.find((b) => String(b?.coinType || "").toLowerCase() === coinType) || null;
      if (!match) match = balances.find((b) => String(b?.symbol || "").toUpperCase() === sym) || null;
      const walletBasis = Number(match?.display) || 0;
      const scope = document.querySelector('input[name="createScope"]:checked')?.value || "shadow";
      const basis = walletBasis > 0 ? walletBasis : (scope === "live" ? 0 : 1);
      if (basis <= 0) return;
      let frac = Number(btn.dataset.amountPreset);
      if (btn.hasAttribute("data-collateral-use-max") || String(btn.dataset.amountPreset || "").toLowerCase() === "max") {
        frac = 1;
      }
      if (!Number.isFinite(frac) || frac <= 0) return;
      input.value = (basis * frac).toFixed(6).replace(/\.?0+$/, "").replace(/\.$/, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });

  document.querySelectorAll('input[name="riskLevel"]').forEach((radio) => {
    if (radio.dataset.riskBound) return;
    radio.dataset.riskBound = "1";
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      const presetKey = radio.dataset.riskPreset;
      const setupForm = document.getElementById("scenario-form");
      if (presetKey && setupForm) applyStrategyPreset(setupForm, presetKey);
    });
  });

  document.addEventListener("click", (event) => {
    const readoutSavePolicy = event.target.closest('[data-action="readout-save-policy"]');
    if (readoutSavePolicy) {
      event.preventDefault();
      void handleSavePolicyOnChain();
      return;
    }

    const readoutMintReceipt = event.target.closest('[data-action="readout-mint-receipt"]');
    if (readoutMintReceipt) {
      event.preventDefault();
      void handleMintReceipt({
        receiptMode: readoutMintReceipt.dataset.receiptMode === "mainnet-readonly"
          ? "mainnet-readonly"
          : "testnet",
      });
      return;
    }

    const readoutRefreshEvidence = event.target.closest('[data-action="readout-refresh-evidence"]');
    if (readoutRefreshEvidence) {
      event.preventDefault();
      void refreshProofEvidence({ silent: false, rerun: true });
      return;
    }

    const copyReceiptLink = event.target.closest('[data-action="copy-receipt-link"]');
    if (copyReceiptLink) {
      event.preventDefault();
      void handleCopyReceiptLinkAction(copyReceiptLink);
      return;
    }

    const startNew = event.target.closest('[data-action="start-new-draft"]');
    if (startNew) {
      event.preventDefault();
      handleStartNewDraft();
      return;
    }

    const activityLedgerFilter = event.target.closest('[data-action="activity-ledger-filter"]');
    if (activityLedgerFilter) {
      event.preventDefault();
      appState.activityLedgerFilter = activityLedgerFilter.dataset.filter === "onchain" ? "onchain" : "all";
      renderCurrentPage();
      return;
    }

    const captureLiveMainnetPre = event.target.closest('[data-action="capture-live-mainnet-pre"]');
    if (captureLiveMainnetPre) {
      event.preventDefault();
      handleCaptureLiveMainnetPreActionSnapshot(captureLiveMainnetPre);
      return;
    }

    const verifyLiveMainnetTx = event.target.closest('[data-action="verify-live-mainnet-tx"]');
    if (verifyLiveMainnetTx) {
      event.preventDefault();
      void handleVerifyLiveMainnetTx(verifyLiveMainnetTx);
      return;
    }

    const mintLiveReceipt = event.target.closest('[data-action="mint-live-receipt"]');
    if (mintLiveReceipt) {
      event.preventDefault();
      const requestedPolicyId = normalizeLiveHistoryText(
        mintLiveReceipt.dataset.policyId || appState.current?.onChainPolicy?.id || ""
      );
      const currentPolicyId = normalizeLiveHistoryText(appState.current?.onChainPolicy?.id);

      if (requestedPolicyId && (requestedPolicyId !== currentPolicyId || !appState.current?.report)) {
        const policy = getLivePolicyRecord(requestedPolicyId);
        const snapshot = findLatestModeledSnapshotForPolicy(requestedPolicyId);

        if (!policy) {
          setStatus("This live policy is not loaded in Workspace yet. Refresh on-chain state first.", true);
          return;
        }

        if (!snapshot?.draft || !snapshot?.report) {
          setStatus("Run this policy in Create before minting a receipt. Receipt minting needs a modeled snapshot.", true);
          return;
        }

        const latestReceipt = getReceiptsForPolicyFromWorkspace(requestedPolicyId)[0] || null;
        appState.current = {
          sourceScenarioId: snapshot.sourceScenarioId || "",
          draft: clone(snapshot.draft),
          input: buildSimulationInput(snapshot.draft),
          report: clone(snapshot.report),
          marketBand: isPlainObject(snapshot.marketBand) ? clone(snapshot.marketBand) : null,
          judge: isPlainObject(snapshot.judge) ? clone(snapshot.judge) : null,
          operatorReview: buildOperatorReview(snapshot.draft, snapshot.report),
          onChainPolicy: clone(policy),
          onChainReceipt: latestReceipt ? clone(latestReceipt) : null,
        };
        appState.draft = clone(snapshot.draft);
        saveStorage(STORAGE_DRAFT_KEY, appState.draft);
        persistCurrentState();
      }

      void handleMintReceipt({
        receiptMode: mintLiveReceipt.dataset.receiptMode === "mainnet-readonly"
          ? "mainnet-readonly"
          : "testnet",
      });
      return;
    }

    const liveControl = event.target.closest('[data-action="live-control"]');
    if (liveControl && !liveControl.closest("#saved-scenarios")) {
      event.preventDefault();
      applyPolicyControlState(
        liveControl.dataset.policyId || appState.current?.onChainPolicy?.id || "",
        liveControl.dataset.controlMode || "active",
        currentPage === "live" ? "live" : "workspace"
      );
      return;
    }

    const liveUnwindToggle = event.target.closest('[data-action="toggle-live-unwind-step"]');
    if (liveUnwindToggle && !liveUnwindToggle.closest("#saved-scenarios")) {
      event.preventDefault();
      toggleLiveUnwindStep(
        liveUnwindToggle.dataset.policyId || appState.current?.onChainPolicy?.id || "",
        liveUnwindToggle.dataset.stepId || "",
        liveUnwindToggle.dataset.stepComplete === "true",
        currentPage === "live" ? "live" : "workspace"
      );
      return;
    }

    const exportLiveHistory = event.target.closest('[data-action="export-live-history"]');
    if (exportLiveHistory && !exportLiveHistory.closest("#workspace-list")) {
      event.preventDefault();
      exportLivePolicyHistory(exportLiveHistory.dataset.policyId || appState.current?.onChainPolicy?.id || "");
      return;
    }

    const exportLiveUnwind = event.target.closest('[data-action="export-live-unwind"]');
    if (exportLiveUnwind && !exportLiveUnwind.closest("#saved-scenarios")) {
      event.preventDefault();
      exportLiveUnwindBrief(exportLiveUnwind.dataset.policyId || appState.current?.onChainPolicy?.id || "");
      return;
    }

    const exportLiveUnwindMarkdownButton = event.target.closest('[data-action="export-live-unwind-md"]');
    if (exportLiveUnwindMarkdownButton && !exportLiveUnwindMarkdownButton.closest("#saved-scenarios")) {
      event.preventDefault();
      exportLiveUnwindMarkdown(exportLiveUnwindMarkdownButton.dataset.policyId || appState.current?.onChainPolicy?.id || "");
      return;
    }

    const refreshLiveReadback = event.target.closest('[data-action="refresh-live-readback"]');
    if (refreshLiveReadback) {
      event.preventDefault();
      void handleRefreshPortfolio();
      return;
    }

    const refreshLiveProtocol = event.target.closest('[data-action="refresh-live-protocol"]');
    if (refreshLiveProtocol && !refreshLiveProtocol.closest("#saved-scenarios")) {
      event.preventDefault();
      void refreshLiveProtocolPosture(
        refreshLiveProtocol.dataset.policyId || appState.current?.onChainPolicy?.id || "",
        currentPage === "live" ? "live" : "workspace"
      );
      return;
    }

    const refreshOpsHealthButton = event.target.closest('[data-action="refresh-ops-health"]');
    if (refreshOpsHealthButton && !refreshOpsHealthButton.closest("#saved-scenarios")) {
      event.preventDefault();
      void refreshOpsHealth({ silent: false });
      return;
    }

  });

  const savedRoot = $("#saved-scenarios");
  if (savedRoot) {
    savedRoot.addEventListener("click", handleSavedScenarioAction);
  }

  const resultsReview = $("#results-review");
  if (resultsReview) {
    resultsReview.addEventListener("input", handleOperatorReviewInput);
    resultsReview.addEventListener("change", handleOperatorReviewChange);
    resultsReview.addEventListener("click", handleOperatorReviewAction);
  }

  document.querySelectorAll("[data-theme-value]").forEach((button) => {
    button.addEventListener("click", () => {
      applyTheme(button.dataset.themeValue, { source: "toggle" });
    });
  });

  document.addEventListener("error", handleAssetError, true);

  bindSetupPrimer();
}

function applyJudgeDemoScenario(mode) {
  const scenario = getJudgeScenario(mode);
  if (!scenario || !form) return null;

  appState.activeDraftId = "";
  saveStorage(STORAGE_ACTIVE_DRAFT_KEY, "");
  clearCurrentPolicyBinding({ persist: false });

  const nextDraft = buildJudgeDraft(clone(DEFAULT_DRAFT), mode);
  const uniqueName = makeUniqueScenarioName(
    nextDraft.scenarioName || DEFAULT_SCENARIO_NAME,
    collectOwnedScenarioNames(appState.activeDraftId)
  );

  for (const [name, value] of Object.entries(nextDraft)) {
    if (name === "scenarioName") continue;
    setFieldValue(form.elements.namedItem(name), value);
  }
  writeScenarioNameToForm(uniqueName);

  enforceGuardrailOrdering();
  validateFieldsInline();
  renderScenarioNameCollisionHint();
  persistDraft({ skipRender: true });
  renderSetupPage();
  return readDraftFromForm();
}

// Judge demo mode — for Sui Overflow judges and anyone else hitting the
// sim cold. `?judge=1` remains the Harbor starter. Named modes load
// deterministic beta-owned portfolio/oracle fixtures; receipt bytes stay
// owned by the proof-pack and verifier surfaces.
function maybeStartJudgeDemo() {
  try {
    if (currentPage !== "setup" || !form) return;
    const mode = resolveJudgeDemoMode(window.location.search);
    if (!mode) return;
    const scenario = getJudgeScenario(mode);
    if (!scenario) return;

    applyJudgeDemoScenario(mode);
    dismissBootSkeleton();

    // Surface a small "Judge demo — auto-running Harbor" banner so the
    // reviewer can tell the flow is canned and deliberate, not a bug.
    const banner = document.createElement("aside");
    banner.className = "setup-primer setup-primer--judge";
    banner.dataset.judgeMode = mode;
    banner.setAttribute("role", "status");
    banner.innerHTML = `
      <div class="setup-primer__body">
        <strong class="setup-primer__title">${escapeHtml(scenario.title)}</strong>
        <span class="setup-primer__text">${escapeHtml(scenario.copy)}</span>
      </div>
    `;
    const host = document.querySelector(".page-stack") || document.body;
    if (host?.firstElementChild) {
      host.insertBefore(banner, host.firstElementChild);
    } else if (host) {
      host.appendChild(banner);
    }
    if (scenario.autoRun === false) return;

    // Give the form + renderSetupPage a tick to finish populating so the
    // submit handler reads the real Harbor draft and not a half-built
    // form state.
    const autoRunDelayMs = (() => {
      try {
        return window.matchMedia("(pointer: coarse)").matches || window.innerWidth <= 720
          ? 1800
          : 1200;
      } catch {
        return 1200;
      }
    })();
    setTimeout(() => {
      _setupSubmitPrimed = true;
      handleSetupSubmit(
        { preventDefault: () => {} },
        { resultsPath: buildJudgeResultsPath(mode), judgeMode: mode }
      );
    }, autoRunDelayMs);
  } catch (error) {
    reportClientError(error, { action: "maybeStartJudgeDemo" });
  }
}

const SETUP_PRIMER_DISMISSED_KEY = "tide.shadow-mode.primer-dismissed.v1";

function bindSetupPrimer() {
  const primer = document.querySelector("[data-setup-primer]");
  if (!primer) return;
  let dismissed = false;
  try {
    dismissed = window.localStorage.getItem(SETUP_PRIMER_DISMISSED_KEY) === "1";
  } catch {}
  if (!dismissed) primer.hidden = false;
  const close = primer.querySelector("[data-setup-primer-close]");
  if (close) {
    close.addEventListener("click", () => {
      primer.hidden = true;
      try { window.localStorage.setItem(SETUP_PRIMER_DISMISSED_KEY, "1"); } catch {}
    });
  }
}

function _reloadWalletScopedState(options = {}) {
  const bundle = loadScenarioStateBundle(options);
  appState.current = bundle.current;
  appState.saved = bundle.saved;
  appState.drafts = Array.isArray(bundle.drafts) ? bundle.drafts : [];
  appState.activeDraftId = typeof bundle.activeDraftId === "string" ? bundle.activeDraftId : "";
  appState.compareId = bundle.compareId;
  appState.draft = bundle.draft;
  appState.liveControlState = normalizeLiveControlStore(bundle.liveControlState);
  appState.liveUnwindProgress = normalizeLiveUnwindProgressStore(bundle.liveUnwindProgress);
  pruneDraftsPromotedToSavedRuns({
    address: options.address || getWalletState().address,
    persist: true,
  });
}

function shouldAutoEnsureCurrentRun(page, walletConnected) {
  if (page === "setup") return false;
  if (page === "live") return false;
  if (!walletConnected && (page === "workspace" || page === "library")) {
    return false;
  }
  if ((page === "results" || page === "live") && readRoutePolicyIdFromUrl()) {
    return false;
  }
  return true;
}

// Expose a small, read-only debug surface on window so an operator
// running the first testnet mints can inspect runtime config, wallet,
// policy, and latest receipt straight from DevTools without digging
// through module-internal state. Read-only by convention — callers
// that need to trigger actions should do so via the UI.
function installTideDebugHelper() {
  if (typeof window === "undefined") return;
  try {
    window.__tideDebug = Object.freeze({
      get appState() { return appState; },
      get runtimeConfig() { return getRuntimeConfig(); },
      get wallet() { return getWalletState(); },
      get currentPage() { return currentPage; },
      get onChainPolicy() { return appState.current?.onChainPolicy || null; },
      get lastReceipt() { return appState.current?.onChainReceipt || null; },
      get latestProofReceipt() { return appState.latestProofReceipt || null; },
      get lastSigningErrors() { return _signingDiagnostics; },
      get oracleReadback() { return appState.oracleReadback || null; },
      get liveControlState() { return appState.liveControlState || {}; },
      isPolicyRegistryConfigured() { return isPolicyRegistryConfigured(getRuntimeConfig()); },
      isExecutionReceiptsConfigured() { return isExecutionReceiptsConfigured(getRuntimeConfig()); },
      fetchOwnedPolicies,
      fetchPolicyObject,
      fetchReceiptObject,
      buildSuiExplorerUrl: (kind, id) => buildSuiExplorerUrl(kind, id, getRuntimeConfig()),
    });
  } catch (err) {
    console.warn("[tide] __tideDebug install failed:", err?.message || err);
  }
}

async function init() {
  assertSuiNetworkExplicit({
    config: getRuntimeConfig(),
    tideEnv: typeof window?.TIDE_ENV === "string" ? window.TIDE_ENV : "",
  });
  assertSuiNetworkCoherent(getRuntimeConfig());
  assertProductionSafety({
    config: getRuntimeConfig(),
    tideEnv: typeof window?.TIDE_ENV === "string" ? window.TIDE_ENV : "",
  });

  const walletConnected = getWalletState().connected;

  _reloadWalletScopedState({
    fallbackToGlobal: walletConnected,
    persistFallback: walletConnected,
  });
  let routeSetupSelection = applyRouteSetupSelection();

  refreshSimulator();

  applyTheme(appState.theme);

  if (form) {
    form.noValidate = true;
    hydrateForm(appState.draft);
    seedCreateScopeFieldState(appState.draft);
    enhanceNumberInputsWithSliders();
    updateGuardrailSliderLimits();
  }
  const rehydrateSetupFormFromDraft = () => {
    if (currentPage !== "setup" || !form) return;
    hydrateForm(appState.draft);
    seedCreateScopeFieldState(appState.draft);
    updateGuardrailSliderLimits();
  };

  bindEvents();
  window.addEventListener("scroll", syncSetupFooterDocking, { passive: true });
  window.addEventListener("resize", syncSetupFooterDocking);

  // Trust posture ("Shadow Mode / No mainnet capital / No live execution")
  // renders on every page as part of the chrome, independent of app state.
  // Safe to call before async setup — computeTrustLabels only reads the
  // runtime config, which is already synchronously available.
  syncTrustLabels();
  syncEnvBadge();
  ensureAppFooter();

  await maybeLoadConfiguredRailPack({
    rerun: Boolean(appState.current?.draft) || currentPage !== "setup",
    silent: true,
  });
  void refreshLatestProofReceipt({ silent: true }).finally(() => {
    renderCurrentPage();
  });
  maybeStartJudgeDemo();

  // Fire-and-forget: pull latest prediction-market consensus so the next
  // simulation run can stress-test against market-implied quantiles. A miss
  // is fine — the simulator falls back to hardcoded drawdown scenarios.
  // Re-render on both success and failure so the Polymarket overlay leaves
  // the "loading…" placeholder state regardless of outcome.
  ensureScenarioForecastLoaded().finally(() => {
    rerenderScenarioChecksForCurrentPage();
  });
  // Parallel warm-up for the Kalshi tab (short-horizon close-price ladder).
  ensureKalshiForecastLoaded().finally(() => {
    rerenderScenarioChecksForCurrentPage();
  });
  // Pyth oracle read-back is config-driven. It never blocks simulation; it
  // only upgrades the readout trust copy from "modeled BTC price" to a
  // read-only Sui RPC oracle snapshot when the feed object is configured.
  ensurePythOracleReadbackLoaded().finally(() => {
    if (currentPage === "results" || currentPage === "live") {
      scheduleRender();
    }
  });

  const marketSeedApplied = syncMarketPriceIntoState();
  const routePolicyId = readRoutePolicyIdFromUrl();
  const routeRunId = readRouteRunIdFromUrl();
  const adoptPolicyDraftFromUrl = currentPage === "setup" && Boolean(routePolicyId);

  const routeRunSelection = routeRunId
    ? applyRouteRunSelection(routeRunId)
    : { requested: false, applied: false, missing: false };
  const routeRunBlocksFallback = routeRunSelection.requested && routeRunSelection.missing
    && (currentPage === "results" || currentPage === "live");
  const routePolicyBlocksFallback = Boolean(routePolicyId)
    && (currentPage === "results" || currentPage === "live");

  if (shouldAutoEnsureCurrentRun(currentPage, walletConnected) && !routeRunSelection.applied && !routeRunBlocksFallback && !routePolicyBlocksFallback) {
    if (marketSeedApplied && appState.current?.draft) {
      await runSimulation(appState.current.draft, { silent: true, preserveJudgeMode: true });
    } else {
      await ensureCurrentRun();
    }
  }

  // Honor ?policy=<id> in the URL. Used by Workspace to route a specific
  // on-chain policy into Setup/Live/Results without falling back to the
  // wallet's latest policy.
  let hydratedRoutePolicy = null;
  if (walletConnected || routePolicyId) {
    try {
      if (walletConnected && routePolicyId && currentPage !== "workspace") {
        await refreshWorkspaceOnChainState();
      }
      hydratedRoutePolicy = await hydrateCurrentPolicyFromChain({
        address: walletConnected ? getWalletState().address : "",
        policyId: routePolicyId,
        adoptPolicyDraft: adoptPolicyDraftFromUrl,
        bindCurrent: !routePolicyId,
      });
      if (routePolicyId) {
        const policyBound = bindRoutePolicyContext(routePolicyId, {
          policy: hydratedRoutePolicy,
          adoptDraft: adoptPolicyDraftFromUrl,
          runId: routeRunId,
        });
        if (!policyBound && (currentPage === "results" || currentPage === "live")) {
          appState.current = null;
        } else if (policyBound) {
          await ensurePolicyOnlyReadoutRun(routePolicyId);
          rehydrateSetupFormFromDraft();
        }
      }
    } catch (_) {}

    try {
      if (walletConnected) {
        await syncRemoteSavedScenarios({ address: getWalletState().address });
        if (currentPage === "setup" && routeSetupSelection.requested && !routeSetupSelection.applied) {
          routeSetupSelection = applyRouteSetupSelection(routeRunId);
          if (routeSetupSelection.applied && form) {
            hydrateForm(appState.draft);
            seedCreateScopeFieldState(appState.draft);
          }
        }
        if (routeRunId) {
          const syncedRunSelection = applyRouteRunSelection(routeRunId);
          if (syncedRunSelection.applied) {
            await hydrateCurrentPolicyFromChain({
              policyId: appState.current?.onChainPolicy?.id || "",
            });
          }
        }
      }
      if (walletConnected && routePolicyId) {
        const policyBound = bindRoutePolicyContext(routePolicyId, {
          policy: hydratedRoutePolicy,
          adoptDraft: adoptPolicyDraftFromUrl,
          runId: routeRunId,
        });
        if (!policyBound && (currentPage === "results" || currentPage === "live")) {
          appState.current = null;
        } else if (policyBound) {
          await ensurePolicyOnlyReadoutRun(routePolicyId);
          rehydrateSetupFormFromDraft();
        }
      }
    } catch (_) {}
  }

  if (currentPage === "workspace") {
    refreshWorkspaceOnChainState().catch(() => {});
  }

  if (appState.current?.report && !appState.current.operatorReview) {
    appState.current.operatorReview = buildOperatorReview(appState.current.draft, appState.current.report);
    persistCurrentState();
  }

  renderCurrentPage();
  fireFunnelPageMountBeacon();

  installTideDebugHelper();

  if (currentPage === "setup" && routeSetupSelection.requested && routeSetupSelection.missing) {
    setStatus("This position link was not found in the current wallet workspace.", true);
  } else if (!walletConnected && routePolicyId && currentPage === "live") {
    setStatus("Live policy loaded in read-only mode. Connect wallet to refresh wallet-scoped rail posture or mint a receipt.");
  } else if (!walletConnected) {
    setStatus("Wallet optional in Create. Connect it to save scenarios, sync to the cloud, and unlock proof actions where signing is enabled.");
  } else if (currentPage === "setup") {
    setStatus("Draft autosaves as you edit.");
  }

  // Track the last wallet-subscribe state so we only re-run connect-side-
  // effects on a real transition (disconnected → connected, or address
  // switch). The wallet module fires `_notify` twice during connect (once
  // immediately, once after balances load), which otherwise would spawn
  // parallel fetchPortfolio / hydratePolicy / syncScenarios bursts and a
  // rapid-fire re-render — the visible workspace flicker.
  let _lastWalletConnected = false;
  let _lastWalletAddress = "";

  const handleWalletState = async (state) => {
    const wasConnected = _lastWalletConnected;
    const lastAddress = _lastWalletAddress;
    _lastWalletConnected = Boolean(state.connected);
    _lastWalletAddress = state.address || "";

    if (state.connected) {
      const isTransition = !wasConnected || lastAddress !== state.address;
      if (!isTransition) {
        // Balance-update notify. Only the surfaces that care about
        // balances need a redraw — coalesced via rAF.
        scheduleRender();
        return;
      }

      _liveProtocolReadbacks = {};
      _liveProtocolRefreshState = {};

      _reloadWalletScopedState({
        fallbackToGlobal: true,
        persistFallback: true,
      });

      const routePolicyId = readRoutePolicyIdFromUrl();
      const routeRunId = readRouteRunIdFromUrl();
      let routeSetupSelection = applyRouteSetupSelection(routeRunId);
      let hydratedRoutePolicy = null;
      const routeRunSelection = routeRunId
        ? applyRouteRunSelection(routeRunId)
        : { requested: false, applied: false, missing: false };
      const routeSetupMissing = () => currentPage === "setup" && routeSetupSelection.requested && routeSetupSelection.missing;

      if (form) {
        hydrateForm(appState.draft);
        seedCreateScopeFieldState(appState.draft);
      }

      // Fetch portfolio state for Live execution
      fetchPortfolioState(state.address)
        .then((portfolio) => {
          const latestWallet = getWalletState();
          if (!latestWallet.connected || latestWallet.address !== state.address) {
            return;
          }
          _lastPortfolioState = portfolio;
          scheduleRender();
        })
        .catch(() => {});

      try {
        hydratedRoutePolicy = await hydrateCurrentPolicyFromChain({
          address: state.address,
          policyId: routePolicyId,
          adoptPolicyDraft: currentPage === "setup" && Boolean(routePolicyId),
          bindCurrent: !routePolicyId,
        });
        if (routePolicyId) {
          const policyBound = bindRoutePolicyContext(routePolicyId, {
            policy: hydratedRoutePolicy,
            adoptDraft: currentPage === "setup",
            runId: routeRunId,
          });
          if (!policyBound && (currentPage === "results" || currentPage === "live")) {
            appState.current = null;
          } else if (policyBound) {
            await ensurePolicyOnlyReadoutRun(routePolicyId);
            rehydrateSetupFormFromDraft();
          }
        }
      } catch (_) {}

      if (currentPage === "workspace") {
        refreshWorkspaceOnChainState().catch(() => {});
      }

      const routeRunBlocksFallback = routeRunSelection.requested && routeRunSelection.missing
        && (currentPage === "results" || currentPage === "live");
      const routePolicyBlocksFallback = Boolean(routePolicyId)
        && (currentPage === "results" || currentPage === "live");

      if (shouldAutoEnsureCurrentRun(currentPage, true) && !routeRunSelection.applied && !routeRunBlocksFallback && !routePolicyBlocksFallback) {
        await ensureCurrentRun();
      }

      syncRemoteSavedScenarios({ address: state.address, showStatus: false })
        .then(async () => {
          if (currentPage === "setup" && routeSetupSelection.requested && !routeSetupSelection.applied) {
            routeSetupSelection = applyRouteSetupSelection(routeRunId);
            if (routeSetupSelection.applied && form) {
              hydrateForm(appState.draft);
              seedCreateScopeFieldState(appState.draft);
            }
          }
          if (routeRunId) {
            const syncedRunSelection = applyRouteRunSelection(routeRunId);
            if (syncedRunSelection.applied) {
              await hydrateCurrentPolicyFromChain({
                address: state.address,
                policyId: appState.current?.onChainPolicy?.id || "",
              });
            }
          }
          if (routePolicyId) {
            const policyBound = bindRoutePolicyContext(routePolicyId, {
              policy: hydratedRoutePolicy,
              runId: routeRunId,
            });
            if (!policyBound && (currentPage === "results" || currentPage === "live")) {
              appState.current = null;
            } else if (policyBound) {
              await ensurePolicyOnlyReadoutRun(routePolicyId);
              rehydrateSetupFormFromDraft();
            }
          }
          scheduleRender();
        })
        .catch((err) => console.warn("[sync] pull failed:", err.message));

      renderCurrentPage();
      const networkWarning = getWalletNetworkWarning(state);
      if (routeSetupMissing()) {
        setStatus("This position link was not found in the current wallet workspace.", true);
      } else if (networkWarning) {
        setStatus(networkWarning, true);
      } else if (currentPage === "setup") {
        setStatus("Wallet connected. Draft autosaves locally and can sync to the cloud.");
      } else {
        setStatus("Wallet connected. Cloud sync and portfolio refresh are enabled.");
      }
    } else {
      if (!wasConnected) {
        return;
      }
      _lastPortfolioState = null;
      _liveProtocolReadbacks = {};
      _liveProtocolRefreshState = {};
      _reloadWalletScopedState();

      if (form) {
        hydrateForm(appState.draft);
        seedCreateScopeFieldState(appState.draft);
      }

      if (shouldAutoEnsureCurrentRun(currentPage, false) && !appState.current?.report) {
        await ensureCurrentRun();
      }

      renderCurrentPage();
      setStatus("Wallet disconnected. Local draft stays available, but saved scenarios are wallet-bound.");
    }
  };

  walletSubscribe(handleWalletState);

  const latestWallet = getWalletState();
  if (latestWallet.connected) {
    await handleWalletState(latestWallet);
  }
}

init().catch((error) => {
  dismissBootSkeleton();
  reportClientError(error, { action: "init" });
  console.error(error);
  setStatus(error instanceof Error ? error.message : "App failed to initialize.", true);
});
