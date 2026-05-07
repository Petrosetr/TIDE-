// Judge entry point fixtures for the `?judge=stress|revoke|oracle-stale` URL
// routes. These deterministic scenarios keep the same demo path stable across
// takes.
//
// Each fixture is a complete scenario snapshot:
//   - readback (Suilend live-read-back-shape OR fixture-shape)
//   - oracle (Pyth read-back-shape, possibly stale)
//   - portfolio (collateralUsd, debtUsd, btcPriceUsd)
//   - decisionExpected (the planner verdict the renderer should show)
//   - guardFired (which fail-closed guard the demo demonstrates)
//   - trustLabel (operator-readable string the UI must render verbatim)
//
// Pure JS — no network, no DOM, no app.js dependency. All randomness
// is removed; every snapshot is deterministic so a video re-record
// hits the same state across takes.

import {
  buildFixtureSuilendReadback,
  SUILEND_READBACK_SHAPE_VERSION,
} from "./suilend-readback.mjs";
import {
  buildFixturePythReadback,
  PYTH_READBACK_SHAPE_VERSION,
} from "./pyth-readback.mjs";

export const JUDGE_FIXTURE_SCHEMA_VERSION = 1;

// Stable scenario id list. Adding a new scenario means appending here and
// adding the corresponding case in buildJudgeFixture.
export const JUDGE_FIXTURE_IDS = Object.freeze([
  "stress",       // collateral down, LTV high → EmergencyDeRisk verdict
  "revoke",       // rail revoked between simulator and mint → N2 fail-closed
  "oracle-stale", // Pyth publishTime > 10 min ago → forecast-stale guard refusal
  "default",      // calm baseline; for fall-through and tests
]);

const FIXED_OBSERVED_AT = "2026-04-29T08:00:00.000Z"; // deterministic for video takes

// Helper: build a snapshot for the calm baseline (`?judge` or `?judge=default`).
function buildDefaultFixture() {
  const readback = buildFixtureSuilendReadback({
    railId: "suilend-sui",
    walletAddress: "0x" + "11".repeat(32),
    collateralUsd: 100_000,
    debtUsd: 14_000,
    observedAt: FIXED_OBSERVED_AT,
    trustLabel: "Modeled scenario — calm baseline. Not on-chain. Not execution.",
  });
  const oracle = buildFixturePythReadback({
    feedSymbol: "BTC/USD",
    priceUsd: 78_000,
    confidenceUsd: 60,
    publishTimeMs: Date.parse(FIXED_OBSERVED_AT) - 1_000,
    observedAt: FIXED_OBSERVED_AT,
    staleMaxMs: 60_000,
    trustLabel: "Modeled BTC/USD — calm baseline.",
  });
  return {
    schemaVersion: JUDGE_FIXTURE_SCHEMA_VERSION,
    fixtureId: "default",
    readback,
    oracle,
    portfolio: {
      btcUnits: 1.4,
      btcPriceUsd: oracle.priceUsd,
      collateralUsd: readback.collateralUsd,
      debtUsd: readback.debtUsd,
      stableBufferUsd: 5_000,
    },
    decisionExpected: "Hold",
    guardFired: null, // calm path — no guard demonstrates
    trustLabel: "Modeled scenario. Not on-chain. Not execution.",
    narration: "Default scenario: position is inside policy band; planner returns Hold.",
  };
}

// `?judge=stress` — crisis baseline: collateral has dropped, LTV is at
// the auto-repay/emergency threshold, planner should emit EmergencyDeRisk.
function buildStressFixture() {
  const readback = buildFixtureSuilendReadback({
    railId: "suilend-sui",
    walletAddress: "0x" + "22".repeat(32),
    collateralUsd: 95_000,    // BTC drawdown vs 100k baseline
    debtUsd: 30_400,          // LTV = 32% — above emergency threshold
    observedAt: FIXED_OBSERVED_AT,
    trustLabel: "Modeled crisis scenario. Not on-chain. Not execution.",
  });
  const oracle = buildFixturePythReadback({
    feedSymbol: "BTC/USD",
    priceUsd: 67_500,         // BTC down ~14% vs default
    confidenceUsd: 180,       // wider confidence under stress
    publishTimeMs: Date.parse(FIXED_OBSERVED_AT) - 2_000,
    observedAt: FIXED_OBSERVED_AT,
    staleMaxMs: 60_000,
    trustLabel: "Modeled BTC/USD under stress.",
  });
  return {
    schemaVersion: JUDGE_FIXTURE_SCHEMA_VERSION,
    fixtureId: "stress",
    readback,
    oracle,
    portfolio: {
      btcUnits: 1.4,
      btcPriceUsd: oracle.priceUsd,
      collateralUsd: readback.collateralUsd,
      debtUsd: readback.debtUsd,
      stableBufferUsd: 1_500, // buffer drawn down
    },
    decisionExpected: "EmergencyDeRisk",
    guardFired: null, // not a guard refusal — just shows the engine reaching the crisis state
    trustLabel: "Crisis scenario — modeled. Decision engine reaches EmergencyDeRisk.",
    narration:
      "Stress scenario: BTC drawdown drives LTV above the emergency threshold. " +
      "Planner emits EmergencyDeRisk; receipt mint is permitted, the demo shows the " +
      "decision being attested as a testnet receipt.",
  };
}

