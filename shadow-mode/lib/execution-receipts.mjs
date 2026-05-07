import { executionRpc } from "./execution.mjs";
import { DECISION_TYPES, PROOF_LIMITATIONS } from "./execution-proof.mjs";
import { getPolicyRegistryConfig } from "./policy-registry.mjs";
import { isKnownRailId, lookupRailIdByDisplay } from "./policy-ids.mjs";
import { resolveOwnedObjectQueryOptions, shouldContinueOwnedObjectPaging } from "./sui-owned-object-query.mjs";
import { Planner } from "./tide_core.mjs";
import { resolveSuiObjectFromTransaction } from "./sui-object-resolution.mjs";
import { getSuiGasBudget } from "./sui-gas.mjs";

function getRuntimeConfig(config = {}) {
  return config && typeof config === "object" ? config : {};
}

function assertReceiptSigningNetwork(config = {}) {
  const runtime = getRuntimeConfig(config);
  const network = String(runtime?.sui?.network || "").trim().toLowerCase();
  if (network && network !== "testnet") {
    throw new Error(`Execution receipt signing is testnet-only; configured Sui network is ${network}.`);
  }
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeEventId(data, fields = []) {
  for (const field of fields) {
    const value = data?.[field];
    const direct = normalizeString(value);
    if (direct) return direct;
    const nested = normalizeString(value?.id);
    if (nested) return nested;
  }
  return "";
}

function normalizeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function encodeUtf8(value) {
  return Array.from(new TextEncoder().encode(String(value || "")));
}

function decodeUtf8(bytes) {
  return new TextDecoder().decode(Uint8Array.from(bytes || []));
}

const MAX_WALRUS_BLOB_ID_BYTES = 512;
const WALRUS_STUB_RE = /^tide-stub:\/\/(?:testnet|mainnet|devnet)\/sha256\/[0-9a-f]{64}$/i;
const LEGACY_PROOF_STUB_RE = /^(?:testnet|mainnet|devnet)-proof:[0-9a-f]{64}$/i;
const WALRUS_BLOB_ID_RE = /^[A-Za-z0-9_-]{40,100}$/;

function normalizeWalrusBlobId(value) {
  const raw = typeof value === "string" ? value : String(value ?? "");
  if (/[\u0000-\u001f\u007f]/.test(raw)) {
    throw new Error("walrusBlobId must not contain control characters.");
  }
  const blobId = normalizeString(value);
  if (!blobId) throw new Error("walrusBlobId is required.");
  const byteLength = encodeUtf8(blobId).length;
  if (byteLength > MAX_WALRUS_BLOB_ID_BYTES) {
    throw new Error(
      `walrusBlobId must be at most ${MAX_WALRUS_BLOB_ID_BYTES} bytes, got ${byteLength}.`
    );
  }
  if (
    !WALRUS_STUB_RE.test(blobId) &&
    !LEGACY_PROOF_STUB_RE.test(blobId) &&
    !WALRUS_BLOB_ID_RE.test(blobId)
  ) {
    throw new Error(
      "walrusBlobId must be a tide-stub URI, a legacy proof stub, or a Walrus base64url blob id."
    );
  }
  return blobId;
}

function parseMoveString(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    try { return new TextDecoder().decode(new Uint8Array(value)); } catch { return value.join(""); }
  }
  if (value && typeof value === "object") {
    if (typeof value.bytes === "string") return value.bytes;
    if (value.fields) return parseMoveString(value.fields.bytes ?? value.fields);
  }
  return "";
}

function parseMoveBytes(value) {
  if (Array.isArray(value)) return value.map((byte) => Number(byte) & 0xff);
  if (value && typeof value === "object" && Array.isArray(value.fields)) return parseMoveBytes(value.fields);
  if (typeof value === "string" && value.startsWith("0x")) {
    const hex = value.slice(2);
    const out = [];
    for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
    return out;
  }
  return [];
}

function toHex(bytes) {
  if (!Array.isArray(bytes) || bytes.length === 0) return "";
  return "0x" + bytes.map((b) => (b & 0xff).toString(16).padStart(2, "0")).join("");
}

function parseContentFields(content) {
  if (!content || typeof content !== "object") return null;
  if (content.dataType === "moveObject" && content.fields && typeof content.fields === "object") return content.fields;
  if (content.content && typeof content.content === "object") return parseContentFields(content.content);
  return null;
}

// Move struct layout of ExecutionReceipt — Step 2 pinned these field
// names. If the on-chain schema changes, bump EVENT_SCHEMA_VERSION in
// the Move module and update the reader here in the same commit.
const RECEIPTS_MODULE_DEFAULT = "execution_receipts";
const SUPPORTED_RECEIPT_EVENT_SCHEMA_VERSIONS = new Set([1, 2, 3]);
export const TIDE_PRE_SIGN_VALIDATOR = "__tideValidateBeforeSign";

export function getExecutionReceiptsConfig(config = {}) {
  const runtime = getRuntimeConfig(config);
  const policyRegistry = runtime.policyRegistry && typeof runtime.policyRegistry === "object"
    ? runtime.policyRegistry
    : {};
  const receipts = runtime.executionReceipts && typeof runtime.executionReceipts === "object"
    ? runtime.executionReceipts
    : {};
  return {
    packageId: normalizeString(policyRegistry.packageId),
    moduleName: normalizeString(receipts.module, RECEIPTS_MODULE_DEFAULT),
    clockObjectId: normalizeString(policyRegistry.clockObjectId, "0x6"),
  };
}

export function isExecutionReceiptsConfigured(config = {}) {
  const { packageId } = getExecutionReceiptsConfig(config);
  return Boolean(packageId) && packageId !== "0x0";
}

export function requireSupportedReceiptSchemaVersion(value) {
  if (value === null || value === undefined || value === "") {
    throw new Error("ReceiptMinted event is missing schema_version.");
  }
  const version = Number(value);
  if (!Number.isInteger(version)) {
    throw new Error("ReceiptMinted event is missing schema_version.");
  }
  if (!SUPPORTED_RECEIPT_EVENT_SCHEMA_VERSIONS.has(version)) {
    throw new Error(`Unsupported ReceiptMinted schema_version ${version}.`);
  }
  return version;
}

async function createBaseTransaction(sender, gasOperation) {
  const { Transaction } = await import("../vendor/sui-runtime.mjs");
  const tx = new Transaction();
  tx.setSender(sender);
  tx.setGasBudget(getSuiGasBudget(gasOperation));
  return tx;
}

