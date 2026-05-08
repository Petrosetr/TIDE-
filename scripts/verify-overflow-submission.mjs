#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { buildRunRows } from "./run-proof-loop-rehearsals.mjs";

const REQUIRED_FILES = [
  "docs/overflow_2026/submission.md",
  "docs/overflow_2026/architecture.md",
  "docs/overflow_2026/verification_checklist.md",
  "docs/onchain_mvp_proof_pack.md",
  "docs/proof/latest-proof-loop.json",
  "docs/proof/run-01.json",
  "docs/proof/run-02.json",
  "docs/proof/run-03.json",
];

const PUBLIC_SNAPSHOT_MARKER = "PUBLIC_REPO_NOTICE.md";
const PUBLIC_SNAPSHOT_OPTIONAL_REQUIRED_FILES = new Set([
  "docs/overflow_2026/verification_checklist.md",
]);

const REQUIRED_SUBMISSION_PATTERNS = [
  {
    id: "testnet-only",
    pattern: /\btestnet only\b/i,
    message: "Submission must explicitly say the demo is testnet-only.",
  },
  {
    id: "no-mainnet-capital",
    pattern: /\bno mainnet capital\b/i,
    message: "Submission must explicitly say no mainnet capital moved.",
  },
  {
    id: "walrus-stub-disclosure",
    pattern: /Walrus[\s\S]{0,220}(tide-stub:\/\/|stub-mode|proof-pack evidence still explicit|runtime config)/i,
    message: "Submission must disclose the Walrus config boundary and explicit stub-mode fallback.",
  },
  {
    id: "guard-n1",
    pattern: /\bN1\b[\s\S]{0,80}\brail/i,
    message: "Submission must mention the N1 rail-mismatch guard.",
  },
  {
    id: "guard-n2",
    pattern: /\bN2\b[\s\S]{0,80}\brevoked/i,
    message: "Submission must mention the N2 revoked-rail guard.",
  },
  {
    id: "guard-n6",
    pattern: /\bN6\b[\s\S]{0,100}\bcontent[- ]digest/i,
    message: "Submission must mention the N6 content-digest guard.",
  },
  {
    id: "guard-n7",
    pattern: /\bN7\b[\s\S]{0,100}\bstale/i,
    message: "Submission must mention the N7 stale-bundle guard.",
  },
];

// Bounded inside a single `### N<id>.` section — `(?:(?!### )[\s\S])*?` refuses
// to cross into the next `### ` header. The earlier `[\s\S]*?` form could
// match `Actual: PASS` from a later section, so a `PENDING` proof of N6
// would silently pass as long as N7 was `PASS`.
const REQUIRED_PROOF_PACK_PATTERNS = [
  {
    id: "three-runs",
    pattern: /### Run #3\b/,
    message: "Proof pack must include at least three positive runs.",
  },
  {
    id: "n1",
    pattern: /### N1\.(?:(?!### )[\s\S])*?Actual: PASS/i,
    message: "Proof pack must include passing N1 evidence.",
  },
  {
    id: "n2",
    pattern: /### N2\.(?:(?!### )[\s\S])*?Actual: PASS/i,
    message: "Proof pack must include passing N2 evidence.",
  },
  {
    id: "n6",
    pattern: /### N6\.(?:(?!### )[\s\S])*?Actual: PASS/i,
    message: "Proof pack must include passing N6 evidence.",
  },
  {
    id: "n7",
    pattern: /### N7\.(?:(?!### )[\s\S])*?Actual: PASS/i,
    message: "Proof pack must include passing N7 evidence.",
  },
];

// Pending-state markers in submission.md that should warn during development
// (so contributors can land WIP) but hard-fail when TIDE_VERIFY_MODE=final
// (so the submission gate cannot ship with a TBD judge flow).
// Each entry's pattern matches the pending marker; the message is what
// reviewers see in CI logs.
const FINAL_REQUIRED_GATES = [
  {
    id: "judge-url-tbd",
    pattern: /\bjudge URL:?\s*TBD\b/i,
    source: "docs/overflow_2026/submission.md",
    message: "Judge URL is still marked TBD in submission.md.",
  },
];

const VALID_MODES = new Set(["development", "final"]);
const FULL_SUI_ADDRESS_RE = /\b0x[0-9a-f]{64}\b/gi;
const ZERO_ADDRESS_RE = /^0x0{64}$/i;
const FINAL_REHEARSAL_REPORT = "docs/proof/rehearsal/latest-rehearsal-report.json";
const FINAL_REHEARSAL_CSV = "docs/proof/rehearsal/latest-rehearsal-runs.csv";
const FINAL_REHEARSAL_MIN_CYCLES = 10;
const FINAL_REHEARSAL_MIN_RUNS = 50;

