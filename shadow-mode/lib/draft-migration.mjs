import { RiskPriority, UserMode } from "./tide_core.mjs";

export const DEFAULT_WRAPPED_BTC_SYMBOL = "wBTC";
export const DEFAULT_WRAPPED_BTC_COIN_TYPE =
  "0xaafb102dd0902f5055cadecd687fb5b71ca82ef0e0285d90afde828ec58ca96b::btc::BTC";

const PERCENT_FIELDS = [
  "targetLtvLowPct",
  "targetLtvHighPct",
  "maxLtvPct",
  "autoRepayLtvPct",
  "emergencyLtvPct",
  "marketRealizedVolPct",
  "marketDailyMovePct",
  "marketWeeklyDrawdownPct",
  "marketTrendStrengthPct",
  "venueExposurePct",
  "wrapperExposurePct",
  "maxSingleVenueExposurePct",
  "maxWrapperExposurePct",
  "oracleConfidencePct",
  "liquidityScorePct",
  "venueHealthScorePct",
  "minOracleConfidencePct",
  "minLiquidityScorePct",
];

function clampPercentDraftFields(draft) {
  for (const field of PERCENT_FIELDS) {
    const value = Number(draft[field]);
    if (!Number.isFinite(value)) continue;
    draft[field] = Math.min(100, Math.max(0, value));
  }
}

export function coerceLegacyDraftFields(draft, overrides = {}) {
  const next = { ...(draft || {}) };
  const defaultSymbol = overrides.defaultWrappedBtcSymbol || DEFAULT_WRAPPED_BTC_SYMBOL;
  const defaultCoinType = overrides.defaultWrappedBtcCoinType || DEFAULT_WRAPPED_BTC_COIN_TYPE;

  if (next.mode !== UserMode.Income) {
    next.mode = UserMode.Income;
  }

  if (next.priority === RiskPriority.BTCPreservation) {
    next.priority = RiskPriority.Safety;
  }

  const symbol = String(next.collateralAssetSymbol || "").trim();
  const coinType = String(next.collateralCoinType || "").trim();

  if (!symbol || (!coinType && symbol.toUpperCase() === "BTC")) {
    next.collateralAssetSymbol = defaultSymbol;
    next.collateralCoinType = defaultCoinType;
  }

  if (String(next.collateralCoinType || "").toLowerCase().includes("::lbtc::")) {
    next.collateralAssetSymbol = "LBTC";
  }

  clampPercentDraftFields(next);

  return next;
}
