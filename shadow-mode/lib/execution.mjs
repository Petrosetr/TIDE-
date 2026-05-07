/**
 * execution.mjs — Execution planning infrastructure for TIDE Live
 *
 * Provides:
 *  - SuiExecutionAdapter: executes only when a real wallet-signable transaction is attached
 *  - Protocol-specific transaction previews (Bucket, Scallop, NAVI, Suilend)
 *  - Receipt tracking and confirmation polling
 *  - Portfolio state refresh after execution
 */

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

import { getSuiNetwork, getSuiRpcUrl, getSuiRpcUrlsWithFallback, postSuiRpcWithFallback } from "./sui-network.mjs";
import { getSuiGasBudget } from "./sui-gas.mjs";

const SUI_COIN_TYPE = "0x2::sui::SUI";
const USDC_COIN_TYPE = "0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN";
const SUI_CLOCK_OBJECT_ID = "0x6";

// Known BTC wrapper coin types on Sui
const WBTC_COIN_TYPE = "0x027792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242d896881::coin::COIN";
const KAI_WBTC_COIN_TYPE = "0xaafb102dd0902f5055cadecd687fb5b71ca82ef0e0285d90afde828ec58ca96b::btc::BTC";
const KAI_LBTC_COIN_TYPE = "0x3e8e9423d80e1774a7ca128fccd8bf5f1f7753be658c5e645929037f7c819040::lbtc::LBTC";
const KAI_XBTC_COIN_TYPE = "0x876a4b7bce8aeaef60464c11f4026903e9afacab79b9b142686158aa86560b50::xbtc::XBTC";
const BTC_SYMBOL_PATTERNS = [
  ["sbwbtc", "sbwBTC"],
  ["stbtc", "stBTC"],
  ["lbtc", "LBTC"],
  ["xbtc", "xBTC"],
  ["nbtc", "nBTC"],
  ["mbtc", "mBTC"],
  ["wbtc", "wBTC"],
  ["btc", "BTC"],
];
const STABLE_SYMBOL_PATTERNS = [
  ["usdb", "USDB"],
  ["usdc", "USDC"],
  ["usdt", "USDT"],
  ["usd", "USD"],
];
const KNOWN_BTC_COIN_TYPES = new Map([
  [WBTC_COIN_TYPE.toLowerCase(), "wBTC"],
  [KAI_WBTC_COIN_TYPE.toLowerCase(), "wBTC"],
  [KAI_LBTC_COIN_TYPE.toLowerCase(), "LBTC"],
  [KAI_XBTC_COIN_TYPE.toLowerCase(), "xBTC"],
]);
const KNOWN_STABLE_COIN_TYPES = new Map([
  [USDC_COIN_TYPE.toLowerCase(), "USDC"],
]);
const DEFAULT_SWAP_SLIPPAGE_BPS = 100;
const MIN_SWAP_SLIPPAGE_BPS = 1;
const MAX_SWAP_SLIPPAGE_BPS = 300;

// Bucket Protocol
const BUCKET_PACKAGE = "0xce7ff77a83ea0cb6fd39bd8748e2ec89a3f41e8efdc3f4eb123e0ca37b184db2";
const BUCKET_PROTOCOL_OBJ = "0x9e3dab13212b27f5434416939db5dec6a319d15b89c84fd074d03ece6350d3df";
const USDB_COIN_TYPE = "0xbc3a676894871284b3ccfb2eec66f428612000e2a6e6d23f592ce8833c27c973::usdb::USDB";

// Scallop
const SCALLOP_VERSION_OBJ = "0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf";
const SCALLOP_MARKET_OBJ = "0xa757975255146dc9686aa823b7838b507f315d704f428cbadad2f4ea061939d9";

// NAVI Protocol
const NAVI_STORAGE_OBJ = "0xbb4e2f4b6205c2e2a2db47aeb4f830796ec7c005f88537ee775986639bc442fe";
const NAVI_POOL_OBJ = "0x96df0fce3c471489f4debaaa762cf960b3d97820bd1f3f025ff8190730e958c5";

// Suilend
const SUILEND_PACKAGE_ID = "0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf";
const SUILEND_MARKET_OBJ = "0x84030d26d85eaa7035084a057f2f11f701b7e2e4eda87551becbc7c97505ece1";
const SUILEND_MARKET_TYPE = `${SUILEND_PACKAGE_ID}::suilend::MAIN_POOL`;
const SUILEND_OWNER_CAP_STRUCT = `${SUILEND_PACKAGE_ID}::lending_market::ObligationOwnerCap<${SUILEND_MARKET_TYPE}>`;
const EXECUTION_PREVIEW_WARNING = "Execution preview only. This policy action is mapped to a rail, but a production-ready Sui transaction builder is not attached yet.";

function getResolvedSuiNetwork(config = globalThis.window?.TIDE_CONFIG || {}) {
  return String(getSuiNetwork(config) || "").trim().toLowerCase();
}

function assertExecutionNetworkMatch(expectedNetwork = "mainnet", label = "protocol execution builder") {
  const expected = String(expectedNetwork || "").trim().toLowerCase();
  const actual = getResolvedSuiNetwork();
  if (!expected) {
    throw new Error(`${label} is missing an expected Sui network.`);
  }
  if (actual !== expected) {
    throw new Error(`${label} is ${expected}-wired but runtime sui.network=${actual || "unknown"}.`);
  }
  return true;
}

function assertMainnetRailBuilder(label) {
  return assertExecutionNetworkMatch("mainnet", label);
}

