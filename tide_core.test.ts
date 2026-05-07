import { describe, it, expect } from "vitest";
import {
  TideEngine,
  RiskEngine,
  RegimeEngine,
  Planner,
  ShadowModeSimulator,
  applyActionRebalanceCost,
  calculateBufferFloor,
  calculateBufferCoverageMonths,
  UserMode,
  RiskPriority,
  MarketRegime,
  ActionType,
  type UserPolicy,
  type PortfolioState,
  type MarketState,
  type VenueStatus,
  type EngineInput,
  type RailSnapshot,
} from "./tide_core.js";

function makePolicy(overrides: Partial<UserPolicy> = {}): UserPolicy {
  return {
    mode: UserMode.Income,
    priority: RiskPriority.Stability,
    maxLtv: 0.50,
    targetLtvLow: 0.10,
    targetLtvHigh: 0.25,
    minStableBufferUsd: 500,
    desiredRunwayMonths: 6,
    monthlyPayoutTargetUsd: 200,
    allowPayoutPauseInStress: true,
    maxSingleVenueExposurePct: 0.80,
    maxWrapperExposurePct: 0.80,
    autoRepayLtv: 0.35,
    emergencyLtv: 0.45,
    minOracleConfidence: 0.85,
    minLiquidityScore: 0.60,
    allowNewBorrowInStress: false,
    allowNewBorrowInCrisis: false,
    ...overrides,
  };
}

function makePortfolio(overrides: Partial<PortfolioState> = {}): PortfolioState {
  return {
    btcUnits: 1.0,
    btcPriceUsd: 60000,
    collateralUsd: 60000,
    debtUsd: 6000,
    stableBufferUsd: 2000,
    venueExposurePct: 0.50,
    wrapperExposurePct: 0.50,
    ...overrides,
  };
}

function makeMarket(overrides: Partial<MarketState> = {}): MarketState {
  return {
    realizedVol30d: 0.45,
    dailyMovePctAbs: 0.02,
    weeklyDrawdownPct: 0.03,
    trendStrength: 0.30,
    ...overrides,
  };
}

function makeVenue(overrides: Partial<VenueStatus> = {}): VenueStatus {
  return {
    name: "test-venue",
    healthy: true,
    oracleConfidence: 0.95,
    liquidityScore: 0.85,
    healthScore: 0.90,
    ...overrides,
  };
}

function makeRail(overrides: Partial<RailSnapshot> = {}): RailSnapshot {
  return {
    id: "test-rail",
    name: "Test Rail",
    source: "adapter",
    wrapper: "wBTC",
    stableAsset: "USDC",
    healthy: true,
    oracleConfidence: 0.95,
    liquidityScore: 0.85,
    healthScore: 0.90,
    borrowApr: 0.08,
    depositApr: 0.01,
    maxLtv: 0.60,
    availableDebtUsd: 1_000_000,
    rebalanceCostBps: 20,
    supportsRefinance: true,
    tags: ["test"],
    notes: [],
    updatedAt: new Date("2026-04-23T08:00:00.000Z").toISOString(),
    ...overrides,
  };
}

function makeInput(overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    now: new Date().toISOString(),
    policy: makePolicy(),
    portfolio: makePortfolio(),
    market: makeMarket(),
    venues: [makeVenue()],
    ...overrides,
  };
}

// --- safeDiv / LTV guards ---

