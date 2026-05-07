#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ENV_FILE = path.join(REPO_ROOT, ".env.testnet.local");
const DEFAULT_RUNNER = path.join(REPO_ROOT, "scripts", "run-testnet-proof-loop.mjs");
const DEFAULT_VERIFIER = path.join(REPO_ROOT, "scripts", "verify-onchain-testnet.mjs");
const DEFAULT_ARTIFACT_ROOT = path.join(REPO_ROOT, "docs", "proof", "rehearsals");
const DEFAULT_REPORT_DIR = path.join(REPO_ROOT, "docs", "proof", "rehearsal");
const DEFAULT_REQUIRED_GUARDS = Object.freeze(["N1", "N2", "N6", "N7"]);
const REDACTED_OPERATOR = "0x0000000000000000000000000000000000000000000000000000000000000000";

function parsePositiveInt(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer, got "${value}"`);
  }
  return parsed;
}

function parseArgs(argv) {
  const args = {
    network: "testnet",
    envFile: DEFAULT_ENV_FILE,
    runner: DEFAULT_RUNNER,
    verifier: DEFAULT_VERIFIER,
    artifactRoot: DEFAULT_ARTIFACT_ROOT,
    reportDir: DEFAULT_REPORT_DIR,
    cycles: 10,
    count: 5,
    minRuns: 3,
    minNonHold: 3,
    minRails: 3,
    requiredGuards: [...DEFAULT_REQUIRED_GUARDS],
    negative: "once",
    verifyAfter: true,
    continueOnError: false,
    timestamp: new Date().toISOString().replace(/[:.]/g, "-"),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = () => {
      if (!argv[i + 1]) throw new Error(`${token} requires a value`);
      return argv[++i];
    };
    if (token === "--network") { args.network = next(); continue; }
    if (token.startsWith("--network=")) { args.network = token.slice("--network=".length); continue; }
    if (token === "--env") { args.envFile = path.resolve(next()); continue; }
    if (token.startsWith("--env=")) { args.envFile = path.resolve(token.slice("--env=".length)); continue; }
    if (token === "--runner") { args.runner = path.resolve(next()); continue; }
    if (token.startsWith("--runner=")) { args.runner = path.resolve(token.slice("--runner=".length)); continue; }
    if (token === "--verifier") { args.verifier = path.resolve(next()); continue; }
    if (token.startsWith("--verifier=")) { args.verifier = path.resolve(token.slice("--verifier=".length)); continue; }
    if (token === "--artifact-root") { args.artifactRoot = path.resolve(next()); continue; }
    if (token.startsWith("--artifact-root=")) { args.artifactRoot = path.resolve(token.slice("--artifact-root=".length)); continue; }
    if (token === "--report-dir") { args.reportDir = path.resolve(next()); continue; }
    if (token.startsWith("--report-dir=")) { args.reportDir = path.resolve(token.slice("--report-dir=".length)); continue; }
    if (token === "--cycles") { args.cycles = parsePositiveInt(next(), "--cycles"); continue; }
    if (token.startsWith("--cycles=")) { args.cycles = parsePositiveInt(token.slice("--cycles=".length), "--cycles"); continue; }
    if (token === "--count") { args.count = parsePositiveInt(next(), "--count"); continue; }
    if (token.startsWith("--count=")) { args.count = parsePositiveInt(token.slice("--count=".length), "--count"); continue; }
    if (token === "--min-runs") { args.minRuns = parsePositiveInt(next(), "--min-runs"); continue; }
    if (token.startsWith("--min-runs=")) { args.minRuns = parsePositiveInt(token.slice("--min-runs=".length), "--min-runs"); continue; }
    if (token === "--min-non-hold") { args.minNonHold = parsePositiveInt(next(), "--min-non-hold"); continue; }
    if (token.startsWith("--min-non-hold=")) { args.minNonHold = parsePositiveInt(token.slice("--min-non-hold=".length), "--min-non-hold"); continue; }
    if (token === "--min-rails") { args.minRails = parsePositiveInt(next(), "--min-rails"); continue; }
    if (token.startsWith("--min-rails=")) { args.minRails = parsePositiveInt(token.slice("--min-rails=".length), "--min-rails"); continue; }
    if (token === "--required-guards") {
      args.requiredGuards = next().split(",").map((value) => value.trim()).filter(Boolean);
      continue;
    }
    if (token.startsWith("--required-guards=")) {
      args.requiredGuards = token.slice("--required-guards=".length).split(",").map((value) => value.trim()).filter(Boolean);
      continue;
    }
    if (token === "--negative") {
      args.negative = next();
      continue;
    }
    if (token.startsWith("--negative=")) {
      args.negative = token.slice("--negative=".length);
      continue;
    }
    if (token === "--skip-verify-after") { args.verifyAfter = false; continue; }
    if (token === "--continue-on-error") { args.continueOnError = true; continue; }
    if (token === "--timestamp") { args.timestamp = next(); continue; }
    if (token.startsWith("--timestamp=")) { args.timestamp = token.slice("--timestamp=".length); continue; }
    if (token === "--help" || token === "-h") {
      process.stdout.write(
        "Usage: node scripts/run-proof-loop-rehearsals.mjs [options]\n" +
        "  --cycles <n>              proof-loop ceremonies to run (default: 10)\n" +
        "  --count <n>               positive runs per ceremony (default: 5)\n" +
        "  --negative <once|every|skip>  negative guard cadence (default: once)\n" +
        "  --verifier <path>         on-chain verifier to run after each ceremony\n" +
        "  --skip-verify-after       do not re-run the on-chain verifier after each ceremony\n" +
        "  --artifact-root <path>    per-cycle artifact root\n" +
        "  --report-dir <path>       aggregate report output dir\n" +
        "  --continue-on-error       collect failed cycles instead of failing fast\n"
      );
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
  }

  if (!["once", "every", "skip"].includes(args.negative)) {
    throw new Error(`--negative must be once|every|skip, got "${args.negative}"`);
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function compactOutput(result) {
  return `${result.stderr || ""}\n${result.stdout || ""}`.replace(/\s+/g, " ").trim().slice(0, 1600);
}

function summarizeVerifierOutput(result) {
  return compactOutput(result).slice(0, 600);
}

function csvEscape(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function getDecisionType(run) {
  return String(run?.receiptMint?.decisionType || run?.receipt?.decisionType || run?.proofBundle?.bundle?.decisionType || "").trim();
}

function getRailId(run) {
  return String(run?.setup?.railId || run?.policyAnchor?.selectedRail || run?.receiptMint?.selectedRail || "").trim();
}

function publicArtifactDir(value) {
  const raw = String(value || "");
  if (!raw) return "";
  if (!path.isAbsolute(raw)) return raw;
  const relative = path.relative(REPO_ROOT, raw);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative;
  }
  return path.basename(raw);
}

function summarizeLoop(loop, { cycle = 1, minRuns = 3, minNonHold = 3, minRails = 3 } = {}) {
  const runs = Array.isArray(loop?.runs) ? loop.runs : [];
  const rails = [...new Set(runs.map(getRailId).filter(Boolean))];
  const nonHoldRuns = runs.filter((run) => {
    const decision = getDecisionType(run);
    return decision && decision !== "Hold";
  });
  const guardIds = [...new Set((Array.isArray(loop?.guardChecks) ? loop.guardChecks : [])
    .filter((check) => check?.ok)
    .map((check) => String(check.id || "").trim())
    .filter(Boolean))];
  const failures = [];
  if (runs.length < minRuns) {
    failures.push(`cycle ${cycle}: expected at least ${minRuns} proof runs, got ${runs.length}`);
  }
  if (nonHoldRuns.length < minNonHold) {
    failures.push(`cycle ${cycle}: expected at least ${minNonHold} non-Hold action receipts, got ${nonHoldRuns.length}`);
  }
  if (rails.length < minRails) {
    failures.push(`cycle ${cycle}: expected at least ${minRails} unique rails, got ${rails.length || 0}`);
  }
  return {
    cycle,
    ok: failures.length === 0,
    failures,
    generatedAt: String(loop?.generatedAt || ""),
    proofRef: String(loop?.proofRef || ""),
    network: String(loop?.network || ""),
    packageId: String(loop?.packageId || ""),
    railAllowlistId: String(loop?.railAllowlistId || ""),
    operatorAddress: REDACTED_OPERATOR,
    runCount: runs.length,
    nonHoldCount: nonHoldRuns.length,
    rails,
    guardIds,
  };
}

function buildRunRows(loop, cycle) {
  const runs = Array.isArray(loop?.runs) ? loop.runs : [];
  return runs.map((run) => ({
    ...run?.evidencePosture,
    cycle,
    runNumber: run?.runNumber || "",
    label: run?.label || "",
    network: run?.network || loop?.network || "",
    packageId: loop?.packageId || "",
    railId: getRailId(run),
    railName: run?.setup?.railName || "",
    decisionType: getDecisionType(run),
    limitations: run?.receiptMint?.limitations || run?.proofBundle?.bundle?.limitations || "",
    policyObjectId: run?.policyAnchor?.objectId || "",
    policyTxDigest: run?.policyAnchor?.txDigest || "",
    receiptObjectId: run?.receiptMint?.objectId || "",
    receiptTxDigest: run?.receiptMint?.txDigest || "",
    contentDigestHex: run?.receiptMint?.contentDigestHex || run?.proofBundle?.contentDigestHex || "",
    railPackDigestHex: run?.receiptMint?.railPackDigestHex || run?.proofBundle?.railPackDigestHex || "",
    digestOk: run?.proofVerification?.digestOk ?? "",
    semanticOk: run?.proofVerification?.semanticOk ?? "",
    freshnessOk: run?.proofVerification?.freshnessOk ?? "",
    bundleFreshnessOk: run?.proofVerification?.bundleFreshnessOk ?? run?.proofVerification?.freshnessOk ?? "",
  }));
}

function summarizeRehearsals(cycles, requirements = {}) {
  const minRuns = requirements.minRuns ?? 3;
  const minNonHold = requirements.minNonHold ?? 3;
  const minRails = requirements.minRails ?? 3;
  const requiredGuards = requirements.requiredGuards ?? DEFAULT_REQUIRED_GUARDS;
  const summaries = [];
  const rows = [];
  const failures = [];
  const aggregateGuardIds = new Set();
  const packageIds = new Set();
  const networks = new Set();
  // proofRef is the git rev-parse HEAD captured by run-testnet-proof-loop.mjs
  // when the per-cycle artifact was minted. Drift between cycles means two
  // halves of the same rehearsal run came from different source trees, which
  // breaks any "this is the rehearsal that produced this code" claim. Track
  // and surface it.
  const proofRefs = new Set();

  for (const entry of cycles) {
    if (entry.error) {
      failures.push(`cycle ${entry.cycle}: runner failed (${entry.error})`);
      summaries.push({
        cycle: entry.cycle,
        ok: false,
        failures: [`cycle ${entry.cycle}: runner failed (${entry.error})`],
        artifactDir: publicArtifactDir(entry.artifactDir),
      });
      continue;
    }
    const loopSummary = summarizeLoop(entry.loop, { cycle: entry.cycle, minRuns, minNonHold, minRails });
    const verifyAfterOk = !entry.verifyAfter || entry.verifyAfter.ok;
    const summary = {
      ...loopSummary,
      ok: loopSummary.ok && verifyAfterOk,
      artifactDir: publicArtifactDir(entry.artifactDir),
      verifyAfter: entry.verifyAfter || null,
    };
    if (summary.verifyAfter && !summary.verifyAfter.ok) {
      failures.push(`cycle ${entry.cycle}: post-ceremony verifier failed (${summary.verifyAfter.status})`);
    }
    for (const guardId of summary.guardIds) aggregateGuardIds.add(guardId);
    if (summary.packageId) packageIds.add(summary.packageId);
    if (summary.network) networks.add(summary.network);
    if (summary.proofRef) proofRefs.add(summary.proofRef);
    summaries.push(summary);
    rows.push(...buildRunRows(entry.loop, entry.cycle));
    failures.push(...summary.failures);
  }

  for (const id of requiredGuards) {
    if (!aggregateGuardIds.has(id)) {
      failures.push(`aggregate: missing passing guard ${id}`);
    }
  }
  if (packageIds.size > 1) {
    failures.push(`aggregate: package id drift across cycles (${[...packageIds].join(", ")})`);
  }
  if (networks.size > 1) {
    failures.push(`aggregate: network drift across cycles (${[...networks].join(", ")})`);
  }
  if (proofRefs.size > 1) {
    failures.push(`aggregate: proof ref drift across cycles (${[...proofRefs].join(", ")})`);
  }

  const proofRefArray = [...proofRefs];
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    ok: failures.length === 0,
    cycleCount: cycles.length,
    successCount: summaries.filter((summary) => summary.ok).length,
    runCount: rows.length,
    nonHoldCount: rows.filter((row) => row.decisionType && row.decisionType !== "Hold").length,
    proofRef: proofRefArray.length === 1 ? proofRefArray[0] : "",
    proofRefs: proofRefArray,
    rails: [...new Set(rows.map((row) => row.railId).filter(Boolean))],
    guardIds: [...aggregateGuardIds].sort(),
    packageIds: [...packageIds],
    networks: [...networks],
    requirements: { minRuns, minNonHold, minRails, requiredGuards },
    failures,
    cycles: summaries,
    runs: rows,
  };
}

function renderRunCsv(rows) {
  const columns = [
    "cycle",
    "runNumber",
    "label",
    "network",
    "packageId",
    "railId",
    "railName",
    "decisionType",
    "limitations",
    "policyObjectId",
    "policyTxDigest",
    "receiptObjectId",
    "receiptTxDigest",
    "contentDigestHex",
    "railPackDigestHex",
    "railDataMode",
    "walrusSource",
    "pythSource",
    "executionMode",
    "claimBoundary",
    "digestOk",
    "semanticOk",
    "freshnessOk",
    "bundleFreshnessOk",
  ];
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
  ].join("\n") + "\n";
}

function renderSummaryMarkdown(report) {
  const status = report.ok ? "PASS" : "FAIL";
  const failureText = report.failures.length
    ? report.failures.map((failure) => `- ${failure}`).join("\n")
    : "- none";
  return [
    "# Proof-loop rehearsal report",
    "",
    `Status: **${status}**`,
    "",
    `Generated: ${report.generatedAt}`,
    `Cycles: ${report.successCount}/${report.cycleCount} passing`,
    `Runs: ${report.runCount}`,
    `Non-Hold receipts: ${report.nonHoldCount}`,
    `Rails: ${report.rails.join(", ") || "none"}`,
    `Guards: ${report.guardIds.join(", ") || "none"}`,
    `Post-ceremony verifier: ${report.cycles.every((cycle) => !cycle.verifyAfter || cycle.verifyAfter.ok) ? "PASS" : "FAIL"}`,
    "",
    "## Failures",
    "",
    failureText,
    "",
  ].join("\n");
}

function writeReportFiles(report, reportDir) {
  mkdirSync(reportDir, { recursive: true });
  const jsonPath = path.join(reportDir, "latest-rehearsal-report.json");
  const csvPath = path.join(reportDir, "latest-rehearsal-runs.csv");
  const mdPath = path.join(reportDir, "latest-rehearsal-summary.md");
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  writeFileSync(csvPath, renderRunCsv(report.runs), "utf8");
  writeFileSync(mdPath, renderSummaryMarkdown(report), "utf8");
  return { jsonPath, csvPath, mdPath };
}

function runVerifierAfterCycle(args, cycle) {
  if (!args.verifyAfter) {
    return null;
  }
  const result = spawnSync(process.execPath, [
    args.verifier,
    "--network", args.network,
    "--env", args.envFile,
  ], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) {
    return {
      ok: false,
      status: 1,
      summary: result.error.message,
      ranAt: new Date().toISOString(),
    };
  }
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    summary: summarizeVerifierOutput(result),
    ranAt: new Date().toISOString(),
    cycle,
  };
}

function runCycle(args, cycle) {
  const cycleLabel = `cycle-${String(cycle).padStart(2, "0")}`;
  const artifactDir = path.join(args.artifactRoot, `${args.timestamp}-${cycleLabel}`);
  mkdirSync(artifactDir, { recursive: true });
  const proofPackPath = path.join(artifactDir, "onchain_mvp_proof_pack.md");
  const runnerArgs = [
    args.runner,
    "--network", args.network,
    "--env", args.envFile,
    "--output-dir", artifactDir,
    "--proof-pack", proofPackPath,
    "--count", String(args.count),
  ];
  const shouldSkipNegative =
    args.negative === "skip" ||
    (args.negative === "once" && cycle > 1);
  if (shouldSkipNegative) runnerArgs.push("--skip-negative");

  const result = spawnSync(process.execPath, runnerArgs, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) {
    throw new Error(result.error.message);
  }
  if (result.status !== 0) {
    throw new Error(compactOutput(result) || `runner exited ${result.status}`);
  }
  const latestPath = path.join(artifactDir, "latest-proof-loop.json");
  if (!existsSync(latestPath)) {
    throw new Error(`runner did not write ${latestPath}`);
  }
  const verifyAfter = runVerifierAfterCycle(args, cycle);
  if (verifyAfter && !verifyAfter.ok) {
    return { cycle, artifactDir, loop: readJson(latestPath), verifyAfter };
  }
  return { cycle, artifactDir, loop: readJson(latestPath), verifyAfter };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cycles = [];
  for (let cycle = 1; cycle <= args.cycles; cycle += 1) {
    process.stdout.write(`[rehearsal] ${cycle}/${args.cycles}: running proof loop\n`);
    try {
      cycles.push(runCycle(args, cycle));
    } catch (error) {
      if (!args.continueOnError) throw error;
      cycles.push({ cycle, artifactDir: "", error: error.message });
    }
  }
  const report = summarizeRehearsals(cycles, {
    minRuns: args.minRuns,
    minNonHold: args.minNonHold,
    minRails: args.minRails,
    requiredGuards: args.requiredGuards,
  });
  const files = writeReportFiles(report, args.reportDir);
  process.stdout.write(
    `[rehearsal] report: ${path.relative(REPO_ROOT, files.jsonPath)}\n` +
    `[rehearsal] csv: ${path.relative(REPO_ROOT, files.csvPath)}\n`
  );
  if (!report.ok) {
    for (const failure of report.failures) {
      process.stderr.write(`[rehearsal] ${failure}\n`);
    }
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`[rehearsal] error: ${error.message}\n`);
    process.exit(1);
  });
}

export {
  buildRunRows,
  csvEscape,
  parseArgs,
  renderRunCsv,
  renderSummaryMarkdown,
  summarizeLoop,
  summarizeRehearsals,
  writeReportFiles,
};
