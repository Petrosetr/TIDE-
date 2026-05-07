// Suilend live read-back — produces a stable JS shape for one rail's
// position from the on-chain obligation object. Renderers depend on the
// SuilendReadback shape below; fields cannot be reordered or renamed without
// bumping SUILEND_READBACK_SHAPE_VERSION in the same commit.
//
// Pure JS — no DOM. Caller supplies network + walletAddress + fetchImpl.
// Two phases:
//   1. fetch the obligation object id from the wallet (existing
//      live-protocol-readback.mjs::findSuilendObligationOwnerCap path);
//   2. fetch the obligation object via Sui RPC, parse into the stable
//      readback shape.
//
// Trust labels are explicit in the output: source='live' means the bytes
// came back from Sui RPC; source='live-mainnet-readonly' is the opt-in
// mainnet-observed label for proof bundles; source='fixture' means a
// deterministic scenario (used for ?judge=stress demo fixtures + tests).
// UI must surface this label so judges see we're not lying about live
// execution.

export const SUILEND_READBACK_SHAPE_VERSION = 1;

const DEFAULT_RPC_URLS = Object.freeze({
  mainnet: "https://fullnode.mainnet.sui.io:443",
  testnet: "https://fullnode.testnet.sui.io:443",
  devnet: "https://fullnode.devnet.sui.io:443",
});

const DEFAULT_STALE_MS = 2 * 60 * 1000; // 2 minutes — Suilend reserves update on each block
const SUILEND_DECIMAL_SCALE = 1_000_000_000_000_000_000n;

export class SuilendReadbackError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SuilendReadbackError";
    this.code = code;
    this.details = details;
  }
}

// The stable shape consumers depend on. Documented here so renderers
// can implement against the contract directly. Numeric fields are USD
// (or basis points where noted) — never raw on-chain integers, so
// downstream code does not need rail-specific decimal handling.
export const SUILEND_READBACK_SHAPE = Object.freeze({
  schemaVersion: SUILEND_READBACK_SHAPE_VERSION,
  railId: "string (e.g. 'suilend-sui')",
  walletAddress: "string (0x-prefixed Sui address)",
  obligationId: "string (0x-prefixed Sui object id) | empty when wallet has none",
  objectOwnerAddress: "string (0x-prefixed Sui address) | empty when object owner is not address-owned",
  ownerBinding: "'address-owner-match' | 'not-exposed' | 'not-checked'",
  source: "'live' | 'live-mainnet-readonly' | 'fixture' | 'missing'",
  observedAt: "ISO timestamp when the snapshot was produced",
  stale: "boolean — true if observedAt is older than the staleness window",
  staleMaxMs: "number — staleness threshold used (ms)",
  collateralUsd: "number — total deposit value in USD",
  debtUsd: "number — total borrow value in USD",
  ltvBps: "number — debt/collateral as basis points (0..10_000)",
  trustLabel: "operator-readable string for the UI; never claim execution",
});

function nowIso() {
  return new Date().toISOString();
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeLabel(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeSuiAddress(value) {
  const text = String(value || "").trim().toLowerCase();
  return /^0x[0-9a-f]{64}$/.test(text) ? text : "";
}

function normalizeRpcNetwork(network) {
  const label = normalizeLabel(network);
  if (label === "mainnet-readonly" || label === "live-mainnet-readonly") {
    return "mainnet";
  }
  return label;
}

function normalizeLiveSource(source, { network = "" } = {}) {
  const explicit = normalizeLabel(source);
  if (explicit === "live-mainnet-readonly" || explicit === "mainnet-readonly") {
    return "live-mainnet-readonly";
  }
  if (explicit === "live") {
    return "live";
  }
  const networkLabel = normalizeLabel(network);
  if (networkLabel === "mainnet-readonly" || networkLabel === "live-mainnet-readonly") {
    return "live-mainnet-readonly";
  }
  return "live";
}

function computeLtvBps(debtUsd, collateralUsd) {
  if (!Number.isFinite(debtUsd) || debtUsd <= 0) return 0;
  if (!Number.isFinite(collateralUsd) || collateralUsd <= 0) return 10_000;
  const bps = Math.round((debtUsd / collateralUsd) * 10_000);
  return Math.max(0, Math.min(10_000, bps));
}

function scaledDecimalStringToNumber(value, fallback = 0) {
  const text = String(value ?? "").trim();
  if (!/^-?\d+$/.test(text)) {
    return safeNumber(value, fallback);
  }
  try {
    const raw = BigInt(text);
    const sign = raw < 0n ? "-" : "";
    const abs = raw < 0n ? -raw : raw;
    const whole = abs / SUILEND_DECIMAL_SCALE;
    const fraction = abs % SUILEND_DECIMAL_SCALE;
    const fractionText = fraction.toString().padStart(18, "0").replace(/0+$/, "");
    return safeNumber(`${sign}${whole.toString()}${fractionText ? `.${fractionText}` : ""}`, fallback);
  } catch {
    return safeNumber(value, fallback);
  }
}

function readSuilendDecimal(value, fallback = NaN) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string" || typeof value === "bigint") {
    return safeNumber(value, fallback);
  }
  if (typeof value !== "object") return fallback;

  const decimalValue = value?.fields?.value ?? value?.value;
  if (decimalValue !== undefined && decimalValue !== null) {
    return scaledDecimalStringToNumber(decimalValue, fallback);
  }
  return fallback;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function asMoveVector(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.fields?.contents)) return value.fields.contents;
  if (Array.isArray(value?.fields?.vec)) return value.fields.vec;
  if (Array.isArray(value?.vec)) return value.vec;
  return [];
}