function assertDigestBytes(label, bytes) {
  if (!Array.isArray(bytes)) {
    throw new Error(`${label} must be a byte array`);
  }
  if (bytes.length !== 32) {
    throw new Error(`${label} must be exactly 32 bytes (SHA-256), got ${bytes.length}`);
  }
  for (const b of bytes) {
    if (!Number.isInteger(b) || b < 0 || b > 255) {
      throw new Error(`${label} contains a non-byte value`);
    }
  }
}

function requireKnownValue(value, label, allowed) {
  const normalized = normalizeString(value);
  if (!normalized) throw new Error(`${label} is required`);
  if (!allowed.includes(normalized)) {
    throw new Error(`${label} must be one of ${allowed.join(", ")}`);
  }
  return normalized;
}

export function assertDecisionMatchesState({
  decisionType,
  plannerInput,
  regime,
  risk,
} = {}) {
  const normalizedDecision = requireKnownValue(decisionType, "decisionType", DECISION_TYPES);
  if (!plannerInput || typeof plannerInput !== "object" || Array.isArray(plannerInput)) {
    throw new Error("decisionAttestation.plannerInput is required to verify decisionType.");
  }
  const normalizedRegime = normalizeString(regime);
  if (!normalizedRegime) {
    throw new Error("decisionAttestation.regime is required to verify decisionType.");
  }
  if (!risk || typeof risk !== "object" || Array.isArray(risk)) {
    throw new Error("decisionAttestation.risk is required to verify decisionType.");
  }

  let replanned;
  try {
    replanned = new Planner().plan(plannerInput, normalizedRegime, risk);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "unknown error");
    throw new Error(`decisionAttestation could not be re-planned: ${message}`);
  }

  const replannedType = normalizeString(replanned?.chosen?.type);
  if (!replannedType) {
    throw new Error("decisionAttestation re-plan produced no chosen decision.");
  }
  if (replannedType !== normalizedDecision) {
    throw new Error(
      `decisionType mismatch: attestation says ${normalizedDecision}, planner says ${replannedType}.`
    );
  }
  return replannedType;
}

function normalizeDecisionAttestationInput(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("decisionAttestation is required for mint_receipt.");
  }
  const decisionType = requireKnownValue(value.decisionType, "decisionType", DECISION_TYPES);
  const limitations = requireKnownValue(value.limitations, "limitations", PROOF_LIMITATIONS);
  assertDecisionMatchesState({
    decisionType,
    plannerInput: value.plannerInput,
    regime: value.regime,
    risk: value.risk,
  });
  const stateBeforeDigest = Array.isArray(value.stateBeforeDigest)
    ? value.stateBeforeDigest.slice()
    : [];
  assertDigestBytes("stateBeforeDigest", stateBeforeDigest);
  return { decisionType, limitations, stateBeforeDigest };
}

// Canonicalize a rail label to the stable id Move compares byte-for-byte.
// Used at every Move-call boundary so callers can pass display labels
// ("Scallop"), venue ids ("scallop"), or stable ids ("scallop-sui") and
// still land on the single on-chain form.
function canonicalizeRailForMove(label, context) {
  const raw = normalizeString(label);
  if (!raw) return "";
  const canonical = isKnownRailId(raw) ? raw : lookupRailIdByDisplay(raw);
  if (!canonical) {
    throw new Error(
      `Rail id "${raw}" is not in the off-chain registry ` +
      `(shadow-mode/lib/policy-ids.mjs) — ${context}. ` +
      `Move would abort with E_RAIL_NOT_ALLOWED or E_RAIL_MISMATCH; ` +
      `fix the caller rather than shipping a mismatched label.`
    );
  }
  return canonical;
}

function normalizeSuiAddressForCompare(value) {
  const raw = normalizeString(value).toLowerCase();
  if (!raw.startsWith("0x")) return raw;
  const hex = raw.slice(2);
  if (!/^[0-9a-f]+$/.test(hex)) return raw;
  return `0x${hex.padStart(64, "0")}`;
}

function extractMoveCall(command) {
  if (!command || typeof command !== "object") return null;
  if (command.MoveCall) return command.MoveCall;
  if (command.moveCall) return command.moveCall;
  if (command.$kind === "MoveCall") return command;
  return null;
}

function getTransactionData(transaction) {
  return typeof transaction?.getData === "function"
    ? transaction.getData()
    : transaction?.blockData || transaction;
}

function getTransactionCommands(transaction) {
  const data = getTransactionData(transaction);
  return Array.isArray(data?.commands)
    ? data.commands
    : Array.isArray(data?.transactions)
      ? data.transactions
      : [];
}

function getTerminalMintMoveCall(transaction, { packageId, moduleName }) {
  const commands = getTransactionCommands(transaction);
  if (commands.length === 0) {
    throw new Error("mint_receipt PTB has no commands to verify.");
  }
  const terminal = extractMoveCall(commands[commands.length - 1]);
  if (!terminal) {
    throw new Error("mint_receipt must be the terminal PTB command.");
  }
  const expectedPackage = normalizeSuiAddressForCompare(packageId);
  const actualPackage = normalizeSuiAddressForCompare(terminal.package || terminal.Package || "");
  const actualModule = normalizeString(terminal.module || terminal.Module);
  const actualFunction = normalizeString(terminal.function || terminal.Function);
  if (
    actualPackage !== expectedPackage ||
    actualModule !== moduleName ||
    actualFunction !== "mint_receipt"
  ) {
    throw new Error(
      `mint_receipt must be the terminal PTB command; got ` +
      `${actualPackage || "?"}::${actualModule || "?"}::${actualFunction || "?"}.`
    );
  }
  return terminal;
}

export function assertReceiptMintIsTerminal(transaction, { packageId, moduleName }) {
  getTerminalMintMoveCall(transaction, { packageId, moduleName });
  return true;
}

function decodeBase64Bytes(value) {
  const raw = normalizeString(value);
  if (!raw) return [];
  if (typeof globalThis.atob === "function") {
    return Array.from(globalThis.atob(raw), (char) => char.charCodeAt(0));
  }
  if (typeof Buffer !== "undefined") {
    return Array.from(Buffer.from(raw, "base64"));
  }
  throw new Error("Cannot decode PTB pure bytes: no base64 decoder is available.");
}