// MA-B5: Mainnet-attested bundle validation. Mainnet-attested receipts live
// under docs/proof/mainnet-attested/
// and represent a *founder-personal manual* mainnet action that TIDE
// observed read-only and anchored on testnet. The verifier must understand
// these as a distinct evidence class so a future edit cannot accidentally
// promote them to "TIDE executed mainnet" — that path remains gated to V3.
//
// Validation is "when-present": the directory may be empty, in which case
// no mainnet-attested check runs. When bundles are present, every one must
// satisfy the invariants below or final mode fails.
export const MAINNET_ATTESTED_DIR = "docs/proof/mainnet-attested";
export const MAINNET_ATTESTED_KIND = "tide-mainnet-attested-demo/v1";
export const MAINNET_ATTESTED_RAILS = Object.freeze(["suilend", "scallop", "navi"]);
export const MAINNET_ATTESTED_DECISION_TYPES = Object.freeze([
  "Hold", "BuildBuffer", "BorrowForBuffer", "PartialRepay",
  "EmergencyDeRisk", "ReducePayout", "PausePayout", "RotateVenue",
]);
export const MAINNET_ATTESTED_REQUIRED_CLAIM_BOUNDARY_TOKENS = Object.freeze([
  "founder-manual",
  "TIDE-readonly",
  "testnet-decision-attestation",
]);
// The load-bearing "doesn't confuse with live execution" deny-list. If any
// of these substrings appear in the bundle JSON we fail closed: a future
// edit that tries to promote mainnet-attested to "TIDE-executed" will be
// caught by this gate before it reaches submission.
export const MAINNET_ATTESTED_DENIED_SUBSTRINGS = Object.freeze([
  "live-execution",
  "TIDE-signed-mainnet",
  "tide-signed-mainnet",
  "service-mainnet-execution",
]);
const FINAL_REHEARSAL_GUARDS = Object.freeze(["N1", "N2", "N6", "N7"]);
// proof-ref ↔ deploy-ref disclosure. The rehearsal artifacts are pinned to
// the git ref captured at proof-loop time (`proofRef`), which can lag the
// deployed/submitted ref. Final mode requires that gap to be either zero or
// explicitly disclosed in this document so a judge cross-checking refs sees
// the relationship spelled out in one place.
const FINAL_PROOF_REF_DISCLOSURE = "docs/proof/proof_ref_disclosure.md";
const FINAL_REHEARSAL_REQUIRED_CSV_COLUMNS = Object.freeze([
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
]);
const FINAL_REHEARSAL_CSV_COMPARE_COLUMNS = Object.freeze([
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
  "freshnessOk",
  "bundleFreshnessOk",
]);
const FINAL_REHEARSAL_CHILD_COMPARE_COLUMNS = Object.freeze([
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
]);
const SUI_OBJECT_ID_RE = /^0x[0-9a-f]{64}$/i;
const HEX_DIGEST_RE = /^0x[0-9a-f]{64}$/i;
const TX_DIGEST_RE = /^[1-9A-HJ-NP-Za-km-z]{32,64}$/; // base58, ~44 chars
const MAINNET_ATTESTED_MAX_EVIDENCE_AGE_MS = 30 * 60 * 1000;

function readText(rootDir, relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), "utf8");
}

function fileExists(rootDir, relativePath) {
  return fs.existsSync(path.join(rootDir, relativePath));
}

function requirePattern({ text, id, pattern, message, source, failures }) {
  if (!pattern.test(text)) {
    failures.push(`${source} [${id}]: ${message}`);
  }
}

