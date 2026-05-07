// tide-engine.ts
// TIDE v1 policy-based treasury engine
// Focus: Income + Storm Guard
// No external deps

// ─── Policy fitting thresholds ───────────────────────────────────────
// Used by fitPolicyToRail() to compress user-defined LTV bands so they
// fit within a specific rail's hard limits while keeping safe corridors.
const FIT_TARGET_HIGH_RATIO = 0.78;       // targetLtvHigh ≤ maxLtv × this
const FIT_TARGET_HIGH_FLOOR = 0.04;       // absolute floor for targetLtvHigh
const FIT_TARGET_HIGH_MIN_GAP = 0.05;     // minimum ceiling if maxLtv is tiny
const FIT_TARGET_HIGH_CEILING_GAP = 0.02; // maxLtv − gap = ceiling

const FIT_TARGET_LOW_RATIO = 0.76;        // targetLtvLow ≤ targetLtvHigh × this
const FIT_TARGET_LOW_FLOOR = 0.02;        // absolute floor for targetLtvLow
const FIT_TARGET_LOW_MIN_GAP = 0.03;      // minimum ceiling if targetLtvHigh is tiny
const FIT_TARGET_LOW_CEILING_GAP = 0.02;  // targetLtvHigh − gap = ceiling

const FIT_AUTOREPAY_CEILING_GAP = 0.01;   // maxLtv − gap = autoRepay ceiling
const FIT_EMERGENCY_MIN_GAP = 0.005;      // emergency ≥ autoRepay + this

// ─── Regime classification thresholds ────────────────────────────────
// RegimeEngine uses these to bucket market conditions. Thresholds are
// calibrated against historical BTC volatility / drawdown distributions.
const CRISIS_WEEKLY_DRAWDOWN = 0.22;      // ≥ 22% weekly → crisis
const CRISIS_DAILY_MOVE = 0.12;           // ≥ 12% daily abs → crisis
const CRISIS_CONFIDENCE_HAIRCUT = 0.75;   // oracle/liquidity × 0.75 → crisis

const STRESS_WEEKLY_DRAWDOWN = 0.12;      // ≥ 12% weekly → stress
const STRESS_DAILY_MOVE = 0.07;           // ≥ 7% daily abs → stress
const STRESS_VOL_30D = 1.10;              // ≥ 110% annualized vol → stress

const TREND_STRENGTH = 0.65;              // ≥ 0.65 trend score → trend regime
const TREND_DAILY_MOVE = 0.035;           // ≥ 3.5% daily abs → trend
const TREND_VOL_30D = 0.75;              // ≥ 75% annualized vol → trend

// ─── Risk engine constants ───────────────────────────────────────────
const MIN_VENUE_HEALTH_SCORE = 0.5;       // venue must score ≥ this to be healthy

// ─── Regime borrow haircuts ──────────────────────────────────────────
// Fraction of safe headroom available for new borrows per regime.
const BORROW_HAIRCUT_QUIET = 0.80;
const BORROW_HAIRCUT_TREND = 0.55;
const BORROW_HAIRCUT_STRESS = 0.20;       // only if policy.allowNewBorrowInStress
const BORROW_HAIRCUT_CRISIS = 0.05;       // only if policy.allowNewBorrowInCrisis
const SHADOW_BASE_HORIZON_DAYS = 30;
const SHADOW_MAX_HORIZON_DAYS = 90;
const SHADOW_LIQUIDATION_PENALTY_BPS_BASE = 500;
const SHADOW_LIQUIDATION_PENALTY_BPS_DRAW = 500;

// Platform management fee for the staged revenue ladder. Surfaced in the
// Readout so the simulator shows TIDE's own take honestly next to rail cost
// and debt carry. Keep exported so UI copy can reference the same number the
// simulator used.
export const TIDE_PLATFORM_FEE_BPS_ANNUAL = 75;

type ISODateString = string;

export enum UserMode {
  Income = "Income",
  StormGuard = "StormGuard",
  Reserve = "Reserve",
  Drift = "Drift",
}

export enum RiskPriority {
  Safety = "Safety",
  Stability = "Stability",
  Income = "Income",
  BTCPreservation = "BTCPreservation",
}

export enum MarketRegime {
  Quiet = "Quiet",
  Trend = "Trend",
  Stress = "Stress",
  Crisis = "Crisis",
}

export enum ActionType {
  Hold = "Hold",
  BuildBuffer = "BuildBuffer",
  BorrowForBuffer = "BorrowForBuffer",
  PartialRepay = "PartialRepay",
  EmergencyDeRisk = "EmergencyDeRisk",
  ReducePayout = "ReducePayout",
  PausePayout = "PausePayout",
  RotateVenue = "RotateVenue",
}

export enum OperatingState {
  Observe = "Observe",
  BuildBuffer = "BuildBuffer",
  Maintain = "Maintain",
  DeRisk = "DeRisk",
  StressLockdown = "StressLockdown",
}

export interface UserPolicy {
  mode: UserMode;
  priority: RiskPriority;
  preferredRailId?: string;

  // LTV values are decimals, e.g. 0.25 = 25%
  maxLtv: number;
  targetLtvLow: number;
  targetLtvHigh: number;

  // buffer / runway
  minStableBufferUsd: number;
  desiredRunwayMonths: number;

  // payout
  monthlyPayoutTargetUsd: number;
  allowPayoutPauseInStress: boolean;

  // venue / asset constraints
  maxSingleVenueExposurePct: number; // 0..1
  maxWrapperExposurePct: number; // 0..1

  // trigger thresholds
  autoRepayLtv: number;
  emergencyLtv: number;
  minOracleConfidence: number; // 0..1
  minLiquidityScore: number; // 0..1

  // hard controls
  allowNewBorrowInStress: boolean;
  allowNewBorrowInCrisis: boolean;
}

export interface PortfolioState {
  btcUnits: number;
  btcPriceUsd: number;

  collateralUsd: number;
  debtUsd: number;
  stableBufferUsd: number;

  venueExposurePct: number;   // max exposure to primary venue
  wrapperExposurePct: number; // max exposure to a single BTC wrapper

  lastActionAt?: ISODateString;
  autopilotPaused?: boolean;
}

export interface MarketState {
  realizedVol30d: number;     // annualized proxy, 0..n
  dailyMovePctAbs: number;    // 0.05 = 5%
  weeklyDrawdownPct: number;  // 0.15 = 15%
  trendStrength: number;      // 0..1
}

export interface VenueStatus {
  name: string;
  healthy: boolean;
  oracleConfidence: number; // 0..1
  liquidityScore: number;   // 0..1
  healthScore: number;      // 0..1
}

export interface EngineInput {
  now: ISODateString;
  policy: UserPolicy;
  portfolio: PortfolioState;
  market: MarketState;
  venues: VenueStatus[];
  policyAdjustments?: PolicyAdjustment[];
}

export interface RiskSnapshot {
  ltv: number;
  liquidationDistancePct: number;
  oracleHealthy: boolean;
  liquidityHealthy: boolean;
  venueHealthy: boolean;
  bufferShortfallUsd: number;
  safeHeadroomUsd: number;
  sustainableMonthlyPayoutUsd: number;
  venueConcentrationBreach: boolean;
  wrapperConcentrationBreach: boolean;
  needsRepay: boolean;
  needsEmergencyDeRisk: boolean;
}

