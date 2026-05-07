function normalizeId(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function buildLiveProtocolCacheKey(policyId = "", walletAddress = "") {
  const pinnedPolicyId = normalizeId(policyId);
  const pinnedWalletAddress = normalizeId(walletAddress);
  return pinnedPolicyId && pinnedWalletAddress ? `${pinnedWalletAddress}:${pinnedPolicyId}` : "";
}

export function getLiveProtocolRefreshState(store = {}, policyId = "", walletAddress = "") {
  const key = buildLiveProtocolCacheKey(policyId, walletAddress);
  if (!key) {
    return {
      pending: false,
      lastRequestedAt: 0,
      lastSettledAt: 0,
    };
  }

  const source = store && typeof store === "object" && !Array.isArray(store) ? store[key] : null;
  return {
    pending: source?.pending === true,
    lastRequestedAt: normalizeTimestamp(source?.lastRequestedAt),
    lastSettledAt: normalizeTimestamp(source?.lastSettledAt),
  };
}

export function shouldAutoRefreshLiveProtocolReadback({
  policyId = "",
  walletAddress = "",
  posture = null,
  refreshState = null,
  now = Date.now(),
  maxAgeMs = 5 * 60 * 1000,
  minGapMs = 15 * 1000,
} = {}) {
  if (!buildLiveProtocolCacheKey(policyId, walletAddress)) {
    return false;
  }
  if (posture?.refreshable !== true) {
    return false;
  }

  const state = getLiveProtocolRefreshState(
    refreshState ? { [buildLiveProtocolCacheKey(policyId, walletAddress)]: refreshState } : {},
    policyId,
    walletAddress,
  );
  if (state.pending) {
    return false;
  }

  const latestFetchAt = normalizeTimestamp(posture?.fetchedAt);
  if (latestFetchAt > 0 && now - latestFetchAt < maxAgeMs) {
    return false;
  }

  if (state.lastRequestedAt > 0 && now - state.lastRequestedAt < minGapMs) {
    return false;
  }

  return true;
}

export function pruneLiveProtocolCacheEntries({
  readbacks = {},
  refreshState = {},
  walletAddress = "",
  policyIds = [],
} = {}) {
  const pinnedWalletAddress = normalizeId(walletAddress);
  if (!pinnedWalletAddress) {
    return {
      readbacks: {},
      refreshState: {},
    };
  }

  const allowedPolicyIds = new Set(
    (Array.isArray(policyIds) ? policyIds : [])
      .map((value) => normalizeId(value))
      .filter(Boolean),
  );

  const nextReadbacks = {};
  const nextRefreshState = {};

  for (const [key, value] of Object.entries(readbacks && typeof readbacks === "object" ? readbacks : {})) {
    const [entryWalletAddress, entryPolicyId] = String(key || "").split(":");
    if (normalizeId(entryWalletAddress) !== pinnedWalletAddress) continue;
    if (!allowedPolicyIds.has(normalizeId(entryPolicyId))) continue;
    nextReadbacks[key] = value;
  }

  for (const [key, value] of Object.entries(refreshState && typeof refreshState === "object" ? refreshState : {})) {
    const [entryWalletAddress, entryPolicyId] = String(key || "").split(":");
    if (normalizeId(entryWalletAddress) !== pinnedWalletAddress) continue;
    if (!allowedPolicyIds.has(normalizeId(entryPolicyId))) continue;
    nextRefreshState[key] = value;
  }

  return {
    readbacks: nextReadbacks,
    refreshState: nextRefreshState,
  };
}
