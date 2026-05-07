import { buildJudgeFixture } from "./judge-fixtures.mjs";

const JUDGE_FIXTURES = Object.freeze({
  harbor: buildJudgeFixture("default"),
  stress: buildJudgeFixture("stress"),
  revoke: buildJudgeFixture("revoke"),
  "oracle-stale": buildJudgeFixture("oracle-stale"),
});

function fixtureMeta(fixture) {
  const oracle = fixture?.oracle ? {
    schemaVersion: fixture.oracle.schemaVersion,
    feedSymbol: fixture.oracle.feedSymbol,
    priceInfoObjectId: fixture.oracle.priceInfoObjectId || "",
    source: fixture.oracle.source,
    observedAt: fixture.oracle.observedAt,
    publishTimeMs: fixture.oracle.publishTimeMs,
    ageMs: fixture.oracle.ageMs,
    stale: Boolean(fixture.oracle.stale),
    staleMaxMs: fixture.oracle.staleMaxMs,
    priceUsd: fixture.oracle.priceUsd,
    confidenceUsd: fixture.oracle.confidenceUsd,
    confidenceBps: fixture.oracle.confidenceBps,
    trustLabel: fixture.oracle.trustLabel,
  } : null;
  return {
    id: fixture.fixtureId,
    trustLabel: fixture.trustLabel,
    narration: fixture.narration,
    decisionExpected: fixture.decisionExpected,
    guardFired: fixture.guardFired || "",
    expectedAbortCode: fixture.expectedAbortCode || "",
    oracle,
  };
}

function fixtureFields(fixture, overrides = {}) {
  const portfolio = fixture?.portfolio || {};
  const railId = typeof fixture?.readback?.railId === "string"
    ? fixture.readback.railId.trim()
    : "";
  return {
    scenarioOrigin: `testnet-rehearsal:${fixture.fixtureId}`,
    btcUnits: Number(portfolio.btcUnits) || 1,
    btcPriceUsd: Number(portfolio.btcPriceUsd) || 82500,
    debtUsd: Math.round(Number(portfolio.debtUsd) || 0),
    stableBufferUsd: Math.round(Number(portfolio.stableBufferUsd) || 4800),
    minStableBufferUsd: Math.round(Number(portfolio.stableBufferUsd) || 4800),
    selectedRail: railId,
    railId,
    venueName:
      railId === "suilend-sui"
        ? "Suilend rehearsal rail"
        : railId === "scallop-sui"
          ? "Scallop rehearsal rail"
          : "Rehearsal rail",
    ...overrides,
  };
}

const JUDGE_MODE_ALIASES = new Map([
  ["1", "harbor"],
  ["true", "harbor"],
  ["harbor", "harbor"],
  ["stress", "stress"],
  ["revoke", "revoke"],
  ["oracle-stale", "oracle-stale"],
  ["oracle_stale", "oracle-stale"],
]);

