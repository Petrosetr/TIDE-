// Mainnet event-only readback fallback.
//
// Used when a rail's public object schema is not yet reliable enough for
// debt/collateral/LTV parsing. The resulting shape is intentionally compatible
// with the mainnet-attested demo bundle, but all financial values are zero and
// `valuesParsed=false` so consumers cannot accidentally present it as deep
// protocol state.

export const MAINNET_EVENT_READBACK_SHAPE_VERSION = 1;

const DEFAULT_STALE_MS = 2 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function buildManualMainnetEventReadback({
  railId = "",
  protocolLabel = "Underlying rail",
  walletAddress = "",
  obligationId = "",
  accountId = "",
  observedAt = nowIso(),
  staleMaxMs = DEFAULT_STALE_MS,
} = {}) {
  const targetId = text(obligationId) || text(accountId);
  return {
    schemaVersion: MAINNET_EVENT_READBACK_SHAPE_VERSION,
    railId: text(railId),
    walletAddress: text(walletAddress).toLowerCase(),
    obligationId: targetId.toLowerCase(),
    accountId: text(accountId).toLowerCase(),
    source: "manual-mainnet-event",
    observedAt,
    stale: false,
    staleMaxMs,
    collateralUsd: 0,
    debtUsd: 0,
    ltvBps: 0,
    valuesParsed: false,
    eventOnly: true,
    schemaStatus: "event-only-fallback",
    trustLabel: `${protocolLabel} schema was not parsed. Evidence is limited to a founder-signed mainnet transaction touching the target object; no debt, collateral, or LTV is inferred.`,
  };
}

export async function fetchManualMainnetEventReadback(options = {}) {
  return buildManualMainnetEventReadback(options);
}