const EXECUTION_CAPABILITIES = {
  bucket: {
    protocol: "Bucket Protocol",
    sdk: "bucket-protocol-sdk",
    level: "signable",
    signable: true,
    overflowGated: true,
    requiresCoinType: true,
    message: "Bucket adapter support is present, but Overflow proof mode keeps protocol manage-position transactions gated. Select a concrete BTC wrapper only for future audited signing paths.",
  },
  scallop: {
    protocol: "Scallop",
    sdk: "@scallop-io/sui-scallop-sdk",
    level: "signable",
    signable: true,
    overflowGated: true,
    message: "Scallop adapter support is present, but Overflow proof mode keeps protocol borrow and repay transactions gated. Existing Scallop obligations remain the source of truth.",
  },
  navi: {
    protocol: "NAVI Protocol",
    sdk: "@naviprotocol/lending",
    level: "signable",
    signable: true,
    overflowGated: true,
    message: "NAVI Protocol adapter support is present, but Overflow proof mode keeps protocol borrow and repay transactions gated. NAVI on-chain health rules remain the source of truth.",
  },
  suilend: {
    protocol: "Suilend",
    sdk: "@suilend/sdk",
    level: "signable",
    signable: true,
    overflowGated: true,
    message: "Suilend adapter support is present, but Overflow proof mode keeps protocol borrow and repay transactions gated. Suilend obligations remain the source of truth.",
  },
  kai: {
    protocol: "Kai Finance",
    sdk: "@kunalabs-io/kai",
    level: "vault-sdk",
    signable: false,
    builderAvailable: true,
    overflowGated: true,
    supportedOperations: ["vault-deposit-preview"],
    message: "Kai vault deposit builder support is bundled for read-only preview research. Current TIDE policy actions still emit borrow/repay intents, so Kai stays gated until Create/Live emits a concrete audited vault action.",
  },
  ferra: {
    protocol: "Ferra",
    sdk: "@ferra-labs/aggregator + @ferra-labs/dlmm",
    level: "swap-sdk",
    signable: false,
    builderAvailable: true,
    overflowGated: true,
    supportedOperations: ["quote", "swap-preview", "dlmm-route-preview"],
    message: "Ferra quote, swap-preview, and DLMM route-preview builders are bundled in the current package. TIDE still gates generic policy actions until Create/Live emits a concrete signed intent.",
  },
  cetusAggregator: {
    protocol: "Cetus Aggregator",
    sdk: "@cetusprotocol/aggregator-sdk",
    level: "router-sdk",
    signable: false,
    builderAvailable: true,
    overflowGated: true,
    supportedOperations: ["quote", "swap-preview", "rebalance-route-preview"],
    message: "Cetus Aggregator support is present for read-only route preview research. Overflow proof mode does not send live swap or rebalance transactions.",
  },
  alphalend: {
    protocol: "AlphaLend",
    sdk: "live-surface",
    level: "monitor-only",
    signable: false,
    message: "AlphaLend is connected as a monitored rail surface only. No signing adapter is attached yet.",
  },
  astros: {
    protocol: "Astros",
    sdk: "live-surface",
    level: "monitor-only",
    signable: false,
    message: "Astros is connected for reachability and venue pressure only. No direct signing adapter is attached yet.",
  },
  volo: {
    protocol: "Volo",
    sdk: "@cetusprotocol/aggregator-sdk",
    level: "router-routable",
    signable: false,
    builderAvailable: true,
    overflowGated: true,
    supportedOperations: ["quote", "swap-preview", "rebalance-route-preview"],
    routableVia: "cetusAggregator",
    routerProviders: ["VOLO"],
    message: "Volo is profiled through Cetus Aggregator for read-only route preview research. Direct vault deposit and withdraw flows are still monitor-only.",
  },
  haedal: {
    protocol: "Haedal",
    sdk: "@cetusprotocol/aggregator-sdk",
    level: "router-routable",
    signable: false,
    builderAvailable: true,
    overflowGated: true,
    supportedOperations: ["quote", "swap-preview", "rebalance-route-preview"],
    routableVia: "cetusAggregator",
    routerProviders: ["HAEDAL", "HAEDALPMM", "HAEDALHMMV2"],
    message: "Haedal is profiled through Cetus Aggregator for read-only route preview research. Direct vault deposit and withdraw flows are still monitor-only.",
  },
  alphafi: {
    protocol: "AlphaFi",
    sdk: "@cetusprotocol/aggregator-sdk",
    level: "router-routable",
    signable: false,
    builderAvailable: true,
    overflowGated: true,
    supportedOperations: ["quote", "swap-preview", "rebalance-route-preview"],
    routableVia: "cetusAggregator",
    routerProviders: ["ALPHAFI"],
    message: "AlphaFi is profiled through Cetus Aggregator for read-only route preview research. Direct vault deposit and withdraw flows are still monitor-only.",
  },
  lotus: {
    protocol: "Lotus",
    sdk: "live-surface",
    level: "monitor-only",
    signable: false,
    message: "Lotus is connected as a vault surface for live monitoring. No direct signing adapter is attached yet.",
  },
  metastable: {
    protocol: "Metastable",
    sdk: "@cetusprotocol/aggregator-sdk",
    level: "router-routable",
    signable: false,
    builderAvailable: true,
    overflowGated: true,
    supportedOperations: ["quote", "swap-preview", "rebalance-route-preview"],
    routableVia: "cetusAggregator",
    routerProviders: ["METASTABLE"],
    message: "Metastable is profiled through Cetus Aggregator for read-only route preview research. Direct vault deposit and withdraw flows are still monitor-only.",
  },
  native: {
    protocol: "Native",
    sdk: "bridge-surface",
    level: "monitor-only",
    signable: false,
    message: "Native is connected as a bridge surface for monitoring only. No direct signing adapter is attached yet.",
  },
  nemo: {
    protocol: "Nemo",
    sdk: "strategy-surface",
    level: "monitor-only",
    signable: false,
    message: "Nemo is connected as a strategy surface for monitoring only. No direct signing adapter is attached yet.",
  },
  typus: {
    protocol: "Typus",
    sdk: "derivatives-surface",
    level: "monitor-only",
    signable: false,
    message: "Typus is connected as a derivatives surface for monitoring only. No direct signing adapter is attached yet.",
  },
  magma: {
    protocol: "Magma",
    sdk: "@cetusprotocol/aggregator-sdk",
    level: "router-routable",
    signable: false,
    builderAvailable: true,
    overflowGated: true,
    supportedOperations: ["quote", "swap-preview", "rebalance-route-preview"],
    routableVia: "cetusAggregator",
    routerProviders: ["MAGMA"],
    message: "Magma is profiled through Cetus Aggregator for read-only route preview research. Direct router-specific signing is not attached yet.",
  },
  cetus: {
    protocol: "Cetus",
    sdk: "@cetusprotocol/aggregator-sdk",
    level: "router-routable",
    signable: false,
    builderAvailable: true,
    overflowGated: true,
    supportedOperations: ["quote", "swap-preview", "rebalance-route-preview"],
    routableVia: "cetusAggregator",
    routerProviders: ["CETUS", "CETUSDLMM"],
    message: "Cetus and Cetus DLMM routes are listed through the bundled Cetus Aggregator router profile for read-only preview research.",
  },
  deepbook: {
    protocol: "DeepBook v3",
    sdk: "@cetusprotocol/aggregator-sdk",
    level: "router-routable",
    signable: false,
    builderAvailable: true,
    overflowGated: true,
    supportedOperations: ["quote", "swap-preview", "rebalance-route-preview"],
    routableVia: "cetusAggregator",
    routerProviders: ["DEEPBOOKV3"],
    message: "DeepBook v3 routes are listed through the bundled Cetus Aggregator router profile for read-only preview research.",
  },
  kriya: {
    protocol: "Kriya",
    sdk: "@cetusprotocol/aggregator-sdk",
    level: "router-routable",
    signable: false,
    builderAvailable: true,
    overflowGated: true,
    supportedOperations: ["quote", "swap-preview", "rebalance-route-preview"],
    routableVia: "cetusAggregator",
    routerProviders: ["KRIYA", "KRIYAV3"],
    message: "Kriya v2 and v3 routes are listed through the bundled Cetus Aggregator router profile for read-only preview research.",
  },
  flowx: {
    protocol: "FlowX",
    sdk: "@cetusprotocol/aggregator-sdk",
    level: "router-routable",
    signable: false,
    builderAvailable: true,
    overflowGated: true,
    supportedOperations: ["quote", "swap-preview", "rebalance-route-preview"],
    routableVia: "cetusAggregator",
    routerProviders: ["FLOWXV2", "FLOWXV3"],
    message: "FlowX routes are listed through the bundled Cetus Aggregator router profile for read-only preview research.",
  },
  bluefin: {
    protocol: "Bluefin",
    sdk: "@cetusprotocol/aggregator-sdk",
    level: "router-routable",
    signable: false,
    builderAvailable: true,
    overflowGated: true,
    supportedOperations: ["quote", "swap-preview", "rebalance-route-preview"],
    routableVia: "cetusAggregator",
    routerProviders: ["BLUEFIN"],
    message: "Bluefin routes are listed through the bundled Cetus Aggregator router profile for read-only preview research.",
  },
  aftermath: {
    protocol: "Aftermath",
    sdk: "@cetusprotocol/aggregator-sdk",
    level: "router-routable",
    signable: false,
    builderAvailable: true,
    overflowGated: true,
    supportedOperations: ["quote", "swap-preview", "rebalance-route-preview"],
    routableVia: "cetusAggregator",
    routerProviders: ["AFTERMATH"],
    message: "Aftermath routes are listed through the bundled Cetus Aggregator router profile for read-only preview research.",
  },
  momentum: {
    protocol: "Momentum",
    sdk: "@cetusprotocol/aggregator-sdk",
    level: "router-routable",
    signable: false,
    builderAvailable: true,
    overflowGated: true,
    supportedOperations: ["quote", "swap-preview", "rebalance-route-preview"],
    routableVia: "cetusAggregator",
    routerProviders: ["MOMENTUM"],
    message: "Momentum routes are listed through the bundled Cetus Aggregator router profile for read-only preview research.",
  },
  turbos: {
    protocol: "Turbos",
    sdk: "@cetusprotocol/aggregator-sdk",
    level: "router-routable",
    signable: false,
    builderAvailable: true,
    overflowGated: true,
    supportedOperations: ["quote", "swap-preview", "rebalance-route-preview"],
    routableVia: "cetusAggregator",
    routerProviders: ["TURBOS"],
    message: "Turbos routes are listed through the bundled Cetus Aggregator router profile for read-only preview research.",
  },
  springsui: {
    protocol: "SpringSui",
    sdk: "@cetusprotocol/aggregator-sdk",
    level: "router-routable",
    signable: false,
    builderAvailable: true,
    overflowGated: true,
    supportedOperations: ["quote", "swap-preview", "rebalance-route-preview"],
    routableVia: "cetusAggregator",
    routerProviders: ["SPRINGSUI"],
    message: "SpringSui routes are listed through the bundled Cetus Aggregator router profile for read-only preview research.",
  },
  steamm: {
    protocol: "Steamm",
    sdk: "@cetusprotocol/aggregator-sdk",
    level: "router-routable",
    signable: false,
    builderAvailable: true,
    overflowGated: true,
    supportedOperations: ["quote", "swap-preview", "rebalance-route-preview"],
    routableVia: "cetusAggregator",
    routerProviders: ["STEAMM", "STEAMM_OMM", "STEAMM_OMM_V2"],
    message: "Steamm routes are listed through the bundled Cetus Aggregator router profile for read-only preview research.",
  },
  obric: {
    protocol: "Obric",
    sdk: "@cetusprotocol/aggregator-sdk",
    level: "router-routable",
    signable: false,
    builderAvailable: true,
    overflowGated: true,
    supportedOperations: ["quote", "swap-preview", "rebalance-route-preview"],
    routableVia: "cetusAggregator",
    routerProviders: ["OBRIC"],
    message: "Obric routes are listed through the bundled Cetus Aggregator router profile for read-only preview research.",
  },
  fullsail: {
    protocol: "Fullsail",
    sdk: "@cetusprotocol/aggregator-sdk",
    level: "router-routable",
    signable: false,
    builderAvailable: true,
    overflowGated: true,
    supportedOperations: ["quote", "swap-preview", "rebalance-route-preview"],
    routableVia: "cetusAggregator",
    routerProviders: ["FULLSAIL"],
    message: "Fullsail routes are listed through the bundled Cetus Aggregator router profile for read-only preview research.",
  },
};