describe("RiskEngine", () => {
  const engine = new RiskEngine();

  it("calculates LTV correctly in normal conditions", () => {
    const input = makeInput({
      portfolio: makePortfolio({ collateralUsd: 100000, debtUsd: 25000 }),
    });
    const snap = engine.evaluate(input, MarketRegime.Quiet);
    expect(snap.ltv).toBeCloseTo(0.25, 4);
  });

  it("handles zero collateral gracefully (LTV = 0, no debt)", () => {
    const input = makeInput({
      portfolio: makePortfolio({ collateralUsd: 0, debtUsd: 0 }),
    });
    const snap = engine.evaluate(input, MarketRegime.Quiet);
    expect(snap.ltv).toBe(0);
  });

  it("treats zero collateral with debt as critical LTV", () => {
    const input = makeInput({
      portfolio: makePortfolio({ collateralUsd: 0, debtUsd: 5000 }),
    });
    const snap = engine.evaluate(input, MarketRegime.Quiet);
    expect(snap.ltv).toBe(1);
    expect(snap.needsRepay).toBe(true);
    expect(snap.needsEmergencyDeRisk).toBe(true);
    expect(snap.liquidationDistancePct).toBe(0);
  });

  it("flags needsRepay when LTV >= autoRepayLtv", () => {
    const policy = makePolicy({ autoRepayLtv: 0.35 });
    const input = makeInput({
      policy,
      portfolio: makePortfolio({ collateralUsd: 100000, debtUsd: 36000 }),
    });
    const snap = engine.evaluate(input, MarketRegime.Quiet);
    expect(snap.needsRepay).toBe(true);
  });

  it("flags needsEmergencyDeRisk when LTV >= emergencyLtv", () => {
    const policy = makePolicy({ emergencyLtv: 0.45 });
    const input = makeInput({
      policy,
      portfolio: makePortfolio({ collateralUsd: 100000, debtUsd: 46000 }),
    });
    const snap = engine.evaluate(input, MarketRegime.Quiet);
    expect(snap.needsEmergencyDeRisk).toBe(true);
  });

  it("flags needsEmergencyDeRisk in Crisis regime regardless of LTV", () => {
    const input = makeInput({
      portfolio: makePortfolio({ collateralUsd: 100000, debtUsd: 5000 }),
    });
    const snap = engine.evaluate(input, MarketRegime.Crisis);
    expect(snap.needsEmergencyDeRisk).toBe(true);
  });

  it("calculates buffer shortfall", () => {
    const policy = makePolicy({
      minStableBufferUsd: 500,
      monthlyPayoutTargetUsd: 200,
      desiredRunwayMonths: 6,
    });
    // bufferFloor = max(500, 200*6) = 1200
    const input = makeInput({
      policy,
      portfolio: makePortfolio({ stableBufferUsd: 800 }),
    });
    const snap = engine.evaluate(input, MarketRegime.Quiet);
    expect(snap.bufferShortfallUsd).toBeCloseTo(400, 1);
  });

  it("exposes safe borrowing headroom for buffer rebuild decisions", () => {
    const policy = makePolicy({
      targetLtvHigh: 0.25,
      minStableBufferUsd: 10_000,
      monthlyPayoutTargetUsd: 10_000,
      desiredRunwayMonths: 1,
    });
    const input = makeInput({
      policy,
      portfolio: makePortfolio({
        collateralUsd: 100_000,
        debtUsd: 24_600,
        stableBufferUsd: 0,
      }),
    });

    const snap = engine.evaluate(input, MarketRegime.Quiet);

    expect(snap.bufferShortfallUsd).toBe(10_000);
    expect(snap.safeHeadroomUsd).toBe(320);
  });
});

describe("Planner buffer rebuild", () => {
  const riskEngine = new RiskEngine();
  const planner = new Planner();

  it("caps BorrowForBuffer by modeled safe headroom", () => {
    const input = makeInput({
      policy: makePolicy({
        targetLtvHigh: 0.25,
        minStableBufferUsd: 10_000,
        monthlyPayoutTargetUsd: 10_000,
        desiredRunwayMonths: 1,
      }),
      portfolio: makePortfolio({
        collateralUsd: 100_000,
        debtUsd: 24_600,
        stableBufferUsd: 0,
      }),
    });
    const risk = riskEngine.evaluate(input, MarketRegime.Quiet);
    const decision = planner.plan(input, MarketRegime.Quiet, risk);

    expect(decision.chosen.type).toBe(ActionType.BorrowForBuffer);
    expect(decision.chosen.amountUsd).toBe(320);
    expect(decision.chosen.metadata?.shortfallUsd).toBe(10_000);
    expect(decision.chosen.metadata?.safeHeadroomUsd).toBe(320);
    expect(decision.chosen.metadata?.unmetShortfallUsd).toBe(9_680);
  });

  it("falls back to BuildBuffer when no safe borrowing headroom remains", () => {
    const input = makeInput({
      policy: makePolicy({
        targetLtvHigh: 0.25,
        minStableBufferUsd: 10_000,
        monthlyPayoutTargetUsd: 10_000,
        desiredRunwayMonths: 1,
      }),
      portfolio: makePortfolio({
        collateralUsd: 100_000,
        debtUsd: 25_000,
        stableBufferUsd: 0,
      }),
    });
    const risk = riskEngine.evaluate(input, MarketRegime.Quiet);
    const decision = planner.plan(input, MarketRegime.Quiet, risk);

    expect(risk.safeHeadroomUsd).toBe(0);
    expect(decision.chosen.type).toBe(ActionType.BuildBuffer);
    expect(decision.chosen.amountUsd).toBe(10_000);
  });
});

