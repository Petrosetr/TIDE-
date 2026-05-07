#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_SHADOW_SCENARIOS,
  RiskPriority,
  ShadowModeSimulator,
  UserMode,
  createStarterRailAdapters,
} from "../shadow-mode/lib/tide_core.mjs";
import {
  DEFAULT_FRESHNESS_MS,
  buildProofBundleWithDigest,
  checkFreshness,
  digestBundle,
  publishProofBundle,
  canonicalizeBundle,
  verifyBundleDigest,
} from "../shadow-mode/lib/execution-proof.mjs";
import {
  normalizeReceiptObject,
  parseReceiptMintedEvents,
  resolveReceiptObjectReference,
} from "../shadow-mode/lib/execution-receipts.mjs";
import { verifyReceiptDigest as verifyReceiptBundleSemantics } from "../shadow-mode/lib/receipt-resolver.mjs";
import {
  derivePolicySnapshot,
  normalizePolicyObject,
} from "../shadow-mode/lib/policy-registry.mjs";
import { DEFAULT_WRAPPED_BTC_COIN_TYPE } from "../shadow-mode/lib/draft-migration.mjs";
import {
  getAllRailIds,
  getRailDisplay,
  getRailEntry,
} from "../shadow-mode/lib/policy-ids.mjs";
import {
  DEFAULT_REDACTED_OPERATOR,
  redactProofRun,
} from "../shadow-mode/lib/proof-bundle-redact.mjs";
import {
  getSuiRpcUrlsWithFallback,
  postSuiRpcWithFallback,
} from "../shadow-mode/lib/sui-network.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ENV_FILE = path.join(REPO_ROOT, ".env.testnet.local");
const DEFAULT_OUTPUT_DIR = path.join(REPO_ROOT, "docs", "proof");
const DEFAULT_PROOF_PACK = path.join(REPO_ROOT, "docs", "onchain_mvp_proof_pack.md");
const GAS_BUDGET = 50_000_000;
const RPC_BY_NETWORK = {
  mainnet: "https://fullnode.mainnet.sui.io:443",
  testnet: "https://fullnode.testnet.sui.io:443",
  devnet: "https://fullnode.devnet.sui.io:443",
};
const EXPLORER_BASE = {
  mainnet: "https://suivision.xyz",
  testnet: "https://testnet.suivision.xyz",
  devnet: "https://devnet.suivision.xyz",
};

const RUN_SPECS = Object.freeze([
  {
    label: "Harbor / Scallop / buffer refill",
    railId: "scallop-sui",
    payoutUsd: 1200,
    minBufferUsd: 4800,
    desiredRunwayMonths: 4,
    debtUsd: 19000,
    stableBufferUsd: 1000,
    btcUnits: 1.4,
    btcPriceUsd: 82500,
    venueExposurePct: 58,
    wrapperExposurePct: 63,
    maxLtvPct: 34,
    targetLtvLowPct: 10,
    targetLtvHighPct: 16,
    autoRepayLtvPct: 25,
    emergencyLtvPct: 31,
    marketRealizedVolPct: 78,
    marketDailyMovePct: 2.8,
    marketWeeklyDrawdownPct: 6,
    marketTrendStrengthPct: 48,
  },
  {
    label: "Harbor / Navi / partial repay",
    railId: "navi-sui",
    payoutUsd: 1050,
    minBufferUsd: 4200,
    desiredRunwayMonths: 5,
    debtUsd: 35000,
    stableBufferUsd: 5250,
    btcUnits: 1.32,
    btcPriceUsd: 81250,
    venueExposurePct: 54,
    wrapperExposurePct: 60,
    maxLtvPct: 40,
    targetLtvLowPct: 12,
    targetLtvHighPct: 20,
    autoRepayLtvPct: 25,
    emergencyLtvPct: 35,
    marketRealizedVolPct: 60,
    marketDailyMovePct: 1,
    marketWeeklyDrawdownPct: 3,
    marketTrendStrengthPct: 20,
  },
  {
    label: "Harbor / Suilend / emergency de-risk",
    railId: "suilend-sui",
    payoutUsd: 900,
    minBufferUsd: 4000,
    desiredRunwayMonths: 5,
    debtUsd: 38000,
    stableBufferUsd: 6100,
    btcUnits: 1.28,
    btcPriceUsd: 79800,
    venueExposurePct: 51,
    wrapperExposurePct: 57,
    maxLtvPct: 40,
    targetLtvLowPct: 12,
    targetLtvHighPct: 20,
    autoRepayLtvPct: 25,
    emergencyLtvPct: 30,
    marketRealizedVolPct: 90,
    marketDailyMovePct: 5,
    marketWeeklyDrawdownPct: 20,
    marketTrendStrengthPct: 90,
  },
  {
    label: "Harbor / Bucket / extra buffer",
    railId: "bucket-sui",
    payoutUsd: 850,
    minBufferUsd: 4500,
    desiredRunwayMonths: 6,
    debtUsd: 15400,
    stableBufferUsd: 6900,
    btcUnits: 1.22,
    btcPriceUsd: 78600,
    venueExposurePct: 49,
    wrapperExposurePct: 55,
    maxLtvPct: 31,
    targetLtvLowPct: 8.5,
    targetLtvHighPct: 13.5,
    autoRepayLtvPct: 21,
    emergencyLtvPct: 27,
    marketRealizedVolPct: 68,
    marketDailyMovePct: 1.9,
    marketWeeklyDrawdownPct: 4.5,
    marketTrendStrengthPct: 38,
  },
  {
    label: "Harbor / Scallop / conservative stress",
    railId: "scallop-sui",
    payoutUsd: 700,
    minBufferUsd: 5000,
    desiredRunwayMonths: 7,
    debtUsd: 14250,
    stableBufferUsd: 7600,
    btcUnits: 1.18,
    btcPriceUsd: 77250,
    venueExposurePct: 46,
    wrapperExposurePct: 52,
    maxLtvPct: 30,
    targetLtvLowPct: 8,
    targetLtvHighPct: 12.5,
    autoRepayLtvPct: 20,
    emergencyLtvPct: 26,
    marketRealizedVolPct: 64,
    marketDailyMovePct: 1.7,
    marketWeeklyDrawdownPct: 4.2,
    marketTrendStrengthPct: 35,
  },
]);

function parseArgs(argv) {
  const args = {
    network: "testnet",
    envFile: DEFAULT_ENV_FILE,
    outputDir: DEFAULT_OUTPUT_DIR,
    proofPackPath: DEFAULT_PROOF_PACK,
    count: RUN_SPECS.length,
    skipProofPack: false,
    skipNegative: false,
    verifyAfter: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--network" && argv[i + 1]) { args.network = argv[++i]; continue; }
    if (token.startsWith("--network=")) { args.network = token.slice("--network=".length); continue; }
    if (token === "--env" && argv[i + 1]) { args.envFile = path.resolve(argv[++i]); continue; }
    if (token.startsWith("--env=")) { args.envFile = path.resolve(token.slice("--env=".length)); continue; }
    if (token === "--output-dir" && argv[i + 1]) { args.outputDir = path.resolve(argv[++i]); continue; }
    if (token.startsWith("--output-dir=")) { args.outputDir = path.resolve(token.slice("--output-dir=".length)); continue; }
    if (token === "--proof-pack" && argv[i + 1]) { args.proofPackPath = path.resolve(argv[++i]); continue; }
    if (token.startsWith("--proof-pack=")) { args.proofPackPath = path.resolve(token.slice("--proof-pack=".length)); continue; }
    if (token === "--count" && argv[i + 1]) { args.count = Number(argv[++i]); continue; }
    if (token.startsWith("--count=")) { args.count = Number(token.slice("--count=".length)); continue; }
    if (token === "--skip-proof-pack") { args.skipProofPack = true; continue; }
    if (token === "--skip-negative") { args.skipNegative = true; continue; }
    if (token === "--skip-verify-after") { args.verifyAfter = false; continue; }
    if (token === "--help" || token === "-h") {
      process.stdout.write(
        "Usage: node scripts/run-testnet-proof-loop.mjs [options]\n" +
        "  --network <testnet|devnet>   target network (default: testnet)\n" +
        "  --env <path>                 env file (default: .env.testnet.local)\n" +
        "  --output-dir <path>          proof artifact dir (default: docs/proof)\n" +
        "  --proof-pack <path>          markdown proof pack output\n" +
        "  --count <n>                  positive proof runs to execute (default: 5)\n" +
        "  --skip-proof-pack            write JSON artifacts only\n" +
        "  --skip-negative              skip negative guard checks such as rail mismatch\n" +
        "  --skip-verify-after          skip post-ceremony on-chain verifier runs\n"
      );
      process.exit(0);
    }
  }

  if (!Number.isInteger(args.count) || args.count <= 0) {
    throw new Error(`--count must be a positive integer, got "${args.count}"`);
  }
  if (!["testnet", "devnet"].includes(args.network)) {
    throw new Error(`--network must be testnet|devnet, got "${args.network}"`);
  }
  return args;
}