function parseJson(rootDir, relativePath, failures) {
  try {
    return JSON.parse(readText(rootDir, relativePath));
  } catch (error) {
    failures.push(`${relativePath}: invalid JSON (${error.message})`);
    return null;
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function verifyPublicProofRefs(rootDir, latest, failures) {
  const firstRun = Array.isArray(latest?.runs) ? latest.runs[0] : null;
  const firstReceiptObjectId = String(firstRun?.receiptMint?.objectId || "").trim();
  const latestProofRef = String(latest?.proofRef || "").trim();
  const staleProofTokens = [
    ["0x687a0d97", "488355c768a2386b22cb531f076408d0425e045c9f7f41687b009da3"].join(""),
    ["9885572363dde9f4", "39e97c59b6187567ec8abc40"].join(""),
    ["2026-05-02", " 15:50 UTC"].join(""),
  ];
  const staleProofPattern = new RegExp(staleProofTokens.map(escapeRegExp).join("|"), "i");
  const proofEntrypoints = [
    "docs/public_readme.md",
    "docs/proof/README.md",
  ];
  if (isPublicSnapshotRoot(rootDir)) {
    proofEntrypoints.push("README.md");
  }
  for (const relativePath of proofEntrypoints) {
    if (!fileExists(rootDir, relativePath)) continue;
    const text = readText(rootDir, relativePath);
    if (staleProofPattern.test(text)) {
      failures.push(`${relativePath}: stale public proof reference; update from docs/proof/latest-proof-loop.json`);
    }
    if (SUI_OBJECT_ID_RE.test(firstReceiptObjectId) && !text.includes(firstReceiptObjectId)) {
      failures.push(`${relativePath}: must reference latest proof-loop receipt ${firstReceiptObjectId}`);
    }
  }
  if (latestProofRef && fileExists(rootDir, FINAL_PROOF_REF_DISCLOSURE)) {
    const disclosure = readText(rootDir, FINAL_PROOF_REF_DISCLOSURE);
    if (!disclosure.includes(latestProofRef)) {
      failures.push(`${FINAL_PROOF_REF_DISCLOSURE}: must reference latest single proofRef ${latestProofRef}`);
    }
  }
  if (fileExists(rootDir, "index.html")) {
    const landing = readText(rootDir, "index.html");
    if (staleProofPattern.test(landing)) {
      failures.push("index.html: stale landing proof fallback; update from docs/proof/latest-proof-loop.json");
    }
  }
}

function normalizeCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function parseCsv(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((line) => line.length > 0);
  if (!lines.length) return { columns: [], rows: [] };
  const columns = parseCsvLine(lines[0]);
  return {
    columns,
    rows: lines.slice(1).map((line) => {
      const values = parseCsvLine(line);
      return Object.fromEntries(columns.map((column, index) => [column, values[index] ?? ""]));
    }),
  };
}

function compareRunRows({ label, actualRows, expectedRows, columns, failures }) {
  if (actualRows.length !== expectedRows.length) {
    failures.push(`${label}: expected ${expectedRows.length} rows, got ${actualRows.length}`);
    return;
  }
  actualRows.forEach((actual, index) => {
    const expected = expectedRows[index] || {};
    for (const column of columns) {
      const actualValue = normalizeCell(actual?.[column]);
      const expectedValue = normalizeCell(expected?.[column]);
      if (actualValue !== expectedValue) {
        failures.push(`${label}: row ${index + 1} column ${column} expected ${expectedValue || "<empty>"}, got ${actualValue || "<empty>"}`);
      }
    }
  });
}

function isAllowedPublicArtifactVerification(run) {
  const proof = run?.proofVerification || {};
  if (proof.ok === true || (proof.digestOk === true && proof.semanticOk === true)) {
    return true;
  }
  if (proof.publicArtifactOnly !== true) return false;
  if (proof.digestOk !== false || proof.semanticOk !== false) return false;
  if (proof.freshnessOk !== true || proof.bundleFreshnessOk === false) return false;
  const digestReason = String(proof.digestReason || "");
  const semanticReason = String(proof.semanticReason || "");
  if (!/redacted|public proof/i.test(`${digestReason} ${semanticReason}`)) return false;
  const actualDigest = String(proof.actualDigestHex || "");
  const expectedDigest = String(proof.expectedDigestHex || "");
  const receiptDigest = String(run?.receiptMint?.contentDigestHex || run?.proofBundle?.contentDigestHex || "");
  return HEX_DIGEST_RE.test(actualDigest) &&
    actualDigest === expectedDigest &&
    (!receiptDigest || receiptDigest === actualDigest);
}

function assertSuiObjectId(value, label, failures) {
  const normalized = normalizeCell(value);
  if (!SUI_OBJECT_ID_RE.test(normalized)) {
    failures.push(`${label}=${JSON.stringify(normalized)} is not a 32-byte 0x-prefixed Sui object id`);
  }
}

function assertHexDigest(value, label, failures) {
  if (!HEX_DIGEST_RE.test(normalizeCell(value))) {
    failures.push(`${label}: expected 32-byte hex digest`);
  }
}

function assertTxDigest(value, label, failures) {
  const normalized = normalizeCell(value);
  if (!TX_DIGEST_RE.test(normalized)) {
    failures.push(`${label}=${JSON.stringify(normalized)} is not a base58 tx digest`);
  }
}

function validateRehearsalRows({ rows, failures, publishedPackageId, source }) {
  rows.forEach((row, index) => {
    const label = `${source}: row ${index + 1}`;
    if (normalizeCell(row.network) !== "testnet") {
      failures.push(`${label} network=${JSON.stringify(normalizeCell(row.network))} expected "testnet"`);
    }
    if (publishedPackageId && normalizeCell(row.packageId) !== publishedPackageId) {
      failures.push(`${label} packageId=${normalizeCell(row.packageId)} expected published.testnet.published-at`);
    }
    if (!normalizeCell(row.railId)) {
      failures.push(`${label}: railId is required`);
    }
    if (!normalizeCell(row.decisionType)) {
      failures.push(`${label}: decisionType is required`);
    }
    assertTxDigest(row.policyTxDigest, `${label} policyTxDigest`, failures);
    assertTxDigest(row.receiptTxDigest, `${label} receiptTxDigest`, failures);
    assertSuiObjectId(row.policyObjectId, `${label} policyObjectId`, failures);
    assertSuiObjectId(row.receiptObjectId, `${label} receiptObjectId`, failures);
    assertHexDigest(row.contentDigestHex, `${label} contentDigestHex`, failures);
    assertHexDigest(row.railPackDigestHex, `${label} railPackDigestHex`, failures);
    if (normalizeCell(row.freshnessOk) !== "true") {
      failures.push(`${label}: freshnessOk must be true`);
    }
  });
}

function validateRehearsalCsv(rootDir, report, failures, { publishedPackageId = "" } = {}) {
  if (!fileExists(rootDir, FINAL_REHEARSAL_CSV)) {
    failures.push(`${FINAL_REHEARSAL_CSV}: required final proof rehearsal CSV is missing`);
    return [];
  }
  const parsed = parseCsv(readText(rootDir, FINAL_REHEARSAL_CSV));
  for (const column of FINAL_REHEARSAL_REQUIRED_CSV_COLUMNS) {
    if (!parsed.columns.includes(column)) {
      failures.push(`${FINAL_REHEARSAL_CSV}: missing required column ${column}`);
    }
  }
  const reportRows = Array.isArray(report.runs) ? report.runs : [];
  compareRunRows({
    label: `${FINAL_REHEARSAL_CSV} vs ${FINAL_REHEARSAL_REPORT}`,
    actualRows: parsed.rows,
    expectedRows: reportRows,
    columns: FINAL_REHEARSAL_CSV_COMPARE_COLUMNS,
    failures,
  });
  validateRehearsalRows({
    rows: parsed.rows,
    failures,
    publishedPackageId,
    source: FINAL_REHEARSAL_CSV,
  });
  return parsed.rows;
}

function resolveRehearsalArtifactDir(rootDir, artifactDir, failures, cycleNumber) {
  const raw = String(artifactDir || "");
  if (!raw) {
    failures.push(`${FINAL_REHEARSAL_REPORT}: cycle ${cycleNumber} artifactDir is required`);
    return "";
  }
  if (path.isAbsolute(raw) || raw.split(/[\\/]+/).includes("..")) {
    failures.push(`${FINAL_REHEARSAL_REPORT}: cycle ${cycleNumber} artifactDir must be an in-repo relative path`);
    return "";
  }
  const absolute = path.resolve(rootDir, raw);
  const proofRoot = path.resolve(rootDir, "docs/proof/rehearsals");
  if (absolute !== proofRoot && !absolute.startsWith(`${proofRoot}${path.sep}`)) {
    failures.push(`${FINAL_REHEARSAL_REPORT}: cycle ${cycleNumber} artifactDir must live under docs/proof/rehearsals`);
    return "";
  }
  return absolute;
}

function validateChildRunArtifact({ rootDir, artifactDir, row, childLoop, failures }) {
  const runNumber = Number(row.runNumber);
  if (!Number.isInteger(runNumber) || runNumber <= 0) {
    failures.push(`${artifactDir}: invalid runNumber ${normalizeCell(row.runNumber) || "<empty>"}`);
    return;
  }
  const relativePath = path.join(artifactDir, `run-${String(runNumber).padStart(2, "0")}.json`);
  if (!fileExists(rootDir, relativePath)) {
    failures.push(`${relativePath}: required child run artifact is missing`);
    return;
  }
  const artifact = parseJson(rootDir, relativePath, failures);
  if (!artifact) return;
  if (normalizeCell(artifact.network || childLoop.network) !== normalizeCell(row.network)) {
    failures.push(`${relativePath}: network must match rehearsal row`);
  }
  if (normalizeCell(artifact.setup?.railId || artifact.policyAnchor?.selectedRail) !== normalizeCell(row.railId)) {
    failures.push(`${relativePath}: railId must match rehearsal row`);
  }
  if (normalizeCell(artifact.receiptMint?.objectId) !== normalizeCell(row.receiptObjectId)) {
    failures.push(`${relativePath}: receipt object must match rehearsal row`);
  }
  if (normalizeCell(artifact.receiptMint?.txDigest) !== normalizeCell(row.receiptTxDigest)) {
    failures.push(`${relativePath}: receipt tx digest must match rehearsal row`);
  }
  if (normalizeCell(artifact.receiptMint?.contentDigestHex || artifact.proofBundle?.contentDigestHex) !== normalizeCell(row.contentDigestHex)) {
    failures.push(`${relativePath}: content digest must match rehearsal row`);
  }
  if (!isAllowedPublicArtifactVerification(artifact)) {
    failures.push(`${relativePath}: proof verification must pass or be explicitly marked as a redacted public artifact with matching digest and freshness`);
  }
}

function validateRehearsalChildArtifacts(rootDir, report, failures, { publishedPackageId = "" } = {}) {
  const reportRows = Array.isArray(report.runs) ? report.runs : [];
  const rowsByCycle = new Map();
  for (const row of reportRows) {
    const cycle = normalizeCell(row.cycle);
    if (!rowsByCycle.has(cycle)) rowsByCycle.set(cycle, []);
    rowsByCycle.get(cycle).push(row);
  }
  const cycles = Array.isArray(report.cycles) ? report.cycles : [];
  for (const cycle of cycles) {
    const cycleNumber = Number(cycle?.cycle);
    const cycleLabel = Number.isInteger(cycleNumber) ? String(cycleNumber) : normalizeCell(cycle?.cycle);
    const absoluteDir = resolveRehearsalArtifactDir(rootDir, cycle?.artifactDir, failures, cycleLabel || "?");
    if (!absoluteDir) continue;
    const artifactDir = path.relative(rootDir, absoluteDir);
    const loopPath = path.join(artifactDir, "latest-proof-loop.json");
    if (!fileExists(rootDir, loopPath)) {
      failures.push(`${loopPath}: required child proof-loop artifact is missing`);
      continue;
    }
    if (!fileExists(rootDir, path.join(artifactDir, "onchain_mvp_proof_pack.md"))) {
      failures.push(`${path.join(artifactDir, "onchain_mvp_proof_pack.md")}: required child proof-pack snapshot is missing`);
    }
    const childLoop = parseJson(rootDir, loopPath, failures);
    if (!childLoop) continue;
    if (normalizeCell(childLoop.network) !== "testnet" || normalizeCell(childLoop.network) !== normalizeCell(cycle.network)) {
      failures.push(`${loopPath}: network must match cycle summary and be testnet`);
    }
    if (publishedPackageId && normalizeCell(childLoop.packageId) !== publishedPackageId) {
      failures.push(`${loopPath}: packageId must match move/Published.toml`);
    }
    if (normalizeCell(childLoop.packageId) !== normalizeCell(cycle.packageId)) {
      failures.push(`${loopPath}: packageId must match cycle summary`);
    }
    const expectedRows = rowsByCycle.get(String(cycleNumber)) || [];
    const actualRows = buildRunRows(childLoop, cycleNumber);
    compareRunRows({
      label: `${loopPath} vs ${FINAL_REHEARSAL_REPORT}`,
      actualRows,
      expectedRows,
      columns: FINAL_REHEARSAL_CHILD_COMPARE_COLUMNS,
      failures,
    });
    validateRehearsalRows({
      rows: actualRows,
      failures,
      publishedPackageId,
      source: loopPath,
    });
    for (const row of actualRows) {
      const run = Array.isArray(childLoop.runs)
        ? childLoop.runs.find((entry) => Number(entry?.runNumber) === Number(row.runNumber))
        : null;
      if (!run || !isAllowedPublicArtifactVerification(run)) {
        failures.push(`${loopPath}: run ${normalizeCell(row.runNumber) || "?"} proof verification must pass or be explicitly redacted-public with matching digest and freshness`);
      }
      validateChildRunArtifact({ rootDir, artifactDir, row, childLoop, failures });
    }
  }
}

function walkJson(value, visitor, path = []) {
  visitor(value, path);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkJson(entry, visitor, [...path, index]));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      walkJson(entry, visitor, [...path, key]);
    }
  }
}

