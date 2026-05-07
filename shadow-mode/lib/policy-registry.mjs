import { executionRpc } from "./execution.mjs";
import { isPolicyRegistryReady } from "./sui-network.mjs";
import { getRailDisplay, isKnownRailId, lookupRailIdByDisplay } from "./policy-ids.mjs";
import { resolveOwnedObjectQueryOptions, shouldContinueOwnedObjectPaging } from "./sui-owned-object-query.mjs";
import { resolveSuiObjectFromTransaction } from "./sui-object-resolution.mjs";
import { getSuiGasBudget } from "./sui-gas.mjs";

function getRuntimeConfig(config = {}) {
  return config && typeof config === "object" ? config : {};
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeMoveAddressForCompare(value) {
  const raw = normalizeString(value).toLowerCase();
  if (!raw) return "";
  const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
  if (!/^[0-9a-f]+$/.test(hex)) return raw;
  return `0x${hex.replace(/^0+/, "") || "0"}`;
}

function parseMoveType(value) {
  const parts = normalizeString(value).split("::");
  if (parts.length < 3) return null;
  return {
    packageId: normalizeMoveAddressForCompare(parts[0]),
    moduleName: normalizeString(parts[1]).toLowerCase(),
    structName: normalizeString(parts[2]).split("<")[0].toLowerCase(),
  };
}

function normalizeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

const MAX_POLICY_STRING_BYTES = 128;
const MAX_POLICY_RAIL_BYTES = 64;
const MAX_POLICY_COIN_TYPE_BYTES = 256;
const BPS_DENOM = 10_000;
const MOVE_IDENT = "[A-Za-z_][A-Za-z0-9_]*";
const MOVE_TYPE_PREFIX_RE = new RegExp(`^0x[0-9a-fA-F]{1,64}::${MOVE_IDENT}::${MOVE_IDENT}`);
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;

function pctToBps(value, fallback = 0) {
  const numeric = normalizeNumber(value, fallback);
  return Math.max(0, Math.round(numeric * 100));
}

function bpsToPct(value, fallback = 0) {
  const numeric = normalizeNumber(value, fallback);
  return Math.max(0, numeric / 100);
}

function encodeUtf8(value) {
  return Array.from(new TextEncoder().encode(String(value || "")));
}

function sanitizePolicyNamePart(value, fallback) {
  const normalized = normalizeString(value, fallback)
    .replace(/[^A-Za-z0-9_-]+/g, "")
    .slice(0, 24);
  return normalized || fallback;
}

export function deriveOnChainPolicyName(draft = {}) {
  const symbol = sanitizePolicyNamePart(draft?.collateralAssetSymbol, "BTC");
  return `TIDE ${symbol} policy`;
}

function utf8ByteLength(value) {
  return new TextEncoder().encode(String(value || "")).length;
}

function normalizeBoundedUtf8(value, fieldName, maxBytes, { required = true } = {}) {
  const normalized = normalizeString(value);
  if (!normalized) {
    if (required) {
      throw new Error(`${fieldName} is required.`);
    }
    return "";
  }
  if (CONTROL_CHAR_RE.test(normalized)) {
    throw new Error(`${fieldName} contains control characters.`);
  }
  const bytes = utf8ByteLength(normalized);
  if (bytes > maxBytes) {
    throw new Error(`${fieldName} is too long (${bytes} bytes, max ${maxBytes}).`);
  }
  return normalized;
}

function hasBalancedTypeArgs(value) {
  let depth = 0;
  for (const char of value) {
    if (char === "<") depth += 1;
    if (char === ">") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function isMoveStructType(value) {
  if (!MOVE_TYPE_PREFIX_RE.test(value)) {
    return false;
  }
  if (!/^[0-9a-zA-Z_:<>,\s]+$/.test(value)) {
    return false;
  }
  return hasBalancedTypeArgs(value);
}

function normalizeMoveCoinType(value, fieldName = "collateral coin type") {
  const normalized = normalizeBoundedUtf8(value, fieldName, MAX_POLICY_COIN_TYPE_BYTES);
  if (!isMoveStructType(normalized)) {
    throw new Error(`${fieldName} must be a Move struct type like 0x2::sui::SUI.`);
  }
  return normalized;
}

function validateSelectedRailId(value, fieldName = "selected rail") {
  const normalized = normalizeBoundedUtf8(value, fieldName, MAX_POLICY_RAIL_BYTES);
  if (!isKnownRailId(normalized)) {
    throw new Error(`${fieldName} must be a canonical rail id from the on-chain allowlist.`);
  }
  return normalized;
}

function validatePolicyThresholds(policy = {}) {
  const payoutTargetUsd = normalizeNumber(policy.payoutTargetUsd, 0);
  const minBufferUsd = normalizeNumber(policy.minBufferUsd, 0);
  const maxLtvBps = normalizeNumber(policy.maxLtvBps, 0);
  const targetLtvLowBps = normalizeNumber(policy.targetLtvLowBps, 0);
  const targetLtvHighBps = normalizeNumber(policy.targetLtvHighBps, 0);
  const repayLtvBps = normalizeNumber(policy.repayLtvBps, 0);
  const emergencyLtvBps = normalizeNumber(policy.emergencyLtvBps, 0);

  if (!Number.isSafeInteger(payoutTargetUsd) || payoutTargetUsd <= 0) {
    throw new Error("payoutTargetUsd must be a positive integer.");
  }
  if (!Number.isSafeInteger(minBufferUsd) || minBufferUsd <= 0) {
    throw new Error("minBufferUsd must be a positive integer.");
  }
  const ladder = [
    ["targetLtvLowBps", targetLtvLowBps],
    ["targetLtvHighBps", targetLtvHighBps],
    ["repayLtvBps", repayLtvBps],
    ["emergencyLtvBps", emergencyLtvBps],
    ["maxLtvBps", maxLtvBps],
  ];
  for (const [name, value] of ladder) {
    if (!Number.isSafeInteger(value) || value < 0 || value > BPS_DENOM) {
      throw new Error(`${name} must be an integer between 0 and ${BPS_DENOM}.`);
    }
  }
  if (!(targetLtvLowBps > 0 && targetLtvLowBps < targetLtvHighBps)) {
    throw new Error("LTV ladder must satisfy 0 < target low < target high.");
  }
  if (!(targetLtvHighBps <= repayLtvBps && repayLtvBps <= emergencyLtvBps && emergencyLtvBps <= maxLtvBps)) {
    throw new Error("LTV ladder must satisfy target high <= repay <= emergency <= max.");
  }
}

export function validatePolicySnapshotForCreate(policy = {}) {
  normalizeBoundedUtf8(policy.name, "policy name", MAX_POLICY_STRING_BYTES);
  normalizeBoundedUtf8(policy.mode, "policy mode", MAX_POLICY_STRING_BYTES);
  normalizeBoundedUtf8(policy.priority, "policy priority", MAX_POLICY_STRING_BYTES);
  normalizeBoundedUtf8(policy.collateralSymbol, "collateral symbol", MAX_POLICY_STRING_BYTES);
  normalizeMoveCoinType(policy.collateralCoinType);
  validateSelectedRailId(policy.selectedRail);
  validatePolicyThresholds(policy);
  return true;
}

export function validatePolicySnapshotForUpdate(policy = {}) {
  normalizeBoundedUtf8(policy.mode, "policy mode", MAX_POLICY_STRING_BYTES);
  normalizeBoundedUtf8(policy.priority, "policy priority", MAX_POLICY_STRING_BYTES);
  validateSelectedRailId(policy.selectedRail);
  validatePolicyThresholds(policy);
  return true;
}

function parseMoveString(value) {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    try {
      return new TextDecoder().decode(new Uint8Array(value));
    } catch {
      return value.join("");
    }
  }

  if (value && typeof value === "object") {
    if (typeof value.bytes === "string") {
      return value.bytes;
    }

    if (value.fields) {
      return parseMoveString(value.fields.bytes ?? value.fields);
    }
  }

  return "";
}

function parseContentFields(content) {
  if (!content || typeof content !== "object") {
    return null;
  }

  if (content.dataType === "moveObject" && content.fields && typeof content.fields === "object") {
    return content.fields;
  }

  if (content.content && typeof content.content === "object") {
    return parseContentFields(content.content);
  }

  return null;
}

export function getPolicyRegistryConfig(config = {}) {
  const runtime = getRuntimeConfig(config);
  const policyRegistry = runtime.policyRegistry && typeof runtime.policyRegistry === "object"
    ? runtime.policyRegistry
    : {};

  return {
    packageId: normalizeString(policyRegistry.packageId),
    moduleName: normalizeString(policyRegistry.module, "policy_registry"),
    clockObjectId: normalizeString(policyRegistry.clockObjectId, "0x6"),
    railAllowlistId: normalizeString(policyRegistry.railAllowlistId),
  };
}

export function isPolicyRegistryConfigured(config = {}) {
  return isPolicyRegistryReady(config);
}

export function getExpectedPolicyObjectType(config = {}) {
  const { packageId, moduleName } = getPolicyRegistryConfig(config);
  return packageId ? `${packageId}::${moduleName}::Policy` : "";
}

export function isPolicyObjectTypeCompatible(policy = {}, config = {}) {
  const expected = parseMoveType(getExpectedPolicyObjectType(config));
  const actual = parseMoveType(policy?.objectType);

  if (!expected || !actual) {
    return true;
  }

  return actual.packageId === expected.packageId
    && actual.moduleName === expected.moduleName
    && actual.structName === expected.structName;
}

// Resolve a draft/report to the stable, on-chain rail id that lives in
// RailAllowlist. Move compares the selected_rail byte-string against the
// allowlist verbatim, so we must never send a display label ("Scallop (SUI)")
// when the chain expects "scallop-sui". Candidates are tried in order:
//   1. draft.selectedRail / draft.venueId / draft.railId (already canonical)
//   2. reverse-lookup from display strings (summary.primaryRailName,
//      draft.venueName, draft.railName) via lookupRailIdByDisplay
// Returns "" if nothing resolves — the caller must then fail closed rather
// than shipping an unknown id that would abort with E_RAIL_NOT_ALLOWED on
// the Move side.
export function resolveCanonicalRailId(draft = {}, report = null) {
  const summary = report?.summary || null;
  const directCandidates = [
    draft?.selectedRail,
    draft?.venueId,
    draft?.railId,
    summary?.primaryRailId,
  ];
  for (const candidate of directCandidates) {
    const id = normalizeString(candidate);
    if (id && isKnownRailId(id)) {
      return id;
    }
  }

  const displayCandidates = [
    summary?.primaryRailName,
    draft?.venueName,
    draft?.railName,
    // Some drafts only carry an uppercase display string; keep it as last
    // resort after the structured id fields above.
    ...directCandidates.filter((v) => typeof v === "string" && v),
  ];
  for (const candidate of displayCandidates) {
    const resolved = lookupRailIdByDisplay(candidate);
    if (resolved) return resolved;
  }
  return "";
}

export function derivePolicySnapshot(draft = {}, report = null) {
  const canonicalRail = resolveCanonicalRailId(draft, report);
  if (!canonicalRail) {
    const attempted = [
      draft?.selectedRail,
      draft?.venueId,
      draft?.railId,
      report?.summary?.primaryRailId,
      report?.summary?.primaryRailName,
      draft?.venueName,
    ].filter((v) => typeof v === "string" && v);
    const error = new Error("Policy snapshot rail resolution failed.");
    error.code = "TIDE_RAIL_NOT_ALLOWLISTED";
    error.userMessage = "Policy data could not be saved. Refresh and try again.";
    error.developerMessage =
      `Selected rail is not on the on-chain allowlist. Tried: ${attempted.join(", ") || "(none)"}. ` +
      `Pick a rail registered in shadow-mode/lib/policy-ids.mjs (e.g. "scallop-sui").`;
    error.attemptedRails = attempted;
    throw error;
  }
  return {
    // Scenario names stay local because they can contain client or treasury
    // context. The Move object only receives a neutral, non-PII label.
    name: deriveOnChainPolicyName(draft),
    mode: normalizeString(draft.mode, "Income"),
    priority: normalizeString(draft.priority, "Stability"),
    collateralSymbol: normalizeString(draft.collateralAssetSymbol, "BTC"),
    collateralCoinType: normalizeString(draft.collateralCoinType, ""),
    selectedRail: canonicalRail,
    payoutTargetUsd: Math.max(0, Math.round(normalizeNumber(draft.monthlyPayoutTargetUsd, 0))),
    minBufferUsd: Math.max(0, Math.round(normalizeNumber(draft.minStableBufferUsd, 0))),
    maxLtvBps: pctToBps(draft.maxLtvPct),
    targetLtvLowBps: pctToBps(draft.targetLtvLowPct),
    targetLtvHighBps: pctToBps(draft.targetLtvHighPct),
    repayLtvBps: pctToBps(draft.autoRepayLtvPct),
    emergencyLtvBps: pctToBps(draft.emergencyLtvPct),
  };
}

export function buildDraftFromPolicyObject(policy = {}, baseDraft = {}) {
  const selectedRail = normalizeString(policy.selectedRail, normalizeString(baseDraft.selectedRail));
  const railLabel = getRailDisplay(selectedRail) || selectedRail || normalizeString(baseDraft.venueName);
  const payoutTargetUsd = normalizeNumber(policy.payoutTargetUsd, normalizeNumber(baseDraft.monthlyPayoutTargetUsd, 0));
  const minBufferUsd = normalizeNumber(policy.minBufferUsd, normalizeNumber(baseDraft.minStableBufferUsd, 0));

  return {
    ...baseDraft,
    createScope: "live",
    scenarioName: normalizeString(policy.name, normalizeString(baseDraft.scenarioName, "Untitled policy")),
    mode: normalizeString(policy.mode, normalizeString(baseDraft.mode, "Income")),
    priority: normalizeString(policy.priority, normalizeString(baseDraft.priority, "Stability")),
    collateralAssetSymbol: normalizeString(policy.collateralSymbol, normalizeString(baseDraft.collateralAssetSymbol, "BTC")),
    collateralCoinType: normalizeString(policy.collateralCoinType, normalizeString(baseDraft.collateralCoinType)),
    selectedRail,
    venueName: railLabel || normalizeString(baseDraft.venueName, "Harbor Rail"),
    monthlyPayoutTargetUsd: payoutTargetUsd,
    minStableBufferUsd: minBufferUsd,
    stableBufferUsd: Math.max(normalizeNumber(baseDraft.stableBufferUsd, 0), minBufferUsd),
    maxLtvPct: bpsToPct(policy.maxLtvBps, normalizeNumber(baseDraft.maxLtvPct, 0)),
    targetLtvLowPct: bpsToPct(policy.targetLtvLowBps, normalizeNumber(baseDraft.targetLtvLowPct, 0)),
    targetLtvHighPct: bpsToPct(policy.targetLtvHighBps, normalizeNumber(baseDraft.targetLtvHighPct, 0)),
    autoRepayLtvPct: bpsToPct(policy.repayLtvBps, normalizeNumber(baseDraft.autoRepayLtvPct, 0)),
    emergencyLtvPct: bpsToPct(policy.emergencyLtvBps, normalizeNumber(baseDraft.emergencyLtvPct, 0)),
  };
}

async function createBaseTransaction(sender, gasOperation) {
  const { Transaction } = await import("../vendor/sui-runtime.mjs");
  const tx = new Transaction();
  tx.setSender(sender);
  tx.setGasBudget(getSuiGasBudget(gasOperation));
  return tx;
}

export async function buildCreatePolicyTransaction({ sender, draft, report, config = globalThis.window?.TIDE_CONFIG || {} }) {
  const { packageId, moduleName, clockObjectId, railAllowlistId } = getPolicyRegistryConfig(config);
  if (!packageId) {
    throw new Error("Policy registry package is not configured.");
  }
  if (!railAllowlistId) {
    throw new Error("Rail allowlist object is not configured.");
  }

  const policy = derivePolicySnapshot(draft, report);
  validatePolicySnapshotForCreate(policy);
  const tx = await createBaseTransaction(sender, "POLICY_CREATE");
  tx.moveCall({
    target: `${packageId}::${moduleName}::create_policy`,
    arguments: [
      tx.pure.vector("u8", encodeUtf8(policy.name)),
      tx.pure.vector("u8", encodeUtf8(policy.mode)),
      tx.pure.vector("u8", encodeUtf8(policy.priority)),
      tx.pure.vector("u8", encodeUtf8(policy.collateralSymbol)),
      tx.pure.vector("u8", encodeUtf8(policy.collateralCoinType)),
      tx.pure.vector("u8", encodeUtf8(policy.selectedRail)),
      tx.pure.u64(policy.payoutTargetUsd),
      tx.pure.u64(policy.minBufferUsd),
      tx.pure.u64(policy.maxLtvBps),
      tx.pure.u64(policy.targetLtvLowBps),
      tx.pure.u64(policy.targetLtvHighBps),
      tx.pure.u64(policy.repayLtvBps),
      tx.pure.u64(policy.emergencyLtvBps),
      tx.object(railAllowlistId),
      tx.object(clockObjectId),
    ],
  });

  return { transaction: tx, policy, mode: "create" };
}

export async function buildUpdatePolicyTransaction({
  sender,
  policyId,
  previousPolicy = null,
  draft,
  report,
  config = globalThis.window?.TIDE_CONFIG || {},
}) {
  const { packageId, moduleName, clockObjectId, railAllowlistId } = getPolicyRegistryConfig(config);
  if (!packageId) {
    throw new Error("Policy registry package is not configured.");
  }
  if (!policyId) {
    throw new Error("Policy object id is required for update.");
  }

  const policy = derivePolicySnapshot(draft, report);
  validatePolicySnapshotForUpdate(policy);
  const tx = await createBaseTransaction(sender, "POLICY_UPDATE");
  const policyObject = tx.object(policyId);

  tx.moveCall({
    target: `${packageId}::${moduleName}::update_policy`,
    arguments: [
      policyObject,
      tx.pure.vector("u8", encodeUtf8(policy.mode)),
      tx.pure.vector("u8", encodeUtf8(policy.priority)),
      tx.pure.u64(policy.payoutTargetUsd),
      tx.pure.u64(policy.minBufferUsd),
      tx.pure.u64(policy.maxLtvBps),
      tx.pure.u64(policy.targetLtvLowBps),
      tx.pure.u64(policy.targetLtvHighBps),
      tx.pure.u64(policy.repayLtvBps),
      tx.pure.u64(policy.emergencyLtvBps),
      tx.object(clockObjectId),
    ],
  });

  const previousRail = normalizeString(previousPolicy?.selectedRail);
  if (previousRail !== policy.selectedRail) {
    if (!railAllowlistId) {
      throw new Error("Rail allowlist object is not configured.");
    }
    tx.moveCall({
      target: `${packageId}::${moduleName}::select_rail`,
      arguments: [
        policyObject,
        tx.pure.vector("u8", encodeUtf8(policy.selectedRail)),
        tx.object(railAllowlistId),
        tx.object(clockObjectId),
      ],
    });
  }

  return { transaction: tx, policy, mode: "update" };
}

export async function buildSelectRailTransaction({
  sender,
  policyId,
  railId,
  config = globalThis.window?.TIDE_CONFIG || {},
}) {
  const { packageId, moduleName, clockObjectId, railAllowlistId } = getPolicyRegistryConfig(config);
  if (!packageId) {
    throw new Error("Policy registry package is not configured.");
  }
  if (!policyId) {
    throw new Error("Policy object id is required for select_rail.");
  }
  if (!railAllowlistId) {
    throw new Error("Rail allowlist object is not configured.");
  }
  const rawRail = normalizeString(railId);
  if (!rawRail) {
    throw new Error("railId is required for select_rail.");
  }
  // Accept either the canonical stable id ("scallop-sui") or a display
  // label ("Scallop (SUI)") — reverse-lookup ensures Move sees the stable
  // id the RailAllowlist was seeded with.
  const rail = isKnownRailId(rawRail) ? rawRail : lookupRailIdByDisplay(rawRail);
  if (!rail) {
    throw new Error(
      `Rail id "${rawRail}" is not in the off-chain registry (shadow-mode/lib/policy-ids.mjs). ` +
      `Move would abort with E_RAIL_NOT_ALLOWED; fix the caller rather than shipping a mismatched label.`
    );
  }

  const tx = await createBaseTransaction(sender, "POLICY_SELECT_RAIL");
  tx.moveCall({
    target: `${packageId}::${moduleName}::select_rail`,
    arguments: [
      tx.object(policyId),
      tx.pure.vector("u8", encodeUtf8(rail)),
      tx.object(railAllowlistId),
      tx.object(clockObjectId),
    ],
  });

  return { transaction: tx, railId: rail, mode: "select_rail" };
}

export async function buildMigratePolicyTransaction({
  sender,
  policyId,
  config = globalThis.window?.TIDE_CONFIG || {},
}) {
  const { packageId, moduleName, clockObjectId } = getPolicyRegistryConfig(config);
  if (!packageId) {
    throw new Error("Policy registry package is not configured.");
  }
  if (!policyId) {
    throw new Error("Policy object id is required for migrate_policy.");
  }
  const tx = await createBaseTransaction(sender, "POLICY_MIGRATE");
  tx.moveCall({
    target: `${packageId}::${moduleName}::migrate_policy`,
    arguments: [
      tx.object(policyId),
      tx.object(clockObjectId),
    ],
  });
  return { transaction: tx, mode: "migrate" };
}

export async function buildDeletePolicyTransaction({
  sender,
  policyId,
  config = globalThis.window?.TIDE_CONFIG || {},
}) {
  const { packageId, moduleName } = getPolicyRegistryConfig(config);
  if (!packageId) {
    throw new Error("Policy registry package is not configured.");
  }
  if (!policyId) {
    throw new Error("Policy object id is required for delete_policy.");
  }
  const tx = await createBaseTransaction(sender, "POLICY_DELETE");
  tx.moveCall({
    target: `${packageId}::${moduleName}::delete_policy`,
    arguments: [tx.object(policyId)],
  });
  return { transaction: tx, mode: "delete" };
}

export function extractPolicyObjectId(result, config = globalThis.window?.TIDE_CONFIG || {}) {
  const { packageId, moduleName } = getPolicyRegistryConfig(config);
  const targetType = `${packageId}::${moduleName}::Policy`;
  const targetEvent = `${packageId}::${moduleName}::PolicyCreated`;
  return resolveSuiObjectFromTransaction({
    result,
    expectedObjectType: targetType,
    expectedEventType: targetEvent,
    eventIdFields: ["policy_id", "policyId", "object_id", "objectId", "id"],
    label: "policy",
  }).objectId;
}

export function resolvePolicyObjectReference({
  result = null,
  confirmation = null,
  fallbackObjectId = "",
  config = globalThis.window?.TIDE_CONFIG || {},
} = {}) {
  const { packageId, moduleName } = getPolicyRegistryConfig(config);
  return resolveSuiObjectFromTransaction({
    result,
    confirmation,
    expectedObjectType: `${packageId}::${moduleName}::Policy`,
    expectedEventType: `${packageId}::${moduleName}::PolicyCreated`,
    eventIdFields: ["policy_id", "policyId", "object_id", "objectId", "id"],
    fallbackObjectId,
    label: "policy",
  });
}

export function normalizePolicyObject(rawObject, config = globalThis.window?.TIDE_CONFIG || {}) {
  const { packageId, moduleName } = getPolicyRegistryConfig(config);
  const fields = parseContentFields(rawObject?.data?.content || rawObject?.content);
  if (!fields) {
    return null;
  }

  const policyId = normalizeString(
    rawObject?.data?.objectId ||
    rawObject?.objectId ||
    fields.id?.id ||
    fields.id
  );

  return {
    id: policyId,
    version: normalizeNumber(fields.version, 0),
    owner: normalizeString(rawObject?.data?.owner?.AddressOwner || rawObject?.owner?.AddressOwner || fields.owner),
    name: parseMoveString(fields.name),
    mode: parseMoveString(fields.mode),
    priority: parseMoveString(fields.priority),
    collateralSymbol: parseMoveString(fields.collateral_symbol),
    collateralCoinType: parseMoveString(fields.collateral_coin_type),
    selectedRail: parseMoveString(fields.selected_rail),
    payoutTargetUsd: normalizeNumber(fields.payout_target_usd, 0),
    minBufferUsd: normalizeNumber(fields.min_buffer_usd, 0),
    maxLtvBps: normalizeNumber(fields.max_ltv_bps, 0),
    targetLtvLowBps: normalizeNumber(fields.target_ltv_low_bps, 0),
    targetLtvHighBps: normalizeNumber(fields.target_ltv_high_bps, 0),
    repayLtvBps: normalizeNumber(fields.repay_ltv_bps, 0),
    emergencyLtvBps: normalizeNumber(fields.emergency_ltv_bps, 0),
    createdAtMs: normalizeNumber(fields.created_at_ms, 0),
    updatedAtMs: normalizeNumber(fields.updated_at_ms, 0),
    objectType: normalizeString(rawObject?.data?.type || rawObject?.type, `${packageId}::${moduleName}::Policy`),
  };
}

export async function fetchPolicyObject(policyId, config = globalThis.window?.TIDE_CONFIG || {}) {
  if (!policyId) {
    return null;
  }

  const result = await executionRpc("sui_getObject", [
    policyId,
    {
      showContent: true,
      showOwner: true,
      showType: true,
    },
  ]);

  return normalizePolicyObject(result, config);
}

export async function fetchOwnedPolicies(address, config = globalThis.window?.TIDE_CONFIG || {}) {
  const { packageId, moduleName } = getPolicyRegistryConfig(config);
  if (!address || !packageId) {
    return [];
  }

  const rows = [];
  const { pageLimit, maxPages } = resolveOwnedObjectQueryOptions(config);
  let cursor = null;
  let completedPages = 0;
  do {
    const page = await executionRpc("suix_getOwnedObjects", [
      address,
      {
        filter: {
          StructType: `${packageId}::${moduleName}::Policy`,
        },
        options: {
          showContent: true,
          showOwner: true,
          showType: true,
        },
      },
      cursor,
      pageLimit,
    ]);
    rows.push(...(page?.data || []));
    cursor = page?.nextCursor || null;
    completedPages += 1;
  } while (shouldContinueOwnedObjectPaging(cursor, completedPages, maxPages));

  return rows
    .map((row) => normalizePolicyObject(row?.data ? row : row?.data, config))
    .filter(Boolean)
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs);
}
