import {
  DEFAULT_SHADOW_SCENARIOS,
} from "./tide_core.mjs";
import {
  deriveMarketScenarios,
  describeMarketBand,
} from "./market-scenarios.mjs";
import {
  buildStressEnvelope,
} from "./stress-envelope.mjs";

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pctToDecimal(value) {
  return asNumber(value) / 100;
}

function normalizeRailPreference(draft = {}) {
  return String(draft?.selectedRail || draft?.railId || "").trim();
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function roundPct(value) {
  return Math.round(value * 10000) / 10000;
}

function isBlank(value) {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function isFiniteField(value) {
  return isBlank(value) || Number.isFinite(Number(value));
}

function addFiniteErrors(draft, errors) {
  const fields = [
    ["btcUnits", "BTC units"],
    ["btcPriceUsd", "BTC price"],
    ["debtUsd", "Debt"],
    ["stableBufferUsd", "Stable buffer"],
    ["minStableBufferUsd", "Minimum stable buffer"],
    ["desiredRunwayMonths", "Desired runway"],
    ["monthlyPayoutTargetUsd", "Monthly payout target"],
    ["maxLtvPct", "Max LTV"],
    ["targetLtvLowPct", "Target LTV low"],
    ["targetLtvHighPct", "Target LTV high"],
    ["autoRepayLtvPct", "Auto repay LTV"],
    ["emergencyLtvPct", "Emergency LTV"],
    ["maxSingleVenueExposurePct", "Max venue exposure"],
    ["maxWrapperExposurePct", "Max wrapper exposure"],
    ["minOracleConfidencePct", "Minimum oracle confidence"],
    ["minLiquidityScorePct", "Minimum liquidity score"],
    ["venueExposurePct", "Venue exposure"],
    ["wrapperExposurePct", "Wrapper exposure"],
    ["marketRealizedVolPct", "Market volatility"],
    ["marketDailyMovePct", "Daily move"],
    ["marketWeeklyDrawdownPct", "Weekly drawdown"],
    ["marketTrendStrengthPct", "Trend strength"],
    ["oracleConfidencePct", "Oracle confidence"],
    ["liquidityScorePct", "Liquidity score"],
    ["venueHealthScorePct", "Venue health"],
  ];

  for (const [field, label] of fields) {
    if (!isFiniteField(draft?.[field])) {
      errors.push(`${label} must be finite.`);
    }
  }
}

function addPercentErrors(draft, errors) {
  const fields = [
    ["maxLtvPct", "Max LTV"],
    ["targetLtvLowPct", "Target LTV low"],
    ["targetLtvHighPct", "Target LTV high"],
    ["autoRepayLtvPct", "Auto repay LTV"],
    ["emergencyLtvPct", "Emergency LTV"],
    ["maxSingleVenueExposurePct", "Max venue exposure"],
    ["maxWrapperExposurePct", "Max wrapper exposure"],
    ["minOracleConfidencePct", "Minimum oracle confidence"],
    ["minLiquidityScorePct", "Minimum liquidity score"],
    ["venueExposurePct", "Venue exposure"],
    ["wrapperExposurePct", "Wrapper exposure"],
    ["marketRealizedVolPct", "Market volatility"],
    ["marketDailyMovePct", "Daily move"],
    ["marketWeeklyDrawdownPct", "Weekly drawdown"],
    ["marketTrendStrengthPct", "Trend strength"],
    ["oracleConfidencePct", "Oracle confidence"],
    ["liquidityScorePct", "Liquidity score"],
    ["venueHealthScorePct", "Venue health"],
  ];

  for (const [field, label] of fields) {
    const value = Number(draft?.[field]);
    if (Number.isFinite(value) && (value < 0 || value > 100)) {
      errors.push(`${label} must stay between 0 and 100.`);
    }
  }
}

export function validateSimulationInputDraft(draft = {}) {
  const errors = [];
  addFiniteErrors(draft, errors);
  addPercentErrors(draft, errors);

  const debtUsd = Number(draft?.debtUsd);
  const stableBufferUsd = Number(draft?.stableBufferUsd);
  const minStableBufferUsd = Number(draft?.minStableBufferUsd);
  const btcUnits = Number(draft?.btcUnits);
  const btcPriceUsd = Number(draft?.btcPriceUsd);
  const desiredRunwayMonths = Number(draft?.desiredRunwayMonths);
  const monthlyPayoutTargetUsd = Number(draft?.monthlyPayoutTargetUsd);
  if (Number.isFinite(btcUnits) && btcUnits < 0) errors.push("BTC units cannot be negative.");
  if (Number.isFinite(btcPriceUsd) && btcPriceUsd < 0) errors.push("BTC price cannot be negative.");
  if (Number.isFinite(debtUsd) && debtUsd < 0) errors.push("Debt cannot be negative.");
  if (Number.isFinite(stableBufferUsd) && stableBufferUsd < 0) errors.push("Stable buffer cannot be negative.");
  if (Number.isFinite(minStableBufferUsd) && minStableBufferUsd < 0) errors.push("Minimum stable buffer cannot be negative.");
  if (Number.isFinite(monthlyPayoutTargetUsd) && monthlyPayoutTargetUsd < 0) errors.push("Monthly payout target cannot be negative.");
  if (Number.isFinite(desiredRunwayMonths) && desiredRunwayMonths <= 0) errors.push("Desired runway must be greater than zero.");

  const low = Number(draft?.targetLtvLowPct);
  const high = Number(draft?.targetLtvHighPct);
  const repay = Number(draft?.autoRepayLtvPct);
  const emergency = Number(draft?.emergencyLtvPct);
  const max = Number(draft?.maxLtvPct);
  if (Number.isFinite(low) && Number.isFinite(high) && low >= high) {
    errors.push("Target LTV low must stay below target LTV high.");
  }
  if (Number.isFinite(high) && Number.isFinite(repay) && high >= repay) {
    errors.push("Target LTV high must stay below auto repay LTV.");
  }
  if (Number.isFinite(repay) && Number.isFinite(emergency) && repay >= emergency) {
    errors.push("Auto repay LTV must stay below emergency LTV.");
  }
  if (Number.isFinite(emergency) && Number.isFinite(max) && emergency > max) {
    errors.push("Emergency LTV cannot exceed max LTV.");
  }

  return errors;
}

export function buildSimulationInput(draft, { now = new Date().toISOString(), validate = true } = {}) {
  if (validate) {
    const errors = validateSimulationInputDraft(draft);
    if (errors.length) {
      throw new Error(`Invalid simulation input: ${errors.join(" ")}`);
    }
  }

  const btcUnits = asNumber(draft?.btcUnits);
  const btcPriceUsd = asNumber(draft?.btcPriceUsd);
  const collateralUsd = Math.round(btcUnits * btcPriceUsd * 100) / 100;

  return {
    now,
    policy: {
      mode: draft?.mode,
      priority: draft?.priority,
      preferredRailId: normalizeRailPreference(draft),
      maxLtv: pctToDecimal(draft?.maxLtvPct),
      targetLtvLow: pctToDecimal(draft?.targetLtvLowPct),
      targetLtvHigh: pctToDecimal(draft?.targetLtvHighPct),
      minStableBufferUsd: asNumber(draft?.minStableBufferUsd),
      desiredRunwayMonths: Math.max(1, asNumber(draft?.desiredRunwayMonths)),
      monthlyPayoutTargetUsd: asNumber(draft?.monthlyPayoutTargetUsd),
      allowPayoutPauseInStress: Boolean(draft?.allowPayoutPauseInStress),
      maxSingleVenueExposurePct: pctToDecimal(draft?.maxSingleVenueExposurePct),
      maxWrapperExposurePct: pctToDecimal(draft?.maxWrapperExposurePct),
      autoRepayLtv: pctToDecimal(draft?.autoRepayLtvPct),
      emergencyLtv: pctToDecimal(draft?.emergencyLtvPct),
      minOracleConfidence: pctToDecimal(draft?.minOracleConfidencePct),
      minLiquidityScore: pctToDecimal(draft?.minLiquidityScorePct),
      allowNewBorrowInStress: Boolean(draft?.allowNewBorrowInStress),
      allowNewBorrowInCrisis: Boolean(draft?.allowNewBorrowInCrisis),
    },
    portfolio: {
      btcUnits,
      btcPriceUsd,
      collateralUsd,
      debtUsd: asNumber(draft?.debtUsd),
      stableBufferUsd: asNumber(draft?.stableBufferUsd),
      stableAssetSymbol: String(draft?.stableAssetSymbol || "").trim() || "USDC",
      venueExposurePct: pctToDecimal(draft?.venueExposurePct),
      wrapperExposurePct: pctToDecimal(draft?.wrapperExposurePct),
    },
    market: {
      realizedVol30d: pctToDecimal(draft?.marketRealizedVolPct),
      dailyMovePctAbs: pctToDecimal(draft?.marketDailyMovePct),
      weeklyDrawdownPct: pctToDecimal(draft?.marketWeeklyDrawdownPct),
      trendStrength: pctToDecimal(draft?.marketTrendStrengthPct),
    },
    venues: [
      {
        name: String(draft?.venueName || "").trim() || "PrimaryRail",
        healthy: Boolean(draft?.venueHealthy),
        oracleConfidence: pctToDecimal(draft?.oracleConfidencePct),
        liquidityScore: pctToDecimal(draft?.liquidityScorePct),
        healthScore: pctToDecimal(draft?.venueHealthScorePct),
      },
    ],
  };
}

function buildSliderStressScenario(draft = {}) {
  const source = draft && typeof draft === "object" ? draft : {};
  const realizedVolPct = Number(source.marketRealizedVolPct);
  const dailyMovePct = Number(source.marketDailyMovePct);
  const weeklyDrawdownPct = Number(source.marketWeeklyDrawdownPct);
  const trendStrengthPct = Number(source.marketTrendStrengthPct);
  const hasOperatorStressInput = (
    (Number.isFinite(realizedVolPct) && realizedVolPct > 0) ||
    (Number.isFinite(dailyMovePct) && dailyMovePct > 0) ||
    (Number.isFinite(weeklyDrawdownPct) && weeklyDrawdownPct > 0) ||
    (Number.isFinite(trendStrengthPct) && Math.abs(trendStrengthPct - 50) > 0.001)
  );
  const currentPriceUsd = Number(source.btcPriceUsd);

  if (!hasOperatorStressInput || !Number.isFinite(currentPriceUsd) || currentPriceUsd <= 0) {
    return null;
  }

  const envelope = buildStressEnvelope({
    ...source,
    spotPriceUsd: currentPriceUsd,
    periodDays: source.stressPeriodDays || source.periodDays || 30,
  });
  const drawdownPct = clamp(Number(envelope?.stress?.shockPeakPct) / 100, 0, 0.82);
  if (drawdownPct <= 0.001) return null;

  const envelopeDailyMovePct = Number(envelope?.inputs?.dailyMovePct) || 0;
  const envelopeRealizedVolPct = Number(envelope?.inputs?.realizedVolPct) || 0;
  const oracleConfidenceHaircut = clamp(
    (envelopeDailyMovePct * 1.5 + envelopeRealizedVolPct * 0.12) / 100,
    0,
    0.35,
  );

  return {
    id: "setup-stress-sliders",
    label: "Setup stress sliders",
    drawdownPct: roundPct(drawdownPct),
    horizonDays: Math.round(Number(envelope?.inputs?.periodDays) || 30),
    oracleConfidenceHaircut: roundPct(oracleConfidenceHaircut),
  };
}

function mergeUniqueScenarios(...groups) {
  const merged = [];
  const seen = new Set();
  for (const group of groups) {
    const items = Array.isArray(group) ? group : [group];
    for (const scenario of items) {
      if (!scenario?.id || seen.has(scenario.id)) continue;
      seen.add(scenario.id);
      merged.push(scenario);
    }
  }
  return merged;
}

export function buildSimulationScenarios({
  draft,
  forecast = null,
  defaultScenarios = DEFAULT_SHADOW_SCENARIOS,
} = {}) {
  const hardcoded = Array.isArray(defaultScenarios) ? defaultScenarios : [];
  const sliderScenario = buildSliderStressScenario(draft);
  const baseScenarios = mergeUniqueScenarios(hardcoded, sliderScenario);
  const currentPriceUsd = Number(draft?.btcPriceUsd);
  if (!forecast || !Number.isFinite(currentPriceUsd) || currentPriceUsd <= 0) {
    return { scenarios: baseScenarios, marketBand: null };
  }

  const derived = deriveMarketScenarios({ forecast, currentPriceUsd });
  if (!derived.scenarios.length) {
    return { scenarios: baseScenarios, marketBand: null };
  }

  const merged = mergeUniqueScenarios(baseScenarios, derived.scenarios);

  return {
    scenarios: merged,
    marketBand: {
      description: describeMarketBand(derived),
      warnings: derived.warnings,
      scenarios: derived.scenarios,
      source: forecast.source,
      observedAt: forecast.observedAt,
      horizonAt: forecast.horizonAt,
      stale: Boolean(forecast.stale),
    },
  };
}