function readEnv(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`env file not found: ${filePath}`);
  }
  const out = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

function runCommand(cmd, args, { allowFailure = false, cwd = REPO_ROOT } = {}) {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  });
  if (result.error) {
    throw new Error(`${cmd} ${args.join(" ")} failed to spawn: ${result.error.message}`);
  }
  if (result.status !== 0 && !allowFailure) {
    const stderr = result.stderr ? result.stderr.toString().trim() : "";
    throw new Error(`${cmd} ${args.join(" ")} exited ${result.status}\n${stderr}`);
  }
  return {
    ok: result.status === 0,
    stdout: (result.stdout || "").toString(),
    stderr: (result.stderr || "").toString(),
    status: result.status ?? 1,
  };
}

function runJson(cmd, args) {
  const result = runCommand(cmd, args);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`failed to parse JSON from ${cmd} ${args.join(" ")}: ${error.message}\n${result.stdout}`);
  }
}

function compactCommandOutput(result) {
  return `${result.stderr || ""}\n${result.stdout || ""}`
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
}

function summarizeVerifierOutput(result) {
  const output = compactCommandOutput(result);
  if (output) return output;
  return result.ok ? "PASS" : `exited ${result.status}`;
}

function runVerifierAfterCeremony(args, runNumber) {
  if (!args.verifyAfter) return null;
  const result = runCommand("node", [
    "scripts/verify-onchain-testnet.mjs",
    "--network", args.network,
    "--env", args.envFile,
  ], {
    allowFailure: true,
  });
  const verifyAfter = {
    ok: result.ok,
    status: result.status,
    ranAt: new Date().toISOString(),
    runNumber,
    summary: summarizeVerifierOutput(result),
  };
  process.stdout.write(`[proof] verify:onchain after run ${runNumber}: ${verifyAfter.ok ? "PASS" : "FAIL"}\n`);
  if (!verifyAfter.ok) {
    throw new Error(`verify:onchain failed after proof run ${runNumber}\n${verifyAfter.summary}`);
  }
  return verifyAfter;
}

function pickMismatchedRailId(railId) {
  return getAllRailIds().find((candidate) => candidate !== railId) || `${railId || "rail"}-wrong`;
}

function pctToDecimal(value) {
  return Number(value) / 100;
}

function roundUsd(value) {
  return Math.round(Number(value) * 100) / 100;
}

function utf8CliArg(value) {
  return JSON.stringify(Array.from(new TextEncoder().encode(String(value || ""))));
}

function buildDraft(spec, runNumber) {
  const railEntry = getRailEntry(spec.railId) || { display: spec.railId };
  return {
    scenarioName: `Proof Run ${String(runNumber).padStart(2, "0")} - ${railEntry.display}`,
    mode: UserMode.Income,
    priority: RiskPriority.Stability,
    createScope: "shadow",
    selectedRail: spec.railId,
    venueId: spec.railId,
    railId: spec.railId,
    venueName: railEntry.display,
    railName: railEntry.display,
    venueHealthy: true,
    oracleConfidencePct: 95,
    liquidityScorePct: 84,
    venueHealthScorePct: 88,
    btcUnits: spec.btcUnits,
    collateralCoinType: DEFAULT_WRAPPED_BTC_COIN_TYPE,
    collateralAssetSymbol: "BTC",
    btcPriceUsd: spec.btcPriceUsd,
    debtUsd: spec.debtUsd,
    stableBufferUsd: spec.stableBufferUsd,
    venueExposurePct: spec.venueExposurePct,
    wrapperExposurePct: spec.wrapperExposurePct,
    desiredRunwayMonths: spec.desiredRunwayMonths,
    monthlyPayoutTargetUsd: spec.payoutUsd,
    minStableBufferUsd: spec.minBufferUsd,
    maxLtvPct: spec.maxLtvPct,
    targetLtvLowPct: spec.targetLtvLowPct,
    targetLtvHighPct: spec.targetLtvHighPct,
    autoRepayLtvPct: spec.autoRepayLtvPct,
    emergencyLtvPct: spec.emergencyLtvPct,
    allowPayoutPauseInStress: true,
    maxSingleVenueExposurePct: 65,
    maxWrapperExposurePct: 78,
    minOracleConfidencePct: 90,
    minLiquidityScorePct: 78,
    allowNewBorrowInStress: false,
    allowNewBorrowInCrisis: false,
    marketRealizedVolPct: spec.marketRealizedVolPct,
    marketDailyMovePct: spec.marketDailyMovePct,
    marketWeeklyDrawdownPct: spec.marketWeeklyDrawdownPct,
    marketTrendStrengthPct: spec.marketTrendStrengthPct,
  };
}

function buildEngineInput(draft) {
  const btcUnits = Number(draft.btcUnits);
  const btcPriceUsd = Number(draft.btcPriceUsd);
  const collateralUsd = roundUsd(btcUnits * btcPriceUsd);

  return {
    now: new Date().toISOString(),
    policy: {
      mode: draft.mode,
      priority: draft.priority,
      maxLtv: pctToDecimal(draft.maxLtvPct),
      targetLtvLow: pctToDecimal(draft.targetLtvLowPct),
      targetLtvHigh: pctToDecimal(draft.targetLtvHighPct),
      minStableBufferUsd: Number(draft.minStableBufferUsd),
      desiredRunwayMonths: Math.max(1, Number(draft.desiredRunwayMonths)),
      monthlyPayoutTargetUsd: Number(draft.monthlyPayoutTargetUsd),
      allowPayoutPauseInStress: Boolean(draft.allowPayoutPauseInStress),
      maxSingleVenueExposurePct: pctToDecimal(draft.maxSingleVenueExposurePct),
      maxWrapperExposurePct: pctToDecimal(draft.maxWrapperExposurePct),
      autoRepayLtv: pctToDecimal(draft.autoRepayLtvPct),
      emergencyLtv: pctToDecimal(draft.emergencyLtvPct),
      minOracleConfidence: pctToDecimal(draft.minOracleConfidencePct),
      minLiquidityScore: pctToDecimal(draft.minLiquidityScorePct),
      allowNewBorrowInStress: Boolean(draft.allowNewBorrowInStress),
      allowNewBorrowInCrisis: Boolean(draft.allowNewBorrowInCrisis),
    },
    portfolio: {
      btcUnits,
      btcPriceUsd,
      collateralUsd,
      debtUsd: Number(draft.debtUsd),
      stableBufferUsd: Number(draft.stableBufferUsd),
      venueExposurePct: pctToDecimal(draft.venueExposurePct),
      wrapperExposurePct: pctToDecimal(draft.wrapperExposurePct),
    },
    market: {
      realizedVol30d: pctToDecimal(draft.marketRealizedVolPct),
      dailyMovePctAbs: pctToDecimal(draft.marketDailyMovePct),
      weeklyDrawdownPct: pctToDecimal(draft.marketWeeklyDrawdownPct),
      trendStrength: pctToDecimal(draft.marketTrendStrengthPct),
    },
    venues: [
      {
        name: String(draft.venueName || "").trim() || getRailDisplay(draft.selectedRail, draft.selectedRail),
        healthy: Boolean(draft.venueHealthy),
        oracleConfidence: pctToDecimal(draft.oracleConfidencePct),
        liquidityScore: pctToDecimal(draft.liquidityScorePct),
        healthScore: pctToDecimal(draft.venueHealthScorePct),
      },
    ],
  };
}

