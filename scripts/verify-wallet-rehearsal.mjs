#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateRehearsalRecord } from "../shadow-mode/lib/wallet-rehearsal.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DIR = path.join(ROOT, "docs", "proof");
const DEFAULT_PREFIX = "wallet-rehearsal";
const DEFAULT_SUFFIX = ".json";
// 30-day budget on rehearsal record freshness when --require / final mode
// is in effect. The wallet rehearsal exercises the human-in-the-loop
// signing flow; if wallet.js regresses between rehearsal and submit, a
// month-old structurally-valid record silently passes. 30 days is the
// common "founder-rehearses-then-week-of-iteration-then-submit" window;
// override with TIDE_REHEARSAL_MAX_AGE_DAYS if a longer baseline is
// genuinely warranted.
const DEFAULT_REHEARSAL_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function relativePath(file, root = ROOT) {
  return path.relative(root, file) || ".";
}

function resolveInputFile(file, root = ROOT) {
  return path.isAbsolute(file) ? file : path.join(root, file);
}

function isFinalVerifyMode(env = process.env) {
  return String(env.TIDE_VERIFY_MODE || "").trim().toLowerCase() === "final";
}

export function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const files = [];
  let help = false;
  let json = false;
  let requireRecord = isFinalVerifyMode(env);

  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") {
      help = true;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--require") {
      requireRecord = true;
    } else {
      files.push(arg);
    }
  }

  return { files, help, json, requireRecord };
}

export async function findDefaultRecords({ root = ROOT } = {}) {
  const dir = path.join(root, "docs", "proof");
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  return entries
    .filter(
      (entry) => entry.isFile()
        && entry.name.startsWith(DEFAULT_PREFIX)
        && entry.name.endsWith(DEFAULT_SUFFIX),
    )
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

function resolveExpectedGitShortShaOverride(env = process.env) {
  // Founder/operator override. Set TIDE_REHEARSAL_EXPECTED_SHA when the
  // final gate must pin a rehearsal artifact to an exact build. Without
  // the override, --require still demands that the record carry its
  // captured gitShortSha and freshness window, but it does not force a
  // manual browser rehearsal rerun after every docs/CSS commit. That
  // keeps the audit trail explicit without creating a circular "commit
  // hash inside its own commit" requirement.
  const override = String(env.TIDE_REHEARSAL_EXPECTED_SHA || "").trim();
  if (override) return override;
  return "";
}

export async function verifyWalletRehearsalFiles(
  files = [],
  {
    root = ROOT,
    requireRecord = false,
    maxAgeMs = DEFAULT_REHEARSAL_MAX_AGE_MS,
    expectedGitShortSha = null,
    now = Date.now(),
  } = {},
) {
  const resolvedFiles = files.length
    ? files.map((file) => resolveInputFile(file, root))
    : await findDefaultRecords({ root });
  const records = [];
  const warnings = [];
  const failures = [];

  if (!resolvedFiles.length) {
    const message = "no wallet rehearsal records found under docs/proof; founder still needs to run the browser-wallet rehearsal";
    if (requireRecord) {
      failures.push(message);
    } else {
      warnings.push(message);
    }
    return {
      ok: failures.length === 0,
      files: [],
      records,
      warnings,
      failures,
    };
  }

  // Freshness + build-binding only kick in under `--require` (or final
  // mode). Default validation stays structural so rehearsals captured
  // pre-B6 do not retroactively fail dev-mode verifies.
  const resolvedExpectedGitShortSha = requireRecord
    ? (typeof expectedGitShortSha === "string"
        ? expectedGitShortSha
        : resolveExpectedGitShortShaOverride())
    : "";
  const validateOptions = requireRecord
    ? {
        maxAgeMs,
        expectedGitShortSha: resolvedExpectedGitShortSha,
        now,
      }
    : {};

  for (const file of resolvedFiles) {
    let record;
    try {
      record = JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error) {
      failures.push(`${relativePath(file, root)}: cannot read or parse JSON: ${error.message}`);
      continue;
    }

    const validation = validateRehearsalRecord(record, validateOptions);
    if (requireRecord && !(typeof record?.gitShortSha === "string" && record.gitShortSha.trim())) {
      validation.ok = false;
      validation.failures.push("gitShortSha is required for required wallet rehearsal records");
    }
    const stepCount = Array.isArray(record?.steps) ? record.steps.length : 0;
    records.push({
      file,
      ok: validation.ok,
      network: record?.network || "",
      packageId: record?.packageId || "",
      stepCount,
      failures: validation.failures,
    });

    if (!validation.ok) {
      failures.push(`${relativePath(file, root)}: ${validation.failures.join("; ")}`);
    }
  }

  return {
    ok: failures.length === 0,
    files: resolvedFiles,
    records,
    warnings,
    failures,
  };
}

function usage() {
  return [
    "Usage:",
    "  node scripts/verify-wallet-rehearsal.mjs [--require] [--json] [record.json ...]",
    "",
    "Without explicit files, validates docs/proof/wallet-rehearsal*.json.",
    "Without --require, an absent manual record is a warning so normal CI can pass.",
    "When TIDE_VERIFY_MODE=final is set, a manual record is required even without --require.",
    "With --require, an absent manual record fails the final submission gate.",
  ].join("\n");
}

function printHumanResult(result) {
  for (const warning of result.warnings) {
    console.warn(`wallet rehearsal: WARN: ${warning}`);
  }
  for (const record of result.records) {
    const label = relativePath(record.file);
    if (record.ok) {
      console.log(`wallet rehearsal: PASS ${label} (${record.stepCount} steps, ${record.network})`);
    } else {
      console.error(`wallet rehearsal: FAIL ${label}`);
      for (const failure of record.failures) {
        console.error(`  - ${failure}`);
      }
    }
  }
  for (const failure of result.failures) {
    if (!failure.includes(":")) {
      console.error(`wallet rehearsal: FAIL: ${failure}`);
    }
  }
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    console.log(usage());
    return;
  }

  const result = await verifyWalletRehearsalFiles(args.files, {
    requireRecord: args.requireRecord,
  });
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHumanResult(result);
  }
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`wallet rehearsal: ERROR: ${error.message}`);
    process.exitCode = 1;
  });
}
