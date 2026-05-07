// Receipt resolver — runtime-agnostic fetch + verify + render-ready
// shape for a single TIDE Action Receipt by id.
//
// Used by:
//   - The standalone CLI verifier (`node scripts/tide-verify.mjs <receipt-id>` —
//     scripts/tide-verify.mjs).
//   - Any third-party integrator that wants to verify a receipt without
//     pulling the TIDE app bundle.
//
// Pure JS: no DOM, no `globalThis.window` reliance, no TIDE_CONFIG.
// Caller supplies network + packageId + optional rpcUrl + optional
// fetchImpl. This makes the lib equally usable from Node CLI and from
// a static page that has only `globalThis.fetch`.

import { normalizeReceiptObject } from "./execution-receipts.mjs";
import {
  canonicalizeBundle,
  PROOF_BUNDLE_VERSION,
  SUPPORTED_PROOF_BUNDLE_VERSIONS,
  DIGEST_BYTES,
  DEFAULT_FRESHNESS_MS,
  checkFreshness,
} from "./execution-proof.mjs";
import {
  buildReceiptCanonicalPayload,
  buildReceiptExplorerUrl,
  buildReceiptReadOnlyUrl,
} from "./receipt-share.mjs";
import { classifyBlobId } from "./walrus-storage.mjs";

const DEFAULT_RPC_URLS = Object.freeze({
  mainnet: "https://fullnode.mainnet.sui.io:443",
  testnet: "https://fullnode.testnet.sui.io:443",
  devnet: "https://fullnode.devnet.sui.io:443",
});

export const RECEIPT_PACKAGE_IDS_BY_NETWORK = Object.freeze({
  mainnet: Object.freeze([]),
  testnet: Object.freeze([
    "0x999c34ce039388017838a5da6670195affa55c4dfbd466612494058963d502f0",
  ]),
  devnet: Object.freeze([]),
});

const EMPTY_TRUSTED_PACKAGE_IDS = Object.freeze([]);
const SUI_OBJECT_ID_RE = /^0x[0-9a-f]{64}$/i;
const SUI_TX_DIGEST_RE = /^[1-9A-HJ-NP-Za-km-z]{32,96}$/;
const DIGEST_HEX_RE = /^0x[0-9a-f]{64}$/i;
const MAINNET_ATTESTED_KIND = "tide-mainnet-attested-demo/v1";
const MAINNET_ATTESTED_RAILS = new Set(["suilend", "scallop", "navi"]);
const MAINNET_ATTESTED_DECISION_TYPES = new Set([
  "Hold",
  "BuildBuffer",
  "BorrowForBuffer",
  "PartialRepay",
  "EmergencyDeRisk",
  "ReducePayout",
  "PausePayout",
  "RotateVenue",
]);
const MAINNET_ATTESTED_CLAIM_BOUNDARY_TOKENS = Object.freeze([
  "founder-manual",
  "TIDE-readonly",
  "testnet-decision-attestation",
]);
const FRESHNESS_TOLERANCE_MS = 30_000;

function isValidNetwork(value) {
  return value === "mainnet" || value === "testnet" || value === "devnet";
}

export class ReceiptResolverError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ReceiptResolverError";
    this.code = code;
    this.details = details;
  }
}

function resolveRpcUrl({ network, rpcUrl }) {
  if (typeof rpcUrl === "string" && rpcUrl.trim()) return rpcUrl.trim();
  if (!isValidNetwork(network)) {
    throw new ReceiptResolverError(
      "invalid-network",
      `network must be 'mainnet' | 'testnet' | 'devnet', got '${network}'`,
    );
  }
  return DEFAULT_RPC_URLS[network];
}

function normalizeReceiptId(receiptId) {
  const id = typeof receiptId === "string" ? receiptId.trim() : "";
  if (!id) {
    throw new ReceiptResolverError("missing-receipt-id", "receiptId is required");
  }
  if (!SUI_OBJECT_ID_RE.test(id)) {
    throw new ReceiptResolverError(
      "invalid-receipt-id",
      `receiptId must be a 32-byte Sui object id (0x + 64 hex chars), got '${id}'`,
    );
  }
  return id.toLowerCase();
}

