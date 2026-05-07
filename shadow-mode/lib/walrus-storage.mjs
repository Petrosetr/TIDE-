// Walrus storage adapter — durable proof-bundle persistence for receipts.
//
// Two operating modes:
//   1. **stub** (current testnet S0): receipt.walrusBlobId is a deterministic
//      `tide-stub://testnet/sha256/<digest>` URI. No off-chain bytes are
//      uploaded; the digest itself is the bundle. The resolver/CLI flag
//      this mode and skip the Walrus fetch.
//   2. **walrus** (preferred): receipt.walrusBlobId is the real Walrus
//      base64url blob id. The lib hits the publisher (PUT) and aggregator
//      (GET) endpoints documented at
//      https://docs.walrus.site/usage/web-api.html.
//
// Pure JS — no DOM, no globalThis.window. Caller supplies the publisher /
// aggregator endpoints (for testnet vs mainnet) and the fetchImpl. Default
// endpoints match the Walrus testnet allowlist already in
// Deployed CSP `connect-src` allowlists must include the active Walrus hosts.

const DEFAULT_PUBLISHER = "https://publisher.walrus-testnet.walrus.space";
const DEFAULT_AGGREGATOR = "https://aggregator.walrus-testnet.walrus.space";

const STUB_RE = /^tide-stub:\/\/(?<network>testnet|mainnet|devnet)\/sha256\/(?<digest>[0-9a-f]{64})$/i;
const LEGACY_STUB_RE = /^(?<network>testnet|mainnet|devnet)-proof:(?<digest>[0-9a-f]{64})$/i;
// Walrus blob ids are base64url, ~44 chars (32-byte hash). We accept the
// 40-100 range to tolerate alphabet variation from different SDK versions.
const WALRUS_BLOB_ID_RE = /^[A-Za-z0-9_-]{40,100}$/;

export class WalrusStorageError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "WalrusStorageError";
    this.code = code;
    this.details = details;
  }
}

// Returns "stub" | "walrus" | "unknown" plus parsed details. The resolver
// uses this to decide whether to attempt a Walrus fetch.
export function classifyBlobId(blobId) {
  if (typeof blobId !== "string" || !blobId.trim()) {
    return { mode: "unknown", reason: "empty" };
  }
  const normalized = blobId.trim();
  const stubMatch = STUB_RE.exec(normalized);
  if (stubMatch) {
    return {
      mode: "stub",
      network: stubMatch.groups.network.toLowerCase(),
      digestHex: "0x" + stubMatch.groups.digest.toLowerCase(),
      raw: normalized,
    };
  }
  const legacyMatch = LEGACY_STUB_RE.exec(normalized);
  if (legacyMatch) {
    return {
      mode: "stub",
      network: legacyMatch.groups.network.toLowerCase(),
      digestHex: "0x" + legacyMatch.groups.digest.toLowerCase(),
      raw: normalized,
      legacy: true,
    };
  }
  if (WALRUS_BLOB_ID_RE.test(normalized)) {
    return { mode: "walrus", blobId: normalized, raw: normalized };
  }
  return { mode: "unknown", reason: "unrecognized-format", raw: normalized };
}

export function buildStubBlobId({ network, digestHex } = {}) {
  if (!network || !["testnet", "mainnet", "devnet"].includes(network)) {
    throw new WalrusStorageError(
      "invalid-network",
      `network must be testnet|mainnet|devnet, got '${network}'`,
    );
  }
  const cleanHex = String(digestHex || "").replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(cleanHex)) {
    throw new WalrusStorageError(
      "invalid-digest",
      `digestHex must be 0x + 64 hex chars, got '${digestHex}'`,
    );
  }
  return `tide-stub://${network}/sha256/${cleanHex}`;
}

