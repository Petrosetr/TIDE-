const TIDE_CONFIG_INPUT = window.TIDE_CONFIG || {};
const TIDE_DEFAULT_OPS_BASE_URL = typeof TIDE_CONFIG_INPUT.apiBaseUrl === "string"
  ? TIDE_CONFIG_INPUT.apiBaseUrl.trim().replace(/\/+$/, "")
  : "";
const TIDE_INPUT_LIVE_PACK = TIDE_CONFIG_INPUT.liveRailPack || {};
const TIDE_INPUT_VERIFY_KEY =
  typeof TIDE_INPUT_LIVE_PACK.verifyKey === "string" ? TIDE_INPUT_LIVE_PACK.verifyKey.trim() : "";
const TIDE_INPUT_EXECUTION_PROOF = TIDE_CONFIG_INPUT.executionProof || {};
const TIDE_INPUT_POLICY_REGISTRY = TIDE_CONFIG_INPUT.policyRegistry || {};
const TIDE_INPUT_SUI_NETWORK = String(TIDE_CONFIG_INPUT.sui?.network || "").trim().toLowerCase();
const TIDE_INPUT_TESTNET_SIGNING_CONFIGURED =
  TIDE_INPUT_SUI_NETWORK === "testnet" &&
  TIDE_INPUT_EXECUTION_PROOF.allowSigning === true &&
  Boolean(TIDE_INPUT_POLICY_REGISTRY.packageId) &&
  Boolean(TIDE_INPUT_POLICY_REGISTRY.railAllowlistId);