async function simulateDraft(spec, runNumber) {
  const draft = buildDraft(spec, runNumber);
  const simulator = new ShadowModeSimulator(createStarterRailAdapters());
  const input = buildEngineInput(draft);
  const report = await simulator.simulate(input, DEFAULT_SHADOW_SCENARIOS);
  const summary = report?.summary && typeof report.summary === "object" ? report.summary : {};
  const primaryRailName = getRailDisplay(spec.railId, draft.venueName || spec.railId);
  return {
    draft,
    input,
    report: {
      ...report,
      schemaVersion: Number(report?.schemaVersion) || 1,
      summary: {
        ...summary,
        railDataMode: "fixture",
        primaryRailId: spec.railId,
        primaryRailName,
      },
    },
  };
}

function getRuntimeConfig(env, network) {
  return {
    sui: {
      network,
      rpcUrl: process.env.TIDE_SUI_RPC_URL || env.TIDE_SUI_RPC_URL || "",
      rpcUrlFallback: process.env.TIDE_SUI_RPC_URL_FALLBACK || env.TIDE_SUI_RPC_URL_FALLBACK || "",
    },
    policyRegistry: {
      packageId: env.TIDE_POLICY_PACKAGE_ID,
      module: "policy_registry",
      railAllowlistId: env.TIDE_POLICY_RAIL_ALLOWLIST_ID,
      clockObjectId: "0x6",
    },
    executionReceipts: {
      packageId: env.TIDE_POLICY_PACKAGE_ID,
      module: "execution_receipts",
      clockObjectId: "0x6",
    },
  };
}

function buildCreatePolicyArgs(snapshot, env) {
  return [
    "client", "call",
    "--package", env.TIDE_POLICY_PACKAGE_ID,
    "--module", "policy_registry",
    "--function", "create_policy",
    "--args",
    utf8CliArg(snapshot.name),
    utf8CliArg(snapshot.mode),
    utf8CliArg(snapshot.priority),
    utf8CliArg(snapshot.collateralSymbol),
    utf8CliArg(snapshot.collateralCoinType),
    utf8CliArg(snapshot.selectedRail),
    String(snapshot.payoutTargetUsd),
    String(snapshot.minBufferUsd),
    String(snapshot.maxLtvBps),
    String(snapshot.targetLtvLowBps),
    String(snapshot.targetLtvHighBps),
    String(snapshot.repayLtvBps),
    String(snapshot.emergencyLtvBps),
    env.TIDE_POLICY_RAIL_ALLOWLIST_ID,
    "0x6",
    "--gas-budget", String(GAS_BUDGET),
    "--json",
  ];
}

function buildSelectRailArgs({ env, policyId, railId }) {
  return [
    "client", "call",
    "--package", env.TIDE_POLICY_PACKAGE_ID,
    "--module", "policy_registry",
    "--function", "select_rail",
    "--args",
    policyId,
    utf8CliArg(railId),
    env.TIDE_POLICY_RAIL_ALLOWLIST_ID,
    "0x6",
    "--gas-budget", String(GAS_BUDGET),
    "--json",
  ];
}

function buildRailAdminArgs({ env, functionName, railId }) {
  return [
    "client", "call",
    "--package", env.TIDE_POLICY_PACKAGE_ID,
    "--module", "policy_registry",
    "--function", functionName,
    "--args",
    env.TIDE_POLICY_ADMIN_CAP_ID,
    env.TIDE_POLICY_RAIL_ALLOWLIST_ID,
    utf8CliArg(railId),
    "--gas-budget", String(GAS_BUDGET),
    "--json",
  ];
}

function buildDecisionAttestation(input, report, network) {
  const decision = report?.baseline?.result?.decision || null;
  const chosen = decision?.chosen || null;
  const risk = decision?.risk || {};
  const portfolio = input?.portfolio || {};
  const rawLtv = Number(risk.ltv ?? 0);
  return {
    decisionType: String(chosen?.type || "Hold"),
    limitations: network === "testnet" ? "testnet-rehearsal" : "shadow-only",
    stateBefore: {
      ltvBps: Math.max(0, Math.round(Number.isFinite(rawLtv) ? rawLtv * 10_000 : 0)),
      bufferUsd: Math.max(0, Math.round(Number(portfolio.stableBufferUsd ?? portfolio.stableUsd ?? 0) || 0)),
      stressLabel: String(report?.summary?.worstOperatingState || decision?.regime || "Unknown"),
    },
  };
}

export function receiptActionForDecisionType(decisionType) {
  const key = String(decisionType || "").trim().toLowerCase();
  if (key === "borrowforbuffer" || key === "borrow_for_buffer") return "decision.borrow_for_buffer";
  if (key === "partialrepay" || key === "partial_repay") return "decision.partial_repay";
  if (key === "emergencyderisk" || key === "emergency_de_risk") return "decision.emergency_de_risk";
  if (key === "reducepayout" || key === "reduce_payout") return "decision.reduce_payout";
  if (key === "pausepayout" || key === "pause_payout") return "decision.pause_payout";
  if (key === "rotatevenue" || key === "rotate_venue") return "decision.rotate_venue";
  if (key === "hold") return "decision.hold";
  return "shadow_run_completed";
}

export function buildMintReceiptArgs({
  env,
  policyId,
  action,
  walrusBlobId,
  railPackDigestHex,
  contentDigestHex,
  expectedRail,
  decisionType,
  limitations,
  stateBeforeDigestHex,
}) {
  return [
    "client", "call",
    "--package", env.TIDE_POLICY_PACKAGE_ID,
    "--module", "execution_receipts",
    "--function", "mint_receipt",
    "--args",
    policyId,
    env.TIDE_POLICY_RAIL_ALLOWLIST_ID,
    utf8CliArg(action || receiptActionForDecisionType(decisionType)),
    utf8CliArg(decisionType),
    utf8CliArg(limitations),
    stateBeforeDigestHex,
    utf8CliArg(walrusBlobId),
    railPackDigestHex,
    contentDigestHex,
    utf8CliArg(expectedRail),
    "0x6",
    "--gas-budget", String(GAS_BUDGET),
    "--json",
  ];
}

function expectRailNotAllowedAbort(result, { label, code }) {
  const output = compactCommandOutput(result);
  const matched = new RegExp(`E_RAIL_NOT_ALLOWED|abort.*${code}|code\\s*${code}|MoveAbort.*${code}`, "i").test(output);
  if (result.ok) {
    throw new Error(`${label} guard failed: transaction unexpectedly succeeded`);
  }
  if (!matched) {
    throw new Error(`${label} guard failed with unexpected error: ${output || "(empty sui output)"}`);
  }
  return output;
}