export function trustedReceiptPackageIds(network = "testnet") {
  return RECEIPT_PACKAGE_IDS_BY_NETWORK[network] || EMPTY_TRUSTED_PACKAGE_IDS;
}

function normalizePackageId(packageId, network = "testnet") {
  const id = typeof packageId === "string" ? packageId.trim() : "";
  if (!id || !SUI_OBJECT_ID_RE.test(id)) {
    throw new ReceiptResolverError(
      "invalid-package-id",
      `packageId must be a 32-byte Sui object id (0x + 64 hex chars), got '${packageId}'`,
    );
  }
  const normalized = id.toLowerCase();
  const trusted = trustedReceiptPackageIds(network);
  if (!trusted.includes(normalized)) {
    throw new ReceiptResolverError(
      "untrusted-package-id",
      `packageId '${normalized}' is not pinned as a trusted TIDE receipt package for ${network}`,
      { network, packageId: normalized, trustedPackageIds: trusted },
    );
  }
  return normalized;
}

function expectedReceiptType(packageId, network) {
  return `${normalizePackageId(packageId, network)}::execution_receipts::ExecutionReceipt`;
}

function normalizeMoveId(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeTimestampMs(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function normalizeDigestHex(value) {
  if (Array.isArray(value)) {
    if (value.length !== DIGEST_BYTES) return "";
    return "0x" + value
      .map((byte) => (Number(byte) & 0xff).toString(16).padStart(2, "0"))
      .join("");
  }
  if (typeof value === "string") {
    const hex = value.trim().toLowerCase();
    return DIGEST_HEX_RE.test(hex) ? hex : "";
  }
  return "";
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizeTimestampLikeMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric > 1e12 ? Math.floor(numeric) : Math.floor(numeric * 1000);
}

function normalizeMainnetTxDigest(value) {
  const digest = firstText(value);
  return SUI_TX_DIGEST_RE.test(digest) ? digest : "";
}

function sameLower(a, b) {
  const left = firstText(a).toLowerCase();
  const right = firstText(b).toLowerCase();
  return Boolean(left && right && left === right);
}

function decodeBundleJson(bundleBytes) {
  let text;
  try {
    text = new TextDecoder().decode(bundleBytes);
  } catch (err) {
    throw new ReceiptResolverError(
      "invalid-bundle",
      `bundleBytes could not be decoded as UTF-8: ${err?.message || err}`,
    );
  }
  try {
    const bundle = JSON.parse(text);
    if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
      throw new Error("bundle root must be an object");
    }
    return bundle;
  } catch (err) {
    throw new ReceiptResolverError(
      "invalid-bundle-json",
      `bundleBytes must contain canonical proof-bundle JSON: ${err?.message || err}`,
    );
  }
}

async function digestCanonicalHex(value, cryptoImpl = null) {
  const subtle = cryptoImpl?.subtle || globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== "function") {
    throw new ReceiptResolverError(
      "no-crypto-impl",
      "cryptoImpl.subtle.digest or globalThis.crypto.subtle.digest must be available",
    );
  }
  let canonical;
  try {
    canonical = canonicalizeBundle(value);
  } catch (err) {
    throw new ReceiptResolverError(
      "bundle-canonicalize-failed",
      err?.message || String(err),
    );
  }
  const buffer = await subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return "0x" + [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function pushMismatch(mismatches, field, expected, actual) {
  const e = expected == null ? "" : String(expected);
  const a = actual == null ? "" : String(actual);
  if (e !== a) mismatches.push({ field, expected: e, actual: a });
}

function checkBundleFreshnessAtMint({ receipt, bundle } = {}) {
  const receiptCreatedAtMs = normalizeTimestampMs(receipt?.createdAtMs);
  if (!receiptCreatedAtMs) {
    return {
      ok: false,
      reason: "missing-receipt-created-at-ms",
      maxAgeMs: DEFAULT_FRESHNESS_MS,
    };
  }
  const result = checkFreshness(bundle, { now: receiptCreatedAtMs });
  if (result.ok) {
    return {
      ok: true,
      ageMs: result.ageMs,
      maxAgeMs: DEFAULT_FRESHNESS_MS,
    };
  }
  const reason = result.reason === "stale"
    ? "stale-at-mint"
    : result.reason === "future-dated"
      ? "future-dated-at-mint"
      : result.reason === "missing createdAtMs"
        ? "missing-bundle-created-at-ms"
        : "invalid-bundle-freshness";
  return {
    ok: false,
    reason,
    ageMs: Number.isFinite(result.ageMs) ? result.ageMs : null,
    maxAgeMs: DEFAULT_FRESHNESS_MS,
  };
}

function inferExecutionMode(receipt) {
  const limitations = String(receipt?.limitations || "");
  if (limitations === "testnet-rehearsal") return "testnet-rehearsal";
  return "shadow-only";
}

function buildEvidencePosture({ receipt, bundle = null, verificationStatus = "pending" } = {}) {
  const classified = classifyBlobId(receipt?.walrusBlobId || "");
  const executionMode = inferExecutionMode(receipt);
  const isMainnetAttested = firstText(bundle?.kind).toLowerCase() === MAINNET_ATTESTED_KIND;
  const railDataMode = String(
    bundle?.report?.summary?.railDataMode ||
    (isMainnetAttested ? "live-mainnet-readonly" : "unknown"),
  );
  const pythSource = String(bundle?.report?.summary?.pythSource || "not-in-bundle");
  const claimBoundary = verificationStatus === "ok"
    ? "digest-and-fields"
    : verificationStatus === "pending"
    ? "resolver-only"
    : "verification-failed";
  return {
    railDataMode,
    walrusSource: classified.mode,
    pythSource,
    executionMode,
    claimBoundary,
  };
}

function extractMainnetEvidence(bundle) {
  const root = plainObject(bundle) || {};
  const rootNetwork = plainObject(root.network) || {};
  const rootKind = firstText(root.kind).toLowerCase();
  const rootClaimBoundary = firstText(root.claimBoundary).toLowerCase();
  const rootMainnetReadback = firstText(rootNetwork.mainnetReadback).toLowerCase();
  const candidates = [
    root.mainnetAttestation,
    root.mainnetEvidence,
    root.mainnetObservation,
    root.manualMainnetEvent,
    plainObject(root.evidence)?.mainnet,
    plainObject(root.protocolEvidence)?.mainnet,
    plainObject(root.attestation)?.mainnet,
  ].map(plainObject).filter(Boolean);

  for (const candidate of candidates) {
    const network = firstText(candidate.network, candidate.sourceNetwork, candidate.chain, rootMainnetReadback).toLowerCase();
    const source = firstText(candidate.source, candidate.mode, candidate.railDataMode, candidate.evidenceMode).toLowerCase();
    const txDigest = normalizeMainnetTxDigest(
      candidate.digest,
      candidate.txDigest,
      candidate.mainnetTxDigest,
      candidate.manualTxDigest,
      candidate.repayTxDigest,
      candidate.actionTxDigest,
      plainObject(candidate.tx)?.digest,
    );
    const eventBased = candidate.eventBased === true;
    const manual = candidate.manualExecution === true
      || candidate.founderExecuted === true
      || source.includes("manual")
      || eventBased
      || rootClaimBoundary.includes("founder-manual");
    const observed = source.includes("mainnet")
      || source.includes("readonly")
      || source.includes("read-only")
      || network === "mainnet"
      || rootKind === MAINNET_ATTESTED_KIND
      || rootMainnetReadback === "mainnet";
    if (!txDigest && !manual && !observed) continue;
    return {
      network: network || "mainnet",
      source: source || (eventBased ? "manual-mainnet-event" : "live-mainnet-readonly"),
      railId: firstText(candidate.railId, candidate.rail, candidate.protocol, root?.policy?.selectedRail),
      action: firstText(candidate.action, candidate.actionType, candidate.decision, root.action, root.decisionType),
      txDigest,
      sender: firstText(candidate.sender, plainObject(candidate.tx)?.sender).toLowerCase(),
      obligationId: firstText(candidate.obligationId, candidate.accountId, candidate.positionId).toLowerCase(),
      checkpoint: firstText(candidate.checkpoint, plainObject(candidate.tx)?.checkpoint),
      timestampMs: normalizeTimestampLikeMs(candidate.timestampMs || plainObject(candidate.tx)?.timestampMs),
      objectChangeCount: Number(candidate.objectChangeCount),
      preDigest: normalizeDigestHex(
        candidate.preStateDigest || candidate.stateBeforeDigest || plainObject(candidate.pre)?.digest || root.preStateDigest || plainObject(root.pre)?.digest,
      ),
      postDigest: normalizeDigestHex(
        candidate.postStateDigest || plainObject(candidate.post)?.digest || root.postStateDigest || plainObject(root.post)?.digest,
      ),
      decisionMatch: typeof candidate.decisionMatch === "boolean"
        ? candidate.decisionMatch
        : typeof root.decisionMatch === "boolean"
          ? root.decisionMatch
          : null,
      manualExecution: manual,
    };
  }
  return null;
}

function validateMainnetAttestedSemantics(bundle, mainnetEvidence) {
  const mismatches = [];
  const fail = (field, expected, actual) => {
    mismatches.push({ field, expected: String(expected ?? ""), actual: String(actual ?? "") });
  };
  const network = plainObject(bundle?.network) || {};
  const rail = firstText(bundle?.rail);
  const railId = firstText(bundle?.railId);
  const claimBoundary = firstText(bundle?.claimBoundary);
  const ownerAddress = firstText(bundle?.ownerAddress).toLowerCase();
  const obligationId = firstText(bundle?.obligationId).toLowerCase();
  const mainnetEvidenceRecord = plainObject(bundle?.mainnetEvidence) || {};
  const evidenceSender = firstText(mainnetEvidenceRecord.sender).toLowerCase();
  const evidenceObligationId = firstText(mainnetEvidenceRecord.obligationId).toLowerCase();

  if (Number(bundle?.schemaVersion) !== 1) fail("schemaVersion", "1", bundle?.schemaVersion);
  if (!MAINNET_ATTESTED_RAILS.has(rail)) fail("rail", "suilend|scallop|navi", rail);
  if (railId !== `${rail}-sui`) fail("railId", `${rail}-sui`, railId);
  if (firstText(network.mainnetReadback) !== "mainnet") {
    fail("network.mainnetReadback", "mainnet", network.mainnetReadback);
  }
  if (firstText(network.receiptMint) !== "testnet") {
    fail("network.receiptMint", "testnet", network.receiptMint);
  }
  for (const token of MAINNET_ATTESTED_CLAIM_BOUNDARY_TOKENS) {
    if (!claimBoundary.includes(token)) fail("claimBoundary", `contains ${token}`, claimBoundary || "(empty)");
  }
  if (!MAINNET_ATTESTED_DECISION_TYPES.has(firstText(bundle?.decisionType))) {
    fail("decisionType", "canonical decision type", bundle?.decisionType);
  }
  if (firstText(bundle?.limitations) !== "testnet-rehearsal") {
    fail("limitations", "testnet-rehearsal", bundle?.limitations);
  }
  if (!SUI_OBJECT_ID_RE.test(ownerAddress)) {
    fail("ownerAddress", "0x-prefixed Sui address", bundle?.ownerAddress);
  }
  if (!SUI_OBJECT_ID_RE.test(obligationId)) {
    fail("obligationId", "0x-prefixed Sui object id", bundle?.obligationId);
  }
  if (!SUI_OBJECT_ID_RE.test(evidenceSender)) {
    fail("mainnetEvidence.sender", "0x-prefixed Sui address", mainnetEvidenceRecord.sender);
  }
  if (!SUI_OBJECT_ID_RE.test(evidenceObligationId)) {
    fail("mainnetEvidence.obligationId", "0x-prefixed Sui object id", mainnetEvidenceRecord.obligationId);
  }
  if (!SUI_TX_DIGEST_RE.test(firstText(bundle?.mainnetEvidence?.digest))) {
    fail("mainnetEvidence.digest", "base58 Sui tx digest", bundle?.mainnetEvidence?.digest);
  }
  if (!firstText(bundle?.mainnetEvidence?.checkpoint)) {
    fail("mainnetEvidence.checkpoint", "non-empty checkpoint", bundle?.mainnetEvidence?.checkpoint);
  }
  if (!Number.isFinite(Number(bundle?.mainnetEvidence?.objectChangeCount)) ||
      Number(bundle?.mainnetEvidence?.objectChangeCount) <= 0) {
    fail("mainnetEvidence.objectChangeCount", "> 0", bundle?.mainnetEvidence?.objectChangeCount);
  }
  if (!Number.isFinite(Number(bundle?.mainnetEvidence?.timestampMs)) ||
      Number(bundle?.mainnetEvidence?.timestampMs) <= 0) {
    fail("mainnetEvidence.timestampMs", "positive timestamp", bundle?.mainnetEvidence?.timestampMs);
  }
  if (!sameLower(ownerAddress, evidenceSender)) {
    fail("mainnetEvidence.sender", ownerAddress, mainnetEvidenceRecord.sender);
  }
  if (!sameLower(obligationId, evidenceObligationId)) {
    fail("mainnetEvidence.obligationId", obligationId, evidenceObligationId);
  }
  if (!sameLower(mainnetEvidence?.sender, evidenceSender)) {
    fail("extracted.sender", mainnetEvidenceRecord.sender, mainnetEvidence?.sender);
  }
  if (!sameLower(mainnetEvidence?.obligationId, evidenceObligationId)) {
    fail("extracted.obligationId", mainnetEvidenceRecord.obligationId, mainnetEvidence?.obligationId);
  }
  return mismatches;
}

function checkMainnetEvidenceFreshnessAtMint(receipt, bundle) {
  const receiptCreatedAtMs = normalizeTimestampMs(receipt?.createdAtMs);
  if (!receiptCreatedAtMs) {
    return {
      ok: false,
      reason: "missing-receipt-created-at-ms",
      maxAgeMs: DEFAULT_FRESHNESS_MS,
    };
  }
  const evidenceAtMs = normalizeTimestampLikeMs(bundle?.mainnetEvidence?.timestampMs)
    || normalizeTimestampLikeMs(bundle?.observedAt)
    || normalizeTimestampLikeMs(bundle?.createdAtMs);
  if (!evidenceAtMs) {
    return {
      ok: false,
      reason: "missing-mainnet-evidence-timestamp",
      maxAgeMs: DEFAULT_FRESHNESS_MS,
    };
  }
  if (evidenceAtMs > receiptCreatedAtMs + FRESHNESS_TOLERANCE_MS) {
    return {
      ok: false,
      reason: "future-dated-at-mint",
      ageMs: evidenceAtMs - receiptCreatedAtMs,
      maxAgeMs: DEFAULT_FRESHNESS_MS,
    };
  }
  const ageMs = receiptCreatedAtMs - evidenceAtMs;
  if (ageMs > DEFAULT_FRESHNESS_MS) {
    return {
      ok: false,
      reason: "stale-at-mint",
      ageMs,
      maxAgeMs: DEFAULT_FRESHNESS_MS,
    };
  }
  return { ok: true, ageMs, maxAgeMs: DEFAULT_FRESHNESS_MS };
}

async function verifyMainnetAttestedBundle({ receipt, bundle, expected, actual, mainnetEvidence, cryptoImpl = null }) {
  if (!mainnetEvidence) {
    return {
      ok: false,
      reason: "missing-mainnet-evidence",
      expected,
      actual,
      algorithm: "sha-256",
      freshness: null,
      mismatches: [],
      mainnetEvidence: null,
    };
  }
  const freshness = checkMainnetEvidenceFreshnessAtMint(receipt, bundle);
  if (!freshness.ok) {
    return { ok: false, reason: freshness.reason, expected, actual, algorithm: "sha-256", freshness, mismatches: [], mainnetEvidence };
  }
  const semanticMismatches = validateMainnetAttestedSemantics(bundle, mainnetEvidence);
  if (semanticMismatches.length > 0) {
    return {
      ok: false,
      reason: "mainnet-attested-semantic-mismatch",
      expected,
      actual,
      algorithm: "sha-256",
      freshness,
      mismatches: semanticMismatches,
      mainnetEvidence,
    };
  }
  const pre = plainObject(bundle?.pre) || {};
  const actualStateDigest = await digestCanonicalHex({
    collateralUsd: Number(pre.collateralUsd) || 0,
    debtUsd: Number(pre.debtUsd) || 0,
    ltvBps: Number(pre.ltvBps) || 0,
  }, cryptoImpl);
  const mismatches = [];
  pushMismatch(mismatches, "action", receipt.action || "", bundle.action || "");
  pushMismatch(mismatches, "decisionType", receipt.decisionType || "", bundle.decisionType || "");
  pushMismatch(mismatches, "limitations", receipt.limitations || "", bundle.limitations || "");
  pushMismatch(mismatches, "selectedRail", receipt.selectedRail || "", bundle.selectedRail || bundle.railId || "");
  pushMismatch(mismatches, "stateBeforeDigest", normalizeDigestHex(receipt.stateBeforeDigestHex || receipt.stateBeforeDigest), actualStateDigest);
  pushMismatch(mismatches, "railPackDigest", normalizeDigestHex(receipt.railPackDigestHex || receipt.railPackDigest), actual);
  return {
    ok: mismatches.length === 0,
    reason: mismatches.length === 0 ? "mainnet-attested-match" : "semantic-mismatch",
    expected,
    actual,
    algorithm: "sha-256",
    freshness,
    mismatches,
    mainnetEvidence,
  };
}

async function verifyReceiptBundleSemantics({ receipt, bundle, cryptoImpl = null }) {
  const expectedContent = normalizeDigestHex(receipt.contentDigestHex || receipt.contentDigest);
  if (!expectedContent) {
    throw new ReceiptResolverError(
      "missing-receipt-digest",
      "receipt.contentDigestHex is missing or malformed",
    );
  }
  const actualContent = await digestCanonicalHex(bundle, cryptoImpl);
  if (actualContent !== expectedContent) {
    return {
      ok: false,
      reason: "digest-mismatch",
      expected: expectedContent,
      actual: actualContent,
      algorithm: "sha-256",
      mismatches: [],
    };
  }

  const isMainnetAttested = firstText(bundle?.kind).toLowerCase() === MAINNET_ATTESTED_KIND;
  if (isMainnetAttested) {
    return verifyMainnetAttestedBundle({
      receipt,
      bundle,
      expected: expectedContent,
      actual: actualContent,
      mainnetEvidence: extractMainnetEvidence(bundle),
      cryptoImpl,
    });
  }

  const bundleVersion = Number(bundle?.version);
  if (!SUPPORTED_PROOF_BUNDLE_VERSIONS.has(bundleVersion)) {
    return {
      ok: false,
      reason: "unsupported-bundle-version",
      expected: expectedContent,
      actual: actualContent,
      algorithm: "sha-256",
      mismatches: [],
    };
  }

  const freshness = checkBundleFreshnessAtMint({ receipt, bundle });
  if (!freshness.ok) {
    return {
      ok: false,
      reason: freshness.reason,
      expected: expectedContent,
      actual: actualContent,
      algorithm: "sha-256",
      freshness,
      mismatches: [],
    };
  }

  const actualStateDigest = await digestCanonicalHex({
    version: PROOF_BUNDLE_VERSION,
    stateBefore: bundle.stateBefore,
  }, cryptoImpl);
  const actualRailPackDigest = normalizeDigestHex(bundle?.railPack?.digest);
  const mismatches = [];
  pushMismatch(mismatches, "policyId", normalizeMoveId(receipt.policyId), normalizeMoveId(bundle?.policy?.id));
  pushMismatch(mismatches, "policyVersion", Number(receipt.policyVersion) || 0, Number(bundle?.policy?.version) || 0);
  pushMismatch(mismatches, "owner", normalizeMoveId(receipt.owner), normalizeMoveId(bundle?.policy?.owner));
  pushMismatch(mismatches, "action", receipt.action || "", bundle.action || "");
  pushMismatch(mismatches, "decisionType", receipt.decisionType || "", bundle.decisionType || "");
  pushMismatch(mismatches, "limitations", receipt.limitations || "", bundle.limitations || "");
  pushMismatch(mismatches, "selectedRail", receipt.selectedRail || "", bundle?.policy?.selectedRail || "");
  pushMismatch(
    mismatches,
    "stateBeforeDigest",
    normalizeDigestHex(receipt.stateBeforeDigestHex || receipt.stateBeforeDigest),
    actualStateDigest,
  );
  pushMismatch(
    mismatches,
    "railPackDigest",
    normalizeDigestHex(receipt.railPackDigestHex || receipt.railPackDigest),
    actualRailPackDigest,
  );

  return {
    ok: mismatches.length === 0,
    reason: mismatches.length === 0 ? "match" : "semantic-mismatch",
    expected: expectedContent,
    actual: actualContent,
    algorithm: "sha-256",
    freshness,
    mismatches,
  };
}

export async function resolveReceiptFromRpc({
  receiptId,
  network = "testnet",
  packageId,
  rpcUrl = null,
  fetchImpl = null,
} = {}) {
  const id = normalizeReceiptId(receiptId);
  const url = resolveRpcUrl({ network, rpcUrl });
  const pinnedPackageId = normalizePackageId(packageId, network);
  const expectedType = expectedReceiptType(pinnedPackageId, network);
  const fetcher = fetchImpl || globalThis.fetch;
  if (typeof fetcher !== "function") {
    throw new ReceiptResolverError(
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
        params: [id, { showContent: true, showOwner: true, showType: true }],
      }),
    });
  } catch (err) {
    throw new ReceiptResolverError(
      "rpc-fetch-failed",
      `RPC fetch failed: ${err?.message || err}`,
      { url },
    );
  }
  if (!response || typeof response.json !== "function") {
    throw new ReceiptResolverError("rpc-bad-response", "RPC response is not JSON-shaped");
  }
  if (response.ok === false) {
    throw new ReceiptResolverError(
      "rpc-http-error",
      `RPC ${url} returned HTTP ${response.status}`,
      { status: response.status },
    );
  }

  const payload = await response.json();
  if (payload?.error) {
    throw new ReceiptResolverError(
      "rpc-error",
      payload.error.message || "RPC error",
      { rpcError: payload.error },
    );
  }
  const result = payload?.result;
  if (result?.error) {
    if (result.error.code === "notExists" || /not exist/i.test(result.error.code || "")) {
      throw new ReceiptResolverError(
        "receipt-not-found",
        `Receipt ${id} does not exist on ${network}`,
        { network, receiptId: id },
      );
    }
    throw new ReceiptResolverError(
      "rpc-result-error",
      result.error.code || "result error",
      { resultError: result.error },
    );
  }
  if (!result?.data) {
    throw new ReceiptResolverError(
      "receipt-empty",
      "RPC returned an empty result",
      { receiptId: id },
    );
  }
  const cfg = { sui: { network }, executionReceipts: { packageId: pinnedPackageId } };
  const receipt = normalizeReceiptObject(result, cfg);
  if (!receipt) {
    throw new ReceiptResolverError(
      "receipt-malformed",
      "RPC returned an object that did not parse as a receipt",
      { receiptId: id },
    );
  }
  const receiptObjectId = normalizeMoveId(receipt.id);
  if (!SUI_OBJECT_ID_RE.test(receiptObjectId)) {
    throw new ReceiptResolverError(
      "receipt-invalid-id",
      `RPC returned receipt object id '${receipt.id}', expected a 32-byte Sui object id`,
      { receiptId: id, returnedReceiptId: receipt.id },
    );
  }
  if (receiptObjectId !== id) {
    throw new ReceiptResolverError(
      "receipt-id-mismatch",
      `RPC returned receipt object '${receiptObjectId}' for requested receipt '${id}'`,
      { receiptId: id, returnedReceiptId: receiptObjectId },
    );
  }
  const objectType = String(receipt.objectType || "");
  if (objectType !== expectedType) {
    throw new ReceiptResolverError(
      "receipt-wrong-type",
      `object ${id} is type '${objectType}', expected '${expectedType}'`,
      { receiptId: id, objectType, expectedType },
    );
  }

  return receipt;
}