function isRedactedCanonicalContainer(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value.redacted === true || value.canonicalKind === "redacted-summary" || typeof value.redactionNotice === "string")
  );
}

function scanProofPackPrivacy(rootDir, failures) {
  const relativePath = "docs/onchain_mvp_proof_pack.md";
  if (!fileExists(rootDir, relativePath)) return;
  const lines = readText(rootDir, relativePath).split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!/operator/i.test(line)) return;
    const addresses = line.match(FULL_SUI_ADDRESS_RE) || [];
    const leaked = addresses.some((address) => !ZERO_ADDRESS_RE.test(address.toLowerCase()));
    if (leaked) {
      failures.push(`${relativePath}:${index + 1}: operator wallet must be redacted in public proof pack`);
    }
  });
}

function scanProofBundlePrivacy(rootDir, failures) {
  const proofDir = path.join(rootDir, "docs/proof");
  if (!fs.existsSync(proofDir)) return;
  const files = fs.readdirSync(proofDir)
    .filter((name) => name === "latest-proof-loop.json" || /^run-\d+\.json$/.test(name) || /^wallet-rehearsal.*\.json$/.test(name))
    .sort();
  for (const name of files) {
    const relativePath = `docs/proof/${name}`;
    const text = readText(rootDir, relativePath);
    if (/"inputs"\s*:/.test(text)) {
      failures.push(`${relativePath}: proof artifacts must not include raw report.inputs`);
    }
    const parsed = parseJson(rootDir, relativePath, failures);
    if (!parsed) continue;
    const operatorAddress = String(parsed.operatorAddress || "");
    if (operatorAddress && !/^0x0{64}$/.test(operatorAddress)) {
      failures.push(`${relativePath}: operatorAddress must be redacted before commit`);
    }
    walkJson(parsed, (value, jsonPath) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      const redactedProof =
        isRedactedCanonicalContainer(value.proofBundle) ||
        isRedactedCanonicalContainer(value.receiptMint) ||
        isRedactedCanonicalContainer(value);
      if (redactedProof && value.proofVerification?.ok === true) {
        failures.push(`${relativePath}: redacted public proof JSON at ${jsonPath.join(".") || "<root>"} must not claim proofVerification.ok=true`);
      }
      if (typeof value.canonical !== "string") return;
      if (/"inputs"\s*:/.test(value.canonical)) {
        failures.push(`${relativePath}: canonical proof JSON must not include raw report.inputs`);
      }
      const containsRedactedOperator = ZERO_ADDRESS_RE.test(String(value?.operatorAddress || "")) ||
        value.canonical.includes("0x0000000000000000000000000000000000000000000000000000000000000000");
      if (containsRedactedOperator) {
        if (value.canonicalKind !== "redacted-summary" || !/redacted/i.test(String(value.redactionNotice || ""))) {
          failures.push(`${relativePath}: redacted canonical JSON at ${jsonPath.join(".") || "<root>"} must include canonicalKind=redacted-summary and redactionNotice`);
        }
      }
    });
  }
}

