/**
 * sui-network.mjs — single source of truth for Sui chain/network wiring.
 *
 * Every `"sui:mainnet"` / `"sui:testnet"` literal and every Sui RPC URL in
 * runtime code must go through this module. Keeping one entry point means
 * we can't accidentally sign a mainnet chain tag against a testnet RPC
 * (or vice versa), and a production build can hard-refuse any
 * testnet-flavoured configuration before boot.
 *
 * Config shape (on TIDE_CONFIG.sui):
 *   - network       "mainnet" | "testnet" | "devnet"   (default: "")
 *   - rpcUrl        optional override of the fullnode URL
 *   - walletChain   optional override ("sui:mainnet" | "sui:testnet")
 *   - explorerBase  optional override of the SuiVision explorer base URL
 *
 * Missing or malformed network config resolves to the empty string. That
 * keeps runtime code fail-closed instead of silently selecting mainnet.
 */

const DEFAULT_RPC_URLS = Object.freeze({
  mainnet: "https://fullnode.mainnet.sui.io:443",
  testnet: "https://fullnode.testnet.sui.io:443",
  devnet: "https://fullnode.devnet.sui.io:443",
});

// Secondary RPC endpoints for the bounded-retry path. Mysten public fullnode
// is a single point of failure during the 20-minute judging window; a brief
// outage or rate-limit there freezes the wallet readback path with no
// recovery path. PublicNode publishes CORS-compatible public Sui RPC endpoints
// for browser readbacks. Override per-build via
// `sui.rpcUrlFallback` in runtime-config.mjs (or empty string to disable).
//
// Deployed CSP `connect-src` allowlists must include both primary and
// fallback hosts; deploying a fallback URL here without updating the CSP
// would silently fail in the browser.
const DEFAULT_FALLBACK_RPC_URLS = Object.freeze({
  mainnet: "https://sui-rpc.publicnode.com",
  testnet: "https://sui-testnet-rpc.publicnode.com",
  devnet: "",
});

const DEFAULT_EXPLORER_BASES = Object.freeze({
  mainnet: "https://suivision.xyz",
  testnet: "https://testnet.suivision.xyz",
  devnet: "https://devnet.suivision.xyz",
});

const VALID_NETWORKS = new Set(["mainnet", "testnet", "devnet"]);
const VALID_CHAINS = new Set(["sui:mainnet", "sui:testnet", "sui:devnet"]);

function readRuntimeConfig(explicit) {
  if (explicit && typeof explicit === "object") {
    return explicit;
  }
  if (typeof globalThis !== "undefined" && globalThis.window?.TIDE_CONFIG) {
    return globalThis.window.TIDE_CONFIG;
  }
  return {};
}

function readSuiSection(config) {
  const runtime = readRuntimeConfig(config);
  const sui = runtime && typeof runtime === "object" ? runtime.sui : null;
  return sui && typeof sui === "object" ? sui : {};
}

function normalizeNetwork(value) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return VALID_NETWORKS.has(raw) ? raw : "";
}

function normalizeChain(value) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return VALID_CHAINS.has(raw) ? raw : "";
}

function stripTrailingSlash(value) {
  return typeof value === "string" ? value.replace(/\/+$/, "") : "";
}

/**
 * Resolve the active Sui network. Missing config intentionally returns
 * the empty string so callers cannot accidentally default to mainnet.
 */
export function getSuiNetwork(config) {
  const sui = readSuiSection(config);
  return normalizeNetwork(sui.network);
}

export function isSuiNetworkExplicit(config) {
  return Boolean(getSuiNetwork(config));
}

export function assertSuiNetworkExplicit({ config, tideEnv } = {}) {
  if (isSuiNetworkExplicit(config)) {
    return;
  }
  const env = typeof tideEnv === "string" ? tideEnv.trim().toLowerCase() : "";
  const sui = readSuiSection(config);
  const observed = sui.network === undefined ? "<unset>" : JSON.stringify(sui.network);
  throw new Error(
    [
      "sui-network: sui.network is required and must be explicit.",
      env ? `TIDE_ENV=${env}; observed sui.network=${observed}.` : `Observed sui.network=${observed}.`,
      "Set TIDE_SUI_NETWORK=mainnet|testnet|devnet at build time; no runtime path falls back to mainnet.",
    ].join(" ")
  );
}

