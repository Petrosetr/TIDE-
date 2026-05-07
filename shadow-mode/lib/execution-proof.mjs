// Execution proof bundles.
//
// A proof bundle is the off-chain record that an on-chain ExecutionReceipt
// anchors. The Move layer stores only two digests (rail_pack_digest and
// content_digest) plus a Walrus blob id. A verifier fetches the bundle
// from the blob id, recomputes the content digest over the canonical
// form, and checks equality. If they match, the bundle in hand is
// exactly what the receipt attests.
//
// Canonicalization rules (kept deliberately simple):
//   - Objects: keys sorted lexicographically at every level
//   - Arrays: preserved in source order
//   - Numbers: finite only (no NaN/Infinity); integers serialize as-is,
//     floats use JSON's default representation
//   - Strings: passed through
//   - null: allowed
//   - undefined / functions / symbols: rejected (not representable)
//
// Walrus integration is explicit: when a publisher URL is configured the
// canonical bundle bytes are uploaded through walrus-storage.mjs; otherwise
// `publishStub(digest)` returns a deterministic
// `tide-stub://<network>/sha256/<hex>` reference. The bundle shape and
// digests don't change between modes.

import { emitObservation } from "./observation-bus.mjs";
import { publishToWalrus as publishBytesToWalrus } from "./walrus-storage.mjs";

export const PROOF_BUNDLE_VERSION = 2;
export const SUPPORTED_PROOF_BUNDLE_VERSIONS = new Set([1, 2]);

export const DECISION_TYPES = Object.freeze([
  "Hold",
  "BuildBuffer",
  "BorrowForBuffer",
  "PartialRepay",
  "EmergencyDeRisk",
  "ReducePayout",
  "PausePayout",
  "RotateVenue",
]);

export const PROOF_LIMITATIONS = Object.freeze([
  "shadow-only",
  "testnet-rehearsal",
]);

// Default freshness window. Short enough that a bundle can't be
// replayed days later; long enough to survive a slow wallet-signing UX.
export const DEFAULT_FRESHNESS_MS = 5 * 60 * 1000;

// Stable digest length of SHA-256, in bytes. The Move side asserts this.
export const DIGEST_BYTES = 32;
export const CORRELATION_ID_HEX_LENGTH = 64;