function readRecordField(record, key) {
  return record?.fields?.[key] ?? record?.[key];
}

function sumRecordMarketValue(records) {
  const total = asMoveVector(records).reduce((sum, record) => {
    const value = readSuilendDecimal(readRecordField(record, "market_value"), NaN);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
  return total > 0 ? total : NaN;
}

function extractObjectId(rawObject, fields) {
  return rawObject?.data?.objectId ||
    rawObject?.objectId ||
    fields?.id?.id ||
    fields?.id?.fields?.id?.id ||
    fields?.id?.fields?.id?.fields?.bytes ||
    fields?.id?.fields?.id ||
    fields?.id?.id?.bytes ||
    fields?.id?.bytes ||
    "";
}

function extractAddressOwner(rawObject, fields) {
  return normalizeSuiAddress(
    rawObject?.data?.owner?.AddressOwner ||
    rawObject?.owner?.AddressOwner ||
    fields?.owner?.fields?.id ||
    fields?.owner?.id ||
    fields?.owner_address ||
    fields?.owner ||
    "",
  );
}

// Parse a raw Sui RPC obligation object into the stable shape. The
// obligation field names track the Suilend lending-market Move source
// at @suilend/sdk 2.0.x. If their schema bumps, this parser is the
// single place to update.
//
// We accept either the wrapped RPC shape `{ data: { content: {...} } }`
// or the inner `{ content: {...} }`, so callers that have already
// unwrapped the RPC response are not penalized.
export function parseSuilendObligationObject(rawObject, {
  railId = "suilend-sui",
  walletAddress = "",
  observedAt = nowIso(),
  staleMaxMs = DEFAULT_STALE_MS,
  source = "live",
} = {}) {
  if (!rawObject || typeof rawObject !== "object") {
    throw new SuilendReadbackError(
      "invalid-input",
      "rawObject must be a non-null object",
    );
  }
  const content = rawObject?.data?.content || rawObject?.content || null;
  if (!content || content.dataType !== "moveObject") {
    throw new SuilendReadbackError(
      "not-move-object",
      "RPC object is not a moveObject (content.dataType !== 'moveObject')",
    );
  }
  const fields = content.fields;
  if (!fields || typeof fields !== "object") {
    throw new SuilendReadbackError(
      "missing-fields",
      "RPC object has no readable fields",
    );
  }
  const obligationId = extractObjectId(rawObject, fields);
  const expectedWalletAddress = normalizeSuiAddress(walletAddress);
  const objectOwnerAddress = extractAddressOwner(rawObject, fields);
  if (expectedWalletAddress && objectOwnerAddress && objectOwnerAddress !== expectedWalletAddress) {
    throw new SuilendReadbackError(
      "owner-mismatch",
      `Suilend obligation owner ${objectOwnerAddress} does not match wallet ${expectedWalletAddress}`,
      { expectedWalletAddress, objectOwnerAddress, obligationId },
    );
  }
  // Current mainnet Suilend obligations expose Decimal structs scaled by
  // 1e18. Older tests/fixtures used plain decimal strings. Accept both.
  const collateralUsd = firstFiniteNumber(
    readSuilendDecimal(fields.deposited_value_usd, NaN),
    sumRecordMarketValue(fields.deposits),
  );
  const debtUsd = firstFiniteNumber(
    readSuilendDecimal(fields.borrowed_value_usd, NaN),
    readSuilendDecimal(fields.unweighted_borrowed_value_usd, NaN),
    readSuilendDecimal(fields.weighted_borrowed_value_usd, NaN),
    sumRecordMarketValue(fields.borrows),
  );
  const ltvBps = computeLtvBps(debtUsd, collateralUsd);
  const ageMs = Math.max(0, Date.now() - Date.parse(observedAt));
  const stale = ageMs > staleMaxMs;
  const liveSource = normalizeLiveSource(source);
  return {
    schemaVersion: SUILEND_READBACK_SHAPE_VERSION,
    railId,
    walletAddress: expectedWalletAddress || String(walletAddress || ""),
    obligationId,
    objectOwnerAddress,
    ownerBinding: objectOwnerAddress
      ? "address-owner-match"
      : expectedWalletAddress
        ? "not-exposed"
        : "not-checked",
    source: liveSource,
    observedAt,
    stale,
    staleMaxMs,
    collateralUsd,
    debtUsd,
    ltvBps,
    trustLabel: liveSource === "live-mainnet-readonly"
      ? "Live mainnet read-only read-back from Sui RPC. Not execution."
      : "Live read-back from Sui RPC. Not execution.",
  };
}

// Build a fixture-mode readback used by judge entry points (?judge=stress
// etc.) and by tests. Source label is 'fixture' so the UI can show
// "Modeled scenario" badge instead of "Live read-back".
export function buildFixtureSuilendReadback({
  railId = "suilend-sui",
  walletAddress = "0x" + "00".repeat(32),
  obligationId = "",
  collateralUsd = 0,
  debtUsd = 0,
  observedAt = nowIso(),
  staleMaxMs = DEFAULT_STALE_MS,
  trustLabel = "Modeled scenario. Not on-chain. Not execution.",
} = {}) {
  return {
    schemaVersion: SUILEND_READBACK_SHAPE_VERSION,
    railId,
    walletAddress,
    obligationId,
    source: "fixture",
    observedAt,
    stale: false,
    staleMaxMs,
    collateralUsd: Math.max(0, safeNumber(collateralUsd)),
    debtUsd: Math.max(0, safeNumber(debtUsd)),
    ltvBps: computeLtvBps(safeNumber(debtUsd), safeNumber(collateralUsd)),
    trustLabel,
  };
}

// Build a "wallet has no Suilend obligation" readback. Stable shape so
// the renderer can pattern-match on source='missing' instead of
// constructing UI from a thrown error.
export function buildMissingSuilendReadback({
  railId = "suilend-sui",
  walletAddress = "",
  observedAt = nowIso(),
  staleMaxMs = DEFAULT_STALE_MS,
} = {}) {
  return {
    schemaVersion: SUILEND_READBACK_SHAPE_VERSION,
    railId,
    walletAddress,
    obligationId: "",
    source: "missing",
    observedAt,
    stale: false,
    staleMaxMs,
    collateralUsd: 0,
    debtUsd: 0,
    ltvBps: 0,
    trustLabel: "Wallet has no Suilend obligation on this network.",
  };
}

export function isReadbackStale(readback, now = Date.now()) {
  if (!readback || typeof readback !== "object") return true;
  if (!Number.isFinite(readback.staleMaxMs)) return true;
  const observedMs = Date.parse(readback.observedAt || "");
  if (!Number.isFinite(observedMs)) return true;
  return now - observedMs > readback.staleMaxMs;
}

// End-to-end fetch: takes a wallet address + an obligation id, fetches
// the object via Sui RPC, parses into the stable shape. Caller supplies
// fetchImpl + obligationId (looked up upstream via the existing
// findSuilendObligationOwnerCap path in live-protocol-readback.mjs).
export async function fetchSuilendReadback({
  obligationId,
  walletAddress = "",
  railId = "suilend-sui",
  network = "testnet",
  rpcUrl = null,
  fetchImpl = null,
  staleMaxMs = DEFAULT_STALE_MS,
  source = null,
  sourceLabel = null,
} = {}) {
  if (!obligationId || typeof obligationId !== "string") {
    return buildMissingSuilendReadback({ railId, walletAddress, staleMaxMs });
  }
  const rpcNetwork = normalizeRpcNetwork(network);
  const liveSource = normalizeLiveSource(sourceLabel ?? source, { network });
  const url = rpcUrl || DEFAULT_RPC_URLS[rpcNetwork];
  if (!url) {
    throw new SuilendReadbackError(
      "invalid-network",
      `no default RPC URL for network '${network}'`,
    );
  }
  const fetcher = fetchImpl || globalThis.fetch;
  if (typeof fetcher !== "function") {
    throw new SuilendReadbackError(
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
        params: [obligationId, { showContent: true, showOwner: true, showType: true }],
      }),
    });
  } catch (err) {
    throw new SuilendReadbackError(
      "rpc-fetch-failed",
      `Suilend obligation fetch failed: ${err?.message || err}`,
      { url, obligationId },
    );
  }
  if (!response || response.ok === false) {
    throw new SuilendReadbackError(
      "rpc-http-error",
      `RPC ${url} returned HTTP ${response?.status ?? "?"}`,
      { url, status: response?.status },
    );
  }
  const payload = await response.json();
  if (payload?.error) {
    throw new SuilendReadbackError(
      "rpc-error",
      payload.error.message || "RPC error",
      { rpcError: payload.error },
    );
  }
  const result = payload?.result;
  if (result?.error) {
    if (result.error.code === "notExists" || /not exist/i.test(result.error.code || "")) {
      return buildMissingSuilendReadback({ railId, walletAddress, staleMaxMs });
    }
    throw new SuilendReadbackError(
      "rpc-result-error",
      result.error.code || "result error",
      { resultError: result.error },
    );
  }
  if (!result?.data) {
    throw new SuilendReadbackError(
      "obligation-empty",
      "RPC returned an empty obligation payload",
      { obligationId },
    );
  }
  return parseSuilendObligationObject(result, {
    railId,
    walletAddress,
    observedAt: nowIso(),
    staleMaxMs,
    source: liveSource,
  });
}

export const SUILEND_READBACK_DEFAULT_STALE_MS = DEFAULT_STALE_MS;