// `?judge=revoke` — the revoke-then-mint race. Receipt mint must abort
// because the rail was revoked between select_rail and mint_receipt
// (Move N2 guard, E_RAIL_NOT_ALLOWED). Fixture exposes the policy id
// + the (now-revoked) rail id; the demo runner attempts mint and the
// renderer surfaces the abort.
function buildRevokeFixture() {
  const readback = buildFixtureSuilendReadback({
    railId: "scallop-sui",
    walletAddress: "0x" + "33".repeat(32),
    collateralUsd: 100_000,
    debtUsd: 28_000,
    observedAt: FIXED_OBSERVED_AT,
    trustLabel: "Modeled scenario — revoke race. Not on-chain. Not execution.",
  });
  const oracle = buildFixturePythReadback({
    feedSymbol: "BTC/USD",
    priceUsd: 78_000,
    confidenceUsd: 60,
    publishTimeMs: Date.parse(FIXED_OBSERVED_AT) - 1_000,
    observedAt: FIXED_OBSERVED_AT,
    staleMaxMs: 60_000,
    trustLabel: "Modeled BTC/USD — calm at simulation time.",
  });
  return {
    schemaVersion: JUDGE_FIXTURE_SCHEMA_VERSION,
    fixtureId: "revoke",
    readback,
    oracle,
    portfolio: {
      btcUnits: 1.4,
      btcPriceUsd: oracle.priceUsd,
      collateralUsd: readback.collateralUsd,
      debtUsd: readback.debtUsd,
      stableBufferUsd: 5_000,
    },
    railRevoked: "scallop-sui", // operator simulated this rail being admin-revoked
    decisionExpected: "PartialRepay", // planner decision was to repay via scallop, but…
    guardFired: "N2", // …mint aborts: E_RAIL_NOT_ALLOWED
    expectedAbortCode: "E_RAIL_NOT_ALLOWED",
    trustLabel:
      "Revoke-race scenario — modeled. Mint should abort with N2 (E_RAIL_NOT_ALLOWED). " +
      "Demonstrates the on-chain allowlist re-check at mint time.",
    narration:
      "Revoke scenario: simulator picks scallop-sui, admin revokes scallop-sui from " +
      "the allowlist between simulation and mint, mint_receipt aborts on-chain with " +
      "E_RAIL_NOT_ALLOWED. The receipt is never created; the demo surfaces the abort " +
      "with a clear 'guard N2 fired' label.",
  };
}

// `?judge=oracle-stale` — Pyth publishTime older than the freshness
// window. The receipt-mint builder refuses (assertForecastIsFresh from
// F-U-A-4) before any RPC is sent.
function buildOracleStaleFixture() {
  const tenMinutesAgoMs = Date.parse(FIXED_OBSERVED_AT) - 10 * 60 * 1000;
  const readback = buildFixtureSuilendReadback({
    railId: "suilend-sui",
    walletAddress: "0x" + "44".repeat(32),
    collateralUsd: 100_000,
    debtUsd: 28_000,
    observedAt: FIXED_OBSERVED_AT,
    trustLabel: "Modeled scenario — oracle stall. Not on-chain. Not execution.",
  });
  const oracle = buildFixturePythReadback({
    feedSymbol: "BTC/USD",
    priceUsd: 78_000,
    confidenceUsd: 60,
    publishTimeMs: tenMinutesAgoMs,
    observedAt: FIXED_OBSERVED_AT,
    staleMaxMs: 60_000,
    trustLabel: "Modeled BTC/USD — stale: rolled back 10 min for the demo.",
  });
  return {
    schemaVersion: JUDGE_FIXTURE_SCHEMA_VERSION,
    fixtureId: "oracle-stale",
    readback,
    oracle,
    portfolio: {
      btcUnits: 1.4,
      btcPriceUsd: oracle.priceUsd,
      collateralUsd: readback.collateralUsd,
      debtUsd: readback.debtUsd,
      stableBufferUsd: 5_000,
    },
    decisionExpected: "PartialRepay", // engine would have wanted PartialRepay, but…
    guardFired: "stale-forecast", // …builder refuses before any RPC
    expectedAbortCode: "Forecast is stale",
    trustLabel:
      "Oracle-stale scenario — modeled. Builder-level stale-forecast guard refuses " +
      "the mint before any PTB is sent.",
    narration:
      "Oracle-stale scenario: Pyth publishTime is 10 minutes old, beyond the 60s " +
      "freshness window. assertForecastIsFresh in execution-receipts.mjs throws " +
      "before the PTB is constructed; the renderer surfaces 'forecast stale, refresh " +
      "before minting'. No on-chain transaction; no partial state.",
  };
}

const BUILDERS = Object.freeze({
  default: buildDefaultFixture,
  stress: buildStressFixture,
  revoke: buildRevokeFixture,
  "oracle-stale": buildOracleStaleFixture,
});

export function buildJudgeFixture(fixtureId) {
  const id = typeof fixtureId === "string" ? fixtureId.toLowerCase() : "";
  const builder = BUILDERS[id] || BUILDERS.default;
  return builder();
}

// All fixture builders share these invariants — the renderer can rely
// on them without case-by-case code.
export const JUDGE_FIXTURE_INVARIANTS = Object.freeze({
  observedAt: FIXED_OBSERVED_AT,
  oracleStaleMaxMs: 60_000,
  suilendReadbackVersion: SUILEND_READBACK_SHAPE_VERSION,
  pythReadbackVersion: PYTH_READBACK_SHAPE_VERSION,
});