const CETUS_ROUTER_PROVIDER_COVERAGE = Object.freeze({
  cetus: ["CETUS", "CETUSDLMM"],
  deepbook: ["DEEPBOOKV3"],
  kriya: ["KRIYA", "KRIYAV3"],
  flowx: ["FLOWXV2", "FLOWXV3"],
  bluefin: ["BLUEFIN"],
  aftermath: ["AFTERMATH"],
  ferra: ["FERRADLMM", "FERRACLMM"],
  haedal: ["HAEDAL", "HAEDALPMM", "HAEDALHMMV2"],
  volo: ["VOLO"],
  alphafi: ["ALPHAFI"],
  metastable: ["METASTABLE"],
  momentum: ["MOMENTUM"],
  magma: ["MAGMA"],
  scallop: ["SCALLOP"],
  suilend: ["SUILEND"],
  springsui: ["SPRINGSUI"],
  steamm: ["STEAMM", "STEAMM_OMM", "STEAMM_OMM_V2"],
  obric: ["OBRIC"],
  turbos: ["TURBOS"],
  fullsail: ["FULLSAIL"],
});

/* ------------------------------------------------------------------ */
/*  JSON-RPC helper                                                    */
/* ------------------------------------------------------------------ */

let _rpcId = 1000;

async function rpc(method, params) {
  const config = globalThis.window?.TIDE_CONFIG || {};
  const res = await postSuiRpcWithFallback({
    urls: getSuiRpcUrlsWithFallback(config),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++_rpcId, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "RPC error");
  return json.result;
}

let _suiRuntimePromise = null;

async function loadSuiRuntime() {
  if (!_suiRuntimePromise) {
    _suiRuntimePromise = import("../vendor/sui-runtime.mjs");
  }
  return _suiRuntimePromise;
}

/* ------------------------------------------------------------------ */
/*  Coin utilities                                                     */
/* ------------------------------------------------------------------ */

async function getCoins(address, coinType) {
  const coins = [];
  let cursor = null;
  do {
    const page = await rpc("suix_getCoins", [address, coinType, cursor, 50]);
    coins.push(...(page.data || []));
    cursor = page.nextCursor;
  } while (cursor);
  return coins;
}

async function getGasCoins(address) {
  return getCoins(address, SUI_COIN_TYPE);
}

async function getOwnedObjectsByType(address, structType) {
  const objects = [];
  let cursor = null;
  do {
    const page = await rpc("suix_getOwnedObjects", [
      address,
      {
        filter: { StructType: structType },
        options: {
          showContent: true,
          showType: true,
        },
      },
      cursor,
      50,
    ]);
    objects.push(...(page?.data || []));
    cursor = page?.nextCursor || null;
  } while (cursor);
  return objects;
}

function totalBalance(coins) {
  return coins.reduce((sum, c) => sum + BigInt(c.balance), 0n);
}

function normalizeCoinType(coinType) {
  return String(coinType || "").trim().toLowerCase();
}

function normalizeExecutionCoinType(coinType) {
  const value = String(coinType || "").trim();
  return value || "";
}

function extractObjectId(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    return (
      value.objectId ||
      value.object_id ||
      value.id ||
      value?.fields?.id?.id ||
      value?.fields?.id ||
      value?.data?.objectId ||
      ""
    );
  }
  return "";
}

function extractNestedId(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    return (
      value.id ||
      value.objectId ||
      value.bytes ||
      value?.fields?.id ||
      value?.fields?.bytes ||
      value?.fields?.id?.id ||
      ""
    );
  }
  return "";
}

function extractObligationIdFromCap(cap) {
  const fields = cap?.data?.content?.fields || cap?.content?.fields || {};
  return (
    extractNestedId(fields.obligation_id) ||
    extractNestedId(fields.obligationId) ||
    ""
  );
}

function isTransactionArgumentLike(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "$kind" in value,
  );
}

function hasSymbolPattern(coinType, patterns) {
  const normalized = normalizeCoinType(coinType);
  if (patterns === BTC_SYMBOL_PATTERNS && KNOWN_BTC_COIN_TYPES.has(normalized)) {
    return true;
  }
  if (patterns === STABLE_SYMBOL_PATTERNS && KNOWN_STABLE_COIN_TYPES.has(normalized)) {
    return true;
  }
  return patterns.some(([pattern]) => normalized.includes(pattern));
}

function inferSymbolFromCoinType(coinType, patterns, fallback) {
  const normalized = normalizeCoinType(coinType);
  if (patterns === BTC_SYMBOL_PATTERNS && KNOWN_BTC_COIN_TYPES.has(normalized)) {
    return KNOWN_BTC_COIN_TYPES.get(normalized);
  }
  if (patterns === STABLE_SYMBOL_PATTERNS && KNOWN_STABLE_COIN_TYPES.has(normalized)) {
    return KNOWN_STABLE_COIN_TYPES.get(normalized);
  }
  for (const [pattern, symbol] of patterns) {
    if (normalized.includes(pattern)) {
      return symbol;
    }
  }
  return fallback;
}

/* ------------------------------------------------------------------ */
/*  Transaction builder base                                           */
/* ------------------------------------------------------------------ */

/**
 * Builds a preview PTB descriptor as JSON.
 * This is useful for operator-facing previews, but it is not wallet-signable on its own.
 */
function makePTB() {
  return {
    version: 1,
    inputs: [],
    transactions: [],
    _inputIndex: 0,
  };
}

function addPureInput(ptb, value, type) {
  const idx = ptb._inputIndex++;
  ptb.inputs.push({ kind: "Input", index: idx, type: "pure", value, valueType: type });
  return { kind: "Input", index: idx };
}

function addObjectInput(ptb, objectId, mutable = true) {
  const idx = ptb._inputIndex++;
  ptb.inputs.push({
    kind: "Input",
    index: idx,
    type: "object",
    objectType: mutable ? "sharedObject" : "immOrOwnedObject",
    objectId,
  });
  return { kind: "Input", index: idx };
}

function addMoveCall(ptb, { target, arguments: args = [], typeArguments = [] }) {
  const idx = ptb.transactions.length;
  ptb.transactions.push({
    kind: "MoveCall",
    target,
    arguments: args,
    typeArguments,
  });
  return { kind: "Result", index: idx };
}

function addSplitCoins(ptb, coin, amounts) {
  const idx = ptb.transactions.length;
  ptb.transactions.push({
    kind: "SplitCoins",
    coin,
    amounts,
  });
  return { kind: "Result", index: idx };
}

function addMergeCoins(ptb, destination, sources) {
  const idx = ptb.transactions.length;
  ptb.transactions.push({
    kind: "MergeCoins",
    destination,
    sources,
  });
  return { kind: "Result", index: idx };
}

function addTransferObjects(ptb, objects, address) {
  ptb.transactions.push({
    kind: "TransferObjects",
    objects,
    address,
  });
}

/* ------------------------------------------------------------------ */
/*  Protocol transaction builders                                      */
/* ------------------------------------------------------------------ */

/**
 * Each builder returns { ptb, description, estimatedGas }
 * ptb is a preview descriptor until a real Transaction object is wired in.
 */

