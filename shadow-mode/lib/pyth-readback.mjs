// Pyth oracle read-back — produces a stable JS shape for one Pyth
// price feed (e.g. BTC/USD). Renderers consume the shape contract documented
// in PYTH_READBACK_SHAPE_VERSION below.
//
// Two operating modes:
//   1. **live**: caller passes a Sui RPC PriceInfoObject (or its inner
//      content) to parsePythPriceInfoObject. We extract price, confidence,
//      publish time, and compute staleness against a configured window.
//   2. **fixture**: ?judge=oracle-stale and unit tests use
//      buildFixturePythReadback to produce a deterministic snapshot.
//
// Trust labels are explicit. UI must not claim 'live execution' off
// this shape; trustLabel = 'Live read-back from Sui RPC. Not execution.'
// for live mode.

export const PYTH_READBACK_SHAPE_VERSION = 1;

const DEFAULT_STALE_MS = 60_000; // 60 seconds — Pyth publishes ~every 400ms; 60s is generous

const DEFAULT_RPC_URLS = Object.freeze({
  mainnet: "https://fullnode.mainnet.sui.io:443",
  testnet: "https://fullnode.testnet.sui.io:443",
  devnet: "https://fullnode.devnet.sui.io:443",
});

export class PythReadbackError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PythReadbackError";
    this.code = code;
    this.details = details;
  }
}

// The stable shape consumers depend on. Renderers implement against
// the contract directly.
export const PYTH_READBACK_SHAPE = Object.freeze({
  schemaVersion: PYTH_READBACK_SHAPE_VERSION,
  feedSymbol: "string (e.g. 'BTC/USD')",
  priceInfoObjectId: "string (0x-prefixed Sui object id) | empty when feed not configured",
  source: "'live' | 'fixture' | 'missing'",
  observedAt: "ISO timestamp when the snapshot was fetched",
  publishTimeMs: "number (ms epoch) — when Pyth attested the price",
  ageMs: "number — observedAt - publishTimeMs",
  stale: "boolean — true if ageMs > staleMaxMs",
  staleMaxMs: "number — staleness threshold used (ms)",
  priceUsd: "number — extracted from {magnitude, expo, sign}",
  confidenceUsd: "number — Pyth confidence interval in USD",
  confidenceBps: "number — confidenceUsd / priceUsd as basis points",
  trustLabel: "operator-readable string — never claim execution",
});