function decodeUleb128(bytes) {
  let value = 0;
  let shift = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, length: i + 1 };
    shift += 7;
  }
  throw new Error("Cannot decode PTB pure vector<u8>: invalid ULEB length.");
}

function decodeBcsVectorU8(bytesBase64, label) {
  const encoded = decodeBase64Bytes(bytesBase64);
  const prefix = decodeUleb128(encoded);
  const end = prefix.length + prefix.value;
  if (end !== encoded.length) {
    throw new Error(
      `${label} PTB pure bytes are not a canonical vector<u8> payload ` +
      `(declared ${prefix.value}, encoded ${encoded.length - prefix.length}).`
    );
  }
  return encoded.slice(prefix.length, end);
}

function getInputIndex(arg, label) {
  if (!arg || typeof arg !== "object") {
    throw new Error(`${label} argument is missing from mint_receipt PTB.`);
  }
  const index = Number.isInteger(arg.Input) ? arg.Input : Number.isInteger(arg.input) ? arg.input : null;
  if (index === null) {
    throw new Error(`${label} argument is not an Input reference in mint_receipt PTB.`);
  }
  return index;
}

function readPureVectorArg(transaction, terminal, argIndex, label) {
  const data = getTransactionData(transaction);
  const args = Array.isArray(terminal?.arguments) ? terminal.arguments : [];
  const inputIndex = getInputIndex(args[argIndex], label);
  const input = Array.isArray(data?.inputs) ? data.inputs[inputIndex] : null;
  const base64 = input?.Pure?.bytes || input?.pure?.bytes || input?.Pure;
  if (typeof base64 !== "string") {
    throw new Error(`${label} argument is not a pure vector<u8> input in mint_receipt PTB.`);
  }
  return decodeBcsVectorU8(base64, label);
}

// B4: read an object-reference argument (e.g. policy_id, allowlist, clock).
// Sui SDK exposes Transaction.getData().inputs in different shapes
// depending on whether the transaction has been resolved against a live
// client. Byte-binding runs pre-sign (right after build, before
// signAndExecuteTransaction), so the input is typically the
// "UnresolvedObject" shape. After resolution it becomes "Object" with
// either ImmOrOwnedObject or SharedObject. This helper handles all three
// to stay valid across the full lifecycle of the Transaction object.
//
// Returns the canonical 32-byte 0x-prefixed object id. Pure-bytes path is
// intentionally rejected — pure bytes for an object id would indicate a
// malformed PTB and is treated as a binding mismatch.
// Pad / strip Sui object ids to canonical 32-byte form so caller's short
// `0x111` and SDK's resolved `0x0000…0111` compare equal. Returns "" for
// malformed input so caller's mismatch path catches it.
function normalizeSuiObjectId(value) {
  const stripped = String(value || "").trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]+$/.test(stripped) || stripped.length === 0 || stripped.length > 64) {
    return "";
  }
  return "0x" + stripped.padStart(64, "0");
}

function requireSuiObjectId(value, label) {
  const normalized = normalizeSuiObjectId(value);
  if (!normalized) {
    throw new Error(`${label} argument is not a valid Sui object id in mint_receipt PTB.`);
  }
  return normalized;
}

function readObjectArg(transaction, terminal, argIndex, label) {
  const data = getTransactionData(transaction);
  const args = Array.isArray(terminal?.arguments) ? terminal.arguments : [];
  const inputIndex = getInputIndex(args[argIndex], label);
  const input = Array.isArray(data?.inputs) ? data.inputs[inputIndex] : null;
  if (!input || typeof input !== "object") {
    throw new Error(`${label} argument is missing from mint_receipt PTB inputs.`);
  }
  // Pre-sign shape: { UnresolvedObject: { objectId } }
  const unresolved = input.UnresolvedObject || input.unresolvedObject;
  if (unresolved && typeof unresolved === "object") {
    const objectId = unresolved.objectId || unresolved.object_id;
    if (typeof objectId === "string" && objectId) {
      return requireSuiObjectId(objectId, label);
    }
  }
  // Post-resolution shape: { Object: { ImmOrOwnedObject | SharedObject | Receiving } }
  const objectInput = input.Object || input.object;
  if (objectInput && typeof objectInput === "object") {
    const ref = objectInput.ImmOrOwnedObject
      || objectInput.immOrOwnedObject
      || objectInput.SharedObject
      || objectInput.sharedObject
      || objectInput.Receiving
      || objectInput.receiving;
    const objectId = (ref && (ref.objectId || ref.object_id))
      || objectInput.objectId
      || objectInput.object_id;
    if (typeof objectId === "string" && objectId) {
      return requireSuiObjectId(objectId, label);
    }
  }
  throw new Error(`${label} argument is not an Object/UnresolvedObject input in mint_receipt PTB.`);
}

function assertSameBytes(label, actual, expected) {
  if (!Array.isArray(expected)) {
    throw new Error(`${label} expected binding must be a byte array.`);
  }
  if (actual.length !== expected.length || actual.some((byte, i) => byte !== expected[i])) {
    throw new Error(`${label} PTB byte binding mismatch.`);
  }
}

export function extractMintReceiptByteBinding(transaction, { packageId, moduleName }) {
  const terminal = getTerminalMintMoveCall(transaction, { packageId, moduleName });
  const binding = {
    // B4: argument index 0 is the policy object reference. Previously
    // unbound, which left a substitution gap: an attacker could swap the
    // PTB's policy object between the modal and signAndExecute and the
    // existing field bindings would still match. Move-side E_RAIL_MISMATCH
    // catches a wrong selected_rail, but a substituted policy with the same
    // selected_rail would mint against the wrong policy id. Bind it here.
    policyId: readObjectArg(transaction, terminal, 0, "policy_id"),
    railAllowlistId: readObjectArg(transaction, terminal, 1, "rail_allowlist"),
    actionBytes: readPureVectorArg(transaction, terminal, 2, "action"),
    decisionTypeBytes: readPureVectorArg(transaction, terminal, 3, "decision_type"),
    limitationsBytes: readPureVectorArg(transaction, terminal, 4, "limitations"),
    stateBeforeDigest: readPureVectorArg(transaction, terminal, 5, "state_before_digest"),
    walrusBlobIdBytes: readPureVectorArg(transaction, terminal, 6, "walrus_blob_id"),
    railPackDigest: readPureVectorArg(transaction, terminal, 7, "rail_pack_digest"),
    contentDigest: readPureVectorArg(transaction, terminal, 8, "content_digest"),
    expectedRailBytes: readPureVectorArg(transaction, terminal, 9, "expected_rail"),
    clockObjectId: readObjectArg(transaction, terminal, 10, "clock"),
  };
  return {
    ...binding,
    action: decodeUtf8(binding.actionBytes),
    decisionType: decodeUtf8(binding.decisionTypeBytes),
    limitations: decodeUtf8(binding.limitationsBytes),
    walrusBlobId: decodeUtf8(binding.walrusBlobIdBytes),
    expectedRail: decodeUtf8(binding.expectedRailBytes),
    stateBeforeDigestHex: toHex(binding.stateBeforeDigest),
    railPackDigestHex: toHex(binding.railPackDigest),
    contentDigestHex: toHex(binding.contentDigest),
  };
}