const ProtocolBuilders = {
  /* ── Bucket Protocol ──────────────────────────────────────────── */

  bucket: {
    /**
     * Borrow USDB against BTC collateral on Bucket Protocol
     */
    borrow({ amountUsd, collateralCoinType = WBTC_COIN_TYPE, address }) {
      // Bucket uses 6 decimals for USDB
      const amountRaw = BigInt(Math.floor(amountUsd * 1e6));
      const ptb = makePTB();

      const protocol = addObjectInput(ptb, BUCKET_PROTOCOL_OBJ);
      const amountInput = addPureInput(ptb, amountRaw.toString(), "u64");

      addMoveCall(ptb, {
        target: `${BUCKET_PACKAGE}::bucket::borrow`,
        arguments: [protocol, amountInput],
        typeArguments: [collateralCoinType],
      });

      return {
        ptb,
        description: `Borrow ${amountUsd.toLocaleString()} USDB from Bucket Protocol`,
        estimatedGas: 5_000_000,
        protocol: "Bucket Protocol",
        action: "Borrow",
      };
    },

    /**
     * Repay USDB debt on Bucket Protocol
     */
    repay({ amountUsd, collateralCoinType = WBTC_COIN_TYPE, address }) {
      const amountRaw = BigInt(Math.floor(amountUsd * 1e6));
      const ptb = makePTB();

      const protocol = addObjectInput(ptb, BUCKET_PROTOCOL_OBJ);
      const amountInput = addPureInput(ptb, amountRaw.toString(), "u64");

      addMoveCall(ptb, {
        target: `${BUCKET_PACKAGE}::bucket::repay`,
        arguments: [protocol, amountInput],
        typeArguments: [collateralCoinType],
      });

      return {
        ptb,
        description: `Repay ${amountUsd.toLocaleString()} USDB on Bucket Protocol`,
        estimatedGas: 4_000_000,
        protocol: "Bucket Protocol",
        action: "Repay",
      };
    },
  },

  /* ── Scallop ──────────────────────────────────────────────────── */

  scallop: {
    borrow({ amountUsd, address }) {
      const amountRaw = BigInt(Math.floor(amountUsd * 1e6));
      const ptb = makePTB();

      const version = addObjectInput(ptb, SCALLOP_VERSION_OBJ, false);
      const market = addObjectInput(ptb, SCALLOP_MARKET_OBJ);
      const amountInput = addPureInput(ptb, amountRaw.toString(), "u64");

      addMoveCall(ptb, {
        target: `scallop_protocol::borrow::borrow`,
        arguments: [version, market, amountInput],
        typeArguments: [USDC_COIN_TYPE],
      });

      return {
        ptb,
        description: `Borrow ${amountUsd.toLocaleString()} USDC from Scallop`,
        estimatedGas: 6_000_000,
        protocol: "Scallop",
        action: "Borrow",
      };
    },

    repay({ amountUsd, address }) {
      const amountRaw = BigInt(Math.floor(amountUsd * 1e6));
      const ptb = makePTB();

      const version = addObjectInput(ptb, SCALLOP_VERSION_OBJ, false);
      const market = addObjectInput(ptb, SCALLOP_MARKET_OBJ);
      const amountInput = addPureInput(ptb, amountRaw.toString(), "u64");

      addMoveCall(ptb, {
        target: `scallop_protocol::repay::repay`,
        arguments: [version, market, amountInput],
        typeArguments: [USDC_COIN_TYPE],
      });

      return {
        ptb,
        description: `Repay ${amountUsd.toLocaleString()} USDC on Scallop`,
        estimatedGas: 5_000_000,
        protocol: "Scallop",
        action: "Repay",
      };
    },
  },

  /* ── NAVI Protocol ────────────────────────────────────────────── */

  navi: {
    borrow({ amountUsd, address }) {
      const amountRaw = BigInt(Math.floor(amountUsd * 1e6));
      const ptb = makePTB();

      const storage = addObjectInput(ptb, NAVI_STORAGE_OBJ);
      const pool = addObjectInput(ptb, NAVI_POOL_OBJ);
      const amountInput = addPureInput(ptb, amountRaw.toString(), "u64");

      addMoveCall(ptb, {
        target: `navi_protocol::lending::borrow`,
        arguments: [storage, pool, amountInput],
        typeArguments: [USDC_COIN_TYPE],
      });

      return {
        ptb,
        description: `Borrow ${amountUsd.toLocaleString()} USDC from NAVI Protocol`,
        estimatedGas: 6_000_000,
        protocol: "NAVI Protocol",
        action: "Borrow",
      };
    },

    repay({ amountUsd, address }) {
      const amountRaw = BigInt(Math.floor(amountUsd * 1e6));
      const ptb = makePTB();

      const storage = addObjectInput(ptb, NAVI_STORAGE_OBJ);
      const pool = addObjectInput(ptb, NAVI_POOL_OBJ);
      const amountInput = addPureInput(ptb, amountRaw.toString(), "u64");

      addMoveCall(ptb, {
        target: `navi_protocol::lending::repay`,
        arguments: [storage, pool, amountInput],
        typeArguments: [USDC_COIN_TYPE],
      });

      return {
        ptb,
        description: `Repay ${amountUsd.toLocaleString()} USDC on NAVI Protocol`,
        estimatedGas: 5_000_000,
        protocol: "NAVI Protocol",
        action: "Repay",
      };
    },
  },

  /* ── Suilend ──────────────────────────────────────────────────── */

  suilend: {
    borrow({ amountUsd, address }) {
      const amountRaw = BigInt(Math.floor(amountUsd * 1e6));
      const ptb = makePTB();

      const market = addObjectInput(ptb, SUILEND_MARKET_OBJ);
      const amountInput = addPureInput(ptb, amountRaw.toString(), "u64");

      addMoveCall(ptb, {
        target: `suilend::lending_market::borrow`,
        arguments: [market, amountInput],
        typeArguments: [USDC_COIN_TYPE],
      });

      return {
        ptb,
        description: `Borrow ${amountUsd.toLocaleString()} USDC from Suilend`,
        estimatedGas: 7_000_000,
        protocol: "Suilend",
        action: "Borrow",
      };
    },

    repay({ amountUsd, address }) {
      const amountRaw = BigInt(Math.floor(amountUsd * 1e6));
      const ptb = makePTB();

      const market = addObjectInput(ptb, SUILEND_MARKET_OBJ);
      const amountInput = addPureInput(ptb, amountRaw.toString(), "u64");

      addMoveCall(ptb, {
        target: `suilend::lending_market::repay`,
        arguments: [market, amountInput],
        typeArguments: [USDC_COIN_TYPE],
      });

      return {
        ptb,
        description: `Repay ${amountUsd.toLocaleString()} USDC on Suilend`,
        estimatedGas: 6_000_000,
        protocol: "Suilend",
        action: "Repay",
      };
    },
  },
};

/* ------------------------------------------------------------------ */
/*  Action → Protocol mapping                                          */
/* ------------------------------------------------------------------ */

/** Map a rail name (from allocation) to its protocol builder key */
function resolveProtocolKey(railName) {
  if (!railName) return null;
  const lower = railName.toLowerCase();
  if (lower.includes("bucket")) return "bucket";
  if (lower.includes("scallop")) return "scallop";
  if (lower.includes("navi")) return "navi";
  if (lower.includes("suilend")) return "suilend";
  return null;
}

function resolveExecutionCapabilityKey(railName) {
  if (!railName) return null;
  const lower = String(railName).toLowerCase();
  if (EXECUTION_CAPABILITIES[lower]) return lower;
  if (lower.includes("bucket")) return "bucket";
  if (lower.includes("cetus")) return "cetus";
  if (lower.includes("deepbook")) return "deepbook";
  if (lower.includes("kriya")) return "kriya";
  if (lower.includes("flowx")) return "flowx";
  if (lower.includes("bluefin")) return "bluefin";
  if (lower.includes("aftermath")) return "aftermath";
  if (lower.includes("scallop")) return "scallop";
  if (lower.includes("navi")) return "navi";
  if (lower.includes("suilend")) return "suilend";
  if (lower.includes("springsui")) return "springsui";
  if (lower.includes("steamm")) return "steamm";
  if (lower.includes("obric")) return "obric";
  if (lower.includes("turbos")) return "turbos";
  if (lower.includes("fullsail")) return "fullsail";
  if (lower.includes("kai")) return "kai";
  if (lower.includes("ferra")) return "ferra";
  if (lower.includes("momentum")) return "momentum";
  if (lower.includes("alpha") && lower.includes("lend")) return "alphalend";
  if (lower.includes("astros")) return "astros";
  if (lower.includes("volo")) return "volo";
  if (lower.includes("haedal")) return "haedal";
  if (lower.includes("alphafi")) return "alphafi";
  if (lower.includes("lotus")) return "lotus";
  if (lower.includes("metastable")) return "metastable";
  if (lower.includes("native")) return "native";
  if (lower.includes("nemo")) return "nemo";
  if (lower.includes("typus")) return "typus";
  if (lower.includes("magma")) return "magma";
  return null;
}

function getProtocolExecutionCapability(railNameOrProtocolKey) {
  const key = resolveExecutionCapabilityKey(railNameOrProtocolKey);
  if (!key) return null;
  return {
    key,
    ...EXECUTION_CAPABILITIES[key],
  };
}

function isSignableTransactionLike(transaction) {
  return Boolean(transaction && typeof transaction.toJSON === "function");
}

function decorateTransactionPreview(tx) {
  const transaction = tx?.transaction;
  const signable = isSignableTransactionLike(transaction);

  return {
    ...tx,
    transaction: signable ? transaction : null,
    signable,
    warning: signable ? "" : (tx?.warning || EXECUTION_PREVIEW_WARNING),
  };
}

function toStableRaw(amountUsd) {
  return Math.max(0, Math.floor(Number(amountUsd || 0) * 1e6));
}

function getExecutableDirection(actionType) {
  switch (actionType) {
    case "BorrowForBuffer":
      return "borrow";
    case "PartialRepay":
    case "EmergencyDeRisk":
      return "repay";
    default:
      return null;
  }
}

function getProtocolExecutionSupportMessage(protocolKeyOrRailName, draft = {}) {
  const capability = getProtocolExecutionCapability(protocolKeyOrRailName);
  if (capability?.key === "bucket" && !getExecutionDraftCoinType(draft)) {
    return "Select a real BTC wrapper in Create before signing. Manual collateral works for simulation, but execution needs a concrete on-chain coin type.";
  }
  if (Array.isArray(capability?.routerProviders) && capability.routerProviders.length > 0) {
    const providerSummary = capability.routerProviders.join(", ");
    return `${capability.protocol} is listed through the bundled Cetus Aggregator router profile (${providerSummary}) for read-only route preview research. Overflow proof mode does not send live router transactions.`;
  }
  return capability?.message || EXECUTION_PREVIEW_WARNING;
}

