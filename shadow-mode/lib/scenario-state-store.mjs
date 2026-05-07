import { cloneJson } from "./wallet-scoped-storage.mjs";

export const STORAGE_DRAFT_KEY = "tide.shadow-mode.draft.v2";
// Named saved drafts (explicit Save as draft). Distinct from STORAGE_DRAFT_KEY
// which holds the single in-progress scratch buffer for the Create form.
export const STORAGE_DRAFTS_KEY = "tide.shadow-mode.drafts.v1";
// Points at the drafts.v1 record the Setup form is currently editing
// (set by Workspace or /setup?id=<draftId>). When set, Save-as-draft updates
// that record in place, including rename edits.
export const STORAGE_ACTIVE_DRAFT_KEY = "tide.shadow-mode.active-draft.v1";
export const STORAGE_SAVED_KEY = "tide.shadow-mode.saved.v2";
// Legacy key. STORAGE_CURRENT_KEY jumped through v2..v6 while
// STORAGE_SAVED_KEY sat at v1, so anything persisted by an older build
// may still be here. Read-on-first-use migrates forward; writes always
// go to STORAGE_SAVED_KEY.
export const LEGACY_STORAGE_SAVED_KEY_V1 = "tide.shadow-mode.saved.v1";
export const STORAGE_CURRENT_KEY = "tide.shadow-mode.current.v6";
export const STORAGE_COMPARE_KEY = "tide.shadow-mode.compare.v4";
export const STORAGE_THEME_KEY = "tide.shadow-mode.theme.v1";
export const STORAGE_RAIL_PACK_KEY = "tide.shadow-mode.rail-pack.v3";
export const STORAGE_DETAILS_KEY = "tide.shadow-mode.details-state.v1";
export const STORAGE_LIVE_CONTROL_KEY = "tide.shadow-mode.live-controls.v1";
export const STORAGE_LIVE_UNWIND_PROGRESS_KEY = "tide.shadow-mode.live-unwind-progress.v1";

export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function identity(value) {
  return value;
}