window.TIDE_CONFIG = {
  ...(window.TIDE_CONFIG || {}),
  siteName: "TIDE",
  landingUrl: (window.TIDE_CONFIG && window.TIDE_CONFIG.landingUrl) || "../",
  workspaceUrl: (window.TIDE_CONFIG && window.TIDE_CONFIG.workspaceUrl) || "./",
  apiBaseUrl: (window.TIDE_CONFIG && window.TIDE_CONFIG.apiBaseUrl) || TIDE_DEFAULT_OPS_BASE_URL,
  telemetry: {
    plausibleDomain:
      (window.TIDE_CONFIG &&
        window.TIDE_CONFIG.telemetry &&
        window.TIDE_CONFIG.telemetry.plausibleDomain) ||
      "",
    plausibleScriptUrl:
      (window.TIDE_CONFIG &&
        window.TIDE_CONFIG.telemetry &&
        window.TIDE_CONFIG.telemetry.plausibleScriptUrl) ||
      "https://plausible.io/js/script.js",
    beaconUrl:
      (window.TIDE_CONFIG &&
        window.TIDE_CONFIG.telemetry &&
        window.TIDE_CONFIG.telemetry.beaconUrl) ||
      (TIDE_DEFAULT_OPS_BASE_URL ? `${TIDE_DEFAULT_OPS_BASE_URL}/v1/track` : ""),
    errorBeaconUrl:
      (window.TIDE_CONFIG &&
        window.TIDE_CONFIG.telemetry &&
        window.TIDE_CONFIG.telemetry.errorBeaconUrl) ||
      (TIDE_DEFAULT_OPS_BASE_URL ? `${TIDE_DEFAULT_OPS_BASE_URL}/v1/error` : ""),
  },
  errorTracking: {
    beaconUrl:
      (window.TIDE_CONFIG &&
        window.TIDE_CONFIG.errorTracking &&
        window.TIDE_CONFIG.errorTracking.beaconUrl) ||
      (TIDE_DEFAULT_OPS_BASE_URL ? `${TIDE_DEFAULT_OPS_BASE_URL}/v1/error` : ""),
  },
  liveRailPack: {
    url:
      (window.TIDE_CONFIG &&
        window.TIDE_CONFIG.liveRailPack &&
        window.TIDE_CONFIG.liveRailPack.url) ||
      (TIDE_DEFAULT_OPS_BASE_URL ? `${TIDE_DEFAULT_OPS_BASE_URL}/v1/live-rail-pack` : "/live-rail-pack.json"),
    // autoLoad is coerced to false when the pack URL is remote but no
    // verifyKey is set. Auto-loading an unsigned remote pack would silently
    // drive Live controls from an unverified source — fail closed instead.
    autoLoad: (() => {
      const explicit =
        window.TIDE_CONFIG &&
        window.TIDE_CONFIG.liveRailPack &&
        window.TIDE_CONFIG.liveRailPack.autoLoad !== undefined
          ? window.TIDE_CONFIG.liveRailPack.autoLoad === true
          : !TIDE_DEFAULT_OPS_BASE_URL || Boolean(TIDE_INPUT_VERIFY_KEY);
      if (explicit && TIDE_DEFAULT_OPS_BASE_URL && !TIDE_INPUT_VERIFY_KEY) {
        return false;
      }
      return explicit;
    })(),
    preferRemote:
      window.TIDE_CONFIG &&
      window.TIDE_CONFIG.liveRailPack &&
      window.TIDE_CONFIG.liveRailPack.preferRemote !== undefined
        ? window.TIDE_CONFIG.liveRailPack.preferRemote === true
        : Boolean(TIDE_DEFAULT_OPS_BASE_URL && TIDE_INPUT_VERIFY_KEY),
    persist:
      window.TIDE_CONFIG &&
      window.TIDE_CONFIG.liveRailPack &&
      window.TIDE_CONFIG.liveRailPack.persist !== undefined
        ? window.TIDE_CONFIG.liveRailPack.persist
        : true,
    seedMarket:
      (window.TIDE_CONFIG &&
        window.TIDE_CONFIG.liveRailPack &&
        window.TIDE_CONFIG.liveRailPack.seedMarket) ||
      null,
    // Ed25519 public key (base64 raw, 32 bytes) used to verify the
    // x-tide-signature header served with remote /v1/live-rail-pack and
    // /v1/market-forecast responses. If set, any remote pack without a
    // valid signature is rejected before it touches app state.
    verifyKey:
      (window.TIDE_CONFIG &&
        window.TIDE_CONFIG.liveRailPack &&
        window.TIDE_CONFIG.liveRailPack.verifyKey) ||
      "",
    // Opt-in escape hatch for dev hosts without a signing backend — lets
    // /v1/market-forecast responses pass without a signature. Production
    // must keep this false so the forecast trust boundary stays intact.
    allowUnsignedForecast:
      window.TIDE_CONFIG &&
      window.TIDE_CONFIG.liveRailPack &&
      window.TIDE_CONFIG.liveRailPack.allowUnsignedForecast === true,
  },
  // When true, supplemental surfaces flagged `experimental: true` in
  // LIVE_COLLECTOR_RAILS render in the UI. Default false so the public
  // product surface advertises only the four frozen BTC allocators.
  showExperimentalRails:
    window.TIDE_CONFIG && window.TIDE_CONFIG.showExperimentalRails === true,
  // Fail-closed: Live/testnet proof controls are enabled only when the
  // operator explicitly opts in and either remote rail packs are signature
  // verified or a local testnet signing package is fully pinned.
  liveEnabled:
    Boolean(window.TIDE_CONFIG && window.TIDE_CONFIG.liveEnabled === true) &&
    (Boolean(TIDE_INPUT_VERIFY_KEY) || TIDE_INPUT_TESTNET_SIGNING_CONFIGURED),
  policyRegistry: {
    packageId:
      (window.TIDE_CONFIG &&
        window.TIDE_CONFIG.policyRegistry &&
        window.TIDE_CONFIG.policyRegistry.packageId) ||
      "",
    module:
      (window.TIDE_CONFIG &&
        window.TIDE_CONFIG.policyRegistry &&
        window.TIDE_CONFIG.policyRegistry.module) ||
      "policy_registry",
    clockObjectId:
      (window.TIDE_CONFIG &&
        window.TIDE_CONFIG.policyRegistry &&
        window.TIDE_CONFIG.policyRegistry.clockObjectId) ||
      "0x6",
    railAllowlistId:
      (window.TIDE_CONFIG &&
        window.TIDE_CONFIG.policyRegistry &&
        window.TIDE_CONFIG.policyRegistry.railAllowlistId) ||
      "",
    adminCapId:
      (window.TIDE_CONFIG &&
        window.TIDE_CONFIG.policyRegistry &&
        window.TIDE_CONFIG.policyRegistry.adminCapId) ||
      "",
  },
  executionReceipts: {
    module:
      (window.TIDE_CONFIG &&
        window.TIDE_CONFIG.executionReceipts &&
        window.TIDE_CONFIG.executionReceipts.module) ||
      "execution_receipts",
  },
  execution: {
    // Wallet-layer allowlist of fully-qualified Move targets that may be
    // signed by the connected wallet. Empty list means "fail closed" — the
    // wallet refuses to sign any MoveCall. Populated by the build via
    // scripts/write-runtime-config.mjs from TIDE_POLICY_PACKAGE_ID.
    allowedMoveTargets: (() => {
      const raw =
        window.TIDE_CONFIG &&
        window.TIDE_CONFIG.execution &&
        window.TIDE_CONFIG.execution.allowedMoveTargets;
      return Array.isArray(raw)
        ? raw.filter((t) => typeof t === "string" && t.trim()).map((t) => t.trim())
        : [];
    })(),
  },
  executionProof: {
    enabled:
      (window.TIDE_CONFIG &&
        window.TIDE_CONFIG.executionProof &&
        window.TIDE_CONFIG.executionProof.enabled === true) ||
      false,
    // Signing is blocked unless explicitly opted in by generated config.
    // Defaults to false so unconfigured builds never accidentally sign.
    allowSigning:
      (window.TIDE_CONFIG &&
        window.TIDE_CONFIG.executionProof &&
        window.TIDE_CONFIG.executionProof.allowSigning === true) ||
      false,
  },
  sui: {
    network:
      (window.TIDE_CONFIG &&
        window.TIDE_CONFIG.sui &&
        window.TIDE_CONFIG.sui.network) ||
      "",
    rpcUrl:
      (window.TIDE_CONFIG &&
        window.TIDE_CONFIG.sui &&
        window.TIDE_CONFIG.sui.rpcUrl) ||
      "",
    explorerBase:
      (window.TIDE_CONFIG &&
        window.TIDE_CONFIG.sui &&
        window.TIDE_CONFIG.sui.explorerBase) ||
      "",
  },
  // Walrus publisher — when set, mint flow POSTs the canonical proof
  // bundle there and pins the resulting blobId on the receipt. Empty
  // = deterministic `tide-stub://<network>/sha256/<digest>` stub. The content
  // digest that gets pinned on-chain is computed locally either way,
  // so the receipt stays verifiable even on publisher downtime.
  walrus: {
    publisherUrl:
      (window.TIDE_CONFIG &&
        window.TIDE_CONFIG.walrus &&
        window.TIDE_CONFIG.walrus.publisherUrl) ||
      "",
    aggregatorUrl:
      (window.TIDE_CONFIG &&
        window.TIDE_CONFIG.walrus &&
        window.TIDE_CONFIG.walrus.aggregatorUrl) ||
      "https://aggregator.walrus-testnet.walrus.space",
    epochs:
      (window.TIDE_CONFIG &&
        window.TIDE_CONFIG.walrus &&
        Number(window.TIDE_CONFIG.walrus.epochs)) ||
      5,
  },
  oracle: {
    pyth: {
      priceInfoObjectId:
        (window.TIDE_CONFIG &&
          window.TIDE_CONFIG.oracle &&
          window.TIDE_CONFIG.oracle.pyth &&
          window.TIDE_CONFIG.oracle.pyth.priceInfoObjectId) ||
        "",
      feedSymbol:
        (window.TIDE_CONFIG &&
          window.TIDE_CONFIG.oracle &&
          window.TIDE_CONFIG.oracle.pyth &&
          window.TIDE_CONFIG.oracle.pyth.feedSymbol) ||
        "BTC/USD",
      rpcUrl:
        (window.TIDE_CONFIG &&
          window.TIDE_CONFIG.oracle &&
          window.TIDE_CONFIG.oracle.pyth &&
          window.TIDE_CONFIG.oracle.pyth.rpcUrl) ||
        "",
      staleMaxMs:
        (window.TIDE_CONFIG &&
          window.TIDE_CONFIG.oracle &&
          window.TIDE_CONFIG.oracle.pyth &&
          Number(window.TIDE_CONFIG.oracle.pyth.staleMaxMs)) ||
        60000,
    },
  },
};

// Freeze the runtime config after initialization to prevent post-boot
// tampering (e.g. a misbehaving extension or CDN-injected script rewriting
// execution.allowedMoveTargets to widen the wallet signing scope). A deep
// freeze walks the object tree; anything unfrozen after this point must be
// stored outside window.TIDE_CONFIG.
(function deepFreezeTideConfig(config) {
  if (!config || typeof config !== "object") return;
  Object.freeze(config);
  for (const key of Object.keys(config)) {
    const value = config[key];
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      deepFreezeTideConfig(value);
    }
  }
})(window.TIDE_CONFIG);