function getExecutionDraftCoinType(draft = {}) {
  return normalizeExecutionCoinType(draft?.collateralCoinType);
}

const KAI_BTC_VAULT_KEY_BY_COIN_TYPE = new Map([
  [KAI_WBTC_COIN_TYPE.toLowerCase(), "wBTC"],
  [KAI_LBTC_COIN_TYPE.toLowerCase(), "LBTC"],
  [KAI_XBTC_COIN_TYPE.toLowerCase(), "xBTC"],
]);

function resolveKaiVaultKey(coinTypeOrSymbol) {
  const normalized = normalizeCoinType(coinTypeOrSymbol);
  if (!normalized) return "";
  if (KAI_BTC_VAULT_KEY_BY_COIN_TYPE.has(normalized)) {
    return KAI_BTC_VAULT_KEY_BY_COIN_TYPE.get(normalized);
  }
  if (normalized.includes("lbtc")) return "LBTC";
  if (normalized.includes("xbtc")) return "xBTC";
  if (normalized.includes("wbtc")) return "wBTC";
  if (normalized.endsWith("::btc::btc") || normalized === "btc") return "wBTC";
  return "";
}

function normalizePositiveAmount(value, label) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return numeric;
}

function normalizeFerraProviderKey(provider) {
  const normalized = String(provider || "CETUS").trim().toUpperCase();
  const supported = new Set(["CETUS", "FLOWX", "BLUEFIN7K", "BLUEFIN7K_LEGACY"]);
  return supported.has(normalized) ? normalized : "CETUS";
}

function normalizePositiveRawAmount(value, label) {
  if (typeof value === "bigint") {
    if (value <= 0n) {
      throw new Error(`${label} must be greater than zero.`);
    }
    return value;
  }

  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  if (/^\d+$/.test(normalized)) {
    const raw = BigInt(normalized);
    if (raw <= 0n) {
      throw new Error(`${label} must be greater than zero.`);
    }
    return raw;
  }

  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }
  return BigInt(Math.floor(numeric));
}

function normalizeCetusProviderKey(provider) {
  return String(provider || "").trim().toUpperCase().replace(/\s+/g, "");
}

function getDefaultCetusRouterProviders() {
  return Array.from(
    new Set(
      Object.values(CETUS_ROUTER_PROVIDER_COVERAGE).flat(),
    ),
  );
}

function resolveCetusProviderSelection(providers = []) {
  const requested = Array.isArray(providers)
    ? providers
    : [providers];
  const resolved = [];

  for (const provider of requested) {
    const normalized = normalizeCetusProviderKey(provider);
    if (!normalized) continue;

    if (CETUS_ROUTER_PROVIDER_COVERAGE[normalized.toLowerCase()]) {
      resolved.push(...CETUS_ROUTER_PROVIDER_COVERAGE[normalized.toLowerCase()]);
      continue;
    }

    resolved.push(normalized);
  }

  return Array.from(new Set(resolved));
}

function normalizeSlippageBps(
  slippageBps = DEFAULT_SWAP_SLIPPAGE_BPS,
  { min = MIN_SWAP_SLIPPAGE_BPS, max = MAX_SWAP_SLIPPAGE_BPS } = {},
) {
  const numeric = Number(slippageBps);

  if (!Number.isFinite(numeric)) {
    throw new Error("Swap slippage must be a finite bps value.");
  }

  const rounded = Math.round(numeric);
  if (rounded < min || rounded > max) {
    throw new Error(`Swap slippage must stay between ${min} and ${max} bps.`);
  }

  return rounded;
}

function normalizeCetusSlippage(slippageBps = DEFAULT_SWAP_SLIPPAGE_BPS) {
  return normalizeSlippageBps(slippageBps) / 10_000;
}

function getCrossProtocolRouterCoverage() {
  return Object.entries(CETUS_ROUTER_PROVIDER_COVERAGE).map(([key, providers]) => ({
    key,
    protocol: EXECUTION_CAPABILITIES[key]?.protocol || key,
    providers: [...providers],
  }));
}

async function createFerraAggregatorRuntime({ sender, provider = "CETUS", sdkOptions = {} } = {}) {
  if (!sender) {
    throw new Error("Wallet address is required to initialize the Ferra aggregator runtime.");
  }
  assertMainnetRailBuilder("Ferra aggregator builder");

  const { FerraAggProvider, initMainnetAggV2SDK } = await loadSuiRuntime();
  const providerKey = normalizeFerraProviderKey(provider);
  const resolvedProvider = FerraAggProvider?.[providerKey];

  if (!resolvedProvider || typeof initMainnetAggV2SDK !== "function") {
    throw new Error("Ferra swap execution is installed in the repo, but the current SDK is not browser-safe. Run Ferra quotes and swap PTBs through the server execution adapter instead of the front-end vendor bundle.");
  }

  // Ferra's initMainnetAggV2SDK is mainnet-wired by design. When a testnet
  // build reaches this path the SDK will not work anyway; we still honour
  // the configured RPC URL so the failure surfaces at the right layer.
  const sdk = initMainnetAggV2SDK(resolvedProvider, sender, {
    fullNodeUrl: getSuiRpcUrl(globalThis.window?.TIDE_CONFIG || {}),
    ...sdkOptions,
  });

  return { sdk, providerKey };
}

async function createCetusAggregatorRuntime({
  sender,
  providers = [],
  sdkOptions = {},
} = {}) {
  assertMainnetRailBuilder("Cetus Aggregator builder");
  const {
    CetusAggregatorClient,
    CetusAggregatorEnv,
    cetusGetAllProviders,
  } = await loadSuiRuntime();

  if (typeof CetusAggregatorClient !== "function") {
    throw new Error("Cetus Aggregator SDK is installed in the repo, but the current browser vendor bundle did not expose the router client.");
  }

  const requestedProviders = resolveCetusProviderSelection(providers);
  const fallbackProviders = typeof cetusGetAllProviders === "function"
    ? cetusGetAllProviders()
    : getDefaultCetusRouterProviders();

  const providerKeys = requestedProviders.length > 0
    ? requestedProviders
    : fallbackProviders;

  const client = new CetusAggregatorClient({
    signer: sender,
    env: CetusAggregatorEnv?.Mainnet ?? 0,
    ...sdkOptions,
  });

  return { client, providerKeys };
}

async function buildKaiVaultDepositTransaction({
  address,
  coinType,
  amount,
} = {}) {
  assertMainnetRailBuilder("Kai vault deposit builder");
  if (!address) {
    throw new Error("Wallet address is required to build a Kai vault deposit transaction.");
  }

  const vaultKey = resolveKaiVaultKey(coinType);
  if (!vaultKey) {
    throw new Error("Kai vault execution currently supports wBTC, LBTC, and xBTC wrappers only.");
  }

  const { Transaction, KaiAmount, KaiVaults } = await loadSuiRuntime();
  const vault = KaiVaults?.[vaultKey];
  if (!vault || typeof vault.depositFromWallet !== "function") {
    throw new Error(`Kai runtime loaded, but vault ${vaultKey} is not available in the current SDK package.`);
  }

  const depositAmount = KaiAmount.fromNum(
    String(normalizePositiveAmount(amount, "Kai deposit amount")),
    vault.T.decimals,
  );

  const tx = new Transaction();
  await vault.depositFromWallet(tx, address, depositAmount);

  return {
    tx: {
      transaction: tx,
      signable: true,
      warning: "",
      estimatedGas: 45_000_000,
      protocol: "Kai Finance",
      action: "VaultDeposit",
      description: `Deposit ${amount} ${vault.T.displaySymbol || vault.T.symbol} into Kai ${vaultKey} vault`,
    },
    vaultKey,
    coinType: vault.T.typeName,
  };
}

async function quoteFerraSwap({
  sender,
  provider = "CETUS",
  fromType,
  targetType,
  amountIn,
  sdkOptions = {},
} = {}) {
  const normalizedFromType = normalizeExecutionCoinType(fromType);
  const normalizedTargetType = normalizeExecutionCoinType(targetType);
  if (!normalizedFromType || !normalizedTargetType) {
    throw new Error("Ferra quote requires both fromType and targetType.");
  }

  const normalizedAmountIn = String(Math.floor(normalizePositiveAmount(amountIn, "Ferra amountIn")));
  const { sdk, providerKey } = await createFerraAggregatorRuntime({
    sender,
    provider,
    sdkOptions,
  });

  const quote = await sdk.Quoter.getBestQuotes(
    {
      coinTypeIn: normalizedFromType,
      coinTypeOut: normalizedTargetType,
      amountIn: normalizedAmountIn,
    },
    { sender },
  );

  if (!quote) {
    throw new Error(`Ferra ${providerKey} returned no route for ${normalizedFromType} -> ${normalizedTargetType}.`);
  }

  return { quote, providerKey, sdk };
}