function assertSerializable(value, path) {
  const t = typeof value;
  if (value === undefined || value === null) return;
  if (t === "string" || t === "boolean") return;
  if (t === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`proof bundle: non-finite number at ${path}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSerializable(item, `${path}[${index}]`));
    return;
  }
  if (t === "object") {
    for (const key of Object.keys(value)) {
      assertSerializable(value[key], `${path}.${key}`);
    }
    return;
  }
  throw new Error(`proof bundle: unsupported value (${t}) at ${path}`);
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const out = {};
    const keys = Object.keys(value).sort();
    for (const key of keys) {
      const next = value[key];
      if (next === undefined) continue;
      out[key] = sortKeysDeep(next);
    }
    return out;
  }
  return value;
}

export function canonicalizeBundle(bundle) {
  assertSerializable(bundle, "$");
  return JSON.stringify(sortKeysDeep(bundle));
}

function getSubtle() {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) {
    throw new Error("crypto.subtle is not available in this environment");
  }
  return subtle;
}

export async function digestBundle(bundle) {
  const canonical = canonicalizeBundle(bundle);
  const bytes = new TextEncoder().encode(canonical);
  const hashBuffer = await getSubtle().digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashBuffer));
}

export function toHexDigest(digestBytes) {
  if (!Array.isArray(digestBytes) || digestBytes.length === 0) return "";
  return digestBytes.map((b) => (b & 0xff).toString(16).padStart(2, "0")).join("");
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`proof bundle: ${label} must be a non-empty string`);
  }
  return value.trim();
}

function requireKnownString(value, label, allowed) {
  const normalized = requireString(value, label);
  if (!allowed.includes(normalized)) {
    throw new Error(`proof bundle: ${label} must be one of ${allowed.join(", ")}`);
  }
  return normalized;
}

function requireFiniteNumber(value, label) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`proof bundle: ${label} must be a finite number`);
  }
  return numeric;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rejectUnsupportedKeys(value, allowed, label) {
  const extra = Object.keys(value).filter((key) => !allowed.has(key));
  if (extra.length) {
    throw new Error(`proof bundle: ${label} has unsupported key(s): ${extra.join(", ")}`);
  }
}

function optionalString(value, label) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`proof bundle: ${label} must be a string`);
  }
  return value;
}

function optionalFiniteNumber(value, label) {
  if (value === undefined || value === null) return value === null ? null : undefined;
  return requireFiniteNumber(value, label);
}

function optionalBoolean(value, label) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`proof bundle: ${label} must be a boolean`);
  }
  return value;
}

function assignDefined(target, key, value) {
  if (value !== undefined) target[key] = value;
}

function hash64Hex(input, seed) {
  const bytes = new TextEncoder().encode(input);
  let hash = (0xcbf29ce484222325n ^ seed) & 0xffffffffffffffffn;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

function normalizeCorrelationId(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new Error("proof bundle: correlationId must be a 32-byte hex string");
  }
  const normalized = value.trim().replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("proof bundle: correlationId must be a 32-byte hex string");
  }
  return normalized;
}

export function buildProofCorrelationId({
  policyId,
  policyVersion,
  action,
  createdAtMs,
  nonce = "",
} = {}) {
  const normalizedNonce = optionalString(nonce, "correlationNonce") || "";
  const basis = JSON.stringify({
    policyId: requireString(policyId, "correlation.policyId"),
    policyVersion: Math.max(0, Math.round(requireFiniteNumber(policyVersion, "correlation.policyVersion"))),
    action: requireString(action, "correlation.action"),
    createdAtMs: Math.round(requireFiniteNumber(createdAtMs, "correlation.createdAtMs")),
    nonce: normalizedNonce,
  });
  return [
    0x00n,
    0x9e3779b97f4a7c15n,
    0xc2b2ae3d27d4eb4fn,
    0x165667b19e3779f9n,
  ].map((seed) => hash64Hex(basis, seed)).join("");
}

const PUBLIC_REPORT_SUMMARY_KEYS = new Set([
  "actionExamples",
  "averageHealthScore",
  "backupRailId",
  "backupRailName",
  "baselineCarryCostUsd",
  "baselineHorizonDays",
  "baselineRebalanceCostUsd",
  "breakwaterTriggerDrawdownPct",
  "bufferCoverageDays",
  "currentLtv",
  "freshestRailUpdateAt",
  "liquidationScenarioLabel",
  "liveRailCount",
  "monthlyPayoutUsd",
  "oldestRailUpdateAt",
  "primaryRailId",
  "primaryRailName",
  "projectedTideFeeBpsAnnual",
  "projectedTideFeePctOfPayout",
  "projectedTideFeeUsd30d",
  "railCount",
  "railDataMode",
  "railWarnings",
  "survivablePayoutBandHighUsd",
  "survivablePayoutBandLowUsd",
  "worstCaseLiquidationPenaltyUsd",
  "worstCaseTotalDragUsd",
  "worstOperatingState",
]);

const PUBLIC_ACTION_EXAMPLE_KEYS = new Set([
  "amountUsd",
  "explanation",
  "metadata",
  "reason",
  "type",
]);

const PUBLIC_ACTION_METADATA_KEYS = new Set([
  "autoRepayLtv",
  "currentLtv",
  "regime",
  "shortfallUsd",
  "sustainablePayoutUsd",
  "targetLtvLow",
  "targetPayoutUsd",
  "venueBreach",
  "wrapperBreach",
]);

function normalizeActionExampleMetadata(value, path) {
  if (value === undefined || value === null) return undefined;
  if (!isPlainObject(value)) {
    throw new Error(`proof bundle: ${path} must be an object`);
  }
  rejectUnsupportedKeys(value, PUBLIC_ACTION_METADATA_KEYS, path);
  const out = {};
  assignDefined(out, "autoRepayLtv", optionalFiniteNumber(value.autoRepayLtv, `${path}.autoRepayLtv`));
  assignDefined(out, "currentLtv", optionalFiniteNumber(value.currentLtv, `${path}.currentLtv`));
  assignDefined(out, "regime", optionalString(value.regime, `${path}.regime`));
  assignDefined(out, "shortfallUsd", optionalFiniteNumber(value.shortfallUsd, `${path}.shortfallUsd`));
  assignDefined(out, "sustainablePayoutUsd", optionalFiniteNumber(value.sustainablePayoutUsd, `${path}.sustainablePayoutUsd`));
  assignDefined(out, "targetLtvLow", optionalFiniteNumber(value.targetLtvLow, `${path}.targetLtvLow`));
  assignDefined(out, "targetPayoutUsd", optionalFiniteNumber(value.targetPayoutUsd, `${path}.targetPayoutUsd`));
  assignDefined(out, "venueBreach", optionalBoolean(value.venueBreach, `${path}.venueBreach`));
  assignDefined(out, "wrapperBreach", optionalBoolean(value.wrapperBreach, `${path}.wrapperBreach`));
  return out;
}

function normalizeActionExamples(value, path) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`proof bundle: ${path} must be an array`);
  }
  return value.slice(0, 4).map((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isPlainObject(entry)) {
      throw new Error(`proof bundle: ${entryPath} must be an object`);
    }
    rejectUnsupportedKeys(entry, PUBLIC_ACTION_EXAMPLE_KEYS, entryPath);
    const out = {
      type: requireKnownString(entry.type, `${entryPath}.type`, DECISION_TYPES),
      reason: requireString(entry.reason, `${entryPath}.reason`),
      explanation: requireString(entry.explanation, `${entryPath}.explanation`),
    };
    assignDefined(out, "amountUsd", optionalFiniteNumber(entry.amountUsd, `${entryPath}.amountUsd`));
    assignDefined(out, "metadata", normalizeActionExampleMetadata(entry.metadata, `${entryPath}.metadata`));
    return out;
  });
}

function normalizeStringArray(value, path, limit = Infinity) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`proof bundle: ${path} must be an array`);
  }
  return value.slice(0, limit).map((entry, index) => requireString(entry, `${path}[${index}]`));
}

export function normalizeProofReportSummary(value = {}) {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) {
    throw new Error("proof bundle: report.summary must be an object");
  }
  rejectUnsupportedKeys(value, PUBLIC_REPORT_SUMMARY_KEYS, "report.summary");
  const out = {};
  assignDefined(out, "survivablePayoutBandLowUsd", optionalFiniteNumber(value.survivablePayoutBandLowUsd, "report.summary.survivablePayoutBandLowUsd"));
  assignDefined(out, "survivablePayoutBandHighUsd", optionalFiniteNumber(value.survivablePayoutBandHighUsd, "report.summary.survivablePayoutBandHighUsd"));
  assignDefined(out, "currentLtv", optionalFiniteNumber(value.currentLtv, "report.summary.currentLtv"));
  assignDefined(out, "bufferCoverageDays", optionalFiniteNumber(value.bufferCoverageDays, "report.summary.bufferCoverageDays"));
  assignDefined(out, "baselineHorizonDays", optionalFiniteNumber(value.baselineHorizonDays, "report.summary.baselineHorizonDays"));
  assignDefined(out, "baselineCarryCostUsd", optionalFiniteNumber(value.baselineCarryCostUsd, "report.summary.baselineCarryCostUsd"));
  assignDefined(out, "baselineRebalanceCostUsd", optionalFiniteNumber(value.baselineRebalanceCostUsd, "report.summary.baselineRebalanceCostUsd"));
  assignDefined(out, "breakwaterTriggerDrawdownPct", optionalFiniteNumber(value.breakwaterTriggerDrawdownPct, "report.summary.breakwaterTriggerDrawdownPct"));
  assignDefined(out, "averageHealthScore", optionalFiniteNumber(value.averageHealthScore, "report.summary.averageHealthScore"));
  assignDefined(out, "worstOperatingState", optionalString(value.worstOperatingState, "report.summary.worstOperatingState"));
  assignDefined(out, "worstCaseTotalDragUsd", optionalFiniteNumber(value.worstCaseTotalDragUsd, "report.summary.worstCaseTotalDragUsd"));
  assignDefined(out, "worstCaseLiquidationPenaltyUsd", optionalFiniteNumber(value.worstCaseLiquidationPenaltyUsd, "report.summary.worstCaseLiquidationPenaltyUsd"));
  assignDefined(out, "liquidationScenarioLabel", optionalString(value.liquidationScenarioLabel, "report.summary.liquidationScenarioLabel"));
  assignDefined(out, "projectedTideFeeBpsAnnual", optionalFiniteNumber(value.projectedTideFeeBpsAnnual, "report.summary.projectedTideFeeBpsAnnual"));
  assignDefined(out, "projectedTideFeeUsd30d", optionalFiniteNumber(value.projectedTideFeeUsd30d, "report.summary.projectedTideFeeUsd30d"));
  assignDefined(out, "projectedTideFeePctOfPayout", optionalFiniteNumber(value.projectedTideFeePctOfPayout, "report.summary.projectedTideFeePctOfPayout"));
  assignDefined(out, "actionExamples", normalizeActionExamples(value.actionExamples, "report.summary.actionExamples"));
  assignDefined(out, "primaryRailId", optionalString(value.primaryRailId, "report.summary.primaryRailId"));
  assignDefined(out, "primaryRailName", optionalString(value.primaryRailName, "report.summary.primaryRailName"));
  assignDefined(out, "backupRailId", optionalString(value.backupRailId, "report.summary.backupRailId"));
  assignDefined(out, "backupRailName", optionalString(value.backupRailName, "report.summary.backupRailName"));
  assignDefined(out, "railWarnings", normalizeStringArray(value.railWarnings, "report.summary.railWarnings", 6));
  assignDefined(out, "railDataMode", optionalString(value.railDataMode, "report.summary.railDataMode"));
  assignDefined(out, "railCount", optionalFiniteNumber(value.railCount, "report.summary.railCount"));
  assignDefined(out, "liveRailCount", optionalFiniteNumber(value.liveRailCount, "report.summary.liveRailCount"));
  assignDefined(out, "oldestRailUpdateAt", optionalString(value.oldestRailUpdateAt, "report.summary.oldestRailUpdateAt"));
  assignDefined(out, "freshestRailUpdateAt", optionalString(value.freshestRailUpdateAt, "report.summary.freshestRailUpdateAt"));
  assignDefined(out, "monthlyPayoutUsd", optionalFiniteNumber(value.monthlyPayoutUsd, "report.summary.monthlyPayoutUsd"));
  return out;
}

function normalizeProofReport(report) {
  if (!isPlainObject(report)) {
    throw new Error("proof bundle: report must be an object");
  }
  rejectUnsupportedKeys(report, new Set(["summary", "schemaVersion"]), "report");
  return {
    summary: normalizeProofReportSummary(report.summary),
    schemaVersion: Number(report.schemaVersion) || 1,
  };
}

export function normalizeStateBeforeDigestInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("proof bundle: stateBefore must be an object");
  }
  const allowed = new Set(["ltvBps", "bufferUsd", "stressLabel"]);
  const keys = Object.keys(value);
  const extra = keys.filter((key) => !allowed.has(key));
  if (extra.length) {
    throw new Error(`proof bundle: stateBefore has unsupported key(s): ${extra.join(", ")}`);
  }
  for (const key of allowed) {
    if (!keys.includes(key)) {
      throw new Error(`proof bundle: stateBefore.${key} is required`);
    }
  }
  return {
    ltvBps: Math.max(0, Math.round(requireFiniteNumber(value.ltvBps, "stateBefore.ltvBps"))),
    bufferUsd: Math.max(0, Math.round(requireFiniteNumber(value.bufferUsd, "stateBefore.bufferUsd"))),
    stressLabel: requireString(value.stressLabel, "stateBefore.stressLabel"),
  };
}

export function normalizeDecisionAttestation(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("proof bundle: decision attestation must be an object");
  }
  const decisionType = requireKnownString(value.decisionType, "decisionType", DECISION_TYPES);
  const limitations = requireKnownString(value.limitations, "limitations", PROOF_LIMITATIONS);
  const stateBefore = normalizeStateBeforeDigestInput(value.stateBefore);
  return { decisionType, limitations, stateBefore };
}

function requireRailPackDigest(railPack) {
  if (!railPack || typeof railPack !== "object") {
    throw new Error("proof bundle: railPack must be an object with a digest");
  }
  const digest = Array.isArray(railPack.digest) ? railPack.digest : null;
  if (!digest || digest.length !== DIGEST_BYTES) {
    throw new Error(`proof bundle: railPack.digest must be ${DIGEST_BYTES} bytes`);
  }
  for (const b of digest) {
    if (!Number.isInteger(b) || b < 0 || b > 255) {
      throw new Error("proof bundle: railPack.digest must contain bytes 0..255");
    }
  }
  return digest;
}

export function buildProofBundle({
  policy,
  report,
  railPack,
  action,
  decisionType,
  limitations,
  stateBefore,
  createdAtMs = Date.now(),
  correlationId,
  correlationNonce = "",
}) {
  if (!policy || typeof policy !== "object") {
    throw new Error("proof bundle: policy is required");
  }
  if (!report || typeof report !== "object") {
    throw new Error("proof bundle: report is required");
  }
  const publicReport = normalizeProofReport(report);
  const railPackDigest = requireRailPackDigest(railPack);
  const actionLabel = requireString(action, "action");
  const attestation = normalizeDecisionAttestation({ decisionType, limitations, stateBefore });
  if (!Number.isFinite(createdAtMs)) {
    throw new Error("proof bundle: createdAtMs must be a finite number");
  }
  const normalizedPolicy = {
    id: requireString(policy.id, "policy.id"),
    version: Number(policy.version) || 0,
    owner: requireString(policy.owner, "policy.owner"),
    selectedRail: requireString(policy.selectedRail, "policy.selectedRail"),
    mode: typeof policy.mode === "string" ? policy.mode : "",
    priority: typeof policy.priority === "string" ? policy.priority : "",
    collateralSymbol: typeof policy.collateralSymbol === "string" ? policy.collateralSymbol : "",
    collateralCoinType: typeof policy.collateralCoinType === "string" ? policy.collateralCoinType : "",
    payoutTargetUsd: Number(policy.payoutTargetUsd) || 0,
    minBufferUsd: Number(policy.minBufferUsd) || 0,
    maxLtvBps: Number(policy.maxLtvBps) || 0,
    targetLtvLowBps: Number(policy.targetLtvLowBps) || 0,
    targetLtvHighBps: Number(policy.targetLtvHighBps) || 0,
    repayLtvBps: Number(policy.repayLtvBps) || 0,
    emergencyLtvBps: Number(policy.emergencyLtvBps) || 0,
  };
  const proofCorrelationId = normalizeCorrelationId(correlationId) || buildProofCorrelationId({
    policyId: normalizedPolicy.id,
    policyVersion: normalizedPolicy.version,
    action: actionLabel,
    createdAtMs,
    nonce: correlationNonce,
  });

  // Copy only the fields that are load-bearing for verification. Avoid
  // capturing anything that is derivative (e.g. computed summaries that
  // may drift between versions of the simulator).
  const bundle = {
    version: PROOF_BUNDLE_VERSION,
    createdAtMs,
    correlationId: proofCorrelationId,
    action: actionLabel,
    decisionType: attestation.decisionType,
    limitations: attestation.limitations,
    stateBefore: attestation.stateBefore,
    policy: normalizedPolicy,
    report: {
      summary: publicReport.summary,
      schemaVersion: publicReport.schemaVersion,
    },
    railPack: {
      digest: railPackDigest.slice(),
      signedBy: typeof railPack.signedBy === "string" ? railPack.signedBy : "",
      signatureAlg: typeof railPack.signatureAlg === "string" ? railPack.signatureAlg : "ed25519",
      generatedAtMs: Number(railPack.generatedAtMs) || 0,
    },
  };

  assertSerializable(bundle, "$");
  return bundle;
}

export async function buildProofBundleWithDigest(input) {
  const bundle = buildProofBundle(input);
  const stateBeforeDigest = await digestBundle({
    version: PROOF_BUNDLE_VERSION,
    stateBefore: bundle.stateBefore,
  });
  const contentDigest = await digestBundle(bundle);
  const result = {
    bundle,
    canonical: canonicalizeBundle(bundle),
    stateBeforeDigest,
    stateBeforeDigestHex: toHexDigest(stateBeforeDigest),
    contentDigest,
    contentDigestHex: toHexDigest(contentDigest),
    railPackDigest: bundle.railPack.digest.slice(),
    railPackDigestHex: toHexDigest(bundle.railPack.digest),
  };
  emitObservation("proof-built", {
    proofBundleVersion: bundle.version,
    action: bundle.action,
    decisionType: bundle.decisionType,
    limitations: bundle.limitations,
    correlationId: bundle.correlationId,
    contentDigestHex: result.contentDigestHex,
    railPackDigestHex: result.railPackDigestHex,
    policyVersion: bundle.policy.version,
    selectedRail: bundle.policy.selectedRail,
    createdAtMs: bundle.createdAtMs,
  }, { source: "execution-proof" });
  return result;
}

// Stub publisher. Deterministic, no network. Used as a safe fallback
// when a real Walrus publisher is not configured, and for offline
// tests. The contentDigest is NOT the blob id — don't conflate them.
//
// PUBLIC DISCLOSURE CONTRACT: buildProofBundle is fail-closed. It only
// serializes the allowlisted policy and report fields above; report.inputs,
// contact metadata, draft scenario names, and raw wallet addresses outside
// policy.owner are rejected or ignored before any canonical body is built.
export function publishStub(contentDigest, { network = "testnet" } = {}) {
  if (!Array.isArray(contentDigest) || contentDigest.length !== DIGEST_BYTES) {
    throw new Error(`publishStub: contentDigest must be ${DIGEST_BYTES} bytes`);
  }
  const hex = toHexDigest(contentDigest);
  const normalizedNetwork = String(network || "testnet")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-") || "testnet";
  return `tide-stub://${normalizedNetwork}/sha256/${hex}`;
}

// Real Walrus publisher. POSTs the canonical bundle body to a Walrus
// HTTP publisher (https://docs.walrus.site/usage/web-api.html#publishers)
// and returns the blob id the publisher assigned. The content-digest
// pinned on-chain is computed locally (SHA-256 over the canonical
// bundle), so it stays valid regardless of which publisher stores the
// blob — the receipt is verifiable by anyone who can fetch the blob
// from any Walrus aggregator.
//
// On any failure the caller should fall back to publishStub so the
// mint path still writes a deterministic, audit-anchored id.
export async function publishToWalrus(canonicalBody, {
  publisherUrl,
  epochs = 5,
  fetchImpl = typeof fetch === "function" ? fetch : null,
} = {}) {
  if (typeof canonicalBody !== "string" || canonicalBody.length === 0) {
    throw new Error("publishToWalrus: canonicalBody must be a non-empty string");
  }
  if (typeof publisherUrl !== "string" || !publisherUrl.startsWith("https://")) {
    throw new Error("publishToWalrus: publisherUrl must be an https URL");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("publishToWalrus: fetch is not available in this environment");
  }

  const result = await publishBytesToWalrus({
    bytes: new TextEncoder().encode(canonicalBody),
    publisherUrl,
    epochs,
    fetchImpl,
  });
  return {
    blobId: result.blobId,
    suiObjectId: result.suiObjectId || null,
    endEpoch: result.endEpoch,
    publisherUrl: publisherUrl.replace(/\/+$/, ""),
  };
}

// Strategy helper used by the app mint path and the CLI proof-loop.
// Tries real Walrus when a publisher URL is configured; on any failure
// falls back to the stub so minting never blocks on publisher uptime.
// Returns a `{ blobId, source }` tuple so the UI can tell the two
// apart if it wants (we label it "Walrus" vs "Walrus stub").
export async function publishProofBundle({
  contentDigest,
  canonicalBody,
  network = "testnet",
  publisherUrl = "",
  epochs = 5,
  fetchImpl,
} = {}) {
  if (publisherUrl) {
    try {
      const result = await publishToWalrus(canonicalBody, {
        publisherUrl,
        epochs,
        fetchImpl,
      });
      return {
        blobId: result.blobId,
        suiObjectId: result.suiObjectId,
        endEpoch: result.endEpoch,
        publisherUrl: result.publisherUrl,
        source: "walrus",
      };
    } catch (error) {
      // Fall through to stub. Caller can inspect the error through the
      // returned `fallbackError` field; the mint flow should not be
      // allowed to die just because a publisher is down.
      return {
        blobId: publishStub(contentDigest, { network }),
        source: "stub",
        fallbackError: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return {
    blobId: publishStub(contentDigest, { network }),
    source: "stub",
  };
}

function digestsEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length || a.length !== DIGEST_BYTES) return false;
  for (let i = 0; i < DIGEST_BYTES; i += 1) {
    if ((a[i] & 0xff) !== (b[i] & 0xff)) return false;
  }
  return true;
}

// Recompute the content digest for a bundle that came back from Walrus
// (or any other out-of-band source) and compare it to the digest
// recorded in an on-chain ExecutionReceipt. This is the *only* check
// that actually proves the bundle has not been swapped under us — the
// Move receipt stores just two digests, and this is what you use to
// close the loop.
//
//   const fresh = checkFreshness(bundle, { now: Date.now() });
//   const verdict = await verifyBundleDigest(bundle, receipt.contentDigest);
//   if (fresh.ok && verdict.ok) { /* trustworthy */ }
//
// `expectedDigest` may be a 32-element byte array or a hex string
// (0x-prefixed or bare). Returns `{ ok, reason, actualHex, expectedHex }`.
export async function verifyBundleDigest(bundle, expectedDigest) {
  const version = Number(bundle?.version);
  if (!SUPPORTED_PROOF_BUNDLE_VERSIONS.has(version)) {
    return { ok: false, reason: "unsupported-bundle-version" };
  }
  let expectedBytes;
  if (Array.isArray(expectedDigest)) {
    expectedBytes = expectedDigest.map((b) => Number(b) & 0xff);
  } else if (typeof expectedDigest === "string") {
    const hex = expectedDigest.trim().replace(/^0x/i, "");
    if (hex.length !== DIGEST_BYTES * 2 || !/^[0-9a-f]+$/i.test(hex)) {
      return { ok: false, reason: "malformed-expected" };
    }
    expectedBytes = [];
    for (let i = 0; i < hex.length; i += 2) {
      expectedBytes.push(parseInt(hex.slice(i, i + 2), 16));
    }
  } else {
    return { ok: false, reason: "missing-expected" };
  }

  if (expectedBytes.length !== DIGEST_BYTES) {
    return { ok: false, reason: "wrong-length-expected" };
  }

  let actual;
  try {
    actual = await digestBundle(bundle);
  } catch (error) {
    return {
      ok: false,
      reason: "canonicalize-failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const ok = digestsEqual(actual, expectedBytes);
  return {
    ok,
    reason: ok ? "match" : "digest-mismatch",
    actualHex: toHexDigest(actual),
    expectedHex: toHexDigest(expectedBytes),
  };
}

// Freshness check: reject bundles whose createdAtMs is outside
// [now - maxAgeMs, now + toleranceMs]. Tolerance covers small clock
// skew between the machine that built the bundle and the one that
// now verifies it.
export function checkFreshness(bundle, {
  now = Date.now(),
  maxAgeMs = DEFAULT_FRESHNESS_MS,
  toleranceMs = 30_000,
} = {}) {
  if (!bundle || typeof bundle !== "object") {
    return { ok: false, reason: "missing bundle" };
  }
  const createdAtMs = Number(bundle.createdAtMs);
  if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) {
    return { ok: false, reason: "missing createdAtMs" };
  }
  if (createdAtMs > now + toleranceMs) {
    return { ok: false, reason: "future-dated", ageMs: createdAtMs - now };
  }
  const ageMs = now - createdAtMs;
  if (ageMs > maxAgeMs) {
    return { ok: false, reason: "stale", ageMs };
  }
  return { ok: true, ageMs };
}
