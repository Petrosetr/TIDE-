// Proof-bundle PII redaction — strips operator-identifying data from a
// proof run (docs/proof/run-XX.json) before it is shared, while keeping
// the on-chain anchors (object ids, content digests, rail names) intact
// so humans can still cross-check the public object ids against testnet RPC.
// The redacted JSON is not a canonical proof bundle anymore; digest
// verification requires the original canonical bundle or durable Walrus bytes.
//
// What gets redacted by default:
//   - operatorAddress (top-level field on a proof bundle).
//   - raw report.inputs embedded in proof bundles / canonical JSON.
//   - any 32-byte Sui address that matches the operator address inside
//     nested objects (the canonical proof JSON embeds the same address
//     under policy.owner — we want one redaction map to cover both).
//
// What stays untouched:
//   - On-chain object ids (policy id, receipt id) — these are public
//     and already retrievable from the chain by anyone with the digest.
//   - Content digests, rail-pack digests, state-before digests — content-
//     addressed hashes, not identity.
//   - Venue / rail names — public protocol metadata.
//   - Allowlisted summary metrics — modeled, not identifying.
//
// The redaction is a one-way value substitution; the result is JSON
// that round-trips cleanly through JSON.parse(JSON.stringify(...)).

const ADDRESS_RE = /\b0x[a-f0-9]{64}\b/g;

export const DEFAULT_REDACTED_OPERATOR =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeAddress(value) {
  if (typeof value !== "string") return "";
  return value.toLowerCase().trim();
}

// The canonical proof JSON is stored as an embedded string under
// `receiptMint.canonical`. We decode → redact → re-encode it so the same
// substitution applies inside.
function redactCanonicalString(canonicalText, addressMap) {
  if (typeof canonicalText !== "string") {
    return { text: canonicalText, redacted: false };
  }
  let parsed;
  try {
    parsed = JSON.parse(canonicalText);
  } catch {
    return { text: canonicalText, redacted: false };
  }
  const redacted = redactValue(parsed, addressMap);
  return { text: JSON.stringify(redacted), redacted: true };
}

function redactString(value, addressMap) {
  if (typeof value !== "string") return value;
  // Replace any 32-byte Sui address that's in the redaction map.
  return value.replace(ADDRESS_RE, (match) => {
    const lc = match.toLowerCase();
    return addressMap.has(lc) ? addressMap.get(lc) : match;
  });
}

function redactValue(value, addressMap, parentKey = "") {
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, addressMap, parentKey));
  }
  if (isPlainObject(value)) {
    const out = {};
    let canonicalWasRedacted = false;
    for (const [key, entry] of Object.entries(value)) {
      if (parentKey === "report" && key === "inputs") {
        continue;
      }
      if (key === "canonical" && typeof entry === "string") {
        const canonical = redactCanonicalString(entry, addressMap);
        out[key] = canonical.text;
        canonicalWasRedacted = canonical.redacted;
        continue;
      }
      out[key] = redactValue(entry, addressMap, key);
    }
    if (canonicalWasRedacted) {
      out.redacted = true;
      out.canonicalKind = "redacted-summary";
      out.redactionNotice = "Canonical proof JSON is redacted for public sharing; use on-chain receipt fields and the canonical unredacted bundle for digest verification.";
    }
    return out;
  }
  if (typeof value === "string") return redactString(value, addressMap);
  return value;
}

function hasRedactedCanonical(value) {
  if (!isPlainObject(value)) return false;
  return value.redacted === true || value.canonicalKind === "redacted-summary";
}

function buildPublicRedactedProofVerification(existing = {}) {
  return {
    ...existing,
    ok: false,
    digestOk: false,
    digestReason: "public proof JSON is redacted; use the original canonical bundle or Walrus bytes for digest verification.",
    semanticOk: false,
    semanticReason: "public proof JSON omits/redacts wallet-specific proof fields and is not a canonical bundle.",
    semanticMismatches: Array.isArray(existing.semanticMismatches) ? existing.semanticMismatches : [],
    publicArtifactOnly: true,
  };
}

function markPublicProofVerification(value) {
  if (Array.isArray(value)) {
    value.forEach(markPublicProofVerification);
    return value;
  }
  if (!isPlainObject(value)) return value;
  const redactedProof =
    hasRedactedCanonical(value.proofBundle) ||
    hasRedactedCanonical(value.receiptMint) ||
    hasRedactedCanonical(value);
  if (redactedProof && isPlainObject(value.proofVerification)) {
    value.proofVerification = buildPublicRedactedProofVerification(value.proofVerification);
  }
  for (const entry of Object.values(value)) {
    markPublicProofVerification(entry);
  }
  return value;
}

// Build the address-substitution map. Inputs are { sensitiveAddresses:
// [..addresses..], replacement } where replacement defaults to
// DEFAULT_REDACTED_OPERATOR. Sensitivity defaults to the bundle's
// `operatorAddress` if it is supplied as `extractFromRun: true`.
export function buildRedactionMap({
  sensitiveAddresses = [],
  replacement = DEFAULT_REDACTED_OPERATOR,
} = {}) {
  const map = new Map();
  for (const raw of sensitiveAddresses) {
    const lc = normalizeAddress(raw);
    if (lc) map.set(lc, replacement);
  }
  return map;
}

export function redactProofRun(run, { sensitiveAddresses = null, replacement = DEFAULT_REDACTED_OPERATOR } = {}) {
  if (!isPlainObject(run)) return run;
  const inferred = sensitiveAddresses === null
    ? [run.operatorAddress, run.draft?.operatorAddress, run.policyAnchor?.owner].filter(Boolean)
    : sensitiveAddresses;
  const map = buildRedactionMap({ sensitiveAddresses: inferred, replacement });
  if (map.size === 0) return JSON.parse(JSON.stringify(run));
  const result = redactValue(run, map);
  markPublicProofVerification(result);
  // The top-level field deserves an explicit replacement too — it might
  // not strictly match a 32-byte regex if it's a placeholder.
  if (typeof result.operatorAddress === "string") {
    result.operatorAddress = replacement;
  }
  return result;
}

// Returns the set of distinct 32-byte addresses present anywhere in the
// run. Useful for audits ("does this bundle leak any new addresses
// beyond the documented operator?").
export function listAddressesInRun(run) {
  const seen = new Set();
  function walk(value) {
    if (Array.isArray(value)) value.forEach(walk);
    else if (isPlainObject(value)) Object.values(value).forEach(walk);
    else if (typeof value === "string") {
      const matches = value.match(ADDRESS_RE) || [];
      for (const match of matches) seen.add(match.toLowerCase());
    }
  }
  walk(run);
  return [...seen].sort();
}