export function assertMintReceiptByteBinding(transaction, expected, { packageId, moduleName }) {
  const binding = extractMintReceiptByteBinding(transaction, { packageId, moduleName });
  // B4: pin the policy object id first. If the PTB references a different
  // policy than the modal/expected one, every other check is suspect.
  // Both sides are normalized to the canonical 32-byte 0x form so that a
  // caller's short id ("0x111") and the SDK's resolved padded id
  // ("0x0000…0111") compare equal — the canonical pad prevents a false
  // mismatch on legitimate inputs without weakening the actual binding.
  if (expected.policyId !== undefined) {
    const expectedPolicyId = normalizeSuiObjectId(expected.policyId);
    const actualPolicyId = normalizeSuiObjectId(binding.policyId);
    if (!expectedPolicyId || !actualPolicyId || expectedPolicyId !== actualPolicyId) {
      throw new Error("policy_id PTB byte binding mismatch.");
    }
  }
  if (expected.railAllowlistId !== undefined) {
    const expectedAllowlistId = normalizeSuiObjectId(expected.railAllowlistId);
    const actualAllowlistId = normalizeSuiObjectId(binding.railAllowlistId);
    if (!expectedAllowlistId || !actualAllowlistId || expectedAllowlistId !== actualAllowlistId) {
      throw new Error("rail_allowlist PTB byte binding mismatch.");
    }
  }
  if (expected.clockObjectId !== undefined) {
    const expectedClockId = normalizeSuiObjectId(expected.clockObjectId);
    const actualClockId = normalizeSuiObjectId(binding.clockObjectId);
    if (!expectedClockId || !actualClockId || expectedClockId !== actualClockId) {
      throw new Error("clock PTB byte binding mismatch.");
    }
  }
  if (expected.action !== undefined && binding.action !== normalizeString(expected.action)) {
    throw new Error("action PTB byte binding mismatch.");
  }
  if (expected.decisionType !== undefined && binding.decisionType !== normalizeString(expected.decisionType)) {
    throw new Error("decision_type PTB byte binding mismatch.");
  }
  if (expected.limitations !== undefined && binding.limitations !== normalizeString(expected.limitations)) {
    throw new Error("limitations PTB byte binding mismatch.");
  }
  if (expected.walrusBlobId !== undefined && binding.walrusBlobId !== normalizeString(expected.walrusBlobId)) {
    throw new Error("walrus_blob_id PTB byte binding mismatch.");
  }
  if (expected.expectedRail !== undefined && binding.expectedRail !== normalizeString(expected.expectedRail)) {
    throw new Error("expected_rail PTB byte binding mismatch.");
  }
  if (expected.stateBeforeDigest !== undefined) assertSameBytes("state_before_digest", binding.stateBeforeDigest, expected.stateBeforeDigest);
  if (expected.railPackDigest !== undefined) assertSameBytes("rail_pack_digest", binding.railPackDigest, expected.railPackDigest);
  if (expected.contentDigest !== undefined) assertSameBytes("content_digest", binding.contentDigest, expected.contentDigest);
  return binding;
}

function cloneExpectedBytes(value) {
  return Array.isArray(value) ? Object.freeze(value.slice()) : value;
}

function freezeMintReceiptExpectedBinding(expected = {}) {
  return Object.freeze({
    policyId: normalizeString(expected.policyId),
    railAllowlistId: normalizeString(expected.railAllowlistId),
    clockObjectId: normalizeString(expected.clockObjectId),
    action: normalizeString(expected.action),
    decisionType: normalizeString(expected.decisionType),
    limitations: normalizeString(expected.limitations),
    stateBeforeDigest: cloneExpectedBytes(expected.stateBeforeDigest),
    walrusBlobId: normalizeString(expected.walrusBlobId),
    railPackDigest: cloneExpectedBytes(expected.railPackDigest),
    contentDigest: cloneExpectedBytes(expected.contentDigest),
    expectedRail: normalizeString(expected.expectedRail),
  });
}

function attachMintReceiptPreSignValidator(transaction, expected, context) {
  const frozenExpected = freezeMintReceiptExpectedBinding(expected);
  const frozenContext = Object.freeze({
    packageId: normalizeString(context?.packageId),
    moduleName: normalizeString(context?.moduleName),
  });
  const existingValidator = typeof transaction?.[TIDE_PRE_SIGN_VALIDATOR] === "function"
    ? transaction[TIDE_PRE_SIGN_VALIDATOR]
    : null;
  Object.defineProperty(transaction, TIDE_PRE_SIGN_VALIDATOR, {
    enumerable: false,
    configurable: true,
    value: async function validateReceiptMintBeforeSign(validationContext = {}) {
      if (existingValidator) {
        await existingValidator.call(this, validationContext);
      }
      return assertMintReceiptByteBinding(this, frozenExpected, frozenContext);
    },
  });
  return transaction;
}

// F-U-A-4: builder-level stale-forecast guard. If the caller supplies a
// `forecast` snapshot (or a raw `forecastObservedAtMs`), the builder
// refuses to construct the PTB when the snapshot is older than
// `forecastMaxStaleMs` (default 6 hours, matching the public web tier
// and the existing UI gate). Back-compat: when no forecast is supplied,
// the builder proceeds — the upstream UI gate keeps doing the staleness
// check the way it always has. This protects the bytes path against a
// scripted runner that bypasses the UI.
const DEFAULT_FORECAST_MAX_STALE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_PYTH_MAX_DIVERGENCE_MS = 10 * 60 * 1000;
// B3: confidence-bound refusal threshold. 100 bps = 1% of price. Per
// oracle-pricing-patterns skill: BTC starts at 100 bps, SUI at 200 bps.
// V1 BTC/USD is the primary feed so 100 is the conservative default.
// §3 architecture-drift entry notes these thresholds belong in
// runtime-config.mjs eventually; they sit as module constants today
// alongside DEFAULT_FORECAST_MAX_STALE_MS / DEFAULT_PYTH_MAX_DIVERGENCE_MS
// pending the runtime-config refactor. Override via callsite parameter.
const DEFAULT_PYTH_MAX_CONFIDENCE_BPS = 100;