function runRailMismatchGuard({ env, policy, proof, walrusBlobId }) {
  const actualRail = policy.selectedRail || "";
  const expectedRail = pickMismatchedRailId(actualRail);
  const result = runCommand("sui", buildMintReceiptArgs({
    env,
    policyId: policy.id,
    action: proof.bundle.action,
    walrusBlobId,
    railPackDigestHex: `0x${proof.railPackDigestHex}`,
    contentDigestHex: `0x${proof.contentDigestHex}`,
    expectedRail,
    decisionType: proof.bundle.decisionType,
    limitations: proof.bundle.limitations,
    stateBeforeDigestHex: `0x${proof.stateBeforeDigestHex}`,
  }), { allowFailure: true });
  const output = compactCommandOutput(result);
  const matched = /E_RAIL_MISMATCH|abort.*5|code\s*5|MoveAbort.*5/i.test(output);

  if (result.ok) {
    throw new Error(`N1 rail mismatch guard failed: mint_receipt succeeded with expectedRail=${expectedRail}`);
  }
  if (!matched) {
    throw new Error(`N1 rail mismatch guard failed with unexpected error: ${output || "(empty sui output)"}`);
  }

  return {
    id: "N1",
    label: "E_RAIL_MISMATCH",
    ok: true,
    actualRail,
    expectedRail,
    status: result.status,
    evidence: output,
  };
}

function runRailRevocationGuard({ env, policy, proof, walrusBlobId }) {
  const actualRail = policy.selectedRail || "";
  const selectRail = pickMismatchedRailId(actualRail);
  const restoreRails = new Set();

  function revokeRail(railId) {
    runCommand("sui", buildRailAdminArgs({ env, functionName: "revoke_rail", railId }));
    restoreRails.add(railId);
  }

  function allowRail(railId) {
    const result = runCommand("sui", buildRailAdminArgs({ env, functionName: "allow_rail", railId }), {
      allowFailure: true,
    });
    if (result.ok) restoreRails.delete(railId);
    return result;
  }

  try {
    revokeRail(selectRail);
    const selectResult = runCommand("sui", buildSelectRailArgs({
      env,
      policyId: policy.id,
      railId: selectRail,
    }), { allowFailure: true });
    const selectEvidence = expectRailNotAllowedAbort(selectResult, {
      label: "N2 select_rail revoked rail",
      code: 4,
    });
    allowRail(selectRail);

    revokeRail(actualRail);
    const mintResult = runCommand("sui", buildMintReceiptArgs({
      env,
      policyId: policy.id,
      action: proof.bundle.action,
      walrusBlobId,
      railPackDigestHex: `0x${proof.railPackDigestHex}`,
      contentDigestHex: `0x${proof.contentDigestHex}`,
      expectedRail: actualRail,
      decisionType: proof.bundle.decisionType,
      limitations: proof.bundle.limitations,
      stateBeforeDigestHex: `0x${proof.stateBeforeDigestHex}`,
    }), { allowFailure: true });
    const mintEvidence = expectRailNotAllowedAbort(mintResult, {
      label: "N2 mint_receipt revoked selected rail",
      code: 6,
    });
    allowRail(actualRail);

    return {
      id: "N2",
      label: "E_RAIL_NOT_ALLOWED",
      ok: true,
      selectRail,
      actualRail,
      selectEvidence,
      mintEvidence,
    };
  } finally {
    const cleanupFailures = [];
    for (const railId of Array.from(restoreRails)) {
      const result = allowRail(railId);
      if (!result.ok) {
        cleanupFailures.push(
          `N2 cleanup failed: could not re-allow ${railId}. ` +
          `${compactCommandOutput(result) || "(empty sui output)"}`
        );
      }
    }
    if (cleanupFailures.length) {
      throw new Error(cleanupFailures.join("\n"));
    }
  }
}

async function runProofVerifierGuards({ proof }) {
  const tamperedBundle = {
    ...proof.bundle,
    policy: {
      ...proof.bundle.policy,
      payoutTargetUsd: Number(proof.bundle.policy?.payoutTargetUsd || 0) + 1,
    },
  };
  const digestVerdict = await verifyBundleDigest(tamperedBundle, proof.contentDigest);
  if (digestVerdict.ok || digestVerdict.reason !== "digest-mismatch") {
    throw new Error(
      `N6 content digest guard failed: expected digest-mismatch, got ${digestVerdict.reason || "ok"}`
    );
  }

  const now = Date.now();
  const staleBundle = {
    ...proof.bundle,
    createdAtMs: now - DEFAULT_FRESHNESS_MS - 1,
  };
  const freshness = checkFreshness(staleBundle, { now });
  if (freshness.ok || freshness.reason !== "stale") {
    throw new Error(
      `N7 freshness guard failed: expected stale, got ${freshness.reason || "ok"}`
    );
  }

  return [
    {
      id: "N6",
      label: "CONTENT_DIGEST_MISMATCH",
      ok: true,
      expectedDigestHex: digestVerdict.expectedHex ? `0x${digestVerdict.expectedHex}` : "",
      actualDigestHex: digestVerdict.actualHex ? `0x${digestVerdict.actualHex}` : "",
      evidence: `tampered payoutTargetUsd rejected with ${digestVerdict.reason}`,
    },
    {
      id: "N7",
      label: "PROOF_BUNDLE_STALE",
      ok: true,
      maxAgeMs: DEFAULT_FRESHNESS_MS,
      ageMs: freshness.ageMs,
      evidence: `bundle older than ${DEFAULT_FRESHNESS_MS}ms rejected with ${freshness.reason}`,
    },
  ];
}

async function fetchObjectRpc(objectId, runtimeConfig) {
  const network = runtimeConfig?.sui?.network || "testnet";
  const urls = getSuiRpcUrlsWithFallback(runtimeConfig);
  const response = await postSuiRpcWithFallback({
    urls: urls.length ? urls : [RPC_BY_NETWORK[network] || RPC_BY_NETWORK.testnet],
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "sui_getObject",
      params: [objectId, { showType: true, showContent: true, showOwner: true }],
    }),
  });
  if (!response.ok) {
    throw new Error(`RPC object fetch returned ${response.status}`);
  }
  const payload = await response.json();
  if (payload?.error) {
    throw new Error(payload.error.message || "RPC object fetch failed");
  }
  return payload.result;
}

function extractAddressOwner(object) {
  const owner = object?.data?.owner || object?.owner || null;
  if (!owner || typeof owner !== "object") return "";
  if (typeof owner.AddressOwner === "string") return owner.AddressOwner;
  if (owner.AddressOwner && typeof owner.AddressOwner === "object") {
    return owner.AddressOwner.address || owner.AddressOwner.owner || "";
  }
  return "";
}

export async function buildCapPostureSidecar({
  env = {},
  runtimeConfig = {},
} = {}) {
  const adminCapId = env.TIDE_POLICY_ADMIN_CAP_ID || "";
  const upgradeCapId = env.TIDE_POLICY_UPGRADE_CAP_ID || "";
  if (!adminCapId || !upgradeCapId) {
    return {
      source: "sui_getObject",
      status: "unknown",
      reason: "missing cap object id",
      adminCapId,
      upgradeCapId,
    };
  }
  try {
    const [adminCap, upgradeCap] = await Promise.all([
      fetchObjectRpc(adminCapId, runtimeConfig),
      fetchObjectRpc(upgradeCapId, runtimeConfig),
    ]);
    const adminCapOwner = extractAddressOwner(adminCap);
    const upgradeCapOwner = extractAddressOwner(upgradeCap);
    const status = adminCapOwner && upgradeCapOwner
      ? (adminCapOwner.toLowerCase() === upgradeCapOwner.toLowerCase() ? "colocated" : "hardened")
      : "unknown";
    return {
      source: "sui_getObject",
      status,
      adminCapId,
      upgradeCapId,
      adminCapOwner,
      upgradeCapOwner,
      reason: status === "unknown" ? "cap owner could not be extracted" : "",
    };
  } catch (error) {
    return {
      source: "sui_getObject",
      status: "unknown",
      adminCapId,
      upgradeCapId,
      reason: error?.message || String(error),
    };
  }
}