/**
 * Return the wallet-standard chain tag for the active network, e.g.
 * `"sui:testnet"`. An explicit `sui.walletChain` override wins if it
 * matches the network (and is a known tag); otherwise we derive it from
 * the network.
 */
export function getSuiWalletChain(config) {
  const sui = readSuiSection(config);
  const override = normalizeChain(sui.walletChain);
  const network = getSuiNetwork(config);
  if (!network) {
    return "";
  }
  const derived = `sui:${network}`;
  if (override && override === derived) {
    return override;
  }
  return derived;
}

function normalizeWalletChains(walletState = {}) {
  const source = [];
  if (typeof walletState.chain === "string") {
    source.push(walletState.chain);
  }
  if (Array.isArray(walletState.chains)) {
    source.push(...walletState.chains);
  }

  const seen = new Set();
  return source
    .map(normalizeChain)
    .filter(Boolean)
    .filter((chain) => {
      if (seen.has(chain)) return false;
      seen.add(chain);
      return true;
    });
}

/**
 * Describe whether the connected wallet can operate on the runtime Sui chain.
 * Wallet Standard exposes supported account chains, not a perfect "active
 * network" signal, so this helper only warns when the expected chain is absent.
 * The actual signing path still passes the expected chain and fail-closes.
 */
export function getWalletNetworkStatus(walletState = {}, config) {
  const expectedChain = getSuiWalletChain(config);
  const walletChains = normalizeWalletChains(walletState);
  const connected = walletState?.connected === true || Boolean(walletState?.address);

  if (!connected) {
    return {
      ok: true,
      status: "disconnected",
      expectedChain,
      walletChain: null,
      walletChains,
      message: "",
    };
  }

  if (!walletChains.length) {
    return {
      ok: true,
      status: "unknown",
      expectedChain,
      walletChain: null,
      walletChains,
      message: "",
    };
  }

  if (walletChains.includes(expectedChain)) {
    return {
      ok: true,
      status: "matched",
      expectedChain,
      walletChain: expectedChain,
      walletChains,
      message: "",
    };
  }

  const walletChain = walletChains[0] || null;
  return {
    ok: false,
    status: "wrong-chain",
    expectedChain,
    walletChain,
    walletChains,
    message: `Connected wallet reports ${walletChain || "another Sui network"}; this build signs ${expectedChain}. Switch wallet network before anchoring or minting action receipts.`,
  };
}

/**
 * Resolve the Sui RPC URL. Explicit `sui.rpcUrl` wins; otherwise we use
 * the known Mysten fullnode for the active network.
 */
export function getSuiRpcUrl(config) {
  const sui = readSuiSection(config);
  const override = typeof sui.rpcUrl === "string" ? sui.rpcUrl.trim() : "";
  if (override) {
    return stripTrailingSlash(override);
  }
  const network = getSuiNetwork(config);
  return network ? DEFAULT_RPC_URLS[network] : "";
}

/**
 * Resolve the secondary Sui RPC URL for the bounded-retry path. Returns
 * empty string when no fallback is configured (signals "no fallback;
 * single-RPC mode"). `sui.rpcUrlFallback` in runtime-config.mjs takes
 * precedence; the empty string explicitly disables the default.
 *
 * Callers must treat empty string as "skip the fallback attempt", not
 * "fall back to primary again" — that would double-charge the failing
 * primary and look like a retry loop.
 */
export function getSuiFallbackRpcUrl(config) {
  const sui = readSuiSection(config);
  const override = typeof sui.rpcUrlFallback === "string" ? sui.rpcUrlFallback.trim() : null;
  if (override !== null) {
    return override === "" ? "" : stripTrailingSlash(override);
  }
  const network = getSuiNetwork(config);
  if (!network) return "";
  return DEFAULT_FALLBACK_RPC_URLS[network] || "";
}