export function createScenarioStateStore({
  storage,
  defaultDraft,
  normalizeDraft = identity,
  normalizeLiveControlStore = identity,
  normalizeLiveUnwindProgressStore = identity,
} = {}) {
  if (!storage || typeof storage.load !== "function" || typeof storage.save !== "function") {
    throw new TypeError("createScenarioStateStore requires a storage adapter");
  }

  function migrateSavedScenariosV1ToV2({ address } = {}) {
    return storage.migrateArrayKey({
      fromKey: LEGACY_STORAGE_SAVED_KEY_V1,
      toKey: STORAGE_SAVED_KEY,
      address,
    });
  }

  function loadSavedScenarios({ address } = {}) {
    const v2 = storage.load(STORAGE_SAVED_KEY, [], { address });
    if (Array.isArray(v2) && v2.length > 0) return v2;
    const migrated = migrateSavedScenariosV1ToV2({ address });
    if (Array.isArray(migrated) && migrated.length > 0) return migrated;
    return Array.isArray(v2) ? v2 : [];
  }

  function loadSavedDrafts({ address } = {}) {
    const stored = storage.load(STORAGE_DRAFTS_KEY, [], { address });
    return Array.isArray(stored) ? stored : [];
  }

  function loadCurrentState(options = {}) {
    const stored = storage.load(STORAGE_CURRENT_KEY, null, options);

    if (!isPlainObject(stored) || !isPlainObject(stored.draft) || !isPlainObject(stored.report)) {
      return null;
    }

    const report = stored.report;

    if (
      !isPlainObject(report.summary) ||
      !isPlainObject(report.baseline) ||
      !Array.isArray(report.scenarios)
    ) {
      return null;
    }

    return {
      sourceScenarioId: typeof stored.sourceScenarioId === "string" ? stored.sourceScenarioId : "",
      draft: stored.draft,
      report,
      input: stored.input ?? null,
      marketBand: isPlainObject(stored.marketBand) ? stored.marketBand : null,
      judge: isPlainObject(stored.judge) ? stored.judge : null,
      operatorReview: stored.operatorReview ?? null,
      onChainPolicy: isPlainObject(stored.onChainPolicy) ? stored.onChainPolicy : null,
      onChainReceipt: isPlainObject(stored.onChainReceipt) ? stored.onChainReceipt : null,
    };
  }

  function persistCurrentState(current, options = {}) {
    if (!current) {
      return false;
    }
    return storage.save(STORAGE_CURRENT_KEY, current, options);
  }

  function loadDraftState(options = {}) {
    const stored = storage.load(STORAGE_DRAFT_KEY, null, options);
    return isPlainObject(stored) ? stored : null;
  }

  function hasDraftOverrides(draft) {
    return isPlainObject(draft) && Object.keys(draft).length > 0;
  }

  function loadScenarioStateBundle({
    address,
    fallbackToGlobal = false,
    persistFallback = false,
  } = {}) {
    const hasAddress = Boolean(storage.normalizeAddress(address));
    const scopedCurrent = loadCurrentState({ address });
    const scopedSaved = loadSavedScenarios({ address });
    const scopedDrafts = loadSavedDrafts({ address });
    const scopedCompareId = storage.load(STORAGE_COMPARE_KEY, null, { address });
    const scopedDraft = hasAddress
      ? loadDraftState({ address })
      : loadDraftState({ global: true });
    const liveControlState = normalizeLiveControlStore(storage.load(STORAGE_LIVE_CONTROL_KEY, {}, { address }));
    const liveUnwindProgress = normalizeLiveUnwindProgressStore(storage.load(STORAGE_LIVE_UNWIND_PROGRESS_KEY, {}, { address }));

    const fallbackCurrent = hasAddress && fallbackToGlobal ? loadCurrentState({ global: true }) : null;
    const fallbackSaved = [];
    const fallbackCompareId = null;
    const fallbackDraft = hasAddress && fallbackToGlobal ? loadDraftState({ global: true }) : null;

    const current = scopedCurrent || fallbackCurrent || null;
    const saved = Array.isArray(scopedSaved) && scopedSaved.length
      ? scopedSaved
      : Array.isArray(fallbackSaved)
        ? cloneJson(fallbackSaved)
        : [];
    let compareId = scopedCompareId || fallbackCompareId || null;
    const draftSource = hasDraftOverrides(scopedDraft)
      ? scopedDraft
      : hasDraftOverrides(fallbackDraft)
        ? fallbackDraft
        : null;
    const draft = {
      ...defaultDraft,
      ...(draftSource || {}),
    };

    if (compareId && !saved.some((scenario) => scenario.id === compareId)) {
      compareId = null;
    }

    if (persistFallback && hasAddress) {
      if (!scopedCurrent && current) {
        storage.save(STORAGE_CURRENT_KEY, current, { address });
      }
      if (!hasDraftOverrides(scopedDraft) && draftSource) {
        storage.save(STORAGE_DRAFT_KEY, draftSource, { address });
      }
    }

    const normalizedCurrent = current && isPlainObject(current?.draft)
      ? {
          ...current,
          draft: normalizeDraft({
            ...defaultDraft,
            ...current.draft,
          }),
        }
      : current;

    const normalizedSaved = saved.map((scenario) => (
      isPlainObject(scenario?.draft)
        ? {
            ...scenario,
            draft: normalizeDraft({
              ...defaultDraft,
              ...scenario.draft,
            }),
          }
        : scenario
    ));

    const drafts = Array.isArray(scopedDrafts) ? scopedDrafts : [];
    const normalizedDrafts = drafts
      .filter((record) => isPlainObject(record) && isPlainObject(record.draft))
      .map((record) => ({
        ...record,
        draft: normalizeDraft({
          ...defaultDraft,
          ...record.draft,
        }),
      }));

    const rawActiveDraftId = storage.load(STORAGE_ACTIVE_DRAFT_KEY, "", { address });
    const activeDraftId = typeof rawActiveDraftId === "string"
      && normalizedDrafts.some((record) => record.id === rawActiveDraftId)
      ? rawActiveDraftId
      : "";

    return {
      current: normalizedCurrent,
      saved: normalizedSaved,
      drafts: normalizedDrafts,
      compareId,
      draft: normalizeDraft(draft),
      activeDraftId,
      liveControlState,
      liveUnwindProgress,
    };
  }

  return {
    migrateSavedScenariosV1ToV2,
    loadSavedScenarios,
    loadSavedDrafts,
    loadCurrentState,
    persistCurrentState,
    loadDraftState,
    loadScenarioStateBundle,
  };
}