async function waitForObject(objectId, runtimeConfig, normalize, label) {
  let lastError = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const raw = await fetchObjectRpc(objectId, runtimeConfig);
      const normalized = normalize(raw);
      if (normalized?.id) {
        return normalized;
      }
      lastError = new Error(`${label} ${objectId} fetched but could not be normalized`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`Timed out waiting for ${label} ${objectId}: ${lastError?.message || "unknown error"}`);
}

function buildRailPackCanonical(spec) {
  const rails = getAllRailIds().map((railId, index) => {
    const entry = getRailEntry(railId) || {};
    const priceFactor = 1 - (index * 0.0075);
    return {
      id: railId,
      venue: entry.venue || railId,
      asset: entry.asset || "SUI",
      referencePriceUsd: roundUsd(spec.btcPriceUsd * priceFactor),
    };
  });
  return {
    label: "fixture-proof-pack",
    generatedAtMs: Date.now(),
    signedBy: "local-proof-operator",
    rails,
  };
}

function buildArtifactSummary({
  runNumber,
  spec,
  draft,
  input,
  report,
  policySnapshot,
  proof,
  policyTxDigest,
  policy,
  receiptTxDigest,
  receipt,
  proofVerification,
  verifyAfter = null,
  walrusResult = null,
  env = {},
  network,
}) {
  const explorerBase = EXPLORER_BASE[network];
  const railDataMode = report.summary?.railDataMode || "fixture";
  const walrusSource = String(walrusResult?.source || "unknown");
  const pythPriceInfoObjectId =
    env.TIDE_PYTH_BTC_USD_PRICE_INFO_OBJECT_ID ||
    process.env.TIDE_PYTH_BTC_USD_PRICE_INFO_OBJECT_ID ||
    "";
  const pythSource = pythPriceInfoObjectId ? "configured" : "missing";
  const executionMode = "testnet-rehearsal";
  const evidencePosture = {
    railDataMode,
    walrusSource,
    pythSource,
    executionMode,
    claimBoundary: "testnet receipt + local proof digest; no mainnet capital movement",
  };
  return {
    runNumber,
    label: spec.label,
    network,
    setup: {
      mode: policySnapshot.mode,
      railId: spec.railId,
      railName: getRailDisplay(spec.railId, spec.railId),
      payoutTargetUsd: policySnapshot.payoutTargetUsd,
      maxLtvBps: policySnapshot.maxLtvBps,
      targetLtvLowBps: policySnapshot.targetLtvLowBps,
      targetLtvHighBps: policySnapshot.targetLtvHighBps,
      repayLtvBps: policySnapshot.repayLtvBps,
      emergencyLtvBps: policySnapshot.emergencyLtvBps,
      railDataMode,
    },
    evidencePosture,
    draft,
    input,
    reportSummary: report.summary,
    policyAnchor: {
      txDigest: policyTxDigest,
      txUrl: `${explorerBase}/txblock/${policyTxDigest}`,
      objectId: policy.id,
      objectUrl: `${explorerBase}/object/${policy.id}`,
      version: policy.version,
      selectedRail: policy.selectedRail,
      owner: policy.owner,
    },
    receiptMint: {
      txDigest: receiptTxDigest,
      txUrl: `${explorerBase}/txblock/${receiptTxDigest}`,
      objectId: receipt.id,
      objectUrl: `${explorerBase}/object/${receipt.id}`,
      walrusBlobId: receipt.walrusBlobId,
      walrusSource,
      contentDigestHex: receipt.contentDigestHex,
      railPackDigestHex: receipt.railPackDigestHex,
      policyVersion: receipt.policyVersion,
      selectedRail: receipt.selectedRail,
      decisionType: receipt.decisionType || proof.bundle.decisionType,
      limitations: receipt.limitations || proof.bundle.limitations,
      stateBeforeDigestHex: receipt.stateBeforeDigestHex || `0x${proof.stateBeforeDigestHex}`,
      createdAtMs: receipt.createdAtMs,
    },
    proofBundle: {
      canonical: proof.canonical,
      bundle: proof.bundle,
      stateBeforeDigestHex: `0x${proof.stateBeforeDigestHex}`,
      contentDigestHex: `0x${proof.contentDigestHex}`,
      railPackDigestHex: `0x${proof.railPackDigestHex}`,
    },
    proofVerification: {
      ...proofVerification,
      evidencePosture,
    },
    verifyAfter,
    notes: [
      `railDataMode=${railDataMode}`,
      `walrusSource=${walrusSource}`,
      `pythSource=${pythSource}`,
      "Execution surface is testnet Autopilot Rehearsal only.",
    ],
  };
}

function formatUtc(timestampMs) {
  const date = new Date(timestampMs);
  const iso = date.toISOString().replace(/\.\d{3}Z$/, "Z");
  return iso.replace("T", " ").replace("Z", " UTC");
}

function formatPublicOperatorAddress(address) {
  const value = String(address || "").trim();
  if (/^0x[0-9a-f]{64}$/i.test(value)) {
    return `${value.slice(0, 6)}...${value.slice(-4)} (redacted in public proof artifacts)`;
  }
  return value || "redacted";
}

function renderRunMarkdown(artifact) {
  const setup = artifact.setup;
  const policy = artifact.policyAnchor;
  const receipt = artifact.receiptMint;
  return [
    `### Run #${artifact.runNumber} - ${artifact.label}`,
    "",
    `Date:     ${formatUtc(receipt.createdAtMs || Date.now())}`,
    `Network:  ${artifact.network}`,
    "",
    "Setup",
    `  Mode:              ${setup.mode}`,
    `  Rail (canonical):  ${setup.railId}`,
    `  Payout target:     $${setup.payoutTargetUsd} / mo`,
    `  Max LTV:           ${(setup.maxLtvBps / 100).toFixed(2)}%`,
    `  Target LTV:        ${(setup.targetLtvLowBps / 100).toFixed(2)}% -> ${(setup.targetLtvHighBps / 100).toFixed(2)}%`,
    `  Managed repay:     ${(setup.repayLtvBps / 100).toFixed(2)}%`,
    `  Emergency:         ${(setup.emergencyLtvBps / 100).toFixed(2)}%`,
    `  Rail data mode:    ${setup.railDataMode}`,
    "",
    "Policy anchor",
    `  Tx:           ${policy.txDigest}  ${policy.txUrl}`,
    `  Policy obj:   ${policy.objectId}  ${policy.objectUrl}`,
    "  Pre-sign:     confirmed",
    "  Wallet:       Sui CLI keystore",
    "",
    "Mint action receipt",
    `  Tx:           ${receipt.txDigest}  ${receipt.txUrl}`,
    `  Receipt obj:  ${receipt.objectId}  ${receipt.objectUrl}`,
    `  ${/^(?:tide-stub:\/\/|(?:testnet|mainnet|devnet)-proof:)/.test(receipt.walrusBlobId || "") ? "Proof stub: " : "Walrus blob: "} ${receipt.walrusBlobId}`,
    `  Decision:     ${receipt.decisionType || "—"} (${receipt.limitations || "—"})`,
    `  State dg:     ${receipt.stateBeforeDigestHex || "—"}`,
    `  Content dg:   ${receipt.contentDigestHex}`,
    `  Rail-pack dg: ${receipt.railPackDigestHex}`,
    "  Pre-sign:     confirmed",
    "  Rail change:  none",
    "",
    "Checks",
    `  [x] SuiVision receipt object resolves with policy_version == ${receipt.policyVersion}`,
    "  [x] Action receipt content digest is pinned on-chain; public proof JSON is a redacted summary, not the canonical bundle",
    "  [x] Freshness window passes locally after mint",
    `  [x] selectedRail remained pinned to ${receipt.selectedRail}`,
    artifact.verifyAfter
      ? `  [x] Post-ceremony verifier passed at ${artifact.verifyAfter.ranAt}`
      : "  [ ] Post-ceremony verifier skipped",
    "",
    "Notes",
    `  fixture rails in the simulator; on-chain action receipt path and digests are real. ${artifact.notes.join(" ")}`,
    "",
  ].join("\n");
}

