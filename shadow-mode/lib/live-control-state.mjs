const LIVE_CONTROL_MODES = new Set([
  "active",
  "paused",
  "unwind-planned",
  "unwound",
]);

const LIVE_CONTROL_SOURCES = new Set([
  "workspace",
  "live",
  "operator",
]);

function normalizePolicyId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeMode(value, fallback = "active") {
  const mode = typeof value === "string" ? value.trim().toLowerCase() : "";
  return LIVE_CONTROL_MODES.has(mode) ? mode : fallback;
}

function normalizeSource(value) {
  const source = typeof value === "string" ? value.trim().toLowerCase() : "";
  return LIVE_CONTROL_SOURCES.has(source) ? source : "workspace";
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

function normalizeNote(value) {
  return typeof value === "string" ? value.trim().slice(0, 280) : "";
}

function normalizeEvent(raw) {
  const mode = normalizeMode(raw?.mode, "");
  const timestamp = normalizeTimestamp(raw?.timestamp);
  if (!mode || !(timestamp > 0)) {
    return null;
  }
  return {
    mode,
    source: normalizeSource(raw?.source),
    note: normalizeNote(raw?.note),
    timestamp,
  };
}

function normalizeEntry(raw, policyId = "") {
  const pinnedPolicyId = normalizePolicyId(policyId || raw?.policyId);
  const history = Array.isArray(raw?.history)
    ? raw.history
      .map((entry) => normalizeEvent(entry))
      .filter(Boolean)
      .sort((left, right) => right.timestamp - left.timestamp)
    : [];

  const recent = history[0] || null;
  const mode = normalizeMode(raw?.mode, recent?.mode || "active");
  const note = normalizeNote(raw?.note || recent?.note);
  const updatedAt = normalizeTimestamp(raw?.updatedAt) || recent?.timestamp || 0;

  return {
    policyId: pinnedPolicyId,
    mode,
    note,
    updatedAt,
    history,
  };
}

export function normalizeLiveControlStore(raw = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const next = {};

  for (const [key, value] of Object.entries(source)) {
    const policyId = normalizePolicyId(key || value?.policyId);
    if (!policyId) continue;
    next[policyId] = normalizeEntry(value, policyId);
  }

  return next;
}

export function getPolicyLiveControlState(store = {}, policyId = "") {
  const pinnedPolicyId = normalizePolicyId(policyId);
  if (!pinnedPolicyId) {
    return normalizeEntry({}, "");
  }
  const normalized = normalizeLiveControlStore(store);
  return normalized[pinnedPolicyId] || normalizeEntry({}, pinnedPolicyId);
}

export function applyPolicyLiveControlTransition(store = {}, policyId = "", transition = {}) {
  const pinnedPolicyId = normalizePolicyId(policyId);
  if (!pinnedPolicyId) {
    return normalizeLiveControlStore(store);
  }

  const normalizedStore = normalizeLiveControlStore(store);
  const current = getPolicyLiveControlState(normalizedStore, pinnedPolicyId);
  const timestamp = normalizeTimestamp(transition?.timestamp) || Date.now();
  const nextEvent = {
    mode: normalizeMode(transition?.mode),
    source: normalizeSource(transition?.source),
    note: normalizeNote(transition?.note),
    timestamp,
  };

  normalizedStore[pinnedPolicyId] = {
    policyId: pinnedPolicyId,
    mode: nextEvent.mode,
    note: nextEvent.note,
    updatedAt: timestamp,
    history: [nextEvent, ...current.history].slice(0, 24),
  };

  return normalizedStore;
}