/**
 * Return [primary, fallback] for the active network, with the fallback
 * filtered out when it equals the primary or is empty. Use this when
 * composing a bounded-retry RPC call so callers do not have to juggle
 * the empty-string sentinel from getSuiFallbackRpcUrl.
 */
export function getSuiRpcUrlsWithFallback(config) {
  const primary = getSuiRpcUrl(config);
  const fallback = getSuiFallbackRpcUrl(config);
  if (!primary) return [];
  if (!fallback || fallback === primary) return [primary];
  return [primary, fallback];
}

/**
 * Bounded-retry POST against a Sui JSON-RPC endpoint. Tries primary
 * first; if it fails (network error, HTTP 5xx, HTTP 429, or AbortError
 * from a timeout), tries the configured fallback once. Returns the
 * `Response` of the first successful attempt; otherwise rethrows the
 * last error so the caller's existing error handling path runs.
 *
 * `urls` is the result of getSuiRpcUrlsWithFallback(config). `body` is
 * the JSON-RPC request payload (already a string). `fetchImpl` lets
 * tests inject a mock; `timeoutMs` lets the caller cap each attempt.
 *
 * The caller still parses the response (`response.json()`); this helper
 * only owns "which URL to hit and when to give up".
 */
export async function postSuiRpcWithFallback({
  urls,
  body,
  fetchImpl = null,
  timeoutMs = 15_000,
  headers = { "content-type": "application/json" },
} = {}) {
  if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error("postSuiRpcWithFallback: no URLs configured");
  }
  const fetcher = fetchImpl || (typeof globalThis !== "undefined" ? globalThis.fetch : null);
  if (typeof fetcher !== "function") {
    throw new Error("postSuiRpcWithFallback: fetchImpl required and globalThis.fetch unavailable");
  }
  let lastError = null;
  for (const url of urls) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller && timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
    try {
      const response = await fetcher(url, {
        method: "POST",
        headers,
        body,
        signal: controller?.signal,
      });
      if (timer) clearTimeout(timer);
      // 5xx and 429 are retryable; 4xx other than 429 is a request-shape
      // bug and should not silently mask itself behind the fallback.
      if (!response || response.status === 429 || (response.status >= 500 && response.status < 600)) {
        lastError = new Error(`Sui RPC ${url} returned HTTP ${response?.status ?? "?"}`);
        continue;
      }
      return response;
    } catch (err) {
      if (timer) clearTimeout(timer);
      lastError = err;
      continue;
    }
  }
  throw lastError || new Error("postSuiRpcWithFallback: all URLs exhausted");
}

/**
 * Base URL for SuiVision links. Per-network default via SuiVision,
 * overridable by `sui.explorerBase`.
 */
export function getSuiExplorerBase(config) {
  const sui = readSuiSection(config);
  const override = typeof sui.explorerBase === "string" ? sui.explorerBase.trim() : "";
  if (override) {
    return stripTrailingSlash(override);
  }
  const network = getSuiNetwork(config);
  return network ? DEFAULT_EXPLORER_BASES[network] : "";
}

/**
 * Build a SuiVision URL for a `kind` of entity and its id. The kinds
 * map to SuiVision's URL layout:
 *   - "tx" | "txblock"   transaction digest
 *   - "object"           shared/owned Sui object id
 *   - "address"          account address
 *   - "coin"             coin type (for tokens)
 */
export function buildSuiExplorerUrl(kind, id, config) {
  const base = getSuiExplorerBase(config);
  if (!base) {
    return "";
  }
  const safeId = typeof id === "string" ? id.trim() : "";
  if (!safeId) {
    return base;
  }
  switch (String(kind || "").toLowerCase()) {
    case "tx":
    case "txblock":
    case "transaction":
      return `${base}/txblock/${encodeURIComponent(safeId)}`;
    case "object":
      return `${base}/object/${encodeURIComponent(safeId)}`;
    case "address":
    case "account":
      return `${base}/account/${encodeURIComponent(safeId)}`;
    case "coin":
    case "cointype":
      return `${base}/coin/${encodeURIComponent(safeId)}`;
    default:
      return `${base}/object/${encodeURIComponent(safeId)}`;
  }
}

