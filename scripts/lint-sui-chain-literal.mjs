#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHAIN_LITERAL_RE = /["'`]sui:(?:mainnet|testnet|devnet|localnet)["'`]/g;

const SEARCH_DIRS = [
  ".github",
  "infra",
  "packages",
  "r",
  "scripts",
  "shadow-mode",
];

const CODE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".ts",
  ".tsx",
  ".yml",
  ".yaml",
]);

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function shouldSkip(filePath, repoRoot = REPO_ROOT) {
  const rel = toPosix(path.relative(repoRoot, filePath));
  if (!rel || rel.startsWith("..")) return true;
  if (rel.includes("/node_modules/") || rel.startsWith("node_modules/")) return true;
  if (rel.includes("/vendor/") || rel.startsWith("vendor/")) return true;
  if (rel.startsWith("dist/")) return true;
  if (rel.endsWith(".test.mjs") || rel.endsWith(".test.js") || rel.endsWith(".spec.mjs")) return true;
  return rel === "shadow-mode/lib/sui-network.mjs";
}

function walk(dir, out = [], repoRoot = REPO_ROOT) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (shouldSkip(absolute, repoRoot)) continue;
    if (entry.isDirectory()) {
      walk(absolute, out, repoRoot);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!CODE_EXTENSIONS.has(path.extname(entry.name))) continue;
    out.push(absolute);
  }
  return out;
}

export function findSuiChainLiteralViolations({ repoRoot = REPO_ROOT } = {}) {
  const files = SEARCH_DIRS.flatMap((dir) => walk(path.join(repoRoot, dir), [], repoRoot));
  const violations = [];
  for (const file of files) {
    let text = "";
    try {
      if (statSync(file).size > 2_000_000) continue;
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!CHAIN_LITERAL_RE.test(line)) {
        CHAIN_LITERAL_RE.lastIndex = 0;
        continue;
      }
      CHAIN_LITERAL_RE.lastIndex = 0;
      violations.push({
        file: toPosix(path.relative(repoRoot, file)),
        line: i + 1,
        text: line.trim(),
      });
    }
  }
  return violations;
}

function main() {
  const violations = findSuiChainLiteralViolations();
  if (violations.length === 0) {
    console.log("[sui-chain-literal] PASS");
    return;
  }
  console.error("[sui-chain-literal] FAIL: Sui chain literals must stay in shadow-mode/lib/sui-network.mjs");
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line} ${violation.text}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