// --- RegimeEngine ---

describe("RegimeEngine", () => {
  const engine = new RegimeEngine();

  it("classifies Quiet market", () => {
    const regime = engine.classify(makeMarket(), [makeVenue()], makePolicy());
    expect(regime).toBe(MarketRegime.Quiet);
  });

  it("classifies Crisis when no venues", () => {
    const regime = engine.classify(makeMarket(), [], makePolicy());
    expect(regime).toBe(MarketRegime.Crisis);
  });

  it("classifies Crisis on large weekly drawdown", () => {
    const regime = engine.classify(
      makeMarket({ weeklyDrawdownPct: 0.25 }),
      [makeVenue()],
      makePolicy()
    );
    expect(regime).toBe(MarketRegime.Crisis);
  });

  it("classifies Stress on moderate drawdown", () => {
    const regime = engine.classify(
      makeMarket({ weeklyDrawdownPct: 0.15 }),
      [makeVenue()],
      makePolicy()
    );
    expect(regime).toBe(MarketRegime.Stress);
  });

  it("classifies Trend on high trend strength", () => {
    const regime = engine.classify(
      makeMarket({ trendStrength: 0.70 }),
      [makeVenue()],
      makePolicy()
    );
    expect(regime).toBe(MarketRegime.Trend);
  });

  it("classifies Crisis when venue is down", () => {
    const regime = engine.classify(
      makeMarket(),
      [makeVenue({ healthy: false })],
      makePolicy()
    );
    expect(regime).toBe(MarketRegime.Crisis);
  });
});

// --- Planner ---

describe("Planner", () => {
  const planner = new Planner();
  const riskEngine = new RiskEngine();

  it("produces EmergencyDeRisk action on emergency", () => {
    const input = makeInput({
      portfolio: makePortfolio({ collateralUsd: 100000, debtUsd: 46000 }),
      policy: makePolicy({ emergencyLtv: 0.45 }),
    });
    const risk = riskEngine.evaluate(input, MarketRegime.Quiet);
    const decision = planner.plan(input, MarketRegime.Quiet, risk);
    expect(decision.chosen.type).toBe(ActionType.EmergencyDeRisk);
    expect(decision.chosen.amountUsd).toBeGreaterThan(0);
  });

  it("emergency repay amount is at least 0.01 (no zero-amount loops)", () => {
    const policy = makePolicy({
      targetLtvLow: 0.10,
      emergencyLtv: 0.45,
    });
    const input = makeInput({
      policy,
      portfolio: makePortfolio({ collateralUsd: 100000, debtUsd: 10000 }),
    });
    // Force emergency via Crisis regime
    const risk = riskEngine.evaluate(input, MarketRegime.Crisis);
    const decision = planner.plan(input, MarketRegime.Crisis, risk);
    if (decision.chosen.type === ActionType.EmergencyDeRisk) {
      expect(decision.chosen.amountUsd).toBeGreaterThanOrEqual(0.01);
    }
  });

  it("produces Hold in calm conditions with healthy buffer", () => {
    const input = makeInput({
      portfolio: makePortfolio({
        collateralUsd: 100000,
        debtUsd: 10000,
        stableBufferUsd: 5000,
      }),
    });
    const risk = riskEngine.evaluate(input, MarketRegime.Quiet);
    const decision = planner.plan(input, MarketRegime.Quiet, risk);
    expect([ActionType.Hold, ActionType.BuildBuffer, ActionType.BorrowForBuffer]).toContain(
      decision.chosen.type
    );
  });
});

// --- TideEngine integration ---

describe("TideEngine", () => {
  const engine = new TideEngine();

  it("runs a full tick without throwing", async () => {
    const input = makeInput();
    const result = await engine.tick(input);
    expect(result.decision).toBeDefined();
    expect(result.decision.regime).toBeDefined();
    expect(result.decision.risk).toBeDefined();
    expect(result.decision.chosen).toBeDefined();
  });

  it("runShadow processes multiple inputs", async () => {
    const inputs = [makeInput(), makeInput(), makeInput()];
    const results = await engine.runShadow(inputs);
    expect(results).toHaveLength(3);
  });
});