async function buildFerraSwapTransaction({
  sender,
  provider = "CETUS",
  quote,
  fromType,
  targetType,
  amountIn,
  amountOut,
  slippageBps = 50,
  sdkOptions = {},
} = {}) {
  const normalizedFromType = normalizeExecutionCoinType(fromType);
  const normalizedTargetType = normalizeExecutionCoinType(targetType);
  if (!normalizedFromType || !normalizedTargetType) {
    throw new Error("Ferra swap requires both fromType and targetType.");
  }
  if (!quote) {
    throw new Error("Ferra swap requires a quote from quoteFerraSwap() or the Ferra Quoter.");
  }

  const normalizedAmountIn = String(Math.floor(normalizePositiveAmount(amountIn, "Ferra amountIn")));
  const normalizedAmountOut = String(amountOut || "");
  if (!normalizedAmountOut) {
    throw new Error("Ferra swap requires the quoted amountOut in smallest units.");
  }

  const normalizedSlippageBps = normalizeSlippageBps(slippageBps);
  const { sdk, providerKey } = await createFerraAggregatorRuntime({
    sender,
    provider,
    sdkOptions,
  });

  const transaction = await sdk.AggSwap.swap(
    {
      quote,
      fromType: normalizedFromType,
      targetType: normalizedTargetType,
      amountIn: normalizedAmountIn,
      amountOut: normalizedAmountOut,
    },
    normalizedSlippageBps,
  );

  return {
    tx: {
      transaction,
      signable: true,
      warning: "",
      estimatedGas: 50_000_000,
      protocol: "Ferra",
      action: "Swap",
      description: `Swap ${normalizedAmountIn} units via Ferra ${providerKey}`,
    },
    providerKey,
  };
}

async function quoteCetusAggregatorSwap({
  sender,
  fromType,
  targetType,
  amountIn,
  byAmountIn = true,
  depth = 3,
  providers = [],
  sdkOptions = {},
} = {}) {
  const normalizedFromType = normalizeExecutionCoinType(fromType);
  const normalizedTargetType = normalizeExecutionCoinType(targetType);
  if (!normalizedFromType || !normalizedTargetType) {
    throw new Error("Cetus Aggregator quote requires both fromType and targetType.");
  }

  const amountRaw = normalizePositiveRawAmount(amountIn, "Cetus Aggregator amountIn");
  const { client, providerKeys } = await createCetusAggregatorRuntime({
    sender,
    providers,
    sdkOptions,
  });

  const router = await client.findRouters({
    from: normalizedFromType,
    target: normalizedTargetType,
    amount: amountRaw,
    byAmountIn,
    depth,
    providers: providerKeys,
  });

  if (!router || router.insufficientLiquidity) {
    throw new Error(`Cetus Aggregator found no route for ${normalizedFromType} -> ${normalizedTargetType} across ${providerKeys.join(", ")}.`);
  }

  return { router, providers: providerKeys, client };
}

async function buildCetusAggregatorSwapTransaction({
  sender,
  quote,
  fromType,
  targetType,
  amountIn,
  slippageBps = 100,
  providers = [],
  sdkOptions = {},
} = {}) {
  if (!sender) {
    throw new Error("Wallet address is required to build a Cetus Aggregator swap transaction.");
  }

  const normalizedFromType = normalizeExecutionCoinType(fromType);
  const normalizedTargetType = normalizeExecutionCoinType(targetType);
  if (!normalizedFromType || !normalizedTargetType) {
    throw new Error("Cetus Aggregator swap requires both fromType and targetType.");
  }

  const amountRaw = normalizePositiveRawAmount(amountIn, "Cetus Aggregator amountIn");
  const resolvedQuote = quote || (await quoteCetusAggregatorSwap({
    sender,
    fromType: normalizedFromType,
    targetType: normalizedTargetType,
    amountIn: amountRaw,
    providers,
    sdkOptions,
  })).router;

  const {
    Transaction,
    cetusBuildInputCoin,
  } = await loadSuiRuntime();
  const { client, providerKeys } = await createCetusAggregatorRuntime({
    sender,
    providers,
    sdkOptions,
  });

  if (typeof cetusBuildInputCoin !== "function") {
    throw new Error("Cetus Aggregator runtime loaded, but the input-coin helper is unavailable in the browser vendor bundle.");
  }

  const tx = new Transaction();
  tx.setSender(sender);
  tx.setGasBudget(getSuiGasBudget("LIVE_CETUS_SWAP"));

  const sourceCoins = await getCoins(sender, normalizedFromType);
  const { targetCoin } = cetusBuildInputCoin(
    tx,
    sourceCoins,
    amountRaw,
    normalizedFromType,
  );

  const outputCoin = await client.routerSwap({
    router: resolvedQuote,
    inputCoin: targetCoin,
    slippage: normalizeCetusSlippage(slippageBps),
    txb: tx,
  });

  if (isTransactionArgumentLike(outputCoin)) {
    tx.transferObjects([outputCoin], tx.pure.address(sender));
  }

  return {
    tx: {
      transaction: tx,
      signable: true,
      warning: "",
      estimatedGas: 60_000_000,
      protocol: "Cetus Aggregator",
      action: "Swap",
      description: `Swap ${amountRaw.toString()} units ${inferSymbolFromCoinType(normalizedFromType, BTC_SYMBOL_PATTERNS, "coin")} -> ${inferSymbolFromCoinType(normalizedTargetType, STABLE_SYMBOL_PATTERNS, "asset")} via ${providerKeys.join(", ")}`,
    },
    providers: providerKeys,
  };
}

async function fetchSuilendReserveIndex(coinType = USDC_COIN_TYPE) {
  const result = await rpc("sui_getObject", [
    SUILEND_MARKET_OBJ,
    { showContent: true },
  ]);
  const reserves = result?.data?.content?.fields?.reserves || [];
  const normalizedTarget = normalizeCoinType(coinType);
  for (let index = 0; index < reserves.length; index += 1) {
    const reserveCoinType = String(
      reserves[index]?.fields?.coin_type?.fields?.name ||
      reserves[index]?.fields?.coin_type ||
      ""
    );
    if (normalizeCoinType(reserveCoinType) === normalizedTarget) {
      return index;
    }
  }
  throw new Error("Suilend USDC reserve was not found in the main market object.");
}

async function findSuilendObligationOwnerCap(address) {
  const caps = await getOwnedObjectsByType(address, SUILEND_OWNER_CAP_STRUCT);
  const cap = caps.find((entry) => extractObjectId(entry?.data || entry));
  if (!cap) {
    throw new Error("No Suilend obligation owner-cap found for this wallet. Open a Suilend position first, then return to Live.");
  }

  const ownerCapId = extractObjectId(cap?.data || cap);
  const obligationId = extractObligationIdFromCap(cap);
  if (!ownerCapId || !obligationId) {
    throw new Error("Suilend obligation owner-cap was found, but its obligation ID could not be resolved.");
  }

  return { ownerCapId, obligationId };
}

async function selectCoinForAmount(address, coinType, amountRaw) {
  const coins = await getCoins(address, coinType);
  const selected = [];
  let total = 0n;

  for (const coin of coins) {
    selected.push(coin);
    total += BigInt(coin.balance || "0");
    if (total >= amountRaw) {
      return selected;
    }
  }

  const symbol = inferSymbolFromCoinType(coinType, STABLE_SYMBOL_PATTERNS, "stable");
  throw new Error(`No ${symbol} balance large enough for repay. Deposit stable liquidity into the connected wallet first.`);
}

async function buildScallopManagePositionTransaction(action, address) {
  const direction = getExecutableDirection(action?.type);
  if (!direction) {
    return {
      error: `Action ${action?.type || "unknown"} is not executable on-chain.`,
    };
  }

  const amountRaw = toStableRaw(action?.amountUsd);
  if (amountRaw <= 0) {
    return {
      error: "Execution amount must be greater than zero before signing.",
    };
  }
  assertMainnetRailBuilder("Scallop manage-position builder");

  const { Transaction, ScallopBuilder } = await loadSuiRuntime();
  const builder = new ScallopBuilder({ networkType: "mainnet" });
  await builder.init();

  const tx = new Transaction();
  tx.setSender(address);
  tx.setGasBudget(getSuiGasBudget("LIVE_SCALLOP_MANAGE"));

  const txBlock = builder.createTxBlock(tx);
  txBlock.setSender(address);

  const shouldRestakeObligation = Boolean(builder.constants?.whitelist?.lending?.has("usdc"));
  if (shouldRestakeObligation) {
    await txBlock.unstakeObligationQuick();
  }

  if (direction === "borrow") {
    const borrowedCoin = await txBlock.borrowQuick(amountRaw, "usdc");
    txBlock.transferObjects([borrowedCoin], address);
  } else {
    await txBlock.repayQuick(amountRaw, "usdc");
  }

  if (shouldRestakeObligation) {
    await txBlock.stakeObligationWithVeScaQuick();
  }

  return {
    tx: {
      transaction: txBlock.txBlock,
      signable: true,
      warning: "",
      estimatedGas: 50_000_000,
      protocol: "Scallop",
      action: direction === "borrow" ? "Borrow" : "Repay",
      description: direction === "borrow"
        ? `Borrow ${action.amountUsd.toLocaleString()} USDC from Scallop`
        : `Repay ${action.amountUsd.toLocaleString()} USDC on Scallop`,
    },
  };
}

