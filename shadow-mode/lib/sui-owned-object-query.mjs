export const DEFAULT_OWNED_OBJECT_PAGE_LIMIT = 50;
export const DEFAULT_OWNED_OBJECT_MAX_PAGES = 5;
export const MAX_OWNED_OBJECT_PAGE_LIMIT = 50;
export const MAX_OWNED_OBJECT_MAX_PAGES = 20;

function normalizePositiveInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.floor(numeric);
}

function readConfiguredValue(config = {}, key) {
  return config?.sui?.[key] ?? config?.onchain?.[key] ?? config?.[key];
}

export function resolveOwnedObjectQueryOptions(config = {}) {
  const pageLimit = normalizePositiveInteger(
    readConfiguredValue(config, "ownedObjectPageLimit"),
    DEFAULT_OWNED_OBJECT_PAGE_LIMIT,
  );
  const maxPages = normalizePositiveInteger(
    readConfiguredValue(config, "ownedObjectMaxPages"),
    DEFAULT_OWNED_OBJECT_MAX_PAGES,
  );

  return {
    pageLimit: Math.min(pageLimit, MAX_OWNED_OBJECT_PAGE_LIMIT),
    maxPages: Math.min(maxPages, MAX_OWNED_OBJECT_MAX_PAGES),
  };
}

export function shouldContinueOwnedObjectPaging(cursor, completedPages, maxPages) {
  return Boolean(cursor) && completedPages < maxPages;
}