function resolveForecastObservedMs(forecast, forecastObservedAtMs) {
  if (!forecast || typeof forecast !== "object") return null;
  if (Number.isFinite(forecast.observedAtMs)) return Number(forecast.observedAtMs);
  if (typeof forecast.observedAt === "string" && forecast.observedAt) {
    const ms = Date.parse(forecast.observedAt);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function resolveSignedForecastObservedMs(forecast) {
  if (!forecast || typeof forecast !== "object") return null;
  const direct = forecast.signedObservedAtMs ?? forecast.signedAtMs;
  if (Number.isFinite(direct)) return Number(direct);
  const sig = forecast.signature && typeof forecast.signature === "object" ? forecast.signature : null;
  if (sig && Number.isFinite(sig.observedAtMs)) return Number(sig.observedAtMs);
  if (sig && typeof sig.observedAt === "string") {
    const ms = Date.parse(sig.observedAt);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function assertCallerObservedAtBoundToSignedSource({ forecast, forecastObservedAtMs }) {
  if (!Number.isFinite(forecastObservedAtMs)) return;
  const signedMs = resolveSignedForecastObservedMs(forecast);
  if (!Number.isFinite(signedMs)) {
    throw new Error("Forecast observedAt is caller-supplied without a signed timestamp; refusing to mint a receipt.");
  }
  if (Number(forecastObservedAtMs) !== signedMs) {
    throw new Error("Forecast observedAt does not match the signed timestamp; refusing to mint a receipt.");
  }
}

function assertPythPublishTimeConsistent({
  observedMs,
  pythReadback,
  pythMaxDivergenceMs = DEFAULT_PYTH_MAX_DIVERGENCE_MS,
  pythMaxConfidenceBps = DEFAULT_PYTH_MAX_CONFIDENCE_BPS,
  allowFixtureReadback = false,
}) {
  if (!pythReadback || typeof pythReadback !== "object") return;
  // V1 acceptable bypass: no Pyth feed configured in env. The
  // Off-chain refusal stays a soft check until a future schema gate
  // freshness_label lands on-chain.
  if (pythReadback.source === "missing") return;
  // B3 fail-closed: a "fixture" readback is a synthetic test seed.
  // Production signing paths must refuse it so that a misconfigured client
  // with a leftover fixture object cannot mint receipts that look live but
  // were anchored against a hand-crafted price. Tests opt in explicitly via
  // `allowFixtureReadback: true`.
  if (pythReadback.source === "fixture") {
    if (allowFixtureReadback) return;
    throw new Error(
      "Pyth read-back source is 'fixture'; refusing to mint a receipt against a synthetic price. Configure a live Pyth PriceInfoObject or pass allowFixtureReadback in tests.",
    );
  }
  if (pythReadback.stale === true) {
    throw new Error("Pyth read-back is stale; refresh oracle read-back before minting a receipt.");
  }
  // B3: confidence-bound refusal. Pyth publishes a `confidenceBps` ratio
  // alongside every price; a wide confidence band means the feed is noisy
  // (chain congestion, publisher slowdown, low-liquidity period). Minting
  // a decision against a noisy price is exactly the V2 risk the council
  // flagged in §9. Default 100 bps (1% of price) for BTC/USD per
  // oracle-pricing-patterns skill; override via `pythMaxConfidenceBps`.
  const confidenceBps = Number(pythReadback.confidenceBps);
  if (Number.isFinite(confidenceBps) && Number.isFinite(pythMaxConfidenceBps)
      && pythMaxConfidenceBps > 0 && confidenceBps > pythMaxConfidenceBps) {
    throw new Error(
      `Pyth read-back confidence too wide: ${confidenceBps} bps, max ${pythMaxConfidenceBps} bps. Refresh oracle read-back before minting a receipt.`,
    );
  }
  const publishTimeMs = Number(pythReadback.publishTimeMs);
  if (!Number.isFinite(publishTimeMs) || publishTimeMs <= 0) return;
  const staleMaxMs = Number(pythReadback.staleMaxMs);
  if (Number.isFinite(staleMaxMs) && staleMaxMs > 0 && observedMs - publishTimeMs > staleMaxMs) {
    const ageSeconds = ((observedMs - publishTimeMs) / 1000).toFixed(1);
    const limitSeconds = (staleMaxMs / 1000).toFixed(1);
    throw new Error(
      `Pyth read-back is stale: ${ageSeconds}s old, max ${limitSeconds}s. Refresh oracle read-back before minting a receipt.`,
    );
  }
  const divergenceMs = Math.abs(Number(observedMs) - publishTimeMs);
  if (divergenceMs > pythMaxDivergenceMs) {
    const divergenceMinutes = (divergenceMs / 60_000).toFixed(1);
    const limitMinutes = (pythMaxDivergenceMs / 60_000).toFixed(1);
    throw new Error(
      `Forecast observedAt contradicts Pyth publishTime by ${divergenceMinutes}m, max ${limitMinutes}m.`,
    );
  }
}

export function assertForecastIsFresh({
  forecast,
  marketBand,
  forecastObservedAtMs,
  forecastMaxStaleMs = DEFAULT_FORECAST_MAX_STALE_MS,
  pythReadback = null,
  pythMaxDivergenceMs = DEFAULT_PYTH_MAX_DIVERGENCE_MS,
  pythMaxConfidenceBps = DEFAULT_PYTH_MAX_CONFIDENCE_BPS,
  allowFixtureReadback = false,
  now = Date.now(),
} = {}) {
  if (marketBand && typeof marketBand === "object" && marketBand.stale === true) {
    throw new Error("Forecast is stale: market band is flagged stale. Refresh forecasts before minting a receipt.");
  }
  if (forecast && typeof forecast === "object" && forecast.stale === true) {
    throw new Error("Forecast is stale: forecast snapshot is flagged stale. Refresh forecasts before minting a receipt.");
  }
  assertCallerObservedAtBoundToSignedSource({ forecast, forecastObservedAtMs });
  if (!forecast && !Number.isFinite(forecastObservedAtMs)) return;
  const observedMs = Number.isFinite(forecastObservedAtMs)
    ? Number(forecastObservedAtMs)
    : resolveForecastObservedMs(forecast, forecastObservedAtMs);
  if (!Number.isFinite(observedMs)) {
    throw new Error("Forecast observedAt is missing or unparseable; refusing to mint a receipt against an unverifiable forecast.");
  }
  assertPythPublishTimeConsistent({ observedMs, pythReadback, pythMaxDivergenceMs, pythMaxConfidenceBps, allowFixtureReadback });
  const ageMs = now - observedMs;
  if (ageMs > forecastMaxStaleMs) {
    const ageHours = (ageMs / (60 * 60_000)).toFixed(1);
    const limitHours = (forecastMaxStaleMs / (60 * 60_000)).toFixed(1);
    throw new Error(
      `Forecast is stale: ${ageHours}h old, max ${limitHours}h. Refresh forecasts before minting a receipt.`,
    );
  }
}

export async function buildMintReceiptTransaction({
  sender,
  policyId,
  action,
  decisionAttestation,
  walrusBlobId,
  railPackDigest,
  contentDigest,
  expectedRail,
  forecast = null,
  marketBand = null,
  forecastObservedAtMs = null,
  forecastMaxStaleMs = DEFAULT_FORECAST_MAX_STALE_MS,
  pythReadback = null,
  pythMaxDivergenceMs = DEFAULT_PYTH_MAX_DIVERGENCE_MS,
  pythMaxConfidenceBps = DEFAULT_PYTH_MAX_CONFIDENCE_BPS,
  allowFixtureReadback = false,
  config = globalThis.window?.TIDE_CONFIG || {},
}) {
  assertReceiptSigningNetwork(config);
  assertForecastIsFresh({ forecast, marketBand, forecastObservedAtMs, forecastMaxStaleMs, pythReadback, pythMaxDivergenceMs, pythMaxConfidenceBps, allowFixtureReadback });
  const { packageId, moduleName, clockObjectId } = getExecutionReceiptsConfig(config);
  const policyCfg = getPolicyRegistryConfig(config);
  if (!packageId) {
    throw new Error("Execution receipts package is not configured.");
  }
  if (!policyCfg.railAllowlistId) {
    throw new Error("Rail allowlist object is not configured for mint_receipt.");
  }
  if (!policyId) {
    throw new Error("policyId is required for mint_receipt.");
  }
  const actionLabel = normalizeString(action);
  if (!actionLabel) throw new Error("action is required for mint_receipt.");
  const attestation = normalizeDecisionAttestationInput(decisionAttestation);
  const blobId = normalizeWalrusBlobId(walrusBlobId);
  assertDigestBytes("railPackDigest", railPackDigest);
  assertDigestBytes("contentDigest", contentDigest);
  const canonicalRail = canonicalizeRailForMove(
    expectedRail,
    "expectedRail for mint_receipt",
  );
  if (!canonicalRail) {
    throw new Error(
      "expectedRail is required for mint_receipt (pins the policy's selected rail to the simulated bundle).",
    );
  }

  const tx = await createBaseTransaction(sender, "RECEIPT_MINT");
  tx.moveCall({
    target: `${packageId}::${moduleName}::mint_receipt`,
    arguments: [
      tx.object(policyId),
      tx.object(policyCfg.railAllowlistId),
      tx.pure.vector("u8", encodeUtf8(actionLabel)),
      tx.pure.vector("u8", encodeUtf8(attestation.decisionType)),
      tx.pure.vector("u8", encodeUtf8(attestation.limitations)),
      tx.pure.vector("u8", attestation.stateBeforeDigest),
      tx.pure.vector("u8", encodeUtf8(blobId)),
      tx.pure.vector("u8", railPackDigest),
      tx.pure.vector("u8", contentDigest),
      tx.pure.vector("u8", encodeUtf8(canonicalRail)),
      tx.object(clockObjectId),
    ],
  });
  assertReceiptMintIsTerminal(tx, { packageId, moduleName });
  const expectedBinding = {
    policyId,
    railAllowlistId: policyCfg.railAllowlistId,
    clockObjectId,
    action: actionLabel,
    decisionType: attestation.decisionType,
    limitations: attestation.limitations,
    stateBeforeDigest: attestation.stateBeforeDigest,
    walrusBlobId: blobId,
    railPackDigest,
    contentDigest,
    expectedRail: canonicalRail,
  };
  const byteBinding = assertMintReceiptByteBinding(tx, expectedBinding, { packageId, moduleName });
  attachMintReceiptPreSignValidator(tx, expectedBinding, { packageId, moduleName });
  return {
    transaction: tx,
    mode: "mint_receipt",
    action: actionLabel,
    decisionType: attestation.decisionType,
    limitations: attestation.limitations,
    expectedRail: canonicalRail,
    policyId: byteBinding.policyId,
    byteBinding,
    stateBeforeDigestHex: byteBinding.stateBeforeDigestHex,
    railPackDigestHex: byteBinding.railPackDigestHex,
    contentDigestHex: byteBinding.contentDigestHex,
  };
}

// Atomic PTB: select_rail + mint_receipt in a single transaction.
//
// Use this when the mint is supposed to attest a rail change that was
// just made. Splitting the two calls leaves a window where the policy
// version could bump from elsewhere, and the mint would then abort with
// E_POLICY_VERSION_STALE. Bundling them guarantees the version the
// proof was built against is the version the receipt records.
//
// When `railId` is falsy (or equals the caller-supplied `currentRail`),
// the rail change is skipped and only mint_receipt runs.
export async function buildSelectRailAndMintTransaction({
  sender,
  policyId,
  railId,
  currentRail,
  action,
  decisionAttestation,
  walrusBlobId,
  railPackDigest,
  contentDigest,
  forecast = null,
  marketBand = null,
  forecastObservedAtMs = null,
  forecastMaxStaleMs = DEFAULT_FORECAST_MAX_STALE_MS,
  pythReadback = null,
  pythMaxDivergenceMs = DEFAULT_PYTH_MAX_DIVERGENCE_MS,
  pythMaxConfidenceBps = DEFAULT_PYTH_MAX_CONFIDENCE_BPS,
  allowFixtureReadback = false,
  config = globalThis.window?.TIDE_CONFIG || {},
}) {
  assertReceiptSigningNetwork(config);
  assertForecastIsFresh({ forecast, marketBand, forecastObservedAtMs, forecastMaxStaleMs, pythReadback, pythMaxDivergenceMs, pythMaxConfidenceBps, allowFixtureReadback });
  const policyCfg = getPolicyRegistryConfig(config);
  const receiptsCfg = getExecutionReceiptsConfig(config);
  if (!policyCfg.packageId) {
    throw new Error("Policy registry package is not configured.");
  }
  if (!receiptsCfg.packageId) {
    throw new Error("Execution receipts package is not configured.");
  }
  if (!policyId) {
    throw new Error("policyId is required.");
  }
  const actionLabel = normalizeString(action);
  if (!actionLabel) throw new Error("action is required.");
  const attestation = normalizeDecisionAttestationInput(decisionAttestation);
  const blobId = normalizeWalrusBlobId(walrusBlobId);
  assertDigestBytes("railPackDigest", railPackDigest);
  assertDigestBytes("contentDigest", contentDigest);

  const desiredRail = canonicalizeRailForMove(railId, "railId for select_rail");
  const canonicalExistingRail = currentRail
    ? canonicalizeRailForMove(currentRail, "currentRail (policy's on-chain selected_rail)")
    : "";
  const shouldSelectRail = Boolean(desiredRail) && desiredRail !== canonicalExistingRail;

  // After this transaction settles, the policy's selected_rail will be
  // `desiredRail` if we're about to call select_rail, or `currentRail`
  // otherwise. The mint_receipt call must pin against whichever one —
  // anchoring the receipt to the rail the caller actually intended.
  const expectedRail = shouldSelectRail ? desiredRail : canonicalExistingRail;
  if (!expectedRail) {
    throw new Error(
      "currentRail is required when no rail change is being made; mint_receipt must pin the policy's selected rail.",
    );
  }

  // mint_receipt always needs the allowlist to re-check the rail at
  // anchor time (E_RAIL_NOT_ALLOWED), so the bundle is hard-invalid if
  // the caller didn't configure it — regardless of whether we're also
  // running select_rail in the same PTB.
  if (!policyCfg.railAllowlistId) {
    throw new Error("Rail allowlist object is not configured.");
  }

  const tx = await createBaseTransaction(
    sender,
    shouldSelectRail ? "RECEIPT_SELECT_RAIL_AND_MINT" : "RECEIPT_MINT",
  );

  if (shouldSelectRail) {
    tx.moveCall({
      target: `${policyCfg.packageId}::${policyCfg.moduleName}::select_rail`,
      arguments: [
        tx.object(policyId),
        tx.pure.vector("u8", encodeUtf8(desiredRail)),
        tx.object(policyCfg.railAllowlistId),
        tx.object(policyCfg.clockObjectId),
      ],
    });
  }

  tx.moveCall({
    target: `${receiptsCfg.packageId}::${receiptsCfg.moduleName}::mint_receipt`,
    arguments: [
      tx.object(policyId),
      tx.object(policyCfg.railAllowlistId),
      tx.pure.vector("u8", encodeUtf8(actionLabel)),
      tx.pure.vector("u8", encodeUtf8(attestation.decisionType)),
      tx.pure.vector("u8", encodeUtf8(attestation.limitations)),
      tx.pure.vector("u8", attestation.stateBeforeDigest),
      tx.pure.vector("u8", encodeUtf8(blobId)),
      tx.pure.vector("u8", railPackDigest),
      tx.pure.vector("u8", contentDigest),
      tx.pure.vector("u8", encodeUtf8(expectedRail)),
      tx.object(receiptsCfg.clockObjectId),
    ],
  });
  assertReceiptMintIsTerminal(tx, {
    packageId: receiptsCfg.packageId,
    moduleName: receiptsCfg.moduleName,
  });
  const expectedBinding = {
    policyId,
    railAllowlistId: policyCfg.railAllowlistId,
    clockObjectId: receiptsCfg.clockObjectId,
    action: actionLabel,
    decisionType: attestation.decisionType,
    limitations: attestation.limitations,
    stateBeforeDigest: attestation.stateBeforeDigest,
    walrusBlobId: blobId,
    railPackDigest,
    contentDigest,
    expectedRail,
  };
  const receiptContext = {
    packageId: receiptsCfg.packageId,
    moduleName: receiptsCfg.moduleName,
  };
  const byteBinding = assertMintReceiptByteBinding(tx, expectedBinding, receiptContext);
  attachMintReceiptPreSignValidator(tx, expectedBinding, receiptContext);

  return {
    transaction: tx,
    mode: shouldSelectRail ? "select_rail+mint_receipt" : "mint_receipt",
    action: actionLabel,
    decisionType: attestation.decisionType,
    limitations: attestation.limitations,
    railChanged: shouldSelectRail,
    railId: desiredRail,
    expectedRail,
    byteBinding,
    stateBeforeDigestHex: byteBinding.stateBeforeDigestHex,
    railPackDigestHex: byteBinding.railPackDigestHex,
    contentDigestHex: byteBinding.contentDigestHex,
  };
}

export function extractReceiptObjectId(result, config = globalThis.window?.TIDE_CONFIG || {}) {
  const { packageId, moduleName } = getExecutionReceiptsConfig(config);
  const targetType = `${packageId}::${moduleName}::ExecutionReceipt`;
  const targetEvent = `${packageId}::${moduleName}::ReceiptMinted`;
  return resolveSuiObjectFromTransaction({
    result,
    expectedObjectType: targetType,
    expectedEventType: targetEvent,
    eventIdFields: ["receipt_id", "receiptId", "object_id", "objectId", "id"],
    label: "receipt",
  }).objectId;
}

export function resolveReceiptObjectReference({
  result = null,
  confirmation = null,
  fallbackObjectId = "",
  config = globalThis.window?.TIDE_CONFIG || {},
} = {}) {
  const { packageId, moduleName } = getExecutionReceiptsConfig(config);
  return resolveSuiObjectFromTransaction({
    result,
    confirmation,
    expectedObjectType: `${packageId}::${moduleName}::ExecutionReceipt`,
    expectedEventType: `${packageId}::${moduleName}::ReceiptMinted`,
    eventIdFields: ["receipt_id", "receiptId", "object_id", "objectId", "id"],
    fallbackObjectId,
    label: "receipt",
  });
}

export function normalizeReceiptObject(rawObject, config = globalThis.window?.TIDE_CONFIG || {}) {
  const { packageId, moduleName } = getExecutionReceiptsConfig(config);
  const fields = parseContentFields(rawObject?.data?.content || rawObject?.content);
  if (!fields) return null;

  const receiptId = normalizeString(
    rawObject?.data?.objectId ||
    rawObject?.objectId ||
    fields.id?.id ||
    fields.id
  );

  const railPack = parseMoveBytes(fields.rail_pack_digest);
  const contentBytes = parseMoveBytes(fields.content_digest);

  return {
    id: receiptId,
    policyId: normalizeString(fields.policy_id),
    policyVersion: normalizeNumber(fields.policy_version, 0),
    owner: normalizeString(rawObject?.data?.owner?.AddressOwner || rawObject?.owner?.AddressOwner || fields.owner),
    action: parseMoveString(fields.action),
    decisionType: parseMoveString(fields.decision_type),
    limitations: parseMoveString(fields.limitations),
    stateBeforeDigest: parseMoveBytes(fields.state_before_digest),
    stateBeforeDigestHex: toHex(parseMoveBytes(fields.state_before_digest)),
    selectedRail: parseMoveString(fields.selected_rail),
    walrusBlobId: parseMoveString(fields.walrus_blob_id),
    railPackDigest: railPack,
    railPackDigestHex: toHex(railPack),
    contentDigest: contentBytes,
    contentDigestHex: toHex(contentBytes),
    revocationSeq: normalizeNumber(fields.revocation_seq, 0),
    createdAtMs: normalizeNumber(fields.created_at_ms, 0),
    objectType: normalizeString(rawObject?.data?.type || rawObject?.type, `${packageId}::${moduleName}::ExecutionReceipt`),
  };
}

export async function fetchReceiptObject(receiptId, config = globalThis.window?.TIDE_CONFIG || {}) {
  if (!receiptId) return null;
  const result = await executionRpc("sui_getObject", [
    receiptId,
    { showContent: true, showOwner: true, showType: true },
  ]);
  return normalizeReceiptObject(result, config);
}

export async function fetchOwnedReceipts(address, config = globalThis.window?.TIDE_CONFIG || {}) {
  const { packageId, moduleName } = getExecutionReceiptsConfig(config);
  if (!address || !packageId) return [];

  const rows = [];
  const { pageLimit, maxPages } = resolveOwnedObjectQueryOptions(config);
  let cursor = null;
  let completedPages = 0;
  do {
    const page = await executionRpc("suix_getOwnedObjects", [
      address,
      {
        filter: { StructType: `${packageId}::${moduleName}::ExecutionReceipt` },
        options: { showContent: true, showOwner: true, showType: true },
      },
      cursor,
      pageLimit,
    ]);
    rows.push(...(page?.data || []));
    cursor = page?.nextCursor || null;
    completedPages += 1;
  } while (shouldContinueOwnedObjectPaging(cursor, completedPages, maxPages));

  return rows
    .map((row) => normalizeReceiptObject(row?.data ? row : row?.data, config))
    .filter(Boolean)
    .sort((left, right) => right.createdAtMs - left.createdAtMs);
}

// Filter owned receipts to a single policy. Used by Workspace to show
// "recent receipts for the bound policy" without a second RPC round —
// ExecutionReceipt is soul-bound to the owner, and policy_id is pinned
// in the receipt at mint time, so a client-side filter is exact.
export async function fetchReceiptsForPolicy(address, policyId, config = globalThis.window?.TIDE_CONFIG || {}) {
  const pinned = normalizeString(policyId);
  if (!pinned) return [];
  const receipts = await fetchOwnedReceipts(address, config);
  return receipts.filter((receipt) => normalizeString(receipt.policyId) === pinned);
}

// Extract ReceiptMinted event(s) out of a raw tx response (sign-and-
// execute or dryRun). Callers use this right after signing so they can
// show the event payload even before the object is indexable.
export function parseReceiptMintedEvents(txResult, config = globalThis.window?.TIDE_CONFIG || {}) {
  const { packageId, moduleName } = getExecutionReceiptsConfig(config);
  if (!packageId || packageId === "0x0") {
    throw new Error("parseReceiptMintedEvents requires executionReceipts packageId.");
  }
  const target = `${packageId}::${moduleName}::ReceiptMinted`;
  const events = Array.isArray(txResult?.events) ? txResult.events : [];
  return events
    .filter((event) => normalizeString(event?.type) === target)
    .map((event) => {
      const data = event?.parsedJson || {};
      const railPack = parseMoveBytes(data.rail_pack_digest);
      const contentBytes = parseMoveBytes(data.content_digest);
      const schemaVersion = requireSupportedReceiptSchemaVersion(data.schema_version);
      const isV2 = schemaVersion >= 2;
      const isV3 = schemaVersion >= 3;
      const stateBeforeDigest = isV2 ? parseMoveBytes(data.state_before_digest) : [];
      if (isV2) {
        requireKnownValue(data.decision_type, "decision_type", DECISION_TYPES);
        requireKnownValue(data.limitations, "limitations", PROOF_LIMITATIONS);
        assertDigestBytes("state_before_digest", stateBeforeDigest);
      }
      return {
        receiptId: normalizeEventId(data, ["receipt_id", "receiptId", "object_id", "objectId", "id"]),
        policyId: normalizeEventId(data, ["policy_id", "policyId"]),
        policyVersion: normalizeNumber(data.policy_version, 0),
        owner: normalizeString(data.owner),
        action: normalizeString(data.action),
        decisionType: isV2 ? normalizeString(data.decision_type) : "",
        limitations: isV2 ? normalizeString(data.limitations) : "",
        stateBeforeDigest,
        stateBeforeDigestHex: toHex(stateBeforeDigest),
        selectedRail: normalizeString(data.selected_rail),
        walrusBlobId: normalizeString(data.walrus_blob_id),
        railPackDigest: railPack,
        railPackDigestHex: toHex(railPack),
        contentDigest: contentBytes,
        contentDigestHex: toHex(contentBytes),
        createdAtMs: normalizeNumber(data.created_at_ms, 0),
        revocationSeq: isV3 ? normalizeNumber(data.revocation_seq, 0) : 0,
        schemaVersion,
        legacy: schemaVersion === 1,
      };
    });
}