// Publish bytes to the Walrus publisher endpoint. Returns the blob id +
// epoch metadata. The publisher returns either a `newlyCreated` or
// `alreadyCertified` envelope; this lib normalises both into the same
// shape.
//
// `bytes` must be a Uint8Array; the publisher accepts arbitrary binary.
// `epochs` controls the storage duration (default 5 — matches Walrus
// testnet "default short-lived storage" guidance).
export async function publishToWalrus({
  bytes,
  publisherUrl = DEFAULT_PUBLISHER,
  epochs = 5,
  fetchImpl = null,
} = {}) {
  if (!(bytes instanceof Uint8Array)) {
    throw new WalrusStorageError(
      "invalid-bytes",
      "bytes must be a Uint8Array",
    );
  }
  if (bytes.byteLength === 0) {
    throw new WalrusStorageError(
      "empty-bytes",
      "refusing to publish a zero-byte bundle",
    );
  }
  if (!Number.isInteger(epochs) || epochs < 1) {
    throw new WalrusStorageError(
      "invalid-epochs",
      `epochs must be an integer >= 1, got ${epochs}`,
    );
  }
  if (typeof publisherUrl !== "string" || !publisherUrl.startsWith("https://")) {
    throw new WalrusStorageError(
      "invalid-publisher-url",
      "publisherUrl must be an https URL",
      { publisherUrl },
    );
  }
  const fetcher = fetchImpl || globalThis.fetch;
  if (typeof fetcher !== "function") {
    throw new WalrusStorageError(
      "no-fetch-impl",
      "fetchImpl must be supplied or globalThis.fetch must be available",
    );
  }

  const url = `${publisherUrl.replace(/\/+$/, "")}/v1/blobs?epochs=${encodeURIComponent(epochs)}`;
  let response;
  try {
    response = await fetcher(url, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: bytes,
    });
  } catch (err) {
    throw new WalrusStorageError(
      "publish-fetch-failed",
      `Walrus publish fetch failed: ${err?.message || err}`,
      { url },
    );
  }
  if (!response || response.ok === false) {
    throw new WalrusStorageError(
      "publish-http-error",
      `Walrus publisher returned HTTP ${response?.status ?? "?"}`,
      { url, status: response?.status },
    );
  }
  const payload = await response.json();
  // Two equivalent shapes:
  //   { newlyCreated: { blobObject: { blobId, registeredEpoch, ... } } }
  //   { alreadyCertified: { blobId, endEpoch, ... } }
  const newly = payload?.newlyCreated?.blobObject;
  const already = payload?.alreadyCertified;
  const blobId = newly?.blobId || already?.blobId;
  if (!blobId) {
    throw new WalrusStorageError(
      "publish-bad-payload",
      "Walrus publisher response did not contain a blobId",
      { payload },
    );
  }
  const classified = classifyBlobId(blobId);
  if (classified.mode !== "walrus") {
    throw new WalrusStorageError(
      "publish-bad-blob-id",
      "Walrus publisher response contained a malformed blobId",
      { blobId, payload },
    );
  }
  return {
    blobId: classified.blobId,
    suiObjectId: newly?.id || already?.event?.txDigest || null,
    network: parsePublisherNetwork(publisherUrl),
    registeredEpoch: newly?.registeredEpoch ?? null,
    endEpoch: newly?.storage?.endEpoch ?? already?.endEpoch ?? null,
    alreadyCertified: Boolean(already),
  };
}

// Fetch bytes back from the aggregator endpoint. Returns Uint8Array.
export async function fetchFromWalrus({
  blobId,
  aggregatorUrl = DEFAULT_AGGREGATOR,
  fetchImpl = null,
} = {}) {
  const classified = classifyBlobId(blobId);
  if (classified.mode !== "walrus") {
    throw new WalrusStorageError(
      "not-a-walrus-blob",
      `blob id is mode '${classified.mode}', not a Walrus blob id; cannot fetch`,
      { classified },
    );
  }
  const fetcher = fetchImpl || globalThis.fetch;
  if (typeof fetcher !== "function") {
    throw new WalrusStorageError(
      "no-fetch-impl",
      "fetchImpl must be supplied or globalThis.fetch must be available",
    );
  }
  // Walrus testnet aggregator serves bundles at /v1/blobs/<blobId>.
  // The earlier /v1/<blobId> shape returned 404 silently and made the
  // judge-facing bundle fetch path look like a verification
  // failure when the bundle was in fact reachable.
  const url = `${aggregatorUrl.replace(/\/+$/, "")}/v1/blobs/${encodeURIComponent(classified.blobId)}`;
  let response;
  try {
    response = await fetcher(url, { method: "GET" });
  } catch (err) {
    throw new WalrusStorageError(
      "fetch-fetch-failed",
      `Walrus aggregator fetch failed: ${err?.message || err}`,
      { url },
    );
  }
  if (!response || response.ok === false) {
    if (response?.status === 404) {
      throw new WalrusStorageError(
        "blob-not-found",
        `Walrus blob ${classified.blobId} not found on ${aggregatorUrl}`,
        { url, status: 404 },
      );
    }
    throw new WalrusStorageError(
      "fetch-http-error",
      `Walrus aggregator returned HTTP ${response?.status ?? "?"}`,
      { url, status: response?.status },
    );
  }
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

function parsePublisherNetwork(publisherUrl) {
  if (publisherUrl.includes("walrus-testnet")) return "testnet";
  if (publisherUrl.includes("walrus-mainnet")) return "mainnet";
  if (publisherUrl.includes("walrus-devnet")) return "devnet";
  return "unknown";
}

export const WALRUS_DEFAULT_PUBLISHER = DEFAULT_PUBLISHER;
export const WALRUS_DEFAULT_AGGREGATOR = DEFAULT_AGGREGATOR;
export const WALRUS_BLOB_ID_PATTERN = WALRUS_BLOB_ID_RE;
export const TIDE_STUB_BLOB_ID_PATTERN = STUB_RE;