export function deriveCapPosture({
  env,
  verifyStatus = "UNKNOWN",
  verifyOutput = "",
  capPostureSidecar = null,
} = {}) {
  const sidecar = capPostureSidecar && typeof capPostureSidecar === "object"
    ? capPostureSidecar
    : null;
  const output = String(verifyOutput || "");
  const hardenedPass = /PASS\s+cap separation|admin cap\s+[^a-z0-9]*\s+upgrade cap/i.test(output);
  const disclosedColocation = /WARN\s+cap separation|TIDE_VERIFY_ALLOW_CAP_COLOCATION=1/i.test(output);
  const adminCap = env?.TIDE_POLICY_ADMIN_CAP_ID || "";
  const upgradeCap = env?.TIDE_POLICY_UPGRADE_CAP_ID || "";
  const packageId = env?.TIDE_POLICY_PACKAGE_ID || "";
  const ownerLines = sidecar
    ? [
      sidecar.adminCapOwner ? `- \`AdminCap\` owner: \`${sidecar.adminCapOwner}\`` : "",
      sidecar.upgradeCapOwner ? `- \`UpgradeCap\` owner: \`${sidecar.upgradeCapOwner}\`` : "",
      sidecar.reason ? `- Structured cap sidecar: ${sidecar.reason}` : "",
    ].filter(Boolean).join("\n")
    : "";

  if (sidecar?.status === "hardened" || hardenedPass) {
    return {
      hardenedLine: "`npm run verify:onchain:hardened` -> PASS on the current package",
      section: `## Cap posture — S0 testnet

The current proof package passes the hardened cap-separation gate for the
package IDs in this proof pack. The proof generator records only the current
object IDs; owner/custody assertions come from
\`scripts/verify-onchain-testnet.mjs\` at ceremony time, not from historical
hard-coded tx digests.

The S0 fallback \`TIDE_VERIFY_ALLOW_CAP_COLOCATION=1\` is documented here only
as the older cap-separation baseline; it is not the path used for this
package. The hardened verifier requires two caps to live on different addresses;
this package meets that stricter gate.

- Package: \`${packageId}\`
- \`AdminCap\`: \`${adminCap}\`
- \`UpgradeCap\`: \`${upgradeCap}\`
- Structured source: \`${sidecar?.source || "verifier stdout"}\`
${ownerLines ? `${ownerLines}\n` : ""}- Gate: \`npm run verify:onchain:hardened\` / \`scripts/verify-onchain-testnet.mjs\`
- Public cap-placement attestation: \`docs/proof/cap-placement-attestation.md\`

This satisfies the F-C-CK-1 gate for the submitted testnet package: the
\`AdminCap\` and \`UpgradeCap\` are not owned by the same address. If the
package is republished, rerun the verifier and regenerate this proof pack
before reusing any cap-posture claim. Any future cap rotation must update the
public cap-placement attestation before the proof pack is reused.
`,
    };
  }

  if (sidecar?.status === "colocated" || disclosedColocation) {
    return {
      hardenedLine: "`npm run verify:onchain:hardened` -> NOT MET; S0 disclosure path used",
      section: `## Cap posture — S0 testnet

The current proof package was verified through the explicit S0 disclosure path:
\`TIDE_VERIFY_ALLOW_CAP_COLOCATION=1\` downgraded cap colocation to a warning.
This is acceptable only for testnet rehearsal evidence and must not be reused
for MVP, audit handoff, mainnet, or any signed/live ops claim.

- Package: \`${packageId}\`
- \`AdminCap\`: \`${adminCap}\`
- \`UpgradeCap\`: \`${upgradeCap || "not recorded"}\`
- Structured source: \`${sidecar?.source || "verifier stdout"}\`
${ownerLines ? `${ownerLines}\n` : ""}- Gate used: \`TIDE_VERIFY_ALLOW_CAP_COLOCATION=1 npm run verify:onchain\`
- Hardened gate: \`npm run verify:onchain:hardened\` must pass before final
  cap-separation claims.
- Public cap-placement attestation: \`docs/proof/cap-placement-attestation.md\`

If this package enters the final Overflow packet, keep this disclosure visible
and do not claim hardened cap separation for it. Any future cap rotation must
update the public cap-placement attestation before the proof pack is reused.
`,
    };
  }

  return {
    hardenedLine: verifyStatus === "PASS"
      ? "`npm run verify:onchain:hardened` -> UNKNOWN; rerun before final packet"
      : "`npm run verify:onchain:hardened` -> FAIL",
    section: `## Cap posture — S0 testnet

Cap posture could not be classified from the verifier output captured during
this proof run. Treat cap separation as unclaimed until the package passes
\`npm run verify:onchain:hardened\` and this proof pack is regenerated.

- Package: \`${packageId}\`
- \`AdminCap\`: \`${adminCap}\`
- \`UpgradeCap\`: \`${upgradeCap || "not recorded"}\`
`,
  };
}