function readPublishedTestnetPackageId(rootDir, failures) {
  const relativePath = "move/Published.toml";
  if (!fileExists(rootDir, relativePath)) {
    failures.push(`${relativePath}: required published package manifest is missing`);
    return "";
  }
  const text = readText(rootDir, relativePath);
  const match = text.match(/\[published\.testnet\][\s\S]*?published-at\s*=\s*"([^"]+)"/);
  const packageId = match?.[1] || "";
  if (!/^0x[0-9a-f]{64}$/i.test(packageId)) {
    failures.push(`${relativePath}: published.testnet.published-at must be a 32-byte Sui object id`);
  }
  return packageId;
}

function verifyFinalProofRehearsal(rootDir, failures, { publishedPackageId = "" } = {}) {
  if (!fileExists(rootDir, FINAL_REHEARSAL_REPORT)) {
    failures.push(`${FINAL_REHEARSAL_REPORT}: required final proof rehearsal aggregate is missing`);
    return;
  }
  const report = parseJson(rootDir, FINAL_REHEARSAL_REPORT, failures);
  if (!report) return;

  if (report.ok !== true) {
    failures.push(`${FINAL_REHEARSAL_REPORT}: aggregate ok must be true`);
  }
  const cycleCount = Number(report.cycleCount);
  const successCount = Number(report.successCount);
  const runCount = Number(report.runCount);
  if (!Number.isFinite(cycleCount) || cycleCount < FINAL_REHEARSAL_MIN_CYCLES) {
    failures.push(`${FINAL_REHEARSAL_REPORT}: expected at least ${FINAL_REHEARSAL_MIN_CYCLES} cycles`);
  }
  if (!Number.isFinite(successCount) || successCount < FINAL_REHEARSAL_MIN_CYCLES || successCount !== cycleCount) {
    failures.push(`${FINAL_REHEARSAL_REPORT}: expected ${cycleCount || FINAL_REHEARSAL_MIN_CYCLES}/${cycleCount || FINAL_REHEARSAL_MIN_CYCLES} passing cycles`);
  }
  if (!Number.isFinite(runCount) || runCount < FINAL_REHEARSAL_MIN_RUNS) {
    failures.push(`${FINAL_REHEARSAL_REPORT}: expected at least ${FINAL_REHEARSAL_MIN_RUNS} proof runs`);
  }
  const guardIds = new Set((Array.isArray(report.guardIds) ? report.guardIds : [])
    .map((id) => String(id || "").trim())
    .filter(Boolean));
  for (const guardId of FINAL_REHEARSAL_GUARDS) {
    if (!guardIds.has(guardId)) {
      failures.push(`${FINAL_REHEARSAL_REPORT}: missing aggregate guard ${guardId}`);
    }
  }
  const networks = new Set((Array.isArray(report.networks) ? report.networks : [])
    .map((network) => String(network || "").trim())
    .filter(Boolean));
  if (!networks.has("testnet") || networks.size !== 1) {
    failures.push(`${FINAL_REHEARSAL_REPORT}: expected testnet-only rehearsal network`);
  }
  const packageIds = new Set((Array.isArray(report.packageIds) ? report.packageIds : [])
    .map((packageId) => String(packageId || "").trim())
    .filter(Boolean));
  if (publishedPackageId && (!packageIds.has(publishedPackageId) || packageIds.size !== 1)) {
    failures.push(`${FINAL_REHEARSAL_REPORT}: packageIds must match move/Published.toml published.testnet.published-at`);
  }
  // proofRef drift gate. Aggregate must declare a single canonical proofRef
  // (40-hex git sha). When that ref differs from the deployed/submitted ref,
  // proof_ref_disclosure.md must explicitly map proofRef → deploy and explain
  // why they differ. Otherwise a judge reading the proof artifacts sees one
  // sha while reading the deploy/release manifest sees another and has no
  // path to reconcile them.
  const proofRefList = Array.isArray(report.proofRefs)
    ? report.proofRefs.map((ref) => String(ref || "").trim()).filter(Boolean)
    : [];
  const proofRef = String(report.proofRef || "").trim();
  if (!/^[0-9a-f]{40}$/i.test(proofRef)) {
    failures.push(`${FINAL_REHEARSAL_REPORT}: proofRef must be a 40-char git sha (got ${JSON.stringify(proofRef)})`);
  }
  if (proofRefList.length > 1) {
    failures.push(`${FINAL_REHEARSAL_REPORT}: proofRefs must be a single ref (got ${proofRefList.join(", ")})`);
  }
  if (!fileExists(rootDir, FINAL_PROOF_REF_DISCLOSURE)) {
    failures.push(`${FINAL_PROOF_REF_DISCLOSURE}: required proof-ref disclosure is missing`);
  } else if (proofRef) {
    const disclosure = readText(rootDir, FINAL_PROOF_REF_DISCLOSURE);
    if (!disclosure.includes(proofRef)) {
      failures.push(`${FINAL_PROOF_REF_DISCLOSURE}: must reference current proofRef ${proofRef}`);
    }
  }
  const runs = Array.isArray(report.runs) ? report.runs : [];
  if (runs.length !== runCount) {
    failures.push(`${FINAL_REHEARSAL_REPORT}: runs array length must match runCount`);
  }
  validateRehearsalRows({
    rows: runs,
    failures,
    publishedPackageId,
    source: FINAL_REHEARSAL_REPORT,
  });
  const cycles = Array.isArray(report.cycles) ? report.cycles : [];
  if (cycles.length < FINAL_REHEARSAL_MIN_CYCLES) {
    failures.push(`${FINAL_REHEARSAL_REPORT}: expected at least ${FINAL_REHEARSAL_MIN_CYCLES} cycle summaries`);
  }
  cycles.forEach((cycle, index) => {
    if (cycle?.ok !== true) {
      failures.push(`${FINAL_REHEARSAL_REPORT}: cycle ${cycle?.cycle || index + 1} is not passing`);
    }
    if (cycle?.verifyAfter?.ok !== true) {
      failures.push(`${FINAL_REHEARSAL_REPORT}: cycle ${cycle?.cycle || index + 1} verifyAfter must be PASS`);
    }
  });
  // Cross-check the JSON aggregate against the run-by-run CSV and the child
  // artifacts. Without these links, a hand-edited aggregate can claim 10x50
  // passing runs while the row-level evidence underneath says otherwise.
  // `digestOk` / `semanticOk` in the CSV may describe a redacted public JSON
  // summary, so the CSV comparison does not treat those two columns as runtime
  // truth; child run artifacts still have to pass or be explicitly marked as
  // redacted public artifacts with matching digest/freshness.
  validateRehearsalCsv(rootDir, report, failures, { publishedPackageId });
  validateRehearsalChildArtifacts(rootDir, report, failures, { publishedPackageId });
}