async function buildNaviManagePositionTransaction(action, address) {
  const direction = getExecutableDirection(action?.type);
  if (!direction) {
    return {
      error: `Action ${action?.type || "unknown"} is not executable on-chain.`,
    };
  }

  const amountRaw = toStableRaw(action?.amountUsd);
  if (amountRaw <= 0) {
    return {
      error: "Execution amount must be greater than zero before signing.",
    };
  }
  assertMainnetRailBuilder("NAVI manage-position builder");

  const {
    Transaction,
    naviBorrowCoinPTB,
    naviRepayCoinPTB,
  } = await loadSuiRuntime();

  const tx = new Transaction();
  tx.setSender(address);
  tx.setGasBudget(getSuiGasBudget("LIVE_NAVI_MANAGE"));

  if (direction === "borrow") {
    const borrowedCoin = await naviBorrowCoinPTB(tx, USDC_COIN_TYPE, amountRaw, {
      env: "prod",
      market: "main",
    });
    if (isTransactionArgumentLike(borrowedCoin)) {
      tx.transferObjects([borrowedCoin], tx.pure.address(address));
    }
  } else {
    const repayCoins = await selectCoinForAmount(address, USDC_COIN_TYPE, BigInt(amountRaw));
    const primaryCoin = tx.object(repayCoins[0].coinObjectId);
    if (repayCoins.length > 1) {
      tx.mergeCoins(
        primaryCoin,
        repayCoins.slice(1).map((coin) => tx.object(coin.coinObjectId)),
      );
    }
    const [repayCoin] = tx.splitCoins(primaryCoin, [tx.pure.u64(BigInt(amountRaw))]);
    const leftover = await naviRepayCoinPTB(tx, USDC_COIN_TYPE, repayCoin, {
      amount: amountRaw,
      env: "prod",
      market: "main",
    });
    if (isTransactionArgumentLike(leftover)) {
      tx.transferObjects([leftover], tx.pure.address(address));
    }
  }

  return {
    tx: {
      transaction: tx,
      signable: true,
      warning: "",
      estimatedGas: 45_000_000,
      protocol: "NAVI Protocol",
      action: direction === "borrow" ? "Borrow" : "Repay",
      description: direction === "borrow"
        ? `Borrow ${action.amountUsd.toLocaleString()} USDC from NAVI Protocol`
        : `Repay ${action.amountUsd.toLocaleString()} USDC on NAVI Protocol`,
    },
  };
}

function canBuildSignableTransaction(action, railName, draft = {}) {
  const direction = getExecutableDirection(action?.type);
  const capability = getProtocolExecutionCapability(railName);

  if (!direction || !capability) {
    return false;
  }

  if (!capability.signable || capability.overflowGated) {
    return false;
  }

  if (capability.requiresCoinType) {
    return Boolean(getExecutionDraftCoinType(draft));
  }

  return true;
}

async function buildBucketManagePositionTransaction(action, address, draft = {}) {
  const collateralCoinType = getExecutionDraftCoinType(draft);
  if (!collateralCoinType) {
    return {
      error: getProtocolExecutionSupportMessage("bucket"),
    };
  }

  const direction = getExecutableDirection(action?.type);
  if (!direction) {
    return {
      error: `Action ${action?.type || "unknown"} is not executable on-chain.`,
    };
  }

  const amountRaw = toStableRaw(action?.amountUsd);
  if (amountRaw <= 0) {
    return {
      error: "Execution amount must be greater than zero before signing.",
    };
  }
  assertMainnetRailBuilder("Bucket manage-position builder");

  const { Transaction, BucketClient } = await loadSuiRuntime();
  const tx = new Transaction();
  tx.setSender(address);
  tx.setGasBudget(getSuiGasBudget("LIVE_BUCKET_MANAGE"));

  const client = new BucketClient({ network: "mainnet" });

  if (direction === "borrow") {
    const results = await client.buildManagePositionTransaction(tx, {
      coinType: collateralCoinType,
      borrowAmount: amountRaw,
    });
    const borrowedStableCoin = Array.isArray(results) ? results[1] : null;
    if (borrowedStableCoin) {
      tx.transferObjects([borrowedStableCoin], tx.pure.address(address));
    }
  } else {
    await client.buildManagePositionTransaction(tx, {
      coinType: collateralCoinType,
      repayCoinOrAmount: amountRaw,
    });
  }

  return {
    tx: {
      transaction: tx,
      signable: true,
      warning: "",
      estimatedGas: 30_000_000,
      protocol: "Bucket Protocol",
      action: direction === "borrow" ? "Borrow" : "Repay",
      description: direction === "borrow"
        ? `Borrow ${action.amountUsd.toLocaleString()} USDB from Bucket Protocol`
        : `Repay ${action.amountUsd.toLocaleString()} USDB on Bucket Protocol`,
    },
  };
}

async function buildSuilendManagePositionTransaction(action, address) {
  const direction = getExecutableDirection(action?.type);
  if (!direction) {
    return {
      error: `Action ${action?.type || "unknown"} is not executable on-chain.`,
    };
  }

  const amountRaw = BigInt(toStableRaw(action?.amountUsd));
  if (amountRaw <= 0n) {
    return {
      error: "Execution amount must be greater than zero before signing.",
    };
  }
  assertMainnetRailBuilder("Suilend manage-position builder");

  const reserveArrayIndex = await fetchSuilendReserveIndex(USDC_COIN_TYPE);
  const { ownerCapId, obligationId } = await findSuilendObligationOwnerCap(address);
  const {
    Transaction,
    suilendBorrowRequest,
    suilendFulfillLiquidityRequest,
    suilendRepay,
  } = await loadSuiRuntime();

  const tx = new Transaction();
  tx.setSender(address);
  tx.setGasBudget(getSuiGasBudget("LIVE_SUILEND_MANAGE"));

  if (direction === "borrow") {
    const liquidityRequest = suilendBorrowRequest(
      tx,
      [SUILEND_MARKET_TYPE, USDC_COIN_TYPE],
      {
        lendingMarket: tx.object(SUILEND_MARKET_OBJ),
        reserveArrayIndex: BigInt(reserveArrayIndex),
        obligationOwnerCap: tx.object(ownerCapId),
        clock: tx.object(SUI_CLOCK_OBJECT_ID),
        amount: amountRaw,
      },
    );
    const borrowedCoin = suilendFulfillLiquidityRequest(
      tx,
      [SUILEND_MARKET_TYPE, USDC_COIN_TYPE],
      {
        lendingMarket: tx.object(SUILEND_MARKET_OBJ),
        reserveArrayIndex: BigInt(reserveArrayIndex),
        liquidityRequest,
      },
    );
    tx.transferObjects([borrowedCoin], tx.pure.address(address));
  } else {
    const repayCoins = await selectCoinForAmount(address, USDC_COIN_TYPE, amountRaw);
    const primaryCoin = tx.object(repayCoins[0].coinObjectId);
    if (repayCoins.length > 1) {
      tx.mergeCoins(
        primaryCoin,
        repayCoins.slice(1).map((coin) => tx.object(coin.coinObjectId)),
      );
    }
    const [repayCoin] = tx.splitCoins(primaryCoin, [tx.pure.u64(amountRaw)]);
    suilendRepay(
      tx,
      [SUILEND_MARKET_TYPE, USDC_COIN_TYPE],
      {
        lendingMarket: tx.object(SUILEND_MARKET_OBJ),
        reserveArrayIndex: BigInt(reserveArrayIndex),
        obligationId,
        clock: tx.object(SUI_CLOCK_OBJECT_ID),
        maxRepayCoins: repayCoin,
      },
    );
  }

  return {
    tx: {
      transaction: tx,
      signable: true,
      warning: "",
      estimatedGas: 40_000_000,
      protocol: "Suilend",
      action: direction === "borrow" ? "Borrow" : "Repay",
      description: direction === "borrow"
        ? `Borrow ${action.amountUsd.toLocaleString()} USDC from Suilend`
        : `Repay ${action.amountUsd.toLocaleString()} USDC on Suilend`,
    },
  };
}

async function buildSignableTransactionForAction(action, railName, address, draft = {}) {
  const capability = getProtocolExecutionCapability(railName);
  if (!capability) {
    return { error: `No execution adapter for rail: ${railName || "unknown"}` };
  }

  const direction = getExecutableDirection(action?.type);
  if (!direction) {
    return buildTransactionForAction(action, railName, address);
  }

  if (!capability.signable || capability.overflowGated) {
    const preview = buildTransactionForAction(action, railName, address);
    if (preview?.tx) {
      return {
        ...preview,
        tx: {
          ...preview.tx,
          transaction: null,
          signable: false,
          warning: getProtocolExecutionSupportMessage(railName, draft),
        },
      };
    }
    return preview;
  }

  try {
    if (capability.key === "bucket") {
      return await buildBucketManagePositionTransaction(action, address, draft);
    }
    if (capability.key === "scallop") {
      return await buildScallopManagePositionTransaction(action, address);
    }
    if (capability.key === "navi") {
      return await buildNaviManagePositionTransaction(action, address);
    }
    if (capability.key === "suilend") {
      return await buildSuilendManagePositionTransaction(action, address);
    }
    return {
      error: getProtocolExecutionSupportMessage(railName, draft),
    };
  } catch (error) {
    return {
      error: error instanceof Error
        ? error.message
        : `Could not build the live ${capability.protocol} transaction.`,
    };
  }
}