export interface PlannedAction {
  type: ActionType;
  amountUsd?: number;
  reason: string;
  explanation: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface EngineDecision {
  regime: MarketRegime;
  risk: RiskSnapshot;
  actions: PlannedAction[];
  chosen: PlannedAction;
}

export interface ExecutionReceipt {
  ok: boolean;
  action: PlannedAction;
  txId?: string;
  error?: string;
}

export interface EngineResult {
  input: EngineInput;
  decision: EngineDecision;
  receipt?: ExecutionReceipt;
}

export interface PolicyHealthSnapshot {
  score: number;
  label: string;
  notes: string[];
}

export interface ShadowScenarioDefinition {
  id: string;
  label: string;
  drawdownPct: number;
  horizonDays?: number;
  // Extra shock knobs. Defaults leave existing drawdown-only
  // scenarios unchanged. Scenarios that set these let the sim
  // model oracle staleness or stablecoin depeg without adding a
  // new BTC-price drawdown.
  oracleConfidenceHaircut?: number; // fraction; 0.30 drops oracleConfidence by 30 pct points
  stableDepegPct?: number;          // fraction; 0.05 removes 5% of stableBufferUsd
}

export interface ShadowScenarioEconomics {
  horizonDays: number;
  borrowApr: number;
  carryCostUsd: number;
  rebalanceCostUsd: number;
  liquidationPenaltyUsd: number;
  liquidationTriggered: boolean;
  totalDragUsd: number;
}

export interface ShadowScenarioOutcome {
  scenario: ShadowScenarioDefinition;
  operatingState: OperatingState;
  health: PolicyHealthSnapshot;
  payoutBandLowUsd: number;
  payoutBandHighUsd: number;
  bufferCoverageMonths: number;
  bufferCoverageDays: number;
  economics: ShadowScenarioEconomics;
  result: EngineResult;
  allocation?: RailAllocationDecision;
}

export interface RailSnapshot extends VenueStatus {
  id: string;
  source: "fixture" | "adapter";
  wrapper: string;
  stableAsset: string;
  borrowApr: number;
  depositApr: number;
  maxLtv: number;
  availableDebtUsd: number;
  rebalanceCostBps: number;
  supportsRefinance: boolean;
  tags: string[];
  notes: string[];
  updatedAt: ISODateString;
  observedAt?: ISODateString;
  // Optional kinked-IR parameters. When present, the stress path
  // computes the effective borrow APR from current utilization using
  // the standard Aave/AlphaLend piecewise-linear model (base +
  // u*slope1 up to the kink, then steeper slope2 beyond). When
  // absent, the simulator falls back to the flat borrowApr above.
  utilizationRate?: number;      // 0..1
  irBaseApr?: number;            // APR at u = 0
  irSlope1?: number;             // APR per 1.0 of utilization pre-kink
  irSlope2?: number;             // APR per 1.0 of utilization past the kink
  irKinkUtilization?: number;    // 0..1
}

export interface RailAdapterContext {
  now: ISODateString;
  policy: UserPolicy;
  portfolio: PortfolioState;
  market: MarketState;
}

export interface RailAdapter {
  id: string;
  label: string;
  fetchSnapshot(context: RailAdapterContext): Promise<RailSnapshot>;
}

export interface HttpRailAdapterOptions {
  id: string;
  label: string;
  url: string;
  init?: Record<string, unknown>;
  fetcher?: (
    url: string,
    init?: Record<string, unknown>
  ) => Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;
  mapSnapshot(payload: unknown, context: RailAdapterContext): RailSnapshot;
}

export interface RailScorecard {
  rail: RailSnapshot;
  score: number;
  recommendedRole: "Primary" | "Backup" | "Avoid";
  reasons: string[];
}

export interface RailAllocationDecision {
  primary?: RailScorecard;
  backup?: RailScorecard;
  ranked: RailScorecard[];
  warnings: string[];
}

export type BtcfiProtocolCategory =
  | "TradeLP"
  | "Derivatives"
  | "Lending"
  | "Vaults"
  | "Routing"
  | "LiquidityLayer";

export type BtcfiProtocolCapability =
  | "Aggregation"
  | "AMM"
  | "AutoCompound"
  | "Borrow"
  | "BridgeIngress"
  | "Collateral"
  | "DCA"
  | "DeepLiquidity"
  | "LP"
  | "Leverage"
  | "Lending"
  | "LimitOrders"
  | "Options"
  | "Perps"
  | "StrategyVaults"
  | "Swaps"
  | "TWAP"
  | "UnifiedLiquidity"
  | "Yield";

export type TreasuryRailRole = "CoreRail" | "SupportingRail" | "SupportOnly";

export interface BtcfiProtocolDefinition {
  id: string;
  name: string;
  category: BtcfiProtocolCategory;
  description: string;
  referenceUrl: string;
  sourceUrl: string;
  supportedBtcAssets: string[];
  capabilities: BtcfiProtocolCapability[];
  treasuryRailRole: TreasuryRailRole;
  adapterStatus: "fixture" | "http_ready" | "planned";
}

export type RailDataMode = "fixture" | "live" | "mixed";

export interface ShadowSimulationSummary {
  survivablePayoutBandLowUsd: number;
  survivablePayoutBandHighUsd: number;
  currentLtv: number;
  bufferCoverageDays: number;
  baselineHorizonDays: number;
  baselineCarryCostUsd: number;
  baselineRebalanceCostUsd: number;
  breakwaterTriggerDrawdownPct: number | null;
  averageHealthScore: number;
  worstOperatingState: OperatingState;
  worstCaseTotalDragUsd: number;
  worstCaseLiquidationPenaltyUsd: number;
  liquidationScenarioLabel?: string;
  projectedTideFeeBpsAnnual: number;
  projectedTideFeeUsd30d: number;
  projectedTideFeePctOfPayout: number;
  actionExamples: PlannedAction[];
  primaryRailId?: string;
  primaryRailName?: string;
  backupRailId?: string;
  backupRailName?: string;
  railWarnings: string[];
  railDataMode: RailDataMode;
  railCount: number;
  liveRailCount: number;
  oldestRailUpdateAt?: ISODateString;
  freshestRailUpdateAt?: ISODateString;
}

export interface ShadowSimulationReport {
  generatedAt: ISODateString;
  baseline: ShadowScenarioOutcome;
  scenarios: ShadowScenarioOutcome[];
  summary: ShadowSimulationSummary;
}

export interface ExecutionAdapter {
  execute(action: PlannedAction, input: EngineInput): Promise<ExecutionReceipt>;
}

export class NoopExecutionAdapter implements ExecutionAdapter {
  async execute(action: PlannedAction, _input: EngineInput): Promise<ExecutionReceipt> {
    return {
      ok: true,
      action,
      txId: `shadow-${Date.now()}`,
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function safeDiv(a: number, b: number): number {
  if (b === 0) return 0;
  const result = a / b;
  if (!Number.isFinite(result)) return 0;
  return result;
}

function calculatePortfolioLtv(debtUsd: number, collateralUsd: number): number {
  if (!Number.isFinite(debtUsd) || debtUsd <= 0) return 0;
  if (!Number.isFinite(collateralUsd) || collateralUsd <= 0) return 1;
  const result = debtUsd / collateralUsd;
  if (!Number.isFinite(result)) return 1;
  return Math.max(0, result);
}

function roundUsd(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundPct(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function minValue(values: number[], fallback = 0): number {
  return values.length === 0 ? fallback : Math.min(...values);
}

function defaultVenue(): VenueStatus {
  return {
    name: "FallbackRail",
    healthy: false,
    oracleConfidence: 0,
    liquidityScore: 0,
    healthScore: 0,
  };
}

export function calculateBufferFloor(policy: UserPolicy): number {
  return Math.max(
    policy.minStableBufferUsd,
    policy.monthlyPayoutTargetUsd * policy.desiredRunwayMonths
  );
}

export function calculateBufferCoverageMonths(
  stableBufferUsd: number,
  monthlyPayoutTargetUsd: number
): number {
  return roundUsd(safeDiv(stableBufferUsd, Math.max(1, monthlyPayoutTargetUsd)));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function roundBps(n: number): number {
  return Math.round(n);
}

function roundUnits(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

function toVenueStatus(rail: RailSnapshot): VenueStatus {
  return {
    name: rail.name,
    healthy: rail.healthy,
    oracleConfidence: rail.oracleConfidence,
    liquidityScore: rail.liquidityScore,
    healthScore: rail.healthScore,
  };
}

function normalizeRailThreshold(
  value: number,
  floor: number,
  ceiling: number
): number {
  return roundPct(clamp(value, floor, ceiling));
}

interface PolicyAdjustment {
  field: string;
  original: number;
  adjusted: number;
  reason: string;
}

interface FittedPolicyResult {
  policy: UserPolicy;
  adjustments: PolicyAdjustment[];
}

function fitPolicyToRail(policy: UserPolicy, rail: RailSnapshot): FittedPolicyResult {
  const adjustments: PolicyAdjustment[] = [];
  const maxLtv = Math.min(policy.maxLtv, rail.maxLtv);
  const targetLtvHigh = normalizeRailThreshold(
    Math.min(policy.targetLtvHigh, maxLtv * FIT_TARGET_HIGH_RATIO),
    FIT_TARGET_HIGH_FLOOR,
    Math.max(FIT_TARGET_HIGH_MIN_GAP, maxLtv - FIT_TARGET_HIGH_CEILING_GAP)
  );
  const targetLtvLow = normalizeRailThreshold(
    Math.min(policy.targetLtvLow, targetLtvHigh * FIT_TARGET_LOW_RATIO),
    FIT_TARGET_LOW_FLOOR,
    Math.max(FIT_TARGET_LOW_MIN_GAP, targetLtvHigh - FIT_TARGET_LOW_CEILING_GAP)
  );
  const autoRepayLtv = normalizeRailThreshold(
    Math.min(Math.max(policy.autoRepayLtv, targetLtvHigh), maxLtv - FIT_AUTOREPAY_CEILING_GAP),
    targetLtvHigh,
    maxLtv - FIT_AUTOREPAY_CEILING_GAP
  );
  const emergencyLtv = normalizeRailThreshold(
    Math.min(Math.max(policy.emergencyLtv, autoRepayLtv + FIT_EMERGENCY_MIN_GAP), maxLtv),
    autoRepayLtv,
    maxLtv
  );

  const fitted = roundPct(maxLtv);
  if (fitted !== policy.maxLtv) adjustments.push({ field: "maxLtv", original: policy.maxLtv, adjusted: fitted, reason: `Rail ${rail.name} caps LTV at ${(rail.maxLtv * 100).toFixed(1)}%` });
  if (targetLtvHigh !== policy.targetLtvHigh) adjustments.push({ field: "targetLtvHigh", original: policy.targetLtvHigh, adjusted: targetLtvHigh, reason: "Compressed to fit within rail max LTV" });
  if (targetLtvLow !== policy.targetLtvLow) adjustments.push({ field: "targetLtvLow", original: policy.targetLtvLow, adjusted: targetLtvLow, reason: "Compressed to maintain corridor below targetLtvHigh" });
  if (autoRepayLtv !== policy.autoRepayLtv) adjustments.push({ field: "autoRepayLtv", original: policy.autoRepayLtv, adjusted: autoRepayLtv, reason: "Adjusted to stay within compressed corridor" });
  if (emergencyLtv !== policy.emergencyLtv) adjustments.push({ field: "emergencyLtv", original: policy.emergencyLtv, adjusted: emergencyLtv, reason: "Adjusted to maintain gap above autoRepayLtv" });

  return {
    policy: {
      ...policy,
      maxLtv: fitted,
      targetLtvLow,
      targetLtvHigh,
      autoRepayLtv,
      emergencyLtv,
    },
    adjustments,
  };
}

function applyRailToInput(
  input: EngineInput,
  allocation?: RailAllocationDecision
): EngineInput {
  const primaryRail = allocation?.primary?.rail;

  if (!primaryRail) {
    return input;
  }

  const { policy: fittedPolicy, adjustments } = fitPolicyToRail(input.policy, primaryRail);

  return {
    ...input,
    policy: fittedPolicy,
    venues: [toVenueStatus(primaryRail)],
    policyAdjustments: adjustments,
  };
}

export class FixtureRailAdapter implements RailAdapter {
  readonly id: string;
  readonly label: string;
  private readonly snapshot: RailSnapshot;

  constructor(snapshot: RailSnapshot) {
    this.id = snapshot.id;
    this.label = snapshot.name;
    this.snapshot = snapshot;
  }

  async fetchSnapshot(context: RailAdapterContext): Promise<RailSnapshot> {
    return {
      ...this.snapshot,
      source: "fixture",
      updatedAt: this.snapshot.updatedAt || new Date(0).toISOString(),
      observedAt: context.now,
    };
  }
}

export class SnapshotRailAdapter implements RailAdapter {
  readonly id: string;
  readonly label: string;
  private readonly snapshot: RailSnapshot;

  constructor(snapshot: RailSnapshot) {
    this.id = snapshot.id;
    this.label = snapshot.name;
    this.snapshot = snapshot;
  }

  async fetchSnapshot(_context: RailAdapterContext): Promise<RailSnapshot> {
    return {
      ...this.snapshot,
    };
  }
}

export class HttpRailAdapter implements RailAdapter {
  readonly id: string;
  readonly label: string;
  private readonly url: string;
  private readonly init?: Record<string, unknown>;
  private readonly mapSnapshot: HttpRailAdapterOptions["mapSnapshot"];
  private readonly fetcher: NonNullable<HttpRailAdapterOptions["fetcher"]>;

  constructor(options: HttpRailAdapterOptions) {
    this.id = options.id;
    this.label = options.label;
    this.url = options.url;
    this.init = options.init;
    this.mapSnapshot = options.mapSnapshot;
    this.fetcher = options.fetcher ?? defaultHttpRailFetcher;
  }

  async fetchSnapshot(context: RailAdapterContext): Promise<RailSnapshot> {
    const response = await this.fetcher(this.url, this.init);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    return this.mapSnapshot(payload, context);
  }
}

async function defaultHttpRailFetcher(
  url: string,
  init?: Record<string, unknown>
): Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}> {
  const fetchRef = globalThis.fetch;

  if (typeof fetchRef !== "function") {
    throw new Error("Global fetch is not available in this runtime.");
  }

  return fetchRef(url, init);
}

export class RailSnapshotAggregator {
  async collect(
    adapters: RailAdapter[],
    context: RailAdapterContext
  ): Promise<{
    snapshots: RailSnapshot[];
    warnings: string[];
  }> {
    const snapshots: RailSnapshot[] = [];
    const warnings: string[] = [];

    for (const adapter of adapters) {
      try {
        snapshots.push(await adapter.fetchSnapshot(context));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown adapter error";
        warnings.push(`${adapter.label} snapshot failed: ${message}`);
      }
    }

    return { snapshots, warnings };
  }
}

export class RailAllocator {
  allocate(
    context: RailAdapterContext,
    rails: RailSnapshot[],
    inheritedWarnings: string[] = []
  ): RailAllocationDecision {
    if (rails.length === 0) {
      return {
        ranked: [],
        warnings: [...inheritedWarnings, "No rail snapshots are available."],
      };
    }

    const weights = {
      [RiskPriority.Safety]: {
        health: 34,
        liquidity: 20,
        oracle: 16,
        leverage: 12,
        apr: 8,
        depth: 8,
        cost: 2,
      },
      [RiskPriority.Stability]: {
        health: 28,
        liquidity: 20,
        oracle: 14,
        leverage: 14,
        apr: 12,
        depth: 8,
        cost: 4,
      },
      [RiskPriority.Income]: {
        health: 20,
        liquidity: 16,
        oracle: 12,
        leverage: 12,
        apr: 24,
        depth: 10,
        cost: 6,
      },
      [RiskPriority.BTCPreservation]: {
        health: 32,
        liquidity: 18,
        oracle: 14,
        leverage: 16,
        apr: 10,
        depth: 8,
        cost: 2,
      },
    }[context.policy.priority];

    const desiredDebtUsd = Math.max(
      context.portfolio.debtUsd,
      context.policy.monthlyPayoutTargetUsd * context.policy.desiredRunwayMonths
    );

    const preferredRailKey = normalizePreferredRailId(context.policy.preferredRailId);
    const ranked = [...rails]
      .map((rail) => {
        const reasons: string[] = [];
        const healthScore = clamp01(rail.healthScore);
        const liquidityScore = clamp01(rail.liquidityScore);
        const oracleScore = clamp01(rail.oracleConfidence);
        const leverageScore = clamp01(safeDiv(rail.maxLtv, Math.max(0.01, context.policy.maxLtv)));
        const aprScore = 1 - clamp01(safeDiv(rail.borrowApr, 0.18));
        const depthScore = clamp01(safeDiv(rail.availableDebtUsd, Math.max(1, desiredDebtUsd)));
        const costScore = 1 - clamp01(safeDiv(rail.rebalanceCostBps, 160));

        let score =
          healthScore * weights.health +
          liquidityScore * weights.liquidity +
          oracleScore * weights.oracle +
          leverageScore * weights.leverage +
          aprScore * weights.apr +
          depthScore * weights.depth +
          costScore * weights.cost;

        if (!rail.healthy) {
          score -= 18;
          reasons.push("Venue health is currently below the operating floor.");
        }

        if (rail.maxLtv < context.policy.targetLtvHigh) {
          score -= 8;
          reasons.push("Rail max LTV compresses the requested operating corridor.");
        } else {
          reasons.push("Rail can support the requested operating corridor.");
        }

        if (rail.borrowApr <= 0.055) {
          reasons.push("Borrow cost is competitive for income extraction.");
        } else if (rail.borrowApr >= 0.075) {
          reasons.push("Borrow cost is elevated, so cashflow margin is tighter.");
        }

        if (rail.availableDebtUsd < desiredDebtUsd) {
          score -= 6;
          reasons.push("Available debt depth is tight for the requested setup.");
        } else {
          reasons.push("Debt depth is sufficient for the requested setup.");
        }

        if (rail.rebalanceCostBps <= 20) {
          reasons.push("Rebalance friction is low enough for backup routing.");
        }

        if (rail.tags.length > 0) {
          reasons.push(`Profile: ${rail.tags.join(", ")}.`);
        }

        return {
          rail,
          score: Math.round(score),
          recommendedRole: "Avoid" as RailScorecard["recommendedRole"],
          reasons,
        };
      })
      .sort((a, b) => b.score - a.score);

    const preferredPrimary = preferredRailKey
      ? ranked.find((scorecard) =>
          railMatchesPreference(scorecard.rail, preferredRailKey) &&
          scorecard.rail.healthy &&
          scorecard.rail.healthScore >= 0.62 &&
          scorecard.rail.oracleConfidence >= context.policy.minOracleConfidence * 0.92
        )
      : null;

    const primary = preferredPrimary ?? ranked.find((scorecard) => {
      return (
        scorecard.rail.healthy &&
        scorecard.rail.healthScore >= 0.62 &&
        scorecard.rail.oracleConfidence >= context.policy.minOracleConfidence * 0.92
      );
    }) ?? ranked[0];

    let backup = ranked.find((scorecard) => {
      return (
        scorecard.rail.id !== primary?.rail.id &&
        scorecard.rail.wrapper !== primary?.rail.wrapper &&
        scorecard.rail.healthy &&
        scorecard.rail.healthScore >= 0.56 &&
        scorecard.rail.liquidityScore >= context.policy.minLiquidityScore
      );
    });

    if (!backup) {
      backup = ranked.find((scorecard) => scorecard.rail.id !== primary?.rail.id);
    }

    const warnings = [...inheritedWarnings];

    if (!primary?.rail.healthy) {
      warnings.push("Primary rail candidate is not fully healthy; fallback logic is likely required.");
    }

    if (primary && primary.rail.maxLtv < context.policy.maxLtv) {
      warnings.push(
        `${primary.rail.name} caps max LTV at ${(primary.rail.maxLtv * 100).toFixed(1)}%, below the requested ${(context.policy.maxLtv * 100).toFixed(1)}%.`
      );
    }

    if (!backup) {
      warnings.push("No backup rail met the safety floor; routing remains single-rail fragile.");
    }

    const annotated = ranked.map((scorecard) => {
      if (primary && scorecard.rail.id === primary.rail.id) {
        return {
          ...scorecard,
          recommendedRole: "Primary" as const,
        };
      }

      if (backup && scorecard.rail.id === backup.rail.id) {
        return {
          ...scorecard,
          recommendedRole: "Backup" as const,
        };
      }

      return scorecard;
    });

    return {
      primary: annotated.find((scorecard) => scorecard.recommendedRole === "Primary"),
      backup: annotated.find((scorecard) => scorecard.recommendedRole === "Backup"),
      ranked: annotated,
      warnings,
    };
  }
}

function normalizePreferredRailId(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/-sui$/, "");
}

function railMatchesPreference(rail: RailSnapshot, preference: string): boolean {
  if (!preference) return false;
  const railIds = [rail.id, rail.name]
    .map((value) => String(value || "").trim().toLowerCase().replace(/-sui$/, ""))
    .filter(Boolean);
  return railIds.includes(preference);
}

function assertPolicy(policy: UserPolicy): void {
  const checks: Array<[boolean, string]> = [
    [policy.maxLtv > 0 && policy.maxLtv < 1, "maxLtv must be between 0 and 1"],
    [policy.targetLtvLow >= 0 && policy.targetLtvLow < policy.targetLtvHigh, "targetLtvLow must be < targetLtvHigh"],
    [policy.targetLtvHigh < policy.maxLtv, "targetLtvHigh must be below maxLtv"],
    [policy.autoRepayLtv >= policy.targetLtvHigh && policy.autoRepayLtv <= policy.maxLtv, "autoRepayLtv must be between targetLtvHigh and maxLtv"],
    [policy.emergencyLtv >= policy.autoRepayLtv && policy.emergencyLtv <= policy.maxLtv, "emergencyLtv must be between autoRepayLtv and maxLtv"],
    [policy.minOracleConfidence >= 0 && policy.minOracleConfidence <= 1, "minOracleConfidence must be 0..1"],
    [policy.minLiquidityScore >= 0 && policy.minLiquidityScore <= 1, "minLiquidityScore must be 0..1"],
    [policy.maxSingleVenueExposurePct > 0 && policy.maxSingleVenueExposurePct <= 1, "maxSingleVenueExposurePct must be 0..1"],
    [policy.maxWrapperExposurePct > 0 && policy.maxWrapperExposurePct <= 1, "maxWrapperExposurePct must be 0..1"],
    [policy.monthlyPayoutTargetUsd >= 0, "monthlyPayoutTargetUsd must be >= 0"],
    [policy.minStableBufferUsd >= 0, "minStableBufferUsd must be >= 0"],
    [policy.desiredRunwayMonths > 0, "desiredRunwayMonths must be > 0"],
  ];

  for (const [ok, message] of checks) {
    if (!ok) throw new Error(`Invalid policy: ${message}`);
  }
}

export class RegimeEngine {
  classify(market: MarketState, venues: VenueStatus[], policy: UserPolicy): MarketRegime {
    if (venues.length === 0) {
      return MarketRegime.Crisis;
    }

    const worstVenueHealth = Math.min(...venues.map(v => v.healthScore));
    const worstOracle = Math.min(...venues.map(v => v.oracleConfidence));
    const worstLiquidity = Math.min(...venues.map(v => v.liquidityScore));
    const anyVenueDown = venues.some(v => !v.healthy);

    if (
      anyVenueDown ||
      worstOracle < policy.minOracleConfidence * CRISIS_CONFIDENCE_HAIRCUT ||
      worstLiquidity < policy.minLiquidityScore * CRISIS_CONFIDENCE_HAIRCUT ||
      market.weeklyDrawdownPct >= CRISIS_WEEKLY_DRAWDOWN ||
      market.dailyMovePctAbs >= CRISIS_DAILY_MOVE
    ) {
      return MarketRegime.Crisis;
    }

    if (
      worstOracle < policy.minOracleConfidence ||
      worstLiquidity < policy.minLiquidityScore ||
      market.weeklyDrawdownPct >= STRESS_WEEKLY_DRAWDOWN ||
      market.dailyMovePctAbs >= STRESS_DAILY_MOVE ||
      market.realizedVol30d >= STRESS_VOL_30D
    ) {
      return MarketRegime.Stress;
    }

    if (
      market.trendStrength >= TREND_STRENGTH ||
      market.dailyMovePctAbs >= TREND_DAILY_MOVE ||
      market.realizedVol30d >= TREND_VOL_30D
    ) {
      return MarketRegime.Trend;
    }

    return MarketRegime.Quiet;
  }
}

export class RiskEngine {
  evaluate(input: EngineInput, regime: MarketRegime): RiskSnapshot {
    const { policy, portfolio, venues } = input;
    const venueSet = venues.length > 0 ? venues : [defaultVenue()];
    const ltv = calculatePortfolioLtv(portfolio.debtUsd, portfolio.collateralUsd);
    if (!Number.isFinite(ltv) || ltv < 0) {
      throw new Error(
        `Invalid LTV state: debt=${portfolio.debtUsd}, collateral=${portfolio.collateralUsd}, ltv=${ltv}`
      );
    }

    const oracleHealthy = venueSet.every(v => v.oracleConfidence >= policy.minOracleConfidence);
    const liquidityHealthy = venueSet.every(v => v.liquidityScore >= policy.minLiquidityScore);
    const venueHealthy = venueSet.every(v => v.healthy && v.healthScore >= MIN_VENUE_HEALTH_SCORE);

    const liquidationDistancePct = clamp(
      safeDiv(policy.maxLtv - ltv, policy.maxLtv),
      0,
      1
    );

    const bufferFloor = calculateBufferFloor(policy);

    const bufferShortfallUsd = Math.max(0, bufferFloor - portfolio.stableBufferUsd);

    const regimeBorrowHaircut = {
      [MarketRegime.Quiet]: BORROW_HAIRCUT_QUIET,
      [MarketRegime.Trend]: BORROW_HAIRCUT_TREND,
      [MarketRegime.Stress]: policy.allowNewBorrowInStress ? BORROW_HAIRCUT_STRESS : 0.00,
      [MarketRegime.Crisis]: policy.allowNewBorrowInCrisis ? BORROW_HAIRCUT_CRISIS : 0.00,
    }[regime];

    const safeHeadroomUsd = Math.max(
      0,
      portfolio.collateralUsd * policy.targetLtvHigh - portfolio.debtUsd
    ) * regimeBorrowHaircut;

    const sustainableMonthlyPayoutUsd = roundUsd(
      Math.min(
        policy.monthlyPayoutTargetUsd,
        Math.max(
          0,
          (portfolio.stableBufferUsd + safeHeadroomUsd) / Math.max(1, policy.desiredRunwayMonths)
        )
      )
    );

    return {
      ltv,
      liquidationDistancePct,
      oracleHealthy,
      liquidityHealthy,
      venueHealthy,
      bufferShortfallUsd: roundUsd(bufferShortfallUsd),
      safeHeadroomUsd: roundUsd(safeHeadroomUsd),
      sustainableMonthlyPayoutUsd,
      venueConcentrationBreach: portfolio.venueExposurePct > policy.maxSingleVenueExposurePct,
      wrapperConcentrationBreach: portfolio.wrapperExposurePct > policy.maxWrapperExposurePct,
      needsRepay: ltv >= policy.autoRepayLtv,
      needsEmergencyDeRisk:
        ltv >= policy.emergencyLtv ||
        regime === MarketRegime.Crisis ||
        !oracleHealthy ||
        !venueHealthy,
    };
  }
}

export class Planner {
  plan(input: EngineInput, regime: MarketRegime, risk: RiskSnapshot): EngineDecision {
    const { policy, portfolio } = input;
    const actions: PlannedAction[] = [];

    // 1. Hard emergency conditions
    if (risk.needsEmergencyDeRisk) {
      const targetDebtUsd = portfolio.collateralUsd * policy.targetLtvLow;
      const repayAmountUsd = roundUsd(Math.max(0.01, portfolio.debtUsd - targetDebtUsd));

      const chosen: PlannedAction = {
        type: ActionType.EmergencyDeRisk,
        amountUsd: repayAmountUsd,
        reason: "Emergency risk condition detected",
        explanation:
          "TIDE detected a crisis-level risk signal or unhealthy infrastructure state. " +
          "The rehearsal plan would prioritize survival, reduce debt, and protect the BTC core.",
        metadata: {
          regime,
          currentLtv: risk.ltv,
          targetLtvLow: policy.targetLtvLow,
        },
      };

      actions.push(chosen);

      if (policy.allowPayoutPauseInStress) {
        actions.push({
          type: ActionType.PausePayout,
          reason: "Preserve liquidity during emergency mode",
          explanation:
            "Payouts are paused to preserve stable buffer and avoid pushing the position closer to unsafe leverage.",
          metadata: { regime },
        });
      }

      return { regime, risk, actions, chosen };
    }

    // 2. Auto-repay zone
    if (risk.needsRepay) {
      const targetDebtUsd = portfolio.collateralUsd * policy.targetLtvLow;
      const repayAmountUsd = roundUsd(Math.max(0, portfolio.debtUsd - targetDebtUsd));

      const chosen: PlannedAction = {
        type: ActionType.PartialRepay,
        amountUsd: repayAmountUsd,
        reason: "LTV exceeded auto-repay threshold",
        explanation:
          "The current leverage moved above your auto-repay threshold. " +
          "The rehearsal plan would reduce debt before the position approaches unsafe territory.",
        metadata: {
          currentLtv: risk.ltv,
          autoRepayLtv: policy.autoRepayLtv,
          targetLtvLow: policy.targetLtvLow,
        },
      };

      actions.push(chosen);
      return { regime, risk, actions, chosen };
    }

    // 3. Buffer shortfall
    if (risk.bufferShortfallUsd > 0) {
      const canBorrow =
        regime !== MarketRegime.Crisis &&
        (regime !== MarketRegime.Stress || policy.allowNewBorrowInStress);
      const borrowableBufferUsd = roundUsd(
        Math.min(risk.bufferShortfallUsd, Math.max(0, risk.safeHeadroomUsd))
      );

      const chosen: PlannedAction = canBorrow && borrowableBufferUsd > 0
        ? {
            type: ActionType.BorrowForBuffer,
            amountUsd: borrowableBufferUsd,
            reason: "Stable buffer below policy minimum",
            explanation:
              "The stable buffer is below your required floor. " +
              "TIDE is rebuilding the buffer only within modeled safe borrowing headroom.",
            metadata: {
              shortfallUsd: risk.bufferShortfallUsd,
              safeHeadroomUsd: risk.safeHeadroomUsd,
              unmetShortfallUsd: roundUsd(Math.max(0, risk.bufferShortfallUsd - borrowableBufferUsd)),
              regime,
            },
          }
        : {
            type: ActionType.BuildBuffer,
            amountUsd: risk.bufferShortfallUsd,
            reason: "Stable buffer below policy minimum; new borrowing restricted",
            explanation:
              "The engine needs to rebuild the stable buffer, but current regime rules restrict fresh borrowing. " +
              "Priority shifts to preserving cash and rebuilding liquidity conservatively.",
            metadata: {
              shortfallUsd: risk.bufferShortfallUsd,
              regime,
            },
          };

      actions.push(chosen);
      return { regime, risk, actions, chosen };
    }

    // 4. Venue / wrapper concentration
    if (risk.venueConcentrationBreach || risk.wrapperConcentrationBreach) {
      const chosen: PlannedAction = {
        type: ActionType.RotateVenue,
        reason: "Concentration rule breached",
        explanation:
          "Exposure to a single venue or wrapper exceeded your configured concentration limits. " +
          "TIDE recommends rotating exposure to restore policy compliance.",
        metadata: {
          venueBreach: risk.venueConcentrationBreach,
          wrapperBreach: risk.wrapperConcentrationBreach,
        },
      };

      actions.push(chosen);
      return { regime, risk, actions, chosen };
    }

    // 5. Payout sustainability check
    if (
      policy.mode === UserMode.Income &&
      risk.sustainableMonthlyPayoutUsd < policy.monthlyPayoutTargetUsd
    ) {
      const chosen: PlannedAction = {
        type: ActionType.ReducePayout,
        amountUsd: roundUsd(policy.monthlyPayoutTargetUsd - risk.sustainableMonthlyPayoutUsd),
        reason: "Current payout target is not sustainable under present conditions",
        explanation:
          "TIDE estimates your current payout target is above the sustainable band for the current risk regime. " +
          "Reducing payout helps preserve BTC upside while keeping leverage under control.",
        metadata: {
          targetPayoutUsd: policy.monthlyPayoutTargetUsd,
          sustainablePayoutUsd: risk.sustainableMonthlyPayoutUsd,
          regime,
        },
      };

      actions.push(chosen);
      return { regime, risk, actions, chosen };
    }

    // 6. Storm Guard proactive deleveraging
    if (policy.mode === UserMode.StormGuard && risk.ltv > policy.targetLtvLow) {
      const repayAmountUsd = roundUsd(
        Math.max(0, portfolio.debtUsd - portfolio.collateralUsd * policy.targetLtvLow)
      );

      const chosen: PlannedAction = {
        type: ActionType.PartialRepay,
        amountUsd: repayAmountUsd,
        reason: "Storm Guard prioritizes survivability over extraction",
        explanation:
          "Storm Guard mode is proactively pushing leverage down toward the lower end of your policy band " +
          "to increase survival margin under volatility expansion.",
        metadata: {
          currentLtv: risk.ltv,
          targetLtvLow: policy.targetLtvLow,
        },
      };

      actions.push(chosen);
      return { regime, risk, actions, chosen };
    }

    // 7. Default: hold
    const chosen: PlannedAction = {
      type: ActionType.Hold,
      reason: "Position is inside policy band",
      explanation:
        "No intervention is required right now. The position remains within risk, buffer, and policy constraints.",
      metadata: {
        regime,
        currentLtv: risk.ltv,
        sustainablePayoutUsd: risk.sustainableMonthlyPayoutUsd,
      },
    };

    actions.push(chosen);
    return { regime, risk, actions, chosen };
  }
}

export class TideEngine {
  private readonly regimeEngine = new RegimeEngine();
  private readonly riskEngine = new RiskEngine();
  private readonly planner = new Planner();

  async tick(
    input: EngineInput,
    opts?: {
      execute?: boolean;
      adapter?: ExecutionAdapter;
    }
  ): Promise<EngineResult> {
    assertPolicy(input.policy);

    const regime = this.regimeEngine.classify(input.market, input.venues, input.policy);
    const risk = this.riskEngine.evaluate(input, regime);
    const decision = this.planner.plan(input, regime, risk);

    if (opts?.execute) {
      const adapter = opts.adapter ?? new NoopExecutionAdapter();
      const receipt = await adapter.execute(decision.chosen, input);
      return { input, decision, receipt };
    }

    return { input, decision };
  }

  async runShadow(inputs: EngineInput[]): Promise<EngineResult[]> {
    const results: EngineResult[] = [];

    for (const input of inputs) {
      results.push(await this.tick(input, { execute: false }));
    }

    return results;
  }
}

const SUI_BTCFI_SOURCE_URL = "https://www.sui.io/btcfi-bitcoin-defi-on-sui";
const SUI_BTCFI_BLOG_URL = "https://blog.sui.io/bitcoin-defi-opportunities-on-sui/";
const FERRA_DOCS_URL = "https://docs.ferra.ag/";
const FERRA_AGGREGATOR_URL = "https://docs.ferra.ag/integration/aggregator-internal-deprecated/typescript-sdk/overview";
const KRIYA_APP_URL = "https://kriya.finance/";
const KRIYA_WBTC_SOURCE_URL = "https://docs.kriya.finance/kriya-swap/swap-tutorial/trade/limit-order";
const HOP_DOCS_URL = "https://docs.hop.ag/";
const HOP_SDK_URL = "https://docs.hop.ag/hop-sdk";

export const OFFICIAL_SUI_BTCFI_PROTOCOLS: BtcfiProtocolDefinition[] = [
  {
    id: "7k",
    name: "7K",
    category: "TradeLP",
    description: "BTC trading aggregator with pools, limit orders, DCA, and bridge routing.",
    referenceUrl: SUI_BTCFI_SOURCE_URL,
    sourceUrl: SUI_BTCFI_BLOG_URL,
    supportedBtcAssets: ["wBTC", "LBTC", "stBTC"],
    capabilities: ["Aggregation", "DCA", "LimitOrders", "Swaps"],
    treasuryRailRole: "SupportOnly",
    adapterStatus: "planned",
  },
  {
    id: "aftermath",
    name: "Aftermath",
    category: "Routing",
    description: "DCA, TWAP, and deep-routing execution across BTC liquidity venues.",
    referenceUrl: SUI_BTCFI_SOURCE_URL,
    sourceUrl: SUI_BTCFI_BLOG_URL,
    supportedBtcAssets: ["wBTC", "LBTC"],
    capabilities: ["Aggregation", "DCA", "DeepLiquidity", "Swaps", "TWAP"],
    treasuryRailRole: "SupportOnly",
    adapterStatus: "planned",
  },
  {
    id: "astros",
    name: "Astros",
    category: "Lending",
    description: "Advanced lending and looping venue included in Sui's BTCfi stack.",
    referenceUrl: SUI_BTCFI_SOURCE_URL,
    sourceUrl: SUI_BTCFI_SOURCE_URL,
    supportedBtcAssets: [],
    capabilities: ["Borrow", "Collateral", "Leverage", "Lending"],
    treasuryRailRole: "CoreRail",
    adapterStatus: "fixture",
  },
  {
    id: "bluefin",
    name: "Bluefin",
    category: "Derivatives",
    description: "Perps venue for BTC directional positioning and hedge overlays.",
    referenceUrl: SUI_BTCFI_SOURCE_URL,
    sourceUrl: SUI_BTCFI_BLOG_URL,
    supportedBtcAssets: ["wBTC", "xBTC", "AUSD", "USDC"],
    capabilities: ["Perps"],
    treasuryRailRole: "SupportOnly",
    adapterStatus: "planned",
  },
  {
    id: "bucket",
    name: "Bucket Protocol",
    category: "Lending",
    description: "Borrowing, leverage, and BTC collateral management venue.",
    referenceUrl: SUI_BTCFI_SOURCE_URL,
    sourceUrl: SUI_BTCFI_BLOG_URL,
    supportedBtcAssets: ["wBTC"],
    capabilities: ["Borrow", "Collateral", "Leverage", "Lending"],
    treasuryRailRole: "CoreRail",
    adapterStatus: "fixture",
  },
  {
    id: "cetus",
    name: "Cetus",
    category: "TradeLP",
    description: "CLMM and BTC liquidity venue on Sui.",
    referenceUrl: SUI_BTCFI_SOURCE_URL,
    sourceUrl: SUI_BTCFI_BLOG_URL,
    supportedBtcAssets: ["wBTC", "LBTC", "xBTC"],
    capabilities: ["AMM", "LP", "Swaps"],
    treasuryRailRole: "SupportOnly",
    adapterStatus: "planned",
  },
  {
    id: "deepbook",
    name: "DeepBook",
    category: "LiquidityLayer",
    description: "Shared liquidity layer that supports BTC routing depth across Sui apps.",
    referenceUrl: SUI_BTCFI_SOURCE_URL,
    sourceUrl: SUI_BTCFI_SOURCE_URL,
    supportedBtcAssets: [],
    capabilities: ["DeepLiquidity", "UnifiedLiquidity"],
    treasuryRailRole: "SupportOnly",
    adapterStatus: "planned",
  },
  {
    id: "flowx",
    name: "FlowX",
    category: "TradeLP",
    description: "BTC spot venue and LP surface on Sui.",
    referenceUrl: SUI_BTCFI_SOURCE_URL,
    sourceUrl: SUI_BTCFI_BLOG_URL,
    supportedBtcAssets: ["wBTC"],
    capabilities: ["AMM", "LP", "Swaps"],
    treasuryRailRole: "SupportOnly",
    adapterStatus: "planned",
  },
  {
    id: "magma",
    name: "Magma",
    category: "Routing",
    description: "BTC routing and strategy access point across Sui liquidity.",
    referenceUrl: SUI_BTCFI_SOURCE_URL,
    sourceUrl: SUI_BTCFI_BLOG_URL,
    supportedBtcAssets: ["wBTC", "xBTC", "LBTC", "AUSD", "USDC"],
    capabilities: ["Aggregation", "LP", "Swaps"],
    treasuryRailRole: "SupportingRail",
    adapterStatus: "fixture",
  },
  {
    id: "momentum",
    name: "Momentum",
    category: "TradeLP",
    description: "BTC liquidity and market venue on Sui.",
    referenceUrl: SUI_BTCFI_SOURCE_URL,
    sourceUrl: SUI_BTCFI_BLOG_URL,
    supportedBtcAssets: ["LBTC", "AUSD", "USDC"],
    capabilities: ["LP", "Swaps"],
    treasuryRailRole: "SupportOnly",
    adapterStatus: "planned",
  },
  {
    id: "steamm",
    name: "Steamm",
    category: "TradeLP",
    description: "BTC liquidity pools and trading venue on Sui.",
    referenceUrl: SUI_BTCFI_SOURCE_URL,
    sourceUrl: SUI_BTCFI_BLOG_URL,
    supportedBtcAssets: ["WBTC"],
    capabilities: ["AMM", "LP", "Swaps"],
    treasuryRailRole: "SupportOnly",
    adapterStatus: "planned",
  },
  {
    id: "turbos",
    name: "Turbos",
    category: "TradeLP",
    description: "BTC CLMM venue with concentrated liquidity on Sui.",
    referenceUrl: SUI_BTCFI_SOURCE_URL,
    sourceUrl: SUI_BTCFI_BLOG_URL,
    supportedBtcAssets: ["wBTC", "xBTC", "LBTC"],
    capabilities: ["AMM", "LP", "Swaps"],
    treasuryRailRole: "SupportOnly",
    adapterStatus: "planned",
  },
  {
    id: "typus",
    name: "Typus",
    category: "Derivatives",
    description: "Options and structured BTC strategies on Sui.",
    referenceUrl: SUI_BTCFI_SOURCE_URL,
    sourceUrl: SUI_BTCFI_BLOG_URL,
    supportedBtcAssets: ["wBTC"],
    capabilities: ["Options", "Yield"],
    treasuryRailRole: "SupportingRail",
    adapterStatus: "fixture",
  },
  {
    id: "alphalend",
    name: "AlphaLend",
    category: "Lending",
    description: "BTC lending and leverage venue on Sui.",
    referenceUrl: SUI_BTCFI_SOURCE_URL,
    sourceUrl: SUI_BTCFI_BLOG_URL,
    supportedBtcAssets: ["wBTC", "LBTC"],
    capabilities: ["Borrow", "Collateral", "Leverage", "Lending"],
    treasuryRailRole: "CoreRail",
    adapterStatus: "fixture",
  },
  {
    id: "kai-finance",
    name: "Kai Finance",
    category: "Lending",
    description: "BTC-backed borrowing and leverage venue on Sui.",
    referenceUrl: SUI_BTCFI_SOURCE_URL,
    sourceUrl: SUI_BTCFI_BLOG_URL,
    supportedBtcAssets: ["wBTC"],
    capabilities: ["Borrow", "Collateral", "Leverage", "Lending"],
    treasuryRailRole: "CoreRail",
    adapterStatus: "fixture",
  },
  {
    id: "navi",
    name: "NAVI Protocol",
    category: "Lending",
    description: "Major BTC lending and borrowing venue on Sui.",
    referenceUrl: SUI_BTCFI_SOURCE_URL,
    sourceUrl: SUI_BTCFI_BLOG_URL,
    supportedBtcAssets: ["wBTC", "LBTC", "stBTC"],
    capabilities: ["Borrow", "Collateral", "Leverage", "Lending"],
    treasuryRailRole: "CoreRail",
    adapterStatus: "fixture",
  },
  {
    id: "suilend",
    name: "Suilend",
    category: "Lending",
    description: "BTC lending and borrow venue with treasury-relevant collateral rails.",
    referenceUrl: SUI_BTCFI_SOURCE_URL,
    sourceUrl: SUI_BTCFI_BLOG_URL,
    supportedBtcAssets: ["wBTC", "LBTC", "stBTC"],
    capabilities: ["Borrow", "Collateral", "Lending"],
    treasuryRailRole: "CoreRail",
    adapterStatus: "fixture",
  },
  {
    id: "alphafi",
    name: "AlphaFi",
    category: "Vaults",
    description: "BTC vault strategies and managed collateral surfaces on Sui.",
    referenceUrl: SUI_BTCFI_SOURCE_URL,
    sourceUrl: SUI_BTCFI_BLOG_URL,
    supportedBtcAssets: ["wBTC"],
    capabilities: ["StrategyVaults", "Yield"],
    treasuryRailRole: "SupportingRail",
    adapterStatus: "fixture",
  },
  {
    id: "haedal",
    name: "Haedal",
    category: "Vaults",
    description: "Vault and auto-compound surface that includes BTC positions.",
    referenceUrl: SUI_BTCFI_SOURCE_URL,
    sourceUrl: SUI_BTCFI_BLOG_URL,
    supportedBtcAssets: ["haSUI", "USDC", "wBTC"],
    capabilities: ["AutoCompound", "StrategyVaults", "Yield"],
    treasuryRailRole: "SupportingRail",
    adapterStatus: "fixture",
  },
  {
    id: "lotus-finance",
    name: "Lotus Finance",
    category: "Vaults",
    description: "BTC and stablecoin vault strategies on Sui.",
    referenceUrl: SUI_BTCFI_SOURCE_URL,
    sourceUrl: SUI_BTCFI_BLOG_URL,
    supportedBtcAssets: ["wBTC", "xBTC", "USDC"],
    capabilities: ["StrategyVaults", "Yield"],
    treasuryRailRole: "SupportingRail",
    adapterStatus: "fixture",
  },
  {
    id: "metastable",
    name: "Metastable",
    category: "Vaults",
    description: "BTC vault strategies and structured LP surfaces.",
    referenceUrl: SUI_BTCFI_SOURCE_URL,
    sourceUrl: SUI_BTCFI_BLOG_URL,
    supportedBtcAssets: ["wBTC", "USDC"],
    capabilities: ["StrategyVaults", "Yield"],
    treasuryRailRole: "SupportingRail",
    adapterStatus: "fixture",
  },
  {
    id: "native",
    name: "Native",
    category: "Routing",
    description: "BTC ingress and routing layer for moving BTC into Sui DeFi rails.",
    referenceUrl: SUI_BTCFI_SOURCE_URL,
    sourceUrl: SUI_BTCFI_SOURCE_URL,
    supportedBtcAssets: ["nBTC"],
    capabilities: ["BridgeIngress", "Collateral", "Swaps"],
    treasuryRailRole: "SupportingRail",
    adapterStatus: "fixture",
  },
  {
    id: "nemo",
    name: "Nemo",
    category: "Vaults",
    description: "BTCfi access layer with zap deposit, staking, and auto-compound strategies.",
    referenceUrl: SUI_BTCFI_SOURCE_URL,
    sourceUrl: SUI_BTCFI_SOURCE_URL,
    supportedBtcAssets: [],
    capabilities: ["Aggregation", "AutoCompound", "BridgeIngress", "StrategyVaults", "Yield"],
    treasuryRailRole: "SupportingRail",
    adapterStatus: "fixture",
  },
  {
    id: "scallop",
    name: "Scallop",
    category: "Lending",
    description: "Lending market with BTC asset support on Sui.",
    referenceUrl: SUI_BTCFI_SOURCE_URL,
    sourceUrl: SUI_BTCFI_SOURCE_URL,
    supportedBtcAssets: [],
    capabilities: ["Borrow", "Collateral", "Lending"],
    treasuryRailRole: "CoreRail",
    adapterStatus: "fixture",
  },
  {
    id: "volo",
    name: "Volo",
    category: "Vaults",
    description: "Vault product set that expands BTC strategy surfaces on Sui.",
    referenceUrl: SUI_BTCFI_SOURCE_URL,
    sourceUrl: SUI_BTCFI_SOURCE_URL,
    supportedBtcAssets: [],
    capabilities: ["StrategyVaults", "Yield"],
    treasuryRailRole: "SupportingRail",
    adapterStatus: "fixture",
  },
];

export const ECOSYSTEM_EXTENSION_PROTOCOLS: BtcfiProtocolDefinition[] = [
  {
    id: "ferra",
    name: "Ferra",
    category: "LiquidityLayer",
    description: "Native Sui liquidity and routing layer with DLMM, CLMM, DAMM, and internal aggregation.",
    referenceUrl: FERRA_DOCS_URL,
    sourceUrl: FERRA_AGGREGATOR_URL,
    supportedBtcAssets: [],
    capabilities: ["Aggregation", "AMM", "DeepLiquidity", "LP", "Swaps"],
    treasuryRailRole: "SupportOnly",
    adapterStatus: "planned",
  },
  {
    id: "kriya",
    name: "Kriya",
    category: "TradeLP",
    description: "Sui-native swap and strategy venue with documented WBTC/USDC trading and cross-protocol vault surfaces.",
    referenceUrl: KRIYA_APP_URL,
    sourceUrl: KRIYA_WBTC_SOURCE_URL,
    supportedBtcAssets: ["wBTC"],
    capabilities: ["AMM", "DeepLiquidity", "LimitOrders", "LP", "StrategyVaults", "Swaps"],
    treasuryRailRole: "SupportOnly",
    adapterStatus: "planned",
  },
  {
    id: "hop-aggregator",
    name: "Hop Aggregator",
    category: "Routing",
    description: "Sui-native aggregation layer routing liquidity across venues, relevant for BTC execution paths and best-price discovery.",
    referenceUrl: HOP_DOCS_URL,
    sourceUrl: HOP_SDK_URL,
    supportedBtcAssets: [],
    capabilities: ["Aggregation", "DeepLiquidity", "Swaps"],
    treasuryRailRole: "SupportOnly",
    adapterStatus: "http_ready",
  },
];

export const SUI_BTCFI_PROTOCOLS: BtcfiProtocolDefinition[] = [
  ...OFFICIAL_SUI_BTCFI_PROTOCOLS,
  ...ECOSYSTEM_EXTENSION_PROTOCOLS,
];

export function getOfficialSuiBtcfiProtocols(): BtcfiProtocolDefinition[] {
  return OFFICIAL_SUI_BTCFI_PROTOCOLS.slice();
}

export function getEcosystemExtensionProtocols(): BtcfiProtocolDefinition[] {
  return ECOSYSTEM_EXTENSION_PROTOCOLS.slice();
}

export function getTreasuryRailProtocols(): BtcfiProtocolDefinition[] {
  return SUI_BTCFI_PROTOCOLS.filter((protocol) => protocol.treasuryRailRole !== "SupportOnly");
}

function protocolHasCapability(
  protocol: BtcfiProtocolDefinition,
  capability: BtcfiProtocolCapability
): boolean {
  return protocol.capabilities.includes(capability);
}

function buildModeledRailSnapshot(
  protocol: BtcfiProtocolDefinition,
  index: number
): RailSnapshot {
  const categoryDefaults = {
    Lending: {
      healthScore: 0.90,
      liquidityScore: 0.87,
      oracleConfidence: 0.96,
      borrowApr: 0.061,
      depositApr: 0.014,
      maxLtv: 0.35,
      availableDebtUsd: 2500000,
      rebalanceCostBps: 13,
    },
    Vaults: {
      healthScore: 0.84,
      liquidityScore: 0.78,
      oracleConfidence: 0.93,
      borrowApr: 0.069,
      depositApr: 0.022,
      maxLtv: 0.28,
      availableDebtUsd: 1350000,
      rebalanceCostBps: 19,
    },
    Routing: {
      healthScore: 0.82,
      liquidityScore: 0.81,
      oracleConfidence: 0.92,
      borrowApr: 0.066,
      depositApr: 0.018,
      maxLtv: 0.27,
      availableDebtUsd: 1250000,
      rebalanceCostBps: 17,
    },
    TradeLP: {
      healthScore: 0.79,
      liquidityScore: 0.83,
      oracleConfidence: 0.91,
      borrowApr: 0.073,
      depositApr: 0.01,
      maxLtv: 0.24,
      availableDebtUsd: 900000,
      rebalanceCostBps: 24,
    },
    Derivatives: {
      healthScore: 0.77,
      liquidityScore: 0.79,
      oracleConfidence: 0.9,
      borrowApr: 0.076,
      depositApr: 0.009,
      maxLtv: 0.2,
      availableDebtUsd: 700000,
      rebalanceCostBps: 28,
    },
    LiquidityLayer: {
      healthScore: 0.8,
      liquidityScore: 0.88,
      oracleConfidence: 0.92,
      borrowApr: 0.071,
      depositApr: 0.011,
      maxLtv: 0.22,
      availableDebtUsd: 1100000,
      rebalanceCostBps: 22,
    },
  }[protocol.category];

  const variation = ((index % 5) - 2) * 0.012;
  const healthy = categoryDefaults.healthScore + variation >= 0.62;
  const maxLtvBoost = protocolHasCapability(protocol, "Leverage") ? 0.03 : 0;
  const borrowAprDiscount = protocolHasCapability(protocol, "Borrow") ? 0.005 : 0;
  const depthBoost = protocolHasCapability(protocol, "DeepLiquidity") ? 650000 : 0;
  const wrapper = protocol.supportedBtcAssets[0] ?? "BTC basket";
  const stableAsset = protocol.supportedBtcAssets.includes("AUSD") ? "AUSD" : "USDC";

  return {
    id: protocol.id,
    name: protocol.name,
    source: "fixture",
    wrapper,
    stableAsset,
    healthy,
    oracleConfidence: roundPct(clamp(categoryDefaults.oracleConfidence + variation * 0.55, 0.45, 0.99)),
    liquidityScore: roundPct(clamp(categoryDefaults.liquidityScore + variation * 0.8, 0.18, 0.99)),
    healthScore: roundPct(clamp(categoryDefaults.healthScore + variation, 0.12, 0.99)),
    borrowApr: roundPct(clamp(categoryDefaults.borrowApr - borrowAprDiscount + variation * 0.3, 0.02, 0.2)),
    depositApr: roundPct(clamp(categoryDefaults.depositApr + variation * 0.15, 0, 0.2)),
    maxLtv: roundPct(clamp(categoryDefaults.maxLtv + maxLtvBoost + variation * 0.4, 0.12, 0.75)),
    availableDebtUsd: roundUsd(
      Math.max(250000, categoryDefaults.availableDebtUsd + depthBoost + (index - 3) * 180000)
    ),
    rebalanceCostBps: roundBps(
      Math.max(6, categoryDefaults.rebalanceCostBps + index * 2 - (protocolHasCapability(protocol, "Aggregation") ? 3 : 0))
    ),
    supportsRefinance:
      protocolHasCapability(protocol, "Borrow") ||
      protocolHasCapability(protocol, "Lending") ||
      protocolHasCapability(protocol, "Aggregation"),
    tags: [protocol.category, ...protocol.capabilities.slice(0, 2)],
    notes: [
      `Modeled starter fixture for ${protocol.name}; not live protocol data.`,
      `Reference: ${protocol.referenceUrl}`,
    ],
    updatedAt: new Date(0).toISOString(),
  };
}

export const STARTER_RAIL_FIXTURES: RailSnapshot[] = getTreasuryRailProtocols().map(
  (protocol, index) => buildModeledRailSnapshot(protocol, index)
);

export function createStarterRailAdapters(): RailAdapter[] {
  return STARTER_RAIL_FIXTURES.map((snapshot) => new FixtureRailAdapter(snapshot));
}

export function createSnapshotRailAdapters(snapshots: RailSnapshot[]): RailAdapter[] {
  return snapshots.map((snapshot) => new SnapshotRailAdapter(snapshot));
}

export const DEFAULT_SHADOW_SCENARIOS: ShadowScenarioDefinition[] = [
  {
    id: "current",
    label: "Current setup",
    drawdownPct: 0,
    horizonDays: 30,
  },
  {
    id: "pullback",
    label: "-20% drawdown",
    drawdownPct: 0.20,
    horizonDays: 45,
  },
  {
    id: "stress",
    label: "-35% drawdown",
    drawdownPct: 0.35,
    horizonDays: 60,
  },
  {
    id: "crash",
    label: "-50% drawdown",
    drawdownPct: 0.50,
    horizonDays: 90,
  },
  {
    // Pyth feed grows stale without a real price drawdown. Engine
    // should pull the venue below minOracleConfidence and suspend
    // execution rather than act on potentially fresh-looking data.
    id: "oracle-stale",
    label: "Oracle confidence drop",
    drawdownPct: 0,
    horizonDays: 30,
    oracleConfidenceHaircut: 0.30,
  },
  {
    // Canonical stablecoin drifts ~5% off peg. Buffer that looks
    // healthy in USD terms is not. Paired with a modest drawdown to
    // stress the buffer + LTV together.
    id: "stable-depeg",
    label: "Stable buffer depeg",
    drawdownPct: 0.15,
    horizonDays: 45,
    stableDepegPct: 0.05,
  },
];

const OPERATING_STATE_SEVERITY: Record<OperatingState, number> = {
  [OperatingState.Observe]: 0,
  [OperatingState.Maintain]: 1,
  [OperatingState.BuildBuffer]: 2,
  [OperatingState.DeRisk]: 3,
  [OperatingState.StressLockdown]: 4,
};

export function deriveOperatingState(input: EngineInput, decision: EngineDecision): OperatingState {
  const hasPauseAction = decision.actions.some(action => action.type === ActionType.PausePayout);

  if (
    decision.regime === MarketRegime.Crisis ||
    decision.chosen.type === ActionType.EmergencyDeRisk ||
    hasPauseAction
  ) {
    return OperatingState.StressLockdown;
  }

  if (
    decision.chosen.type === ActionType.BorrowForBuffer ||
    decision.chosen.type === ActionType.BuildBuffer
  ) {
    return OperatingState.BuildBuffer;
  }

  if (
    decision.regime === MarketRegime.Stress ||
    decision.chosen.type === ActionType.PartialRepay ||
    decision.chosen.type === ActionType.RotateVenue ||
    decision.chosen.type === ActionType.ReducePayout
  ) {
    return OperatingState.DeRisk;
  }

  if (
    !input.portfolio.lastActionAt &&
    decision.regime === MarketRegime.Quiet &&
    decision.risk.ltv < input.policy.targetLtvLow * 0.85
  ) {
    return OperatingState.Observe;
  }

  return OperatingState.Maintain;
}

export function evaluatePolicyHealth(
  input: EngineInput,
  decision: EngineDecision
): PolicyHealthSnapshot {
  const { policy } = input;
  const { risk, regime } = decision;
  const notes: string[] = [];
  const bufferFloor = calculateBufferFloor(policy);
  const ltvPressure = clamp(safeDiv(risk.ltv, policy.maxLtv), 0, 1);
  const bufferStress = clamp(safeDiv(risk.bufferShortfallUsd, Math.max(1, bufferFloor)), 0, 1);

  let score = 100;
  score -= ltvPressure * 32;
  score -= bufferStress * 28;

  const regimePenalty = {
    [MarketRegime.Quiet]: 0,
    [MarketRegime.Trend]: 8,
    [MarketRegime.Stress]: 18,
    [MarketRegime.Crisis]: 32,
  }[regime];

  score -= regimePenalty;

  if (!risk.oracleHealthy) {
    score -= 14;
    notes.push("Oracle confidence is below the minimum threshold.");
  }

  if (!risk.liquidityHealthy) {
    score -= 10;
    notes.push("Execution liquidity is below the policy floor.");
  }

  if (!risk.venueHealthy) {
    score -= 12;
    notes.push("At least one venue fails the health check.");
  }

  if (risk.venueConcentrationBreach) {
    score -= 10;
    notes.push("Primary venue concentration is above your allowed cap.");
  }

  if (risk.wrapperConcentrationBreach) {
    score -= 8;
    notes.push("Wrapper concentration is above your allowed cap.");
  }

  if (risk.bufferShortfallUsd > 0) {
    notes.push(`Stable buffer is short by $${roundUsd(risk.bufferShortfallUsd)}.`);
  }

  if (risk.sustainableMonthlyPayoutUsd < policy.monthlyPayoutTargetUsd) {
    notes.push("Requested payout is above the currently sustainable band.");
  }

  if (notes.length === 0) {
    notes.push("Policy is operating inside its target envelope.");
  }

  const normalizedScore = Math.round(clamp(score, 0, 100));
  let label = "Critical";

  if (normalizedScore >= 85) {
    label = "Strong";
  } else if (normalizedScore >= 70) {
    label = "Stable";
  } else if (normalizedScore >= 55) {
    label = "Guarded";
  } else if (normalizedScore >= 35) {
    label = "Fragile";
  }

  return {
    score: normalizedScore,
    label,
    notes,
  };
}

export function projectPayoutBand(result: EngineResult): {
  lowUsd: number;
  highUsd: number;
} {
  const sustainable = result.decision.risk.sustainableMonthlyPayoutUsd;
  const target = result.input.policy.monthlyPayoutTargetUsd;

  if (sustainable <= 0) {
    return { lowUsd: 0, highUsd: 0 };
  }

  const downsideBuffer = {
    [MarketRegime.Quiet]: 0.05,
    [MarketRegime.Trend]: 0.07,
    [MarketRegime.Stress]: 0.10,
    [MarketRegime.Crisis]: 0.14,
  }[result.decision.regime];

  const lowUsd = roundUsd(Math.max(0, sustainable * (1 - downsideBuffer)));
  const highUsd = roundUsd(Math.min(target, sustainable * (1 + downsideBuffer * 0.55)));

  return {
    lowUsd: Math.min(lowUsd, highUsd),
    highUsd: Math.max(lowUsd, highUsd),
  };
}

export function deriveShadowScenarioHorizonDays(
  scenario: ShadowScenarioDefinition
): number {
  const explicit = Math.round(Number(scenario.horizonDays));
  if (Number.isFinite(explicit) && explicit > 0) {
    return clamp(explicit, 1, 365);
  }

  return Math.round(
    clamp(
      SHADOW_BASE_HORIZON_DAYS + Math.max(0, scenario.drawdownPct) * 120,
      SHADOW_BASE_HORIZON_DAYS,
      SHADOW_MAX_HORIZON_DAYS
    )
  );
}

function createZeroEconomics(
  horizonDays: number,
  borrowApr = 0
): ShadowScenarioEconomics {
  return {
    horizonDays,
    borrowApr: roundPct(Math.max(0, borrowApr)),
    carryCostUsd: 0,
    rebalanceCostUsd: 0,
    liquidationPenaltyUsd: 0,
    liquidationTriggered: false,
    totalDragUsd: 0,
  };
}

function withTotalDrag(economics: ShadowScenarioEconomics): ShadowScenarioEconomics {
  return {
    ...economics,
    totalDragUsd: roundUsd(
      Math.max(
        0,
        economics.carryCostUsd +
          economics.rebalanceCostUsd +
          economics.liquidationPenaltyUsd
      )
    ),
  };
}

// AlphaLend / Aave-style piecewise-linear interest rate. When a rail
// snapshot carries kink parameters, this yields the borrow APR at the
// current (or stressed) utilization. Falls back to the flat borrowApr
// when any parameter is missing, so existing fixtures stay byte-stable.
export function computeEffectiveBorrowApr(
  rail: RailSnapshot | undefined,
  stressedUtilization?: number
): number {
  const flat = clamp(rail?.borrowApr ?? 0, 0, 1);
  if (!rail) return flat;

  const hasKink =
    typeof rail.irBaseApr === "number" &&
    typeof rail.irSlope1 === "number" &&
    typeof rail.irSlope2 === "number" &&
    typeof rail.irKinkUtilization === "number";
  if (!hasKink) return flat;

  const baseUtilization = clamp(
    typeof stressedUtilization === "number"
      ? stressedUtilization
      : rail.utilizationRate ?? 0,
    0,
    1
  );
  const kink = clamp(rail.irKinkUtilization!, 0.05, 0.98);
  const base = Math.max(0, rail.irBaseApr!);
  const slope1 = Math.max(0, rail.irSlope1!);
  const slope2 = Math.max(0, rail.irSlope2!);

  if (baseUtilization <= kink) {
    return clamp(base + baseUtilization * slope1, 0, 2);
  }
  return clamp(base + kink * slope1 + (baseUtilization - kink) * slope2, 0, 2);
}

export function applyScenarioStressEconomics(
  input: EngineInput,
  scenario: ShadowScenarioDefinition,
  primaryRail?: RailSnapshot
): { input: EngineInput; economics: ShadowScenarioEconomics } {
  const horizonDays = deriveShadowScenarioHorizonDays(scenario);
  // Drawdowns drain lending-pool liquidity, which drives utilization
  // up the kinked curve. Clamp the bump conservatively — the goal is
  // "IR is not flat during a crash," not a perfect pool model.
  const drawdownPct = clamp(scenario.drawdownPct, 0, 0.9);
  const baseUtilization = clamp(primaryRail?.utilizationRate ?? 0, 0, 1);
  const stressedUtilization = clamp(
    baseUtilization + drawdownPct * 0.25,
    0,
    1
  );
  const borrowApr = computeEffectiveBorrowApr(primaryRail, stressedUtilization);

  let nextPortfolio: PortfolioState = {
    ...input.portfolio,
  };

  let liquidationPenaltyUsd = 0;
  let liquidationTriggered = false;
  let carryCostUsd = 0;

  const liquidationThreshold = clamp(
    Math.min(input.policy.maxLtv, primaryRail?.maxLtv ?? input.policy.maxLtv),
    0.05,
    0.95
  );
  const liquidationPenaltyRate = clamp(
    (SHADOW_LIQUIDATION_PENALTY_BPS_BASE +
      Math.max(0, scenario.drawdownPct) * SHADOW_LIQUIDATION_PENALTY_BPS_DRAW) /
      10000,
    0.03,
    0.12
  );

  // Partial-liquidation cascade. Real lending markets cap each
  // liquidation at ~50% of outstanding debt and pay the penalty out of
  // collateral. Runs at most 3 passes per trigger. Returns the portfolio
  // post-cascade and how much penalty was applied.
  const PARTIAL_LIQ_CAP_PCT = 0.5;
  const MAX_LIQ_PASSES = 3;

  function runLiquidationCascade(
    portfolio: PortfolioState
  ): { portfolio: PortfolioState; penaltyUsd: number; triggered: boolean } {
    let pf = portfolio;
    let penalty = 0;
    let triggered = false;

    for (let pass = 0; pass < MAX_LIQ_PASSES; pass += 1) {
      const currentLtv = safeDiv(pf.debtUsd, pf.collateralUsd);
      if (
        !Number.isFinite(currentLtv) ||
        currentLtv <= liquidationThreshold ||
        pf.debtUsd <= 0 ||
        pf.collateralUsd <= 0
      ) {
        break;
      }

      const excessDebtUsd = Math.max(
        0,
        pf.debtUsd - pf.collateralUsd * liquidationThreshold
      );
      const denominator = 1 - liquidationThreshold * (1 + liquidationPenaltyRate);
      if (excessDebtUsd <= 0 || denominator <= 0.02) {
        break;
      }

      const unconstrainedRepayUsd = excessDebtUsd / denominator;
      const passCapUsd = PARTIAL_LIQ_CAP_PCT * pf.debtUsd;
      const forcedRepayUsd = roundUsd(
        clamp(Math.min(unconstrainedRepayUsd, passCapUsd), 0, pf.debtUsd)
      );
      if (forcedRepayUsd <= 0) {
        break;
      }

      const passPenaltyUsd = roundUsd(forcedRepayUsd * liquidationPenaltyRate);
      penalty = roundUsd(penalty + passPenaltyUsd);

      const collateralAfter = roundUsd(
        Math.max(0, pf.collateralUsd - forcedRepayUsd - passPenaltyUsd)
      );
      const debtAfter = roundUsd(Math.max(0, pf.debtUsd - forcedRepayUsd));

      pf = {
        ...pf,
        btcUnits:
          pf.btcPriceUsd > 0
            ? roundUnits(collateralAfter / pf.btcPriceUsd)
            : pf.btcUnits,
        collateralUsd: collateralAfter,
        debtUsd: debtAfter,
      };
      triggered = true;
    }

    return { portfolio: pf, penaltyUsd: penalty, triggered };
  }

  // Path-dependent daily accrual. Debt accrues at the stressed APR
  // every day; LTV is checked after each day so an intra-horizon
  // liquidation fires on the day it would happen in reality — not
  // after we let debt compound for the whole horizon. When no
  // mid-horizon liquidation triggers the end-state debt is byte-
  // identical to the previous single-step compound (same formula,
  // unrolled).
  const dailyRate = borrowApr / 365;
  const safeHorizonDays = Math.max(0, Math.floor(horizonDays));

  // Liquidation check at day 0 catches drawdowns that already breach
  // the threshold at scenario start, before any daily accrual runs.
  {
    const cascade = runLiquidationCascade(nextPortfolio);
    nextPortfolio = cascade.portfolio;
    liquidationPenaltyUsd = roundUsd(liquidationPenaltyUsd + cascade.penaltyUsd);
    if (cascade.triggered) liquidationTriggered = true;
  }

  for (let day = 1; day <= safeHorizonDays; day += 1) {
    if (nextPortfolio.debtUsd <= 0) break;
    const accrual = nextPortfolio.debtUsd * dailyRate;
    carryCostUsd = roundUsd(carryCostUsd + Math.max(0, accrual));
    nextPortfolio = {
      ...nextPortfolio,
      debtUsd: roundUsd(nextPortfolio.debtUsd + accrual),
    };

    const cascade = runLiquidationCascade(nextPortfolio);
    if (cascade.triggered) {
      nextPortfolio = cascade.portfolio;
      liquidationPenaltyUsd = roundUsd(liquidationPenaltyUsd + cascade.penaltyUsd);
      liquidationTriggered = true;
    }
  }

  return {
    input: {
      ...input,
      portfolio: nextPortfolio,
    },
    economics: withTotalDrag({
      horizonDays,
      borrowApr,
      carryCostUsd,
      rebalanceCostUsd: 0,
      liquidationPenaltyUsd,
      liquidationTriggered,
      totalDragUsd: 0,
    }),
  };
}

export function estimateActionRebalanceCostUsd(
  action: PlannedAction,
  rail?: RailSnapshot,
  portfolio?: PortfolioState
): number {
  const rebalanceCostBps = Math.max(0, Number(rail?.rebalanceCostBps || 0));
  if (!action || rebalanceCostBps <= 0) {
    return 0;
  }

  const amountUsd = Math.max(0, Number(action.amountUsd) || 0);
  let notionalUsd = 0;

  switch (action.type) {
    case ActionType.BorrowForBuffer:
    case ActionType.PartialRepay:
    case ActionType.EmergencyDeRisk:
      notionalUsd = amountUsd;
      break;
    case ActionType.RotateVenue:
      notionalUsd = Math.max(0, Number(portfolio?.debtUsd) || 0);
      break;
    default:
      notionalUsd = 0;
      break;
  }

  return roundUsd(notionalUsd * rebalanceCostBps / 10000);
}

export function applyActionRebalanceCost(
  input: EngineInput,
  action: PlannedAction,
  primaryRail?: RailSnapshot,
  existingEconomics?: ShadowScenarioEconomics
): { input: EngineInput; economics: ShadowScenarioEconomics } {
  const economics = existingEconomics
    ? { ...existingEconomics }
    : createZeroEconomics(SHADOW_BASE_HORIZON_DAYS, primaryRail?.borrowApr ?? 0);
  const rebalanceCostUsd = estimateActionRebalanceCostUsd(
    action,
    primaryRail,
    input.portfolio
  );
  const existingRebalanceCostUsd = Math.max(
    0,
    Number(economics.rebalanceCostUsd) || 0
  );

  if (rebalanceCostUsd <= 0) {
    return {
      input,
      economics: withTotalDrag(economics),
    };
  }

  const cumulativeRebalanceCostUsd = roundUsd(
    existingRebalanceCostUsd + rebalanceCostUsd
  );
  const stableBufferAfterCostUsd = roundUsd(
    Math.max(0, input.portfolio.stableBufferUsd - rebalanceCostUsd)
  );
  const unfundedCostUsd = roundUsd(
    Math.max(0, rebalanceCostUsd - input.portfolio.stableBufferUsd)
  );

  return {
    input: {
      ...input,
      portfolio: {
        ...input.portfolio,
        stableBufferUsd: stableBufferAfterCostUsd,
        debtUsd: roundUsd(input.portfolio.debtUsd + unfundedCostUsd),
      },
    },
    economics: withTotalDrag({
      ...economics,
      rebalanceCostUsd: cumulativeRebalanceCostUsd,
    }),
  };
}

export function stressRailSnapshot(
  rail: RailSnapshot,
  drawdownPct: number
): RailSnapshot {
  const healthScore = clamp(rail.healthScore - drawdownPct * 0.30, 0.12, 1);

  return {
    ...rail,
    healthy: rail.healthy && healthScore >= 0.42,
    oracleConfidence: roundPct(
      clamp(rail.oracleConfidence - drawdownPct * 0.10, 0.40, 1)
    ),
    liquidityScore: roundPct(
      clamp(rail.liquidityScore - drawdownPct * 0.24, 0.18, 1)
    ),
    healthScore: roundPct(healthScore),
    borrowApr: roundPct(
      clamp(rail.borrowApr + drawdownPct * 0.045, 0.01, 0.3)
    ),
    depositApr: roundPct(
      clamp(rail.depositApr + drawdownPct * 0.01, 0, 0.2)
    ),
    maxLtv: roundPct(
      clamp(rail.maxLtv - drawdownPct * 0.035, 0.12, 0.85)
    ),
    availableDebtUsd: roundUsd(
      Math.max(0, rail.availableDebtUsd * (1 - drawdownPct * 0.46))
    ),
    rebalanceCostBps: roundBps(
      rail.rebalanceCostBps * (1 + drawdownPct * 1.1)
    ),
    notes: [
      ...rail.notes,
      `Stress-adjusted at ${Math.round(drawdownPct * 100)}% BTC drawdown.`,
    ],
  };
}

export function createShadowScenarioInput(
  baseInput: EngineInput,
  scenario: ShadowScenarioDefinition
): EngineInput {
  const drawdownPct = clamp(scenario.drawdownPct, 0, 0.9);
  const oracleHaircut = clamp(scenario.oracleConfidenceHaircut ?? 0, 0, 0.95);
  const stableDepegPct = clamp(scenario.stableDepegPct ?? 0, 0, 0.5);
  const nextBtcPriceUsd = roundUsd(baseInput.portfolio.btcPriceUsd * (1 - drawdownPct));
  const nextCollateralUsd = roundUsd(baseInput.portfolio.btcUnits * nextBtcPriceUsd);
  const bufferDrainMultiplier = clamp(1 - drawdownPct * 0.45, 0.50, 1);
  // Depeg cuts into the stable buffer before the drawdown-driven drain.
  const depegDrainedBuffer = baseInput.portfolio.stableBufferUsd * (1 - stableDepegPct);
  const nextStableBufferUsd = roundUsd(depegDrainedBuffer * bufferDrainMultiplier);
  const venueSet = baseInput.venues.length > 0 ? baseInput.venues : [defaultVenue()];

  return {
    ...baseInput,
    portfolio: {
      ...baseInput.portfolio,
      btcPriceUsd: nextBtcPriceUsd,
      collateralUsd: nextCollateralUsd,
      stableBufferUsd: nextStableBufferUsd,
      debtUsd: baseInput.portfolio.debtUsd,
    },
    market: {
      realizedVol30d: roundPct(
        clamp(
          Math.max(baseInput.market.realizedVol30d, 0.42 + drawdownPct * 2.6),
          0.2,
          2.5
        )
      ),
      dailyMovePctAbs: roundPct(
        clamp(
          Math.max(baseInput.market.dailyMovePctAbs, 0.012 + drawdownPct * 0.22),
          0.005,
          0.2
        )
      ),
      weeklyDrawdownPct: roundPct(
        clamp(
          Math.max(baseInput.market.weeklyDrawdownPct, drawdownPct),
          0,
          0.6
        )
      ),
      trendStrength: roundPct(
        clamp(
          Math.max(baseInput.market.trendStrength, 0.30 + drawdownPct * 1.1),
          0,
          1
        )
      ),
    },
    venues: venueSet.map((venue) => {
      const healthScore = clamp(venue.healthScore - drawdownPct * 0.42, 0.12, 1);
      // Oracle-stale scenarios shave confidence on top of the drawdown
      // haircut; the engine treats a <minOracleConfidence venue as
      // blocked, which is the right behaviour when Pyth feeds go stale.
      const oracleConfidence = roundPct(
        clamp(venue.oracleConfidence - drawdownPct * 0.12 - oracleHaircut, 0, 1)
      );
      return {
        ...venue,
        healthy: venue.healthy && healthScore >= 0.42 && oracleConfidence >= 0.45,
        oracleConfidence,
        liquidityScore: roundPct(
          clamp(venue.liquidityScore - drawdownPct * 0.34, 0.18, 1)
        ),
        healthScore: roundPct(healthScore),
      };
    }),
  };
}

export class ShadowModeSimulator {
  private readonly engine = new TideEngine();
  private readonly railAdapters: RailAdapter[];
  private readonly railAggregator = new RailSnapshotAggregator();
  private readonly railAllocator = new RailAllocator();

  constructor(railAdapters: RailAdapter[] = createStarterRailAdapters()) {
    this.railAdapters = railAdapters;
  }

  async simulate(
    baseInput: EngineInput,
    scenarios: ShadowScenarioDefinition[] = DEFAULT_SHADOW_SCENARIOS
  ): Promise<ShadowSimulationReport> {
    const baseContext: RailAdapterContext = {
      now: baseInput.now,
      policy: baseInput.policy,
      portfolio: baseInput.portfolio,
      market: baseInput.market,
    };

    const { snapshots: baseRails, warnings: adapterWarnings } = await this.railAggregator.collect(
      this.railAdapters,
      baseContext
    );

    const outcomes: ShadowScenarioOutcome[] = [];

    for (const scenario of scenarios) {
      const rawInput = createShadowScenarioInput(baseInput, scenario);
      const stressedRails = baseRails.map((rail) => stressRailSnapshot(rail, scenario.drawdownPct));
      const allocation = this.railAllocator.allocate(
        {
          now: rawInput.now,
          policy: rawInput.policy,
          portfolio: rawInput.portfolio,
          market: rawInput.market,
        },
        stressedRails,
        adapterWarnings
      );
      const effectiveInput = applyRailToInput(rawInput, allocation);
      const primaryRail = allocation.primary?.rail;
      const stressModeled = applyScenarioStressEconomics(
        effectiveInput,
        scenario,
        primaryRail
      );
      let result = await this.engine.tick(stressModeled.input, { execute: false });
      let accumulatedEconomics = stressModeled.economics;
      let lastActionType = result.decision.chosen?.type;

      // Each rebalance action changes portfolio state; the next tick
      // may choose a different action which also carries rebalance
      // drag. Loop until the action stabilises or a safety cap hits
      // (prevents pathological oscillation between two action types).
      const MAX_REBALANCE_PASSES = 3;
      for (let pass = 0; pass < MAX_REBALANCE_PASSES; pass += 1) {
        const previousRebalanceCostUsd = Math.max(
          0,
          accumulatedEconomics.rebalanceCostUsd || 0
        );
        const nextCost = applyActionRebalanceCost(
          result.input,
          result.decision.chosen,
          primaryRail,
          accumulatedEconomics
        );
        const incrementalRebalanceCostUsd = roundUsd(
          nextCost.economics.rebalanceCostUsd - previousRebalanceCostUsd
        );
        accumulatedEconomics = nextCost.economics;
        if (incrementalRebalanceCostUsd <= 0) {
          break;
        }
        result = await this.engine.tick(nextCost.input, { execute: false });
        const nextActionType = result.decision.chosen?.type;
        if (nextActionType === lastActionType || !nextActionType) {
          break;
        }
        lastActionType = nextActionType;
      }

      outcomes.push(this.createOutcome(scenario, result, allocation, accumulatedEconomics));
    }

    const baseline = outcomes[0];

    if (!baseline) {
      throw new Error("Shadow Mode requires at least one scenario.");
    }

    const uniqueActions: PlannedAction[] = [];

    for (const outcome of outcomes) {
      const alreadyIncluded = uniqueActions.some(
        (action) => action.type === outcome.result.decision.chosen.type
      );

      if (!alreadyIncluded) {
        uniqueActions.push(outcome.result.decision.chosen);
      }
    }

    const breakwaterTrigger =
      outcomes.find((outcome) => (
        outcome.scenario.drawdownPct > 0 &&
        OPERATING_STATE_SEVERITY[outcome.operatingState] >= OPERATING_STATE_SEVERITY[OperatingState.DeRisk]
      ))?.scenario.drawdownPct ?? null;

    const worstOperatingState = outcomes.reduce((worst, outcome) => {
      return OPERATING_STATE_SEVERITY[outcome.operatingState] > OPERATING_STATE_SEVERITY[worst]
        ? outcome.operatingState
        : worst;
    }, OperatingState.Observe);

    const sustainableValues = outcomes.map(
      (outcome) => outcome.result.decision.risk.sustainableMonthlyPayoutUsd
    );
    const liquidationOutcome = outcomes.reduce<ShadowScenarioOutcome | null>((worst, outcome) => {
      if (!outcome.economics.liquidationTriggered) {
        return worst;
      }
      if (!worst) {
        return outcome;
      }
      return outcome.economics.liquidationPenaltyUsd > worst.economics.liquidationPenaltyUsd
        ? outcome
        : worst;
    }, null);
    const railWarnings = [...new Set(outcomes.flatMap((outcome) => outcome.allocation?.warnings ?? []))];
    const liveRailCount = baseRails.filter((rail) => rail.source !== "fixture").length;
    const railDataMode: RailDataMode =
      liveRailCount === 0
        ? "fixture"
        : liveRailCount === baseRails.length
          ? "live"
          : "mixed";
    const railUpdateTimestamps = baseRails
      .map((rail) => Date.parse(rail.updatedAt))
      .filter((value) => Number.isFinite(value) && value > 0);
    const oldestRailUpdateAt =
      railUpdateTimestamps.length > 0
        ? new Date(Math.min(...railUpdateTimestamps)).toISOString()
        : undefined;
    const freshestRailUpdateAt =
      railUpdateTimestamps.length > 0
        ? new Date(Math.max(...railUpdateTimestamps)).toISOString()
        : undefined;

    return {
      generatedAt: new Date().toISOString(),
      baseline,
      scenarios: outcomes,
      summary: {
        survivablePayoutBandLowUsd: roundUsd(minValue(sustainableValues)),
        survivablePayoutBandHighUsd: roundUsd(
          Math.max(
            baseline.result.decision.risk.sustainableMonthlyPayoutUsd,
            minValue(sustainableValues)
          )
        ),
        currentLtv: roundPct(baseline.result.decision.risk.ltv),
        bufferCoverageDays: Math.round(baseline.bufferCoverageDays),
        baselineHorizonDays: baseline.economics.horizonDays,
        baselineCarryCostUsd: baseline.economics.carryCostUsd,
        baselineRebalanceCostUsd: baseline.economics.rebalanceCostUsd,
        breakwaterTriggerDrawdownPct: breakwaterTrigger,
        averageHealthScore: Math.round(average(outcomes.map((outcome) => outcome.health.score))),
        worstOperatingState,
        worstCaseTotalDragUsd: roundUsd(Math.max(...outcomes.map((outcome) => outcome.economics.totalDragUsd))),
        worstCaseLiquidationPenaltyUsd: roundUsd(
          Math.max(...outcomes.map((outcome) => outcome.economics.liquidationPenaltyUsd))
        ),
        liquidationScenarioLabel: liquidationOutcome?.scenario.label,
        // Platform-fee preview — honest take-rate visibility so the
        // Readout shows the *TIDE* fee alongside rail cost, debt carry,
        // and rebalance drag. Rate is the S2+ target in the pricing
        // ladder (0.75% annual mgmt fee on managed debt). Updated in
        // one place; Readout reads from summary.
        projectedTideFeeBpsAnnual: TIDE_PLATFORM_FEE_BPS_ANNUAL,
        projectedTideFeeUsd30d: roundUsd(
          Math.max(0, baseline.result.input.portfolio.debtUsd)
          * (TIDE_PLATFORM_FEE_BPS_ANNUAL / 10_000)
          * (30 / 365)
        ),
        projectedTideFeePctOfPayout: roundPct(
          baseline.result.input.policy.monthlyPayoutTargetUsd > 0
            ? (Math.max(0, baseline.result.input.portfolio.debtUsd)
                * (TIDE_PLATFORM_FEE_BPS_ANNUAL / 10_000)
                * (30 / 365))
              / baseline.result.input.policy.monthlyPayoutTargetUsd
            : 0
        ),
        actionExamples: uniqueActions.slice(0, 4),
        primaryRailId: baseline.allocation?.primary?.rail.id,
        primaryRailName: baseline.allocation?.primary?.rail.name,
        backupRailId: baseline.allocation?.backup?.rail.id,
        backupRailName: baseline.allocation?.backup?.rail.name,
        railWarnings: railWarnings.slice(0, 6),
        railDataMode,
        railCount: baseRails.length,
        liveRailCount,
        oldestRailUpdateAt,
        freshestRailUpdateAt,
      },
    };
  }

  private createOutcome(
    scenario: ShadowScenarioDefinition,
    result: EngineResult,
    allocation?: RailAllocationDecision,
    economics: ShadowScenarioEconomics = createZeroEconomics(
      deriveShadowScenarioHorizonDays(scenario)
    )
  ): ShadowScenarioOutcome {
    const operatingState = deriveOperatingState(result.input, result.decision);
    const health = evaluatePolicyHealth(result.input, result.decision);
    const payoutBand = projectPayoutBand(result);
    const bufferCoverageMonths = calculateBufferCoverageMonths(
      result.input.portfolio.stableBufferUsd,
      result.input.policy.monthlyPayoutTargetUsd
    );

    return {
      scenario,
      operatingState,
      health,
      payoutBandLowUsd: payoutBand.lowUsd,
      payoutBandHighUsd: payoutBand.highUsd,
      bufferCoverageMonths,
      bufferCoverageDays: roundUsd(bufferCoverageMonths * 30.4),
      economics,
      result,
      allocation,
    };
  }
}

// -------------------------
// Example usage
// -------------------------

async function demo(): Promise<EngineResult> {
  const engine = new TideEngine();

  const input: EngineInput = {
    now: new Date().toISOString(),
    policy: {
      mode: UserMode.Income,
      priority: RiskPriority.BTCPreservation,
      maxLtv: 0.32,
      targetLtvLow: 0.18,
      targetLtvHigh: 0.24,
      minStableBufferUsd: 1500,
      desiredRunwayMonths: 3,
      monthlyPayoutTargetUsd: 500,
      allowPayoutPauseInStress: true,
      maxSingleVenueExposurePct: 0.70,
      maxWrapperExposurePct: 0.80,
      autoRepayLtv: 0.27,
      emergencyLtv: 0.30,
      minOracleConfidence: 0.90,
      minLiquidityScore: 0.75,
      allowNewBorrowInStress: false,
      allowNewBorrowInCrisis: false,
    },
    portfolio: {
      btcUnits: 1.0,
      btcPriceUsd: 90000,
      collateralUsd: 90000,
      debtUsd: 22000,
      stableBufferUsd: 800,
      venueExposurePct: 0.65,
      wrapperExposurePct: 0.70,
    },
    market: {
      realizedVol30d: 0.88,
      dailyMovePctAbs: 0.042,
      weeklyDrawdownPct: 0.09,
      trendStrength: 0.58,
    },
    venues: [
      {
        name: "PrimaryRail",
        healthy: true,
        oracleConfidence: 0.95,
        liquidityScore: 0.82,
        healthScore: 0.88,
      },
    ],
  };

  const result = await engine.tick(input, { execute: false });

  return result;
}

if (
  typeof require !== "undefined" &&
  typeof module !== "undefined" &&
  require.main === module
) {
  demo().catch(() => {
    process.exit(1);
  });
}
