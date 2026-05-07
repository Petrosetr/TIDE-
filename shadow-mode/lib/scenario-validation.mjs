import { deriveDraftMetrics } from "./operator-review.mjs";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pctToDecimal(value) {
  return asNumber(value) / 100;
}

function formatUsd(value) {
  return currencyFormatter.format(Math.round(value));
}

function isBlank(value) {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function isInvalidFiniteInput(value) {
  if (isBlank(value)) {
    return false;
  }
  return !Number.isFinite(Number(value));
}

function addFiniteNumberErrors(draft, errors) {
  const fields = [
    ["btcUnits", "BTC units"],
    ["btcPriceUsd", "BTC price"],
    ["debtUsd", "Debt"],
    ["stableBufferUsd", "Stable buffer"],
    ["monthlyPayoutTargetUsd", "Monthly payout target"],
    ["desiredRunwayMonths", "Desired runway"],
    ["minStableBufferUsd", "Minimum stable buffer"],
    ["targetLtvLowPct", "Target LTV low"],
    ["targetLtvHighPct", "Target LTV high"],
    ["maxLtvPct", "Max LTV"],
    ["autoRepayLtvPct", "Auto repay LTV"],
    ["emergencyLtvPct", "Emergency LTV"],
    ["marketRealizedVolPct", "Market volatility"],
    ["marketDailyMovePct", "Daily move"],
    ["marketWeeklyDrawdownPct", "Weekly drawdown"],
    ["marketTrendStrengthPct", "Trend strength"],
    ["venueExposurePct", "Venue exposure"],
    ["wrapperExposurePct", "Wrapper exposure"],
    ["maxSingleVenueExposurePct", "Max venue exposure"],
    ["maxWrapperExposurePct", "Max wrapper exposure"],
    ["oracleConfidencePct", "Oracle confidence"],
    ["liquidityScorePct", "Liquidity score"],
    ["venueHealthScorePct", "Venue health"],
    ["minOracleConfidencePct", "Minimum oracle confidence"],
    ["minLiquidityScorePct", "Minimum liquidity score"],
  ];

  for (const [field, label] of fields) {
    if (isInvalidFiniteInput(draft?.[field])) {
      errors.push(`${label} must be a finite number.`);
    }
  }
}

function addPercentBoundErrors(draft, errors) {
  const fields = [
    ["targetLtvLowPct", "Target LTV low"],
    ["targetLtvHighPct", "Target LTV high"],
    ["maxLtvPct", "Max LTV"],
    ["autoRepayLtvPct", "Auto repay LTV"],
    ["emergencyLtvPct", "Emergency LTV"],
    ["marketRealizedVolPct", "Market volatility"],
    ["marketDailyMovePct", "Daily move"],
    ["marketWeeklyDrawdownPct", "Weekly drawdown"],
    ["marketTrendStrengthPct", "Trend strength"],
    ["venueExposurePct", "Venue exposure"],
    ["wrapperExposurePct", "Wrapper exposure"],
    ["maxSingleVenueExposurePct", "Max venue exposure"],
    ["maxWrapperExposurePct", "Max wrapper exposure"],
    ["oracleConfidencePct", "Oracle confidence"],
    ["liquidityScorePct", "Liquidity score"],
    ["venueHealthScorePct", "Venue health"],
    ["minOracleConfidencePct", "Minimum oracle confidence"],
    ["minLiquidityScorePct", "Minimum liquidity score"],
  ];

  for (const [field, label] of fields) {
    const value = Number(draft?.[field]);
    if (Number.isFinite(value) && (value < 0 || value > 100)) {
      errors.push(`${label} must stay between 0% and 100%.`);
    }
  }
}

export function validateScenarioDraft({
  draft = {},
  createScopeState = null,
} = {}) {
  const metrics = deriveDraftMetrics(draft);
  const errors = [];
  const warnings = [];

  addFiniteNumberErrors(draft, errors);
  addPercentBoundErrors(draft, errors);

  if (!String(draft.scenarioName || "").trim()) {
    errors.push("Scenario name is required.");
  }

  if (asNumber(draft.btcUnits) <= 0) {
    errors.push("BTC units must be greater than zero.");
  }

  if (asNumber(draft.btcPriceUsd) <= 0) {
    errors.push("BTC price must be greater than zero.");
  }

  if (asNumber(draft.debtUsd) < 0) {
    errors.push("Debt cannot be negative.");
  }

  if (asNumber(draft.stableBufferUsd) < 0) {
    errors.push("Stable buffer cannot be negative.");
  }

  if (asNumber(draft.monthlyPayoutTargetUsd) <= 0) {
    errors.push("Monthly payout target must be greater than zero.");
  }

  if (asNumber(draft.desiredRunwayMonths) < 1) {
    errors.push("Desired runway must be at least one month.");
  }

  if (asNumber(draft.targetLtvLowPct) >= asNumber(draft.targetLtvHighPct)) {
    errors.push("Target LTV low must stay below target LTV high.");
  }

  if (asNumber(draft.targetLtvHighPct) >= asNumber(draft.autoRepayLtvPct)) {
    errors.push("Target LTV high must stay below auto repay LTV.");
  }

  if (asNumber(draft.autoRepayLtvPct) >= asNumber(draft.emergencyLtvPct)) {
    errors.push("Auto repay LTV must stay below emergency LTV.");
  }

  if (asNumber(draft.emergencyLtvPct) > asNumber(draft.maxLtvPct)) {
    errors.push("Emergency LTV cannot exceed max LTV.");
  }

  if (asNumber(draft.targetLtvHighPct) >= asNumber(draft.maxLtvPct)) {
    errors.push("Target LTV high must stay below max LTV.");
  }

  if (metrics.collateralUsd <= 0) {
    errors.push("Collateral base must be positive.");
  }

  if (metrics.ltv > pctToDecimal(draft.maxLtvPct)) {
    warnings.push("Current debt already sits above the max LTV boundary.");
  }

  if (metrics.bufferGapUsd > 0) {
    warnings.push(`Stable buffer is ${formatUsd(metrics.bufferGapUsd)} below the requested floor.`);
  }

  if (metrics.runwayMonths < Math.max(1, asNumber(draft.desiredRunwayMonths))) {
    warnings.push("Stable runway is shorter than the requested operating runway.");
  }

  if (asNumber(draft.marketRealizedVolPct) > 100) {
    warnings.push("Market volatility input is already in severe territory.");
  }

  if (createScopeState?.scope === "live" && !createScopeState.canRunSimulation) {
    errors.push(createScopeState.message);
  }

  return { errors, warnings, metrics, createScopeState };
}