/** Map an engine action to a protocol transaction builder call */
function buildTransactionForAction(action, railName, address) {
  const protocolKey = resolveProtocolKey(railName);
  const capability = getProtocolExecutionCapability(railName);
  if (!protocolKey) {
    if (capability) {
      const direction = getExecutableDirection(action?.type);
      if (!direction) {
        return { skip: true, reason: "No on-chain action needed — position is within policy band." };
      }
      return {
        tx: decorateTransactionPreview({
          transaction: null,
          signable: false,
          warning: getProtocolExecutionSupportMessage(railName),
          estimatedGas: 0,
          protocol: capability.protocol,
          action: direction === "borrow" ? "Borrow" : "Repay",
          description: `${capability.protocol} is attached in ${capability.level} mode`,
        }),
      };
    }
    return { error: `No execution adapter for rail: ${railName || "unknown"}` };
  }

  const builder = ProtocolBuilders[protocolKey];
  if (!builder) {
    return { error: `Builder not found for protocol: ${protocolKey}` };
  }

  const params = { amountUsd: action.amountUsd || 0, address };

  switch (action.type) {
    case "BorrowForBuffer":
    case "EmergencyDeRisk":
      // EmergencyDeRisk repays debt aggressively
      if (action.type === "EmergencyDeRisk") {
        return { tx: decorateTransactionPreview(builder.repay(params)) };
      }
      return { tx: decorateTransactionPreview(builder.borrow(params)) };

    case "PartialRepay":
      return { tx: decorateTransactionPreview(builder.repay(params)) };

    case "Hold":
      return { skip: true, reason: "No on-chain action needed — position is within policy band." };

    case "BuildBuffer":
      return { skip: true, reason: "Buffer building mode — no fresh borrowing in current regime." };

    case "ReducePayout":
    case "PausePayout":
      return { skip: true, reason: "Payout adjustment — off-chain policy change only." };

    case "RotateVenue":
      return { error: "Venue rotation requires manual orchestration across multiple protocols." };

    default:
      return { error: `Unknown action type: ${action.type}` };
  }
}

/* ------------------------------------------------------------------ */
/*  Execution adapter for TideEngine                                   */
/* ------------------------------------------------------------------ */

export class SuiExecutionAdapter {
  #signAndExecute;
  #address;
  #railName;

  /**
   * @param {Function} signAndExecute — from wallet.js
   * @param {string} address — connected wallet address
   * @param {string} railName — primary rail name for protocol resolution
   */
  constructor(signAndExecute, address, railName) {
    this.#signAndExecute = signAndExecute;
    this.#address = address;
    this.#railName = railName;
  }

  async execute(action, _input) {
    const result = await buildSignableTransactionForAction(
      action,
      this.#railName,
      this.#address,
      _input?.draft || _input || {},
    );

    if (result.skip) {
      return {
        ok: true,
        action,
        txId: null,
        skipped: true,
        reason: result.reason,
      };
    }

    if (result.error) {
      return {
        ok: false,
        action,
        txId: null,
        error: result.error,
      };
    }

    const { tx } = result;

    try {
      if (!tx.signable || !isSignableTransactionLike(tx.transaction)) {
        return {
          ok: false,
          action,
          txId: null,
          previewOnly: true,
          error: tx.warning || EXECUTION_PREVIEW_WARNING,
          protocol: tx.protocol,
          description: tx.description,
        };
      }

      const receipt = await this.#signAndExecute(tx.transaction);
      return {
        ok: true,
        action,
        txId: receipt.digest,
        receipt,
        protocol: tx.protocol,
        description: tx.description,
      };
    } catch (err) {
      return {
        ok: false,
        action,
        txId: null,
        error: err.message || "Transaction signing failed",
        protocol: tx.protocol,
        description: tx.description,
      };
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Transaction history                                                */
/* ------------------------------------------------------------------ */

const STORAGE_TX_HISTORY_KEY = "tide.live.tx-history.v1";

export function loadTxHistory(address) {
  if (!address) return [];
  try {
    const raw = localStorage.getItem(`${STORAGE_TX_HISTORY_KEY}:${address}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveTxReceipt(address, entry) {
  if (!address) return;
  try {
    const history = loadTxHistory(address);
    history.unshift({
      ...entry,
      policyId: typeof entry?.policyId === "string" ? entry.policyId.trim() : "",
      sourceScenarioId: typeof entry?.sourceScenarioId === "string" ? entry.sourceScenarioId.trim() : "",
      receiptId: typeof entry?.receiptId === "string" ? entry.receiptId.trim() : "",
      selectedRail: typeof entry?.selectedRail === "string" ? entry.selectedRail.trim() : "",
      timestamp: new Date().toISOString(),
    });
    // Keep last 100 entries
    if (history.length > 100) history.length = 100;
    localStorage.setItem(`${STORAGE_TX_HISTORY_KEY}:${address}`, JSON.stringify(history));
  } catch {}
}

/* ------------------------------------------------------------------ */
/*  Portfolio refresh                                                   */
/* ------------------------------------------------------------------ */

export async function fetchPortfolioState(address) {
  if (!address) return null;

  try {
    const allBalances = await rpc("suix_getAllBalances", [address]);

    const btcBalances = allBalances.filter((b) => hasSymbolPattern(b.coinType, BTC_SYMBOL_PATTERNS));
    const stableBalances = allBalances.filter((b) => hasSymbolPattern(b.coinType, STABLE_SYMBOL_PATTERNS));

    const totalBtcRaw = btcBalances.reduce((s, b) => s + BigInt(b.totalBalance || "0"), 0n);
    const totalStableRaw = stableBalances.reduce((s, b) => s + BigInt(b.totalBalance || "0"), 0n);

    return {
      address,
      btcBalances: btcBalances.map((b) => ({
        coinType: b.coinType,
        symbol: inferSymbolFromCoinType(b.coinType, BTC_SYMBOL_PATTERNS, "BTC"),
        raw: b.totalBalance,
        display: formatUnits(b.totalBalance, 8),
      })),
      stableBalances: stableBalances.map((b) => ({
        coinType: b.coinType,
        symbol: inferSymbolFromCoinType(b.coinType, STABLE_SYMBOL_PATTERNS, "USD"),
        raw: b.totalBalance,
        display: formatUnits(b.totalBalance, 6),
      })),
      totalBtcDisplay: formatUnits(totalBtcRaw.toString(), 8),
      totalStableDisplay: formatUnits(totalStableRaw.toString(), 6),
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.warn("[execution] portfolio fetch failed:", err.message);
    return null;
  }
}

function formatUnits(raw, decimals) {
  const n = BigInt(raw || "0");
  const divisor = BigInt(10 ** decimals);
  const whole = n / divisor;
  const frac = n % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}

/* ------------------------------------------------------------------ */
/*  Transaction confirmation polling                                   */
/* ------------------------------------------------------------------ */

export async function waitForTransaction(digest, { maxAttempts = 20, intervalMs = 1500 } = {}) {
  let lastResult = null;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const result = await rpc("sui_getTransactionBlock", [
        digest,
        { showEffects: true, showEvents: true, showObjectChanges: true },
      ]);
      lastResult = result || null;

      if (result?.effects?.status?.status === "success") {
        return { confirmed: true, result };
      }
      if (result?.effects?.status?.status === "failure") {
        return {
          confirmed: false,
          error: result.effects.status.error || "Transaction failed on-chain",
          result,
        };
      }
    } catch {
      // Not found yet, keep polling
    }

    if (i < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  return {
    confirmed: false,
    error: "Transaction confirmation timed out",
    result: lastResult,
  };
}

/* ------------------------------------------------------------------ */
/*  Exports                                                            */
/* ------------------------------------------------------------------ */

export {
  getCrossProtocolRouterCoverage,
  ProtocolBuilders,
  buildCetusAggregatorSwapTransaction,
  buildFerraSwapTransaction,
  buildKaiVaultDepositTransaction,
  buildTransactionForAction,
  buildSignableTransactionForAction,
  canBuildSignableTransaction,
  findSuilendObligationOwnerCap,
  assertExecutionNetworkMatch,
  getResolvedSuiNetwork,
  getProtocolExecutionCapability,
  getProtocolExecutionSupportMessage,
  isSignableTransactionLike,
  normalizeSlippageBps,
  quoteCetusAggregatorSwap,
  quoteFerraSwap,
  resolveProtocolKey,
  rpc as executionRpc,
};
