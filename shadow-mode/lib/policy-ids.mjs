// Stable <-> display mapping for rail identifiers.
//
// Move compares rails byte-for-byte (the on-chain `selected_rail` string
// must match something in RailAllowlist). Off-chain display names change
// freely ("Scallop (SUI)" vs "Scallop · sui", etc.) so we keep a single
// mapping in one place.
//
// The stable ids MUST match the rails seeded by
// `scripts/seed-rail-allowlist.mjs`. Adding a new rail requires:
//   1. adding it here
//   2. adding it to the seed script defaults (or running --rail)
//   3. surfacing it in `collect-live-rail-pack.mjs` if it should appear
//      in baseline evidence
//
// Keep the list short and explicit. If a display name ends up ambiguous
// (two rails map to the same string), downstream UI will need to
// disambiguate, but the stable id stays unique.

export const RAIL_REGISTRY = Object.freeze({
  "scallop-sui":  { display: "Scallop", venue: "scallop",  asset: "SUI" },
  "navi-sui":     { display: "Navi",    venue: "navi",     asset: "SUI" },
  "suilend-sui":  { display: "Suilend", venue: "suilend",  asset: "SUI" },
  "bucket-sui":   { display: "Bucket",  venue: "bucket",   asset: "SUI" },
  "alphalend-sui": { display: "AlphaLend", venue: "alphalend", asset: "SUI" },
});

export const RAIL_ORDER = Object.freeze(Object.keys(RAIL_REGISTRY));

export function getAllRailIds() {
  return RAIL_ORDER.slice();
}

export function getRailDisplay(stableId, fallback = "") {
  const entry = RAIL_REGISTRY[stableId];
  if (entry) return entry.display;
  return typeof fallback === "string" && fallback ? fallback : String(stableId || "");
}

export function getRailEntry(stableId) {
  return RAIL_REGISTRY[stableId] || null;
}

export function isKnownRailId(stableId) {
  return typeof stableId === "string" && Object.prototype.hasOwnProperty.call(RAIL_REGISTRY, stableId);
}

// Fuzzy reverse lookup for the case where we only have a display label
// (legacy data, older saved runs). Tries exact display match first, then
// case-insensitive, then venue+asset. Returns the stable id or "".
export function lookupRailIdByDisplay(displayOrVenue) {
  const raw = typeof displayOrVenue === "string" ? displayOrVenue.trim() : "";
  if (!raw) return "";
  if (RAIL_REGISTRY[raw]) return raw;

  const lowered = raw.toLowerCase();
  for (const id of RAIL_ORDER) {
    const entry = RAIL_REGISTRY[id];
    if (entry.display.toLowerCase() === lowered) return id;
  }
  for (const id of RAIL_ORDER) {
    const entry = RAIL_REGISTRY[id];
    const composite = `${entry.venue}-${entry.asset}`.toLowerCase();
    if (composite === lowered) return id;
    if (entry.venue.toLowerCase() === lowered) return id;
  }
  return "";
}