/**
 * True when the policy registry package is configured with a real
 * package id AND a rail allowlist id. Empty strings (the prod default)
 * return false, which is what blocks accidental live signing paths.
 */
export function isPolicyRegistryReady(config) {
  const runtime = readRuntimeConfig(config);
  const policy = runtime.policyRegistry && typeof runtime.policyRegistry === "object"
    ? runtime.policyRegistry
    : {};
  const packageId = typeof policy.packageId === "string" ? policy.packageId.trim() : "";
  const railAllowlistId = typeof policy.railAllowlistId === "string" ? policy.railAllowlistId.trim() : "";
  return Boolean(packageId) && packageId !== "0x0"
    && Boolean(railAllowlistId) && railAllowlistId !== "0x0";
}

/**
 * Assert that the runtime config is internally coherent. Throws with a
 * descriptive message otherwise. Safe to call during app boot.
 *
 * The rules are the ones we keep violating by accident:
 *   - network must be one of the known values or empty
 *   - walletChain override, if set, must match the network
 *   - rpcUrl override, if set, must use http(s)
 */
export function assertSuiNetworkCoherent(config) {
  const sui = readSuiSection(config);
  if (sui.network !== undefined && String(sui.network).trim() && !normalizeNetwork(sui.network)) {
    throw new Error(`sui-network: unknown sui.network "${sui.network}" (expected mainnet | testnet | devnet)`);
  }
  if (sui.walletChain !== undefined) {
    const chain = normalizeChain(sui.walletChain);
    if (!chain) {
      throw new Error(`sui-network: unknown sui.walletChain "${sui.walletChain}"`);
    }
    const network = getSuiNetwork(config);
    if (!network) {
      throw new Error("sui-network: walletChain is set but sui.network is empty");
    }
    if (chain !== `sui:${network}`) {
      throw new Error(`sui-network: walletChain ${chain} does not match network ${network}`);
    }
  }
  if (sui.rpcUrl !== undefined && typeof sui.rpcUrl === "string" && sui.rpcUrl.trim()) {
    if (!/^https?:\/\//i.test(sui.rpcUrl.trim())) {
      throw new Error(`sui-network: sui.rpcUrl must be http(s): got "${sui.rpcUrl}"`);
    }
  }
}

/**
 * Production safety guard. Call at build time AND at app boot in
 * production contexts. Refuses to proceed if a production deploy is
 * not explicitly configured for mainnet or if execution-receipt signing is
 * enabled. Production can show read-only policy metadata, but it must not
 * present a signing-capable runtime.
 *
 * Call as `assertProductionSafety({ tideEnv, config })`.
 */
export function assertProductionSafety({ tideEnv, config }) {
  const env = typeof tideEnv === "string" ? tideEnv.trim().toLowerCase() : "";
  if (env !== "production") {
    return;
  }
  const sui = readSuiSection(config);
  const network = getSuiNetwork(config);
  const violations = [];
  if (network !== "mainnet") {
    violations.push(`sui.network is "${network || "<empty>"}" (production must explicitly resolve to mainnet).`);
  }
  if (sui.walletChain !== undefined) {
    const chain = normalizeChain(sui.walletChain);
    if (chain && chain !== "sui:mainnet") {
      violations.push(`sui.walletChain is "${chain}" (production must resolve to sui:mainnet).`);
    }
  }
  const runtime = readRuntimeConfig(config);
  const executionProof = runtime.executionProof && typeof runtime.executionProof === "object"
    ? runtime.executionProof
    : {};
  if (executionProof.allowSigning === true) {
    violations.push("executionProof.allowSigning=true is not permitted in production.");
  }
  if (violations.length > 0) {
    throw new Error(
      [
        "Refusing production boot: sui-network safety violations.",
        ...violations.map((line) => `  - ${line}`),
      ].join("\n")
    );
  }
}