export const JUDGE_SCENARIOS = {
  harbor: {
    mode: "harbor",
    queryValue: "1",
    title: "Judge demo mode",
    label: "Harbor starter",
    autoRun: false,
    copy: "Harbor starter loaded with modeled BTC collateral. Run it when ready; no wallet is required.",
    defenseLine: "Shows the normal policy loop: check, explain, anchor, receipt.",
    fixture: fixtureMeta(JUDGE_FIXTURES.harbor),
    fields: fixtureFields(JUDGE_FIXTURES.harbor, {
      scenarioName: "Overflow Judge Harbor",
      strategyPreset: "starter",
      createScope: "shadow",
      monthlyPayoutTargetUsd: 1200,
      desiredRunwayMonths: 4,
      maxLtvPct: 34,
      targetLtvLowPct: 18,
      targetLtvHighPct: 24,
      autoRepayLtvPct: 27,
      emergencyLtvPct: 31,
      marketRealizedVolPct: 78,
      marketDailyMovePct: 2.8,
      marketWeeklyDrawdownPct: 6,
      marketTrendStrengthPct: 48,
      venueHealthy: true,
      oracleConfidencePct: 95,
      liquidityScorePct: 84,
      venueHealthScorePct: 88,
    }),
  },
  stress: {
    mode: "stress",
    queryValue: "stress",
    title: "Stress rehearsal",
    label: "Crisis path",
    autoRun: true,
    copy: "Loads a drawdown-heavy treasury state so the decision engine has to defend the policy instead of showing a calm hold.",
    defenseLine: "Shows how the decision engine escalates when drawdown and buffer pressure rise.",
    fixture: fixtureMeta(JUDGE_FIXTURES.stress),
    fields: fixtureFields(JUDGE_FIXTURES.stress, {
      scenarioName: "Overflow Judge Stress",
      strategyPreset: "safety",
      createScope: "shadow",
      monthlyPayoutTargetUsd: 900,
      desiredRunwayMonths: 6,
      maxLtvPct: 30,
      targetLtvLowPct: 16,
      targetLtvHighPct: 21,
      autoRepayLtvPct: 24,
      emergencyLtvPct: 28,
      marketRealizedVolPct: 98,
      marketDailyMovePct: 9.5,
      marketWeeklyDrawdownPct: 42,
      marketTrendStrengthPct: 82,
      venueExposurePct: 72,
      wrapperExposurePct: 70,
      venueHealthy: true,
      oracleConfidencePct: 92,
      liquidityScorePct: 78,
      venueHealthScorePct: 80,
    }),
  },
  revoke: {
    mode: "revoke",
    queryValue: "revoke",
    title: "Revoked rail defence",
    label: "Rail guard",
    autoRun: true,
    copy: "Shows the operator-side defence posture for a rail that should not be trusted. The on-chain negative guard remains in the CLI proof pack.",
    defenseLine: "Shows rail-risk copy in the UI; the revoke-then-mint fail-close proof is in the CLI proof pack.",
    fixture: fixtureMeta(JUDGE_FIXTURES.revoke),
    fields: fixtureFields(JUDGE_FIXTURES.revoke, {
      scenarioName: "Overflow Judge Revoked Rail",
      strategyPreset: "starter",
      createScope: "shadow",
      monthlyPayoutTargetUsd: 900,
      desiredRunwayMonths: 5,
      maxLtvPct: 32,
      targetLtvLowPct: 17,
      targetLtvHighPct: 22,
      autoRepayLtvPct: 25,
      emergencyLtvPct: 29,
      venueName: "Revoked Rail Rehearsal",
      venueHealthy: false,
      venueExposurePct: 92,
      wrapperExposurePct: 81,
      oracleConfidencePct: 88,
      liquidityScorePct: 58,
      venueHealthScorePct: 24,
      minOracleConfidencePct: 90,
      minLiquidityScorePct: 78,
    }),
  },
  "oracle-stale": {
    mode: "oracle-stale",
    queryValue: "oracle-stale",
    title: "Oracle confidence rehearsal",
    label: "Oracle guard",
    autoRun: true,
    copy: "Loads a low-confidence oracle posture so the readout can show why signed, fresh market sources matter before any action receipt is trusted.",
    defenseLine: "Shows low-confidence oracle posture in the UI; the live Pyth read path is used when a feed object is configured.",
    fixture: fixtureMeta(JUDGE_FIXTURES["oracle-stale"]),
    fields: fixtureFields(JUDGE_FIXTURES["oracle-stale"], {
      scenarioName: "Overflow Judge Oracle Stale",
      strategyPreset: "starter",
      createScope: "shadow",
      monthlyPayoutTargetUsd: 1100,
      desiredRunwayMonths: 4,
      maxLtvPct: 34,
      targetLtvLowPct: 18,
      targetLtvHighPct: 23,
      autoRepayLtvPct: 26,
      emergencyLtvPct: 30,
      marketRealizedVolPct: 96,
      marketDailyMovePct: 6.4,
      marketWeeklyDrawdownPct: 18,
      marketTrendStrengthPct: 66,
      venueHealthy: true,
      oracleConfidencePct: 52,
      liquidityScorePct: 81,
      venueHealthScorePct: 78,
      minOracleConfidencePct: 90,
      minLiquidityScorePct: 78,
    }),
  },
};

export function resolveJudgeDemoMode(search = "") {
  const params = search instanceof URLSearchParams
    ? search
    : new URLSearchParams(String(search || "").replace(/^\?/, ""));
  const raw = params.get("judge");
  if (!raw) return null;
  return JUDGE_MODE_ALIASES.get(String(raw).trim().toLowerCase()) || null;
}

export function getJudgeScenario(mode) {
  return JUDGE_SCENARIOS[mode] || null;
}

export function buildJudgeDraft(baseDraft, mode) {
  const scenario = getJudgeScenario(mode);
  if (!scenario) return baseDraft ? { ...baseDraft } : {};
  return {
    ...(baseDraft || {}),
    ...scenario.fields,
  };
}

export function buildJudgeRunContext(mode) {
  const scenario = getJudgeScenario(mode);
  if (!scenario) return null;
  return {
    mode: scenario.mode,
    queryValue: scenario.queryValue,
    title: scenario.title,
    label: scenario.label,
    defenseLine: scenario.defenseLine,
    fixture: scenario.fixture,
  };
}

export function applyJudgeMarketBandOverrides(marketBand, mode) {
  const context = buildJudgeRunContext(mode);
  if (!context?.fixture?.oracle?.stale) {
    return marketBand || null;
  }
  return {
    ...(marketBand || {}),
    source: marketBand?.source || context.fixture.oracle.source || "pyth-fixture",
    observedAt: marketBand?.observedAt || context.fixture.oracle.observedAt || "",
    horizonAt: marketBand?.horizonAt || context.fixture.oracle.observedAt || "",
    stale: true,
    warnings: [
      ...(Array.isArray(marketBand?.warnings) ? marketBand.warnings : []),
      context.fixture.expectedAbortCode || "Forecast is stale",
    ].filter(Boolean),
  };
}

export function buildJudgeResultsPath(mode) {
  const scenario = getJudgeScenario(mode);
  if (!scenario) return "/results";
  return `/results?judge=${encodeURIComponent(scenario.queryValue)}`;
}