function resolveMode(rawMode, env = process.env) {
  const mode = String(rawMode ?? env.TIDE_VERIFY_MODE ?? "development").toLowerCase();
  if (!VALID_MODES.has(mode)) {
    throw new Error(`Unknown TIDE_VERIFY_MODE='${mode}'. Use 'development' or 'final'.`);
  }
  return mode;
}

// MA-B5: validate every bundle file under docs/proof/mainnet-attested/.
// Pure validation: opens each *.bundle.json, applies schema invariants
// + the "doesn't conflate with live execution" deny-list. Returns
// { count, validated } so the caller can include it in the report.
export function validateMainnetAttestedBundles(rootDir, failures, { now = Date.now() } = {}) {
  const dirAbs = path.join(rootDir, MAINNET_ATTESTED_DIR);
  if (!fs.existsSync(dirAbs)) {
    return { count: 0, validated: 0 };
  }
  let entries;
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch (error) {
    failures.push(`${MAINNET_ATTESTED_DIR}: cannot read directory (${error.message})`);
    return { count: 0, validated: 0 };
  }
  const bundles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".bundle.json"))
    .map((entry) => path.join(MAINNET_ATTESTED_DIR, entry.name))
    .sort();
  let validated = 0;
  for (const relativePath of bundles) {
    const ok = validateOneMainnetAttestedBundle(rootDir, relativePath, failures, { now });
    if (ok) validated += 1;
  }
  return { count: bundles.length, validated };
}