// --- Shadow economics ---

describe("shadow economics rebalance drag", () => {
  it("accumulates rebalance drag across sequential action costs", () => {
    const input = makeInput({
      portfolio: makePortfolio({ debtUsd: 1000, stableBufferUsd: 100 }),
    });
    const existingEconomics = {
      horizonDays: 30,
      borrowApr: 0.10,
      carryCostUsd: 3,
      rebalanceCostUsd: 2,
      liquidationPenaltyUsd: 4,
      liquidationTriggered: false,
      totalDragUsd: 9,
    };

    const result = applyActionRebalanceCost(
      input,
      {
        type: ActionType.PartialRepay,
        amountUsd: 1000,
        reason: "test",
        explanation: "test",
      },
      makeRail({ rebalanceCostBps: 20 }),
      existingEconomics
    );

    expect(result.economics.rebalanceCostUsd).toBe(4);
    expect(result.economics.totalDragUsd).toBe(11);
    expect(result.input.portfolio.stableBufferUsd).toBe(98);
    expect(result.input.portfolio.debtUsd).toBe(1000);
  });

  it("does not erase accumulated rebalance drag when the next action has no cost", () => {
    const input = makeInput();
    const existingEconomics = {
      horizonDays: 30,
      borrowApr: 0.10,
      carryCostUsd: 3,
      rebalanceCostUsd: 7,
      liquidationPenaltyUsd: 4,
      liquidationTriggered: false,
      totalDragUsd: 14,
    };

    const result = applyActionRebalanceCost(
      input,
      {
        type: ActionType.Hold,
        reason: "test",
        explanation: "test",
      },
      makeRail({ rebalanceCostBps: 20 }),
      existingEconomics
    );

    expect(result.economics.rebalanceCostUsd).toBe(7);
    expect(result.economics.totalDragUsd).toBe(14);
    expect(result.input).toBe(input);
  });

  it("reports cumulative rebalance drag when a cost creates a second action", async () => {
    const rail = makeRail({
      borrowApr: 0,
      rebalanceCostBps: 100,
    });
    const simulator = new ShadowModeSimulator([
      {
        id: "test-adapter",
        label: "Test Adapter",
        async fetchSnapshot() {
          return rail;
        },
      },
    ]);

    const report = await simulator.simulate(
      makeInput({
        policy: makePolicy({
          minStableBufferUsd: 500,
          desiredRunwayMonths: 1,
          monthlyPayoutTargetUsd: 100,
          maxSingleVenueExposurePct: 0.70,
        }),
        portfolio: makePortfolio({
          btcUnits: 1,
          btcPriceUsd: 100000,
          collateralUsd: 100000,
          debtUsd: 1000,
          stableBufferUsd: 505,
          venueExposurePct: 0.75,
        }),
      }),
      [{ id: "current", label: "Current setup", drawdownPct: 0, horizonDays: 1 }]
    );

    expect(report.baseline.result.decision.chosen.type).toBe(ActionType.BorrowForBuffer);
    expect(report.baseline.economics.rebalanceCostUsd).toBe(10.05);
    expect(report.summary.baselineRebalanceCostUsd).toBe(10.05);
  });
});

// --- Utility functions ---

describe("calculateBufferFloor", () => {
  it("returns minimum when payout*runway is smaller", () => {
    const policy = makePolicy({
      minStableBufferUsd: 2000,
      monthlyPayoutTargetUsd: 100,
      desiredRunwayMonths: 3,
    });
    expect(calculateBufferFloor(policy)).toBe(2000);
  });

  it("returns payout*runway when larger", () => {
    const policy = makePolicy({
      minStableBufferUsd: 500,
      monthlyPayoutTargetUsd: 200,
      desiredRunwayMonths: 6,
    });
    expect(calculateBufferFloor(policy)).toBe(1200);
  });
});

describe("calculateBufferCoverageMonths", () => {
  it("divides buffer by monthly payout", () => {
    expect(calculateBufferCoverageMonths(6000, 1000)).toBeCloseTo(6, 1);
  });

  it("handles zero payout (floor of 1)", () => {
    expect(calculateBufferCoverageMonths(6000, 0)).toBeCloseTo(6000, 0);
  });
});