function nowIso() {
  return new Date().toISOString();
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Pyth on-chain Price encodes the magnitude + sign + expo separately.
// The Sui-deployed Pyth uses `pyth::i64::I64 { magnitude: u64, negative: bool }`,
// so the readable RPC field is `negative` (boolean). Older fixtures and a
// minority of off-chain SDKs surface a `sign: u64` field instead (sign=0
// means negative, sign=1 means positive). We accept both shapes and prefer
// `negative` when present so the deployed object is read correctly.
//
// `priceNegative` / `expoNegative` are booleans drawn from `fields.negative`.
// `sign` / `expoSign` are the legacy strings; passed only when the boolean
// path is absent.
function decodePythPrice({ magnitude, priceNegative, sign, expo, expoNegative, expoSign } = {}) {
  const mag = safeNumber(magnitude);
  const isNegative = resolvePythSign({ negative: priceNegative, sign });
  const expoMag = safeNumber(expo);
  const expoNeg = resolvePythSign({ negative: expoNegative, sign: expoSign });
  const expoSigned = expoNeg ? -expoMag : expoMag;
  const value = mag * Math.pow(10, expoSigned);
  return isNegative ? -value : value;
}

// Resolves the negative-or-not bit from either `negative` (boolean, current
// Sui Pyth shape) or legacy `sign` (string "0"=negative, "1"=positive).
// Returns false (positive) when neither is present so an undefined sign
// does not silently flip the price.
function resolvePythSign({ negative, sign }) {
  if (typeof negative === "boolean") return negative;
  if (negative === "true" || negative === "false") return negative === "true";
  if (sign === undefined || sign === null) return false;
  return String(sign) === "0";
}

// Parse a raw Sui RPC PriceInfoObject into the stable shape. Accepts
// both wrapped { data: { content: {...} } } and inner { content: {...} }.
export function parsePythPriceInfoObject(rawObject, {
  feedSymbol = "BTC/USD",
  observedAt = nowIso(),
  staleMaxMs = DEFAULT_STALE_MS,
} = {}) {
  if (!rawObject || typeof rawObject !== "object") {
    throw new PythReadbackError("invalid-input", "rawObject must be a non-null object");
  }
  const content = rawObject?.data?.content || rawObject?.content || null;
  if (!content || content.dataType !== "moveObject") {
    throw new PythReadbackError(
      "not-move-object",
      "RPC object is not a moveObject (content.dataType !== 'moveObject')",
    );
  }
  const fields = content.fields;
  if (!fields || typeof fields !== "object") {
    throw new PythReadbackError("missing-fields", "RPC object has no readable fields");
  }
  const priceInfo = fields.price_info?.fields || fields.price_info || null;
  const priceFeed = priceInfo?.price_feed?.fields || priceInfo?.price_feed || null;
  if (!priceFeed) {
    throw new PythReadbackError(
      "missing-price-feed",
      "PriceInfoObject is missing price_info.price_feed",
    );
  }
  const priceStruct = priceFeed.price?.fields || priceFeed.price || null;
  if (!priceStruct) {
    throw new PythReadbackError(
      "missing-price-struct",
      "price_feed has no price struct",
    );
  }
  const priceUsd = decodePythPrice({
    magnitude: priceStruct.price?.fields?.magnitude || priceStruct.price?.magnitude || priceStruct.magnitude,
    priceNegative: priceStruct.price?.fields?.negative ?? priceStruct.price?.negative ?? priceStruct.negative,
    sign: priceStruct.price?.fields?.sign || priceStruct.price?.sign || priceStruct.sign,
    expo: priceStruct.expo?.fields?.magnitude || priceStruct.expo?.magnitude,
    expoNegative: priceStruct.expo?.fields?.negative ?? priceStruct.expo?.negative,
    expoSign: priceStruct.expo?.fields?.sign || priceStruct.expo?.sign,
  });
  // expoSigned mirrors decodePythPrice's resolvePythSign so confidence and
  // price share the same exponent sign — otherwise confidenceBps is wrong
  // by 16 orders of magnitude on the deployed `negative: bool` shape.
  const expoIsNegative = resolvePythSign({
    negative: priceStruct.expo?.fields?.negative ?? priceStruct.expo?.negative,
    sign: priceStruct.expo?.fields?.sign || priceStruct.expo?.sign,
  });
  const confidenceUsd = safeNumber(priceStruct.conf, 0) *
    Math.pow(
      10,
      (expoIsNegative ? -1 : 1) *
      safeNumber(priceStruct.expo?.fields?.magnitude || priceStruct.expo?.magnitude),
    );
  const publishTimeRaw = priceStruct.timestamp || priceStruct.publish_time || priceFeed.publish_time;
  const publishTimeSec = safeNumber(publishTimeRaw, 0);
  const publishTimeMs = publishTimeSec > 1e10 ? publishTimeSec : publishTimeSec * 1000;
  const observedMs = Date.parse(observedAt);
  const ageMs = Math.max(0, observedMs - publishTimeMs);
  const objectId = rawObject?.data?.objectId || rawObject?.objectId || fields?.id?.id || "";

  return {
    schemaVersion: PYTH_READBACK_SHAPE_VERSION,
    feedSymbol,
    priceInfoObjectId: objectId,
    source: "live",
    observedAt,
    publishTimeMs,
    ageMs,
    stale: ageMs > staleMaxMs,
    staleMaxMs,
    priceUsd,
    confidenceUsd,
    confidenceBps: priceUsd > 0
      ? Math.round((confidenceUsd / priceUsd) * 10_000)
      : 0,
    trustLabel: "Live read-back from Sui RPC. Not execution.",
  };
}

export function buildFixturePythReadback({
  feedSymbol = "BTC/USD",
  priceInfoObjectId = "",
  priceUsd = 82_500,
  confidenceUsd = 75,
  publishTimeMs = Date.now(),
  observedAt = nowIso(),
  staleMaxMs = DEFAULT_STALE_MS,
  trustLabel = "Modeled scenario. Not on-chain. Not execution.",
} = {}) {
  const observedMs = Date.parse(observedAt);
  const ageMs = Math.max(0, observedMs - publishTimeMs);
  return {
    schemaVersion: PYTH_READBACK_SHAPE_VERSION,
    feedSymbol,
    priceInfoObjectId,
    source: "fixture",
    observedAt,
    publishTimeMs,
    ageMs,
    stale: ageMs > staleMaxMs,
    staleMaxMs,
    priceUsd: safeNumber(priceUsd),
    confidenceUsd: safeNumber(confidenceUsd),
    confidenceBps: priceUsd > 0
      ? Math.round((confidenceUsd / priceUsd) * 10_000)
      : 0,
    trustLabel,
  };
}

export function buildMissingPythReadback({
  feedSymbol = "BTC/USD",
  observedAt = nowIso(),
  staleMaxMs = DEFAULT_STALE_MS,
  trustLabel = "Pyth feed not configured for this network. Trust strip shows 'modeled price'.",
} = {}) {
  return {
    schemaVersion: PYTH_READBACK_SHAPE_VERSION,
    feedSymbol,
    priceInfoObjectId: "",
    source: "missing",
    observedAt,
    publishTimeMs: 0,
    ageMs: 0,
    stale: true,
    staleMaxMs,
    priceUsd: 0,
    confidenceUsd: 0,
    confidenceBps: 0,
    trustLabel,
  };
}

export function isReadbackStale(readback, now = Date.now()) {
  if (!readback || typeof readback !== "object") return true;
  if (readback.source === "missing") return true;
  if (!Number.isFinite(readback.publishTimeMs)) return true;
  if (!Number.isFinite(readback.staleMaxMs)) return true;
  return now - readback.publishTimeMs > readback.staleMaxMs;
}

export async function fetchPythReadback({
  priceInfoObjectId,
  feedSymbol = "BTC/USD",
  network = "testnet",
  rpcUrl = null,
  fetchImpl = null,
  staleMaxMs = DEFAULT_STALE_MS,
} = {}) {
  if (!priceInfoObjectId || typeof priceInfoObjectId !== "string") {
    return buildMissingPythReadback({ feedSymbol, staleMaxMs });
  }
  const url = rpcUrl || DEFAULT_RPC_URLS[network];
  if (!url) {
    throw new PythReadbackError(
      "invalid-network",
      `no default RPC URL for network '${network}'`,
    );
  }
  const fetcher = fetchImpl || globalThis.fetch;
  if (typeof fetcher !== "function") {
    throw new PythReadbackError(
      "no-fetch-impl",
      "fetchImpl must be supplied or globalThis.fetch must be available",
    );
  }
  let response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sui_getObject",
        params: [priceInfoObjectId, { showContent: true, showOwner: true, showType: true }],
      }),
    });
  } catch (err) {
    throw new PythReadbackError(
      "rpc-fetch-failed",
      `Pyth feed fetch failed: ${err?.message || err}`,
      { url, priceInfoObjectId },
    );
  }
  if (!response || response.ok === false) {
    throw new PythReadbackError(
      "rpc-http-error",
      `RPC ${url} returned HTTP ${response?.status ?? "?"}`,
      { url, status: response?.status },
    );
  }
  const payload = await response.json();
  if (payload?.error) {
    throw new PythReadbackError(
      "rpc-error",
      payload.error.message || "RPC error",
      { rpcError: payload.error },
    );
  }
  const result = payload?.result;
  if (result?.error) {
    if (result.error.code === "notExists" || /not exist/i.test(result.error.code || "")) {
      return buildMissingPythReadback({ feedSymbol, staleMaxMs });
    }
    throw new PythReadbackError(
      "rpc-result-error",
      result.error.code || "result error",
      { resultError: result.error },
    );
  }
  if (!result?.data) {
    throw new PythReadbackError(
      "feed-empty",
      "RPC returned an empty Pyth feed payload",
      { priceInfoObjectId },
    );
  }
  return parsePythPriceInfoObject(result, {
    feedSymbol,
    observedAt: nowIso(),
    staleMaxMs,
  });
}

export const PYTH_READBACK_DEFAULT_STALE_MS = DEFAULT_STALE_MS;