function validateOneMainnetAttestedBundle(rootDir, relativePath, failures, { now = Date.now() } = {}) {
  const text = readText(rootDir, relativePath);
  // Anti-promotion deny-list runs against the raw text BEFORE parse —
  // catches any string a future edit could sneak in even if the JSON
  // shape is otherwise valid.
  for (const denied of MAINNET_ATTESTED_DENIED_SUBSTRINGS) {
    if (text.toLowerCase().includes(denied.toLowerCase())) {
      failures.push(`${relativePath}: contains forbidden substring '${denied}' — mainnet-attested bundles must not claim TIDE-side mainnet execution`);
      return false;
    }
  }
  let bundle;
  try {
    bundle = JSON.parse(text);
  } catch (error) {
    failures.push(`${relativePath}: invalid JSON (${error.message})`);
    return false;
  }
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    failures.push(`${relativePath}: bundle must be a JSON object`);
    return false;
  }
  let ok = true;
  const fail = (msg) => { failures.push(`${relativePath}: ${msg}`); ok = false; };

  if (bundle.kind !== MAINNET_ATTESTED_KIND) {
    fail(`kind must be '${MAINNET_ATTESTED_KIND}', got '${bundle.kind}'`);
  }
  if (Number(bundle.schemaVersion) !== 1) {
    fail(`schemaVersion must be 1, got '${bundle.schemaVersion}'`);
  }
  if (!MAINNET_ATTESTED_RAILS.includes(bundle.rail)) {
    fail(`rail must be one of ${MAINNET_ATTESTED_RAILS.join("|")}, got '${bundle.rail}'`);
  }
  if (typeof bundle.railId !== "string" || bundle.railId !== `${bundle.rail}-sui`) {
    fail(`railId must be '${bundle.rail}-sui', got '${bundle.railId}'`);
  }
  if (!bundle.network || typeof bundle.network !== "object") {
    fail(`network block is required`);
  } else {
    if (bundle.network.mainnetReadback !== "mainnet") {
      fail(`network.mainnetReadback must be 'mainnet', got '${bundle.network.mainnetReadback}'`);
    }
    if (bundle.network.receiptMint !== "testnet") {
      fail(`network.receiptMint must be 'testnet' (mainnet receipt mint is forbidden until V3), got '${bundle.network.receiptMint}'`);
    }
  }
  const claimBoundary = String(bundle.claimBoundary || "");
  for (const token of MAINNET_ATTESTED_REQUIRED_CLAIM_BOUNDARY_TOKENS) {
    if (!claimBoundary.includes(token)) {
      fail(`claimBoundary must include '${token}'`);
    }
  }
  if (!MAINNET_ATTESTED_DECISION_TYPES.includes(bundle.decisionType)) {
    fail(`decisionType must be one of the canonical 8 enum values, got '${bundle.decisionType}'`);
  }
  if (bundle.limitations !== "testnet-rehearsal") {
    fail(`limitations must be 'testnet-rehearsal' (mainnet-attested receipts mint on testnet), got '${bundle.limitations}'`);
  }
  const owner = String(bundle.ownerAddress || "").toLowerCase();
  const evidenceSender = String(bundle.mainnetEvidence?.sender || "").toLowerCase();
  if (!SUI_OBJECT_ID_RE.test(owner)) {
    fail(`ownerAddress must be a full 0x-prefixed Sui address`);
  }
  if (!evidenceSender) {
    fail(`mainnetEvidence.sender is required`);
  } else if (!SUI_OBJECT_ID_RE.test(evidenceSender)) {
    fail(`mainnetEvidence.sender must be a full 0x-prefixed Sui address`);
  } else if (owner && evidenceSender !== owner) {
    fail(`mainnetEvidence.sender (${evidenceSender}) must match ownerAddress (${owner})`);
  }
  const obligationId = String(bundle.obligationId || "").toLowerCase();
  const evidenceObligation = String(bundle.mainnetEvidence?.obligationId || "").toLowerCase();
  if (!SUI_OBJECT_ID_RE.test(obligationId)) {
    fail(`obligationId must be a full 0x-prefixed Sui object id`);
  }
  if (!evidenceObligation) {
    fail(`mainnetEvidence.obligationId is required`);
  } else if (!SUI_OBJECT_ID_RE.test(evidenceObligation)) {
    fail(`mainnetEvidence.obligationId must be a full 0x-prefixed Sui object id`);
  } else if (obligationId && evidenceObligation !== obligationId) {
    fail(`mainnetEvidence.obligationId (${evidenceObligation}) must match top-level obligationId (${obligationId})`);
  }
  if (!bundle.mainnetEvidence?.digest || !TX_DIGEST_RE.test(String(bundle.mainnetEvidence.digest))) {
    fail(`mainnetEvidence.digest must be a base58 Sui tx digest`);
  }
  if (typeof bundle.mainnetEvidence?.checkpoint !== "string" || !bundle.mainnetEvidence.checkpoint.trim()) {
    fail(`mainnetEvidence.checkpoint is required`);
  }
  const evidenceTimestampMs = Number(bundle.mainnetEvidence?.timestampMs);
  if (!Number.isFinite(evidenceTimestampMs) || evidenceTimestampMs <= 0) {
    fail(`mainnetEvidence.timestampMs must be a positive number`);
  }
  const objectChangeCount = Number(bundle.mainnetEvidence?.objectChangeCount);
  if (!Number.isInteger(objectChangeCount) || objectChangeCount <= 0) {
    fail(`mainnetEvidence.objectChangeCount must be a positive integer`);
  }
  const observedAtMs = Date.parse(String(bundle.observedAt || ""));
  if (!Number.isFinite(observedAtMs)) {
    fail(`observedAt must be an ISO timestamp`);
  } else if (Number.isFinite(evidenceTimestampMs)) {
    const ageMs = observedAtMs - evidenceTimestampMs;
    if (ageMs < 0) {
      fail(`observedAt must not be earlier than mainnetEvidence.timestampMs`);
    } else if (ageMs > MAINNET_ATTESTED_MAX_EVIDENCE_AGE_MS) {
      fail(`mainnetEvidence.timestampMs is stale relative to observedAt (${ageMs}ms > ${MAINNET_ATTESTED_MAX_EVIDENCE_AGE_MS}ms)`);
    }
  }
  for (const phase of ["pre", "post"]) {
    const r = bundle[phase];
    if (!r || typeof r !== "object") {
      fail(`${phase}: readback object is required`);
      continue;
    }
    if (!Number.isFinite(Number(r.ltvBps))) {
      fail(`${phase}.ltvBps must be a number`);
    }
    if (!Number.isFinite(Number(r.debtUsd))) {
      fail(`${phase}.debtUsd must be a number`);
    }
    if (!Number.isFinite(Number(r.collateralUsd))) {
      fail(`${phase}.collateralUsd must be a number`);
    }
    for (const field of ["walletAddress", "obligationId", "objectOwnerAddress", "ownerCapId"]) {
      if (r[field] !== undefined && !SUI_OBJECT_ID_RE.test(String(r[field]).toLowerCase())) {
        fail(`${phase}.${field} must be a full 0x-prefixed Sui object id/address`);
      }
    }
  }
  const preMs = Date.parse(String(bundle.pre?.observedAt || ""));
  const postMs = Date.parse(String(bundle.post?.observedAt || ""));
  if (!Number.isFinite(preMs)) {
    fail(`pre.observedAt must be an ISO timestamp`);
  }
  if (!Number.isFinite(postMs)) {
    fail(`post.observedAt must be an ISO timestamp`);
  }
  if (Number.isFinite(preMs) && Number.isFinite(evidenceTimestampMs) && Number.isFinite(postMs) &&
      !(preMs < evidenceTimestampMs && evidenceTimestampMs <= postMs)) {
    fail(`mainnet evidence ordering must satisfy pre.observedAt < mainnetEvidence.timestampMs <= post.observedAt`);
  }
  if (bundle.rail === "suilend" &&
      bundle.pre?.eventOnly !== true &&
      bundle.post?.eventOnly !== true &&
      bundle.pre?.valuesParsed !== false &&
      bundle.post?.valuesParsed !== false) {
    const preDebtUsd = Number(bundle.pre?.debtUsd);
    const postDebtUsd = Number(bundle.post?.debtUsd);
    const preLtvBps = Number(bundle.pre?.ltvBps);
    const postLtvBps = Number(bundle.post?.ltvBps);
    if (Number.isFinite(preDebtUsd) && Number.isFinite(postDebtUsd) &&
        Number.isFinite(preLtvBps) && Number.isFinite(postLtvBps) &&
        preDebtUsd > 0 &&
        !(postDebtUsd < preDebtUsd || postLtvBps < preLtvBps)) {
      fail(`Suilend mainnet-attested repay evidence must reduce debt or debt pressure in post-state`);
    }
  }
  return ok;
}

const DEFAULT_EXPORT_ROOT = path.join("dist", "overflow-submission-repo");

function findNonEmptyNodeModulesDirs(root) {
  const found = [];
  if (!fs.existsSync(root)) return found;

  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.name === "node_modules") {
        let children = [];
        try {
          children = fs.readdirSync(fullPath);
        } catch {
          children = [];
        }
        if (children.length > 0) found.push(fullPath);
        continue;
      }
      walk(fullPath);
    }
  };

  walk(root);
  return found;
}

