import { cloneJson } from "./wallet-scoped-storage.mjs";
import { isPlainObject } from "./scenario-state-store.mjs";

export const DRAFT_SIGNATURE_FIELDS = [
  "mode",
  "btcUnits",
  "btcPriceUsd",
  "debtUsd",
  "stableBufferUsd",
  "targetLtvLowPct",
  "targetLtvHighPct",
  "maxLtvPct",
  "autoRepayLtvPct",
  "emergencyLtvPct",
  "monthlyPayoutTargetUsd",
  "selectedRail",
  "collateralSymbol",
  "collateralCoinType",
];

function defaultMakeId() {
  return `scenario-${Date.now().toString(36)}`;
}

function defaultNowIso() {
  return new Date().toISOString();
}

function isIsoDateString(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function serializeDraftForCompare(draft) {
  if (!isPlainObject(draft)) return null;
  const out = {};
  for (const key of DRAFT_SIGNATURE_FIELDS) {
    const value = draft[key];
    out[key] = typeof value === "number" ? Number(value.toFixed(6)) : value ?? null;
  }
  return JSON.stringify(out);
}

export function splitScenarioNameRoot(name) {
  const raw = String(name || "").trim();
  const match = raw.match(/^(.*?)\s*\((\d+)\)$/);
  if (match) {
    return { root: match[1].trim(), index: Number(match[2]) };
  }
  return { root: raw, index: 0 };
}

export function collectOwnedScenarioNames({
  drafts = [],
  saved = [],
  excludeId = "",
  excludeIds = [],
} = {}) {
  const names = [];
  const excluded = new Set([excludeId, ...excludeIds].filter(Boolean));
  for (const draft of Array.isArray(drafts) ? drafts : []) {
    if (draft && !excluded.has(draft.id) && draft.name) names.push(String(draft.name));
  }
  for (const scenario of Array.isArray(saved) ? saved : []) {
    if (scenario && !excluded.has(scenario.id) && scenario.name) names.push(String(scenario.name));
  }
  return names;
}

export function makeUniqueScenarioName(baseName, takenNames) {
  const clean = String(baseName || "").trim();
  if (!clean) return "Untitled scenario";
  const taken = new Set((takenNames || []).map((name) => String(name || "").trim().toLowerCase()).filter(Boolean));
  if (!taken.has(clean.toLowerCase())) return clean;
  const { root } = splitScenarioNameRoot(clean);
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${root} (${index})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${root} (${Date.now()})`;
}

export function normalizeSavedScenarioRecord(scenario, fallback = {}, {
  makeId = defaultMakeId,
  nowIso = defaultNowIso,
} = {}) {
  if (!isPlainObject(scenario) || !isPlainObject(scenario.draft) || !isPlainObject(scenario.report)) {
    return null;
  }

  const id = typeof scenario.id === "string" && scenario.id.trim()
    ? scenario.id.trim()
    : typeof fallback.id === "string" && fallback.id.trim()
      ? fallback.id.trim()
      : makeId();

  const fallbackName = typeof fallback.name === "string" ? fallback.name : "";
  const fallbackCreatedAt = typeof fallback.createdAt === "string" ? fallback.createdAt : "";
  const createdAt = isIsoDateString(scenario.createdAt)
    ? scenario.createdAt
    : isIsoDateString(fallbackCreatedAt)
      ? fallbackCreatedAt
      : nowIso();

  return {
    ...cloneJson(scenario),
    id,
    name: typeof scenario.name === "string" && scenario.name.trim()
      ? scenario.name.trim()
      : fallbackName || scenario.draft.scenarioName || "Untitled scenario",
    createdAt,
  };
}

export function extractRemoteSavedScenarios(response, options = {}) {
  const scenarios = Array.isArray(response?.scenarios) ? response.scenarios : [];
  const normalized = [];

  for (const entry of scenarios) {
    if (!entry || entry.type !== "saved") {
      continue;
    }

    try {
      const data = typeof entry.data_json === "string"
        ? JSON.parse(entry.data_json)
        : entry.data_json;

      const savedScenario = normalizeSavedScenarioRecord(data, {
        id: entry.id,
        name: entry.name,
        createdAt: entry.created_at || entry.updated_at,
      }, options);

      if (savedScenario) {
        normalized.push(savedScenario);
      }
    } catch {
      continue;
    }
  }

  normalized.sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0));
  return normalized;
}

export function planDraftSave({
  source,
  drafts = [],
  saved = [],
  activeDraftId = "",
  defaultName = "New scenario",
  makeId = defaultMakeId,
  nowIso = defaultNowIso,
  allowDuplicate = false,
} = {}) {
  if (!isPlainObject(source)) {
    return {
      type: "empty",
      record: null,
      drafts: Array.isArray(drafts) ? drafts : [],
      activeDraftId,
    };
  }

  const currentDrafts = Array.isArray(drafts) ? drafts : [];
  const desiredName = String(source.scenarioName || "").trim() || defaultName;
  const activeRecord = activeDraftId
    ? currentDrafts.find((draft) => draft.id === activeDraftId)
    : null;
  const now = nowIso();

  if (activeRecord) {
    const renamed = String(activeRecord.name || "").toLowerCase() !== desiredName.toLowerCase();
    const updated = {
      ...activeRecord,
      name: desiredName,
      updatedAt: now,
      draft: cloneJson({
        ...source,
        scenarioName: desiredName,
      }),
    };
    return {
      type: "update",
      record: updated,
      drafts: currentDrafts.map((draft) => (draft.id === activeDraftId ? updated : draft)),
      activeDraftId,
      renamed,
      duplicate: null,
    };
  }

  const draftSig = serializeDraftForCompare(source);
  const duplicate = draftSig
    ? currentDrafts.find((draft) => draft.id !== activeDraftId && serializeDraftForCompare(draft.draft) === draftSig)
    : null;

  if (duplicate && !allowDuplicate) {
    return {
      type: "duplicate",
      record: null,
      drafts: currentDrafts,
      activeDraftId,
      duplicate,
    };
  }

  const finalName = makeUniqueScenarioName(
    desiredName,
    collectOwnedScenarioNames({ drafts: currentDrafts, saved, excludeId: activeDraftId }),
  );
  const draft = {
    ...source,
    scenarioName: finalName,
  };
  const record = {
    id: makeId(),
    name: finalName,
    createdAt: now,
    draft: cloneJson(draft),
  };

  return {
    type: "create",
    record,
    drafts: [record, ...currentDrafts].slice(0, 20),
    activeDraftId: record.id,
    renamed: finalName !== desiredName,
    duplicate: null,
  };
}

export function buildAutoSavedRunRecord({
  current,
  saved = [],
  drafts = [],
  activeDraftId = "",
  sourceSavedId = "",
  defaultName = "New scenario",
  makeId = defaultMakeId,
  nowIso = defaultNowIso,
  buildOperatorReview = null,
} = {}) {
  if (!isPlainObject(current?.draft) || !isPlainObject(current?.report)) {
    return null;
  }

  const resolvedSourceSavedId = sourceSavedId || current.sourceScenarioId || "";
  const positionId = resolvedSourceSavedId || activeDraftId || "";
  const operatorReview = current.operatorReview || (typeof buildOperatorReview === "function"
    ? buildOperatorReview(current.draft, current.report)
    : null);
  const baseName = String(current.draft.scenarioName || "").trim() || defaultName;
  const currentSig = serializeDraftForCompare(current.draft);
  const existingBySource = positionId
    ? (Array.isArray(saved) ? saved : []).find((scenario) => scenario.id === positionId)
    : null;
  const existingBySignature = !positionId && currentSig
    ? (Array.isArray(saved) ? saved : []).find((scenario) => serializeDraftForCompare(scenario.draft) === currentSig)
    : null;
  const existing = existingBySource || existingBySignature || null;
  const finalName = existing
    ? baseName
    : makeUniqueScenarioName(
        baseName,
        collectOwnedScenarioNames({ drafts, saved, excludeId: activeDraftId }),
      );
  const draft = {
    ...current.draft,
    scenarioName: finalName,
  };
  const record = {
    id: existing ? existing.id : (positionId || makeId()),
    name: finalName,
    createdAt: existing ? existing.createdAt : nowIso(),
    updatedAt: nowIso(),
    draft: cloneJson(draft),
    report: cloneJson(current.report),
    marketBand: isPlainObject(current.marketBand) ? cloneJson(current.marketBand) : null,
    judge: isPlainObject(current.judge) ? cloneJson(current.judge) : null,
    operatorReview: operatorReview ? cloneJson(operatorReview) : null,
    onChainPolicy: isPlainObject(current.onChainPolicy) ? cloneJson(current.onChainPolicy) : null,
    onChainReceipt: isPlainObject(current.onChainReceipt) ? cloneJson(current.onChainReceipt) : null,
  };
  const remaining = (Array.isArray(saved) ? saved : []).filter((scenario) => scenario.id !== record.id);

  return {
    record,
    saved: [record, ...remaining].slice(0, 12),
    compareId: record.id,
    replaced: Boolean(existing),
    renamed: !existing && finalName !== baseName,
  };
}