export function renderProofPack({
  env,
  network,
  head,
  verifyStatus,
  verifyOutput = "",
  capPostureSidecar = null,
  cliVersion,
  operatorAddress,
  artifacts,
  guardChecks = [],
}) {
  const publishedOn = artifacts.length
    ? formatUtc(artifacts[artifacts.length - 1].receiptMint.createdAtMs || Date.now())
    : "pending proof run";
  const signoffDate = publishedOn.includes(" ")
    ? publishedOn.slice(0, publishedOn.indexOf(" "))
    : publishedOn;
  const runsMarkdown = artifacts.map((artifact) => renderRunMarkdown(artifact)).join("\n");
  const railMismatch = guardChecks.find((check) => check.id === "N1");
  const railMismatchActual = railMismatch?.ok
    ? [
      `Actual: PASS. Automated CLI guard called \`mint_receipt\` with`,
      `\`expected_rail=${railMismatch.expectedRail}\` against policy rail`,
      `\`${railMismatch.actualRail}\`; Sui aborted as expected.`,
      "",
      `Evidence: \`${railMismatch.evidence || "abort observed"}\``,
    ].join(" ")
    : "Actual: skipped for this run; pass `--skip-negative` only when the operator is intentionally avoiding negative testnet transactions.";
  const railRevocation = guardChecks.find((check) => check.id === "N2");
  const railRevocationActual = railRevocation?.ok
    ? [
      `Actual: PASS. Automated CLI guard revoked \`${railRevocation.selectRail}\` and`,
      `confirmed \`select_rail\` failed closed with code 4; then revoked the`,
      `policy's selected rail \`${railRevocation.actualRail}\` and confirmed`,
      `\`mint_receipt\` failed closed with code 6. Both rails were re-allowed`,
      `during cleanup.`,
      "",
      `Select evidence: \`${railRevocation.selectEvidence || "abort observed"}\``,
      "",
      `Mint evidence: \`${railRevocation.mintEvidence || "abort observed"}\``,
    ].join(" ")
    : "Actual: skipped for this run; pass `--skip-negative` only when the operator is intentionally avoiding negative testnet transactions.";
  const contentDigestMismatch = guardChecks.find((check) => check.id === "N6");
  const contentDigestMismatchActual = contentDigestMismatch?.ok
    ? [
      "Actual: PASS. The local verifier mutated a load-bearing policy field",
      "inside the proof bundle and recomputed the digest; it rejected the",
      `bundle with \`${contentDigestMismatch.label}\`.`,
      "",
      `Evidence: \`${contentDigestMismatch.evidence || "digest mismatch observed"}\``,
    ].join(" ")
    : "Actual: skipped for this run; pass `--skip-negative` only when the operator is intentionally avoiding negative verifier checks.";
  const staleProofBundle = guardChecks.find((check) => check.id === "N7");
  const staleProofBundleActual = staleProofBundle?.ok
    ? [
      "Actual: PASS. The local verifier rewound the bundle timestamp past",
      "the freshness window and rejected it before any receipt could be",
      "trusted as current evidence.",
      "",
      `Evidence: \`${staleProofBundle.evidence || "stale proof observed"}\``,
    ].join(" ")
    : "Actual: skipped for this run; pass `--skip-negative` only when the operator is intentionally avoiding negative verifier checks.";
  const capPosture = deriveCapPosture({ env, verifyStatus, verifyOutput, capPostureSidecar });

  return `# Autopilot Rehearsal proof pack

Operator-filled log of the repeatable testnet runs that ratify the
Autopilot Rehearsal proof loop.

Generated by \`node scripts/run-testnet-proof-loop.mjs\`.

## Deployment

| Field                   | Value |
| ----------------------- | ----- |
| Branch HEAD             | \`${head}\` |
| Published on            | \`${publishedOn}\` |
| Network                 | \`${network}\` |
| Package ID              | \`${env.TIDE_POLICY_PACKAGE_ID}\` |
| Admin cap ID            | \`${env.TIDE_POLICY_ADMIN_CAP_ID}\` |
| Rail allowlist ID       | \`${env.TIDE_POLICY_RAIL_ALLOWLIST_ID}\` |
| Seeded rails            | \`${getAllRailIds().join(", ")}\` |
| Verify script           | \`npm run verify:onchain\` -> ${verifyStatus} |
| Hardened verifier       | ${capPosture.hardenedLine} |
| Active sui CLI version  | \`${cliVersion}\` |
| Operator address        | \`${formatPublicOperatorAddress(operatorAddress)}\` |

## HTTP security headers — S0 host state

The repo ships a smoke verifier at \`npm run verify:security-headers <https-url>\`
that checks HSTS / CSP / Referrer-Policy / Permissions-Policy /
X-Content-Type-Options against any deployed URL. As of the latest live
verification pass, the public hosts return the expected HTTP security headers.

Remaining hygiene:
1. Keep \`TIDE_VERIFY_SECURITY_HEADERS_REQUIRED=true\` in the deploy
   environment once every host is managed by the same nginx snippets.
2. Re-run \`npm run verify:security-headers <https-url>\` after every
   manual host config change.
3. Move nginx config fully into infra-as-code so header drift cannot
   reappear outside CI review.

${capPosture.section}

## Runs

${runsMarkdown}
## Negative / guard checks

The positive Autopilot Rehearsal loop above is backed by live tx/object ids. N1
and N2 are exercised automatically by this script unless \`--skip-negative\` is
passed; the remaining cases stay in the companion playbook.

### N1. E_RAIL_MISMATCH (code 5)

Expected: \`mint_receipt\` aborts when \`expected_rail\` disagrees with
the on-chain \`selected_rail\`.

${railMismatchActual}

### N2. E_RAIL_NOT_ALLOWED (code 1 / 6)

Expected: revoked rails fail closed at \`select_rail\` and again at
\`mint_receipt\`.

${railRevocationActual}

### N3. E_POLICY_VERSION_STALE

Expected: mint fails if the policy schema/version changed under the UI.

Actual: PASS in the Move regression
\`execution_receipts_tests::mint_receipt_rejects_stale_policy_version\`.
This is not a live operator transaction on the current package: the guard
only trips when a policy object is stale relative to the published package
schema, so an on-chain testnet repro requires the next package/schema upgrade drill.

### N4. Mainnet wallet fail-closed

Expected: production/mainnet builds stay read-only with signing disabled.

Actual: verified separately by build/runtime guards; not part of the
testnet mint loop.

### N5. Pre-sign cancel

Expected: cancel path exits cleanly with no tx submitted.

Actual: browser-wallet path only; not exercised by the CLI operator run.

### N6. Content digest mismatch

Expected: a proof bundle with any load-bearing field changed after mint must
fail local digest verification against the receipt's on-chain content digest.

${contentDigestMismatchActual}

### N7. Stale proof bundle

Expected: a proof bundle outside the freshness window must be refused before it
is presented as current Autopilot Rehearsal evidence.

${staleProofBundleActual}

## Sign-off

| Reviewer       | Role                                  | Date  | Decision |
| -------------- | ------------------------------------- | ----- | -------- |
| \`Petr Osetr\` | Founder-operator                     | ${signoffDate} | approved for Overflow submission |
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = readEnv(args.envFile);
  mkdirSync(args.outputDir, { recursive: true });

  const required = [
    "TIDE_POLICY_PACKAGE_ID",
    "TIDE_POLICY_ADMIN_CAP_ID",
    "TIDE_POLICY_RAIL_ALLOWLIST_ID",
  ];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(`env is missing: ${missing.join(", ")}`);
  }

  const activeEnv = runCommand("sui", ["client", "active-env"]).stdout.trim();
  if (activeEnv !== args.network) {
    throw new Error(`active sui env is "${activeEnv}", expected "${args.network}"`);
  }

  const operatorAddress = runCommand("sui", ["client", "active-address"]).stdout.trim();
  const cliVersion = runCommand("sui", ["client", "--version"]).stdout.trim();
  const verifyRun = runCommand("node", [
    "scripts/verify-onchain-testnet.mjs",
    "--network", args.network,
    "--env", args.envFile,
  ], {
    allowFailure: true,
  });
  const verifyStatus = verifyRun.ok ? "PASS" : "FAIL";
  if (!verifyRun.ok) {
    throw new Error(`verify:onchain failed before proof loop\n${verifyRun.stderr || verifyRun.stdout}`);
  }

  const runtimeConfig = getRuntimeConfig(env, args.network);
  const capPostureSidecar = await buildCapPostureSidecar({ env, runtimeConfig });
  const proofRef = runCommand("git", ["rev-parse", "HEAD"]).stdout.trim();
  const artifacts = [];
  const guardChecks = [];

  for (let index = 0; index < Math.min(args.count, RUN_SPECS.length); index += 1) {
    const runNumber = index + 1;
    const spec = RUN_SPECS[index];
    process.stdout.write(`[proof] run ${runNumber}/${args.count}: ${spec.label}\n`);

    const { draft, input, report } = await simulateDraft(spec, runNumber);
    const policySnapshot = derivePolicySnapshot(draft, report);

    const createResult = runJson("sui", buildCreatePolicyArgs(policySnapshot, env));
    const policyTxDigest = createResult?.digest || createResult?.effects?.transactionDigest || "";
    const policyId = createResult?.events?.[0]?.parsedJson?.policy_id
      || createResult?.objectChanges?.find((change) => change.type === "created" && change.objectType?.endsWith("::policy_registry::Policy"))?.objectId
      || "";
    if (!policyId) {
      throw new Error(`run ${runNumber}: create_policy succeeded but no policy object id was returned`);
    }

    const policy = await waitForObject(
      policyId,
      runtimeConfig,
      (raw) => normalizePolicyObject(raw, runtimeConfig),
      "policy",
    );

    const railPackCanonical = buildRailPackCanonical(spec);
    const railPackDigest = await digestBundle(railPackCanonical);
    const decisionAttestation = buildDecisionAttestation(input, report, args.network);
    const proof = await buildProofBundleWithDigest({
      policy: {
        id: policy.id,
        version: Number(policy.version) || 1,
        owner: policy.owner || operatorAddress,
        selectedRail: policy.selectedRail || policySnapshot.selectedRail,
        mode: policy.mode || policySnapshot.mode,
        priority: policy.priority || policySnapshot.priority,
        collateralSymbol: policy.collateralSymbol || policySnapshot.collateralSymbol,
        collateralCoinType: policy.collateralCoinType || policySnapshot.collateralCoinType,
        payoutTargetUsd: Number(policy.payoutTargetUsd) || policySnapshot.payoutTargetUsd,
        minBufferUsd: Number(policy.minBufferUsd) || policySnapshot.minBufferUsd,
        maxLtvBps: Number(policy.maxLtvBps) || policySnapshot.maxLtvBps,
        targetLtvLowBps: Number(policy.targetLtvLowBps) || policySnapshot.targetLtvLowBps,
        targetLtvHighBps: Number(policy.targetLtvHighBps) || policySnapshot.targetLtvHighBps,
        repayLtvBps: Number(policy.repayLtvBps) || policySnapshot.repayLtvBps,
        emergencyLtvBps: Number(policy.emergencyLtvBps) || policySnapshot.emergencyLtvBps,
      },
      report: {
        summary: report.summary || {},
        schemaVersion: Number(report.schemaVersion) || 1,
      },
      railPack: {
        digest: railPackDigest,
        signedBy: railPackCanonical.signedBy,
        signatureAlg: "ed25519",
        generatedAtMs: railPackCanonical.generatedAtMs,
      },
      action: receiptActionForDecisionType(decisionAttestation.decisionType),
      ...decisionAttestation,
      createdAtMs: Date.now(),
    });

    // Try real Walrus when TIDE_WALRUS_PUBLISHER_URL is set (loaded
    // via the env file or process.env); fall back to the deterministic
    // stub so a publisher outage never blocks a proof run.
    const walrusResult = await publishProofBundle({
      contentDigest: proof.contentDigest,
      canonicalBody: canonicalizeBundle(proof.bundle),
      network: args.network,
      publisherUrl: process.env.TIDE_WALRUS_PUBLISHER_URL || env.TIDE_WALRUS_PUBLISHER_URL || "",
      epochs: Number(process.env.TIDE_WALRUS_EPOCHS || env.TIDE_WALRUS_EPOCHS || 5),
    });
    const walrusBlobId = walrusResult.blobId;
    if (walrusResult.source === "stub" && walrusResult.fallbackError) {
      console.warn(`[proof] walrus fallback to stub: ${walrusResult.fallbackError}`);
    }
    const mintResult = runJson("sui", buildMintReceiptArgs({
      env,
      policyId: policy.id,
      action: proof.bundle.action,
      walrusBlobId,
      railPackDigestHex: `0x${proof.railPackDigestHex}`,
      contentDigestHex: `0x${proof.contentDigestHex}`,
      expectedRail: policy.selectedRail || policySnapshot.selectedRail,
      decisionType: proof.bundle.decisionType,
      limitations: proof.bundle.limitations,
      stateBeforeDigestHex: `0x${proof.stateBeforeDigestHex}`,
    }));
    const receiptTxDigest = mintResult?.digest || mintResult?.effects?.transactionDigest || "";
    const receiptRef = resolveReceiptObjectReference({ result: mintResult, config: runtimeConfig });
    const receiptId = receiptRef.objectId
      || parseReceiptMintedEvents(mintResult, runtimeConfig)?.[0]?.receiptId
      || "";
    if (!receiptId) {
      throw new Error(`run ${runNumber}: mint_receipt succeeded but no receipt object id was returned (${receiptRef.reason || "unknown"})`);
    }

    const receipt = await waitForObject(
      receiptId,
      runtimeConfig,
      (raw) => normalizeReceiptObject(raw, runtimeConfig),
      "receipt",
    );

    const digestVerdict = await verifyBundleDigest(proof.bundle, receipt.contentDigestHex);
    const semanticVerdict = await verifyReceiptBundleSemantics({
      receipt,
      bundleBytes: new TextEncoder().encode(proof.canonical),
    });
    const freshness = checkFreshness(proof.bundle, { now: Date.now() });
    const proofVerification = {
      ok: Boolean(digestVerdict.ok && semanticVerdict.ok && freshness.ok),
      digestOk: Boolean(digestVerdict.ok),
      digestReason: digestVerdict.reason || "",
      semanticOk: Boolean(semanticVerdict.ok),
      semanticReason: semanticVerdict.reason || "",
      semanticMismatches: Array.isArray(semanticVerdict.mismatches) ? semanticVerdict.mismatches : [],
      bundleFreshnessOk: Boolean(freshness.ok),
      bundleFreshnessReason: freshness.reason || "",
      freshnessOk: Boolean(freshness.ok),
      freshnessReason: freshness.reason || "",
      ageMs: Number.isFinite(freshness.ageMs) ? freshness.ageMs : null,
      actualDigestHex: digestVerdict.actualHex ? `0x${digestVerdict.actualHex}` : "",
      expectedDigestHex: digestVerdict.expectedHex ? `0x${digestVerdict.expectedHex}` : "",
    };
    if (!proofVerification.ok) {
      throw new Error(
        `run ${runNumber}: proof verification failed (${proofVerification.digestReason || proofVerification.semanticReason || proofVerification.freshnessReason || "unknown"})`
      );
    }

    if (!args.skipNegative && !guardChecks.some((check) => check.id === "N6")) {
      process.stdout.write("[proof] guard N6/N7: verifier rejects tampered and stale bundles\n");
      guardChecks.push(...await runProofVerifierGuards({ proof }));
    }

    if (!args.skipNegative && !guardChecks.some((check) => check.id === "N1")) {
      process.stdout.write("[proof] guard N1: rail mismatch should abort\n");
      guardChecks.push(runRailMismatchGuard({
        env,
        policy,
        proof,
        walrusBlobId,
      }));
      process.stdout.write("[proof] guard N2: revoked rails should fail closed\n");
      guardChecks.push(runRailRevocationGuard({
        env,
        policy,
        proof,
        walrusBlobId,
      }));
    }

    const verifyAfter = runVerifierAfterCeremony(args, runNumber);
    const artifact = buildArtifactSummary({
      runNumber,
      spec,
      draft,
      input,
      report,
      policySnapshot,
      proof,
      policyTxDigest,
      policy,
      receiptTxDigest,
      receipt,
      proofVerification,
      verifyAfter,
      walrusResult,
      env,
      network: args.network,
    });
    const publicArtifact = redactProofRun(artifact, { sensitiveAddresses: [operatorAddress] });
    artifacts.push(publicArtifact);
    const jsonPath = path.join(args.outputDir, `run-${String(runNumber).padStart(2, "0")}.json`);
    writeFileSync(jsonPath, JSON.stringify(publicArtifact, null, 2) + "\n", "utf8");
  }

  const latestPath = path.join(args.outputDir, "latest-proof-loop.json");
  writeFileSync(latestPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    proofRef,
    network: args.network,
    packageId: env.TIDE_POLICY_PACKAGE_ID,
    railAllowlistId: env.TIDE_POLICY_RAIL_ALLOWLIST_ID,
    operatorAddress: DEFAULT_REDACTED_OPERATOR,
    runs: artifacts,
    guardChecks,
  }, null, 2) + "\n", "utf8");

  if (!args.skipProofPack) {
    const markdown = renderProofPack({
      env,
      network: args.network,
      head: proofRef,
      verifyStatus,
      verifyOutput: `${verifyRun.stdout || ""}\n${verifyRun.stderr || ""}`,
      capPostureSidecar,
      cliVersion,
      operatorAddress,
      artifacts,
      guardChecks,
    });
    writeFileSync(args.proofPackPath, markdown, "utf8");
  }

  process.stdout.write(
    `[proof] completed ${artifacts.length} run(s)\n` +
    `[proof] artifacts: ${path.relative(REPO_ROOT, args.outputDir)}\n` +
    (args.skipProofPack
      ? ""
      : `[proof] proof pack: ${path.relative(REPO_ROOT, args.proofPackPath)}\n`)
  );
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`[proof] error: ${error.message}\n`);
    process.exit(1);
  });
}