function verifyExportRootNodeModules(rootDir, failures, env = process.env) {
  const exportRoot = String(env.TIDE_OVERFLOW_EXPORT_ROOT || DEFAULT_EXPORT_ROOT).trim();
  if (!exportRoot) return;
  const absoluteRoot = path.isAbsolute(exportRoot)
    ? exportRoot
    : path.join(rootDir, exportRoot);
  if (!fs.existsSync(absoluteRoot)) return;

  for (const dir of findNonEmptyNodeModulesDirs(absoluteRoot)) {
    failures.push(`${path.relative(rootDir, dir)}: node_modules must not be present in the public Overflow export`);
  }
}

export function isPublicSnapshotRoot(rootDir) {
  return fileExists(rootDir, PUBLIC_SNAPSHOT_MARKER);
}

export function requiredFilesForRoot(rootDir) {
  if (!isPublicSnapshotRoot(rootDir)) return REQUIRED_FILES;
  return REQUIRED_FILES.filter((relativePath) => !PUBLIC_SNAPSHOT_OPTIONAL_REQUIRED_FILES.has(relativePath));
}

export function runVerification({ cwd = process.cwd(), mode, env = process.env } = {}) {
  const rootDir = cwd;
  const resolvedMode = resolveMode(mode, env);
  const failures = [];
  const warnings = [];

  verifyExportRootNodeModules(rootDir, failures, env);

  for (const relativePath of requiredFilesForRoot(rootDir)) {
    if (!fileExists(rootDir, relativePath)) {
      failures.push(`${relativePath}: required Overflow artifact is missing`);
    }
  }

  if (failures.length === 0) {
    const submission = readText(rootDir, "docs/overflow_2026/submission.md");
    for (const check of REQUIRED_SUBMISSION_PATTERNS) {
      requirePattern({
        text: submission,
        source: "docs/overflow_2026/submission.md",
        failures,
        ...check,
      });
    }

    for (const gate of FINAL_REQUIRED_GATES) {
      const text = readText(rootDir, gate.source);
      if (!gate.pattern.test(text)) continue;
      const legacyForcesFail = gate.legacyEnvOverride && env[gate.legacyEnvOverride] === "1";
      const finalMode = resolvedMode === "final";
      if (finalMode || legacyForcesFail) {
        failures.push(`${gate.source} [${gate.id}]: ${gate.message}`);
      } else {
        warnings.push(`${gate.source} [${gate.id}]: ${gate.message}`);
      }
    }

    const proofPack = readText(rootDir, "docs/onchain_mvp_proof_pack.md");
    const publishedPackageId = readPublishedTestnetPackageId(rootDir, failures);
    for (const check of REQUIRED_PROOF_PACK_PATTERNS) {
      requirePattern({
        text: proofPack,
        source: "docs/onchain_mvp_proof_pack.md",
        failures,
        ...check,
      });
    }
    if (publishedPackageId && !proofPack.includes(publishedPackageId)) {
      failures.push("docs/onchain_mvp_proof_pack.md: missing current testnet package id from move/Published.toml");
    }
    scanProofPackPrivacy(rootDir, failures);
    scanProofBundlePrivacy(rootDir, failures);
    // MA-B5: Validate any mainnet-attested bundles regardless of mode.
    // Validate-when-present so dev mode catches mistakes early; final
    // mode treats every failure as blocking via the shared `failures`
    // accumulator. Empty directory is fine.
    validateMainnetAttestedBundles(rootDir, failures);
    if (resolvedMode === "final") {
      verifyFinalProofRehearsal(rootDir, failures, { publishedPackageId });
    }

    const latest = parseJson(rootDir, "docs/proof/latest-proof-loop.json", failures);
    if (latest) {
      const latestPackageId = String(latest.packageId || "").trim();
      if (publishedPackageId && latestPackageId !== publishedPackageId) {
        failures.push("docs/proof/latest-proof-loop.json: packageId must match move/Published.toml published.testnet.published-at");
      }
      const runs = Array.isArray(latest.runs) ? latest.runs : [];
      if (runs.length < 3) {
        failures.push("docs/proof/latest-proof-loop.json: expected at least 3 proof runs");
      }
      const nonHoldRuns = runs.filter((run) => {
        const decisionType = String(run?.receiptMint?.decisionType || run?.receipt?.decisionType || "");
        return decisionType && decisionType !== "Hold";
      });
      if (nonHoldRuns.length < 3) {
        failures.push("docs/proof/latest-proof-loop.json: expected at least 3 non-Hold action receipts");
      }
      const positiveRails = new Set(runs.slice(0, 3)
        .map((run) => String(run?.setup?.railId || run?.policyAnchor?.selectedRail || ""))
        .filter(Boolean));
      if (positiveRails.size < 3) {
        failures.push("docs/proof/latest-proof-loop.json: first 3 proof runs must rotate across 3 rails");
      }
      const guardIds = new Set((Array.isArray(latest.guardChecks) ? latest.guardChecks : [])
        .filter((check) => check?.ok)
        .map((check) => check.id));
      for (const id of ["N1", "N2", "N6", "N7"]) {
        if (!guardIds.has(id)) {
          failures.push(`docs/proof/latest-proof-loop.json: missing passing guard ${id}`);
        }
      }
      verifyPublicProofRefs(rootDir, latest, failures);
    }
  }

  return { mode: resolvedMode, failures, warnings };
}

export {
  REQUIRED_FILES,
  REQUIRED_SUBMISSION_PATTERNS,
  REQUIRED_PROOF_PACK_PATTERNS,
  FINAL_REQUIRED_GATES,
  FINAL_REHEARSAL_REQUIRED_CSV_COLUMNS,
  FINAL_REHEARSAL_CSV_COMPARE_COLUMNS,
  FINAL_REHEARSAL_CHILD_COMPARE_COLUMNS,
};

export function runCli({ cwd = process.cwd(), env = process.env, stdout = console.log, stderr = console.error, exit = process.exit } = {}) {
  const result = runVerification({ cwd, env });

  if (result.failures.length) {
    stderr("Overflow submission verification failed.");
    stderr(`Mode: ${result.mode}`);
    for (const failure of result.failures) {
      stderr(`- ${failure}`);
    }
    exit(1);
    return result;
  }

  stdout(`Overflow submission verification passed (mode=${result.mode}).`);
  if (result.warnings.length) {
    stdout("Warnings:");
    for (const warning of result.warnings) {
      stdout(`- ${warning}`);
    }
  }
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runCli();
}
