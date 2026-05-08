const UNWIND_STEP_IDS = Object.freeze([
  "pause",
  "review",
  "repay-withdraw",
  "final-proof",
]);

function normalizePolicyId(value) {
  return typeof value === "string" ? value.trim() : "";
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

function normalizeStepId(value) {
  const stepId = typeof value === "string" ? value.trim() : "";
  return UNWIND_STEP_IDS.includes(stepId) ? stepId : "";
}

function normalizeText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeMainnetEvidence(raw = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const status = source.status === "verified" ? "verified" : source.status === "error" ? "error" : "pending";
  const evidence = {
    digest: normalizeText(source.digest),
    sender: normalizeText(source.sender).toLowerCase(),
    obligationId: normalizeText(source.obligationId).toLowerCase(),
    checkpoint: normalizeText(source.checkpoint),
    timestampMs: normalizeNumber(source.timestampMs),
    objectChangeCount: normalizeNumber(source.objectChangeCount),
    protocolAction: normalizeText(source.protocolAction),
    verifiedAt: normalizeNumber(source.verifiedAt),
    status,
    error: status === "error" ? normalizeText(source.error) : "",
    ...(source.preReadback && typeof source.preReadback === "object" && !Array.isArray(source.preReadback)
      ? { preReadback: source.preReadback }
      : {}),
    ...(source.postReadback && typeof source.postReadback === "object" && !Array.isArray(source.postReadback)
      ? { postReadback: source.postReadback }
      : {}),
  };
  return evidence.digest || evidence.verifiedAt > 0 || evidence.error ? evidence : null;
}

function normalizeEntry(raw, policyId = "") {
  const pinnedPolicyId = normalizePolicyId(policyId || raw?.policyId);
  const completed = {};
  const source = raw?.completed && typeof raw.completed === "object" && !Array.isArray(raw.completed)
    ? raw.completed
    : {};
  const mainnetEvidence = normalizeMainnetEvidence(raw?.mainnetEvidence);

  for (const stepId of UNWIND_STEP_IDS) {
    const stamp = normalizeTimestamp(source[stepId]);
    if (stamp > 0) {
      completed[stepId] = stamp;
    }
  }

  return {
    policyId: pinnedPolicyId,
    completed,
    updatedAt: normalizeTimestamp(raw?.updatedAt) || Math.max(0, ...Object.values(completed)),
    ...(mainnetEvidence ? { mainnetEvidence } : {}),
  };
}

export function normalizeLiveUnwindProgressStore(raw = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const next = {};

  for (const [key, value] of Object.entries(source)) {
    const policyId = normalizePolicyId(key || value?.policyId);
    if (!policyId) continue;
    next[policyId] = normalizeEntry(value, policyId);
  }

  return next;
}

export function getPolicyLiveUnwindProgress(store = {}, policyId = "") {
  const pinnedPolicyId = normalizePolicyId(policyId);
  if (!pinnedPolicyId) {
    return normalizeEntry({}, "");
  }
  const normalized = normalizeLiveUnwindProgressStore(store);
  return normalized[pinnedPolicyId] || normalizeEntry({}, pinnedPolicyId);
}

export function togglePolicyLiveUnwindStep(store = {}, policyId = "", stepId = "", completed = true, timestamp = Date.now()) {
  const pinnedPolicyId = normalizePolicyId(policyId);
  const pinnedStepId = normalizeStepId(stepId);
  if (!pinnedPolicyId || !pinnedStepId) {
    return normalizeLiveUnwindProgressStore(store);
  }

  const normalized = normalizeLiveUnwindProgressStore(store);
  const current = getPolicyLiveUnwindProgress(normalized, pinnedPolicyId);
  const nextCompleted = {
    ...current.completed,
  };

  if (completed) {
    nextCompleted[pinnedStepId] = normalizeTimestamp(timestamp) || Date.now();
  } else {
    delete nextCompleted[pinnedStepId];
  }

  normalized[pinnedPolicyId] = {
    policyId: pinnedPolicyId,
    completed: nextCompleted,
    updatedAt: Math.max(0, ...Object.values(nextCompleted)),
    ...(current.mainnetEvidence ? { mainnetEvidence: current.mainnetEvidence } : {}),
  };

  return normalized;
}

export function getLiveUnwindProgressSummary(progress = {}) {
  const completed = progress?.completed && typeof progress.completed === "object" ? progress.completed : {};
  const done = UNWIND_STEP_IDS.filter((stepId) => Number.isFinite(completed[stepId]) && completed[stepId] > 0).length;
  return {
    total: UNWIND_STEP_IDS.length,
    done,
    allDone: done === UNWIND_STEP_IDS.length,
  };
}

export { UNWIND_STEP_IDS };