// Parse the supplied canonical proof-bundle JSON, recompute its
// content_digest, and compare all load-bearing receipt fields against
// the bundle. A digest match alone is not enough: the verifier must also
// prove the bundle belongs to this receipt's policy/version/rail/action.
//
// The bundle is the canonical proof-bundle JSON the receipt anchors;
// for an off-chain Walrus / stub fetch flow, the integrator passes the
// fetched bundle bytes here.
export async function verifyReceiptDigest({
  receipt,
  bundleBytes,
  cryptoImpl = null,
} = {}) {
  if (!receipt || typeof receipt !== "object") {
    throw new ReceiptResolverError("invalid-receipt", "receipt is required");
  }
  if (!(bundleBytes instanceof Uint8Array)) {
    throw new ReceiptResolverError(
      "invalid-bundle",
      "bundleBytes must be a Uint8Array",
    );
  }
  const bundle = decodeBundleJson(bundleBytes);
  return verifyReceiptBundleSemantics({ receipt, bundle, cryptoImpl });
}

// Bundle the resolver outputs into a render-ready view that the read-only
// HTML page (or the CLI) can show without further transforms. Includes
// the canonical share payload (from receipt-share.mjs) + a verification
// status block. Caller supplies `bundleBytes` only when it has already
// fetched the off-chain bundle; otherwise verification is `pending`.
export async function buildResolvedReceiptView({
  receipt,
  network = "testnet",
  bundleBytes = null,
  origin = "",
  cryptoImpl = null,
} = {}) {
  if (!receipt || typeof receipt !== "object") {
    throw new ReceiptResolverError("invalid-receipt", "receipt is required");
  }
  const cfg = { sui: { network } };
  const canonical = buildReceiptCanonicalPayload(receipt, { config: cfg, network });
  const classified = classifyBlobId(receipt?.walrusBlobId || "");

  let verification = {
    status: "pending",
    reason: classified.mode === "stub"
      ? "stub-no-offchain-bytes"
      : classified.mode === "walrus"
        ? "walrus-fetch-pending"
        : "bundle-not-supplied",
    message: classified.mode === "stub"
      ? "Stub anchor: the on-chain digest is pinned, but no off-chain Walrus bytes exist to fetch; supply the original canonical bundle file to verify content and freshness."
      : classified.mode === "walrus"
        ? "Walrus bundle not fetched; fetch or supply bundleBytes before treating this proof as verified."
        : "Bundle not supplied; supply bundleBytes to verify the content digest.",
  };
  let decodedBundle = null;
  if (bundleBytes instanceof Uint8Array) {
    try {
      decodedBundle = decodeBundleJson(bundleBytes);
      const result = await verifyReceiptDigest({ receipt, bundleBytes, cryptoImpl });
      verification = {
        status: result.ok ? "ok" : "fail",
        message: result.ok
          ? `Proof bundle digest and load-bearing receipt fields match.`
          : result.reason === "semantic-mismatch"
            ? `Bundle digest matches, but ${result.mismatches.length} receipt field(s) differ.`
            : result.reason === "stale-at-mint"
              ? `Bundle digest matches, but the bundle was stale when this receipt was minted.`
              : result.reason === "future-dated-at-mint"
                ? `Bundle digest matches, but the bundle timestamp is after the receipt mint time.`
                : result.reason === "missing-bundle-created-at-ms"
                  ? `Bundle digest matches, but bundle.createdAtMs is missing.`
                  : result.reason === "missing-receipt-created-at-ms"
                    ? `Bundle digest matches, but receipt.createdAtMs is missing.`
                    : `Mismatch: on-chain digest ${result.expected}, computed ${result.actual}.`,
        expected: result.expected,
        actual: result.actual,
        algorithm: result.algorithm,
        reason: result.reason,
        freshness: result.freshness,
        mismatches: result.mismatches || [],
      };
    } catch (err) {
      verification = {
        status: "error",
        message: err?.message || String(err),
        code: err?.code || "verify-failed",
      };
    }
  }

  const explorerUrl = buildReceiptExplorerUrl(receipt, { config: cfg, network });
  return {
    canonical,
    explorerUrl,
    readOnlyUrl: origin
      ? buildReceiptReadOnlyUrl(receipt, { config: cfg, network, origin })
      : "",
    evidencePosture: buildEvidencePosture({
      receipt,
      bundle: decodedBundle,
      verificationStatus: verification.status,
    }),
    verification,
  };
}
