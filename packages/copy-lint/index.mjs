// @tide/copy-lint — Sui-treasury-style copy canon enforcer.
//
// Pure JS, zero dependencies, ESM-first. Scans HTML / JS / Markdown /
// TXT files for marketing claims that counsel, audit firms, or technical
// reviewers would flag: unqualified Autopilot, guaranteed cashflow,
// mainnet-capital claims, advisor/recommendation language, and similar.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const AUTOPILOT_QUALIFIERS =
  /\b(rehearsal|rehearses|testnet|gated|roadmap|future|audit|audited|not live|not yet|wallet signs|wallet-signed|user-signed|you sign|only after)\b/i;
const TEXT_EXTENSIONS = new Set([".html", ".js", ".md", ".mjs", ".txt"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);

function hasNearbyNegation(content, index) {
  const window = content.slice(Math.max(0, index - 90), Math.min(content.length, index + 180));
  return /\b(no|not|never|without|none|does not|do not|cannot|can't|isn't|is not|not yet|before any)\b/i.test(window);
}

export const CLAIMS = [
  {
    id: "bare-autopilot",
    pattern: /\bautopilot\b/gi,
    message: "Autopilot must be qualified nearby with Rehearsal, testnet, gated, roadmap, or audit language.",
    validator: (content, match) => {
      const window = content.slice(Math.max(0, match.index - 80), Math.min(content.length, match.index + 160));
      return AUTOPILOT_QUALIFIERS.test(window);
    },
  },
  {
    id: "yield-or-investment-product",
    pattern: /\bTIDE\b[\s\S]{0,140}\b(yield product|lending product|investment product)\b/gi,
    message: "Do not frame TIDE as a yield/lending/investment product.",
    validator: (content, match) => hasNearbyNegation(content, match.index),
  },
  {
    id: "guaranteed-return",
    pattern: /\b(guarantee|guaranteed|guarantees|ensure|ensures)\b[\s\S]{0,80}\b(return|cashflow|cash flow|income|yield|outcome|outcomes)\b/gi,
    message: "Do not imply guaranteed return, cashflow, income, yield, or outcomes.",
    validator: (content, match) => hasNearbyNegation(content, match.index),
  },
  {
    id: "mainnet-capital-managed",
    pattern: /\b(mainnet capital managed|manages mainnet capital|managed mainnet capital|mainnet capital movement)\b/gi,
    message: "Do not claim mainnet capital is managed or moved.",
    validator: (content, match) => hasNearbyNegation(content, match.index),
  },
  {
    id: "auto-repay-executed",
    pattern: /\b(auto[- ]?repay executed|automatically repays|auto[- ]?repays|repays automatically)\b/gi,
    message: "Do not claim auto-repay execution; use modeled repay threshold or wallet-signed action.",
  },
  {
    id: "liquidation-avoided",
    pattern: /\b(liquidation avoided|avoids liquidation|avoid liquidation|prevents liquidation|prevent liquidation)\b/gi,
    message: "Do not promise liquidation avoidance.",
  },
  {
    id: "audited-live-autopilot",
    pattern: /\b(audited live autopilot|live autopilot audited|audited mainnet autopilot)\b/gi,
    message: "Do not claim audited live autopilot before external audit ships.",
  },
  {
    id: "advisor-recommendation-language",
    pattern: /\b(recommend|recommends|recommended|advises)\b/gi,
    message: "Avoid advisor/recommendation language; use models, flags, shows, or operator review.",
  },
];

export function walkFilePaths(entry, root = process.cwd()) {
  const absolute = path.resolve(root, entry);
  if (!fs.existsSync(absolute)) return [];
  const stat = fs.statSync(absolute);
  if (stat.isFile()) {
    return TEXT_EXTENSIONS.has(path.extname(absolute).toLowerCase()) ? [absolute] : [];
  }
  if (!stat.isDirectory()) return [];

  const files = [];
  for (const name of fs.readdirSync(absolute)) {
    if (SKIP_DIRS.has(name)) continue;
    files.push(...walkFilePaths(path.relative(root, path.join(absolute, name)), root));
  }
  return files;
}

function lineColumn(content, index) {
  const before = content.slice(0, index);
  const lines = before.split("\n");
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

export function scanContent(content, file = "<inline>") {
  const findings = [];
  for (const claim of CLAIMS) {
    claim.pattern.lastIndex = 0;
    for (const match of content.matchAll(claim.pattern)) {
      if (claim.validator && claim.validator(content, match)) continue;
      const where = lineColumn(content, match.index);
      findings.push({
        file,
        line: where.line,
        column: where.column,
        id: claim.id,
        message: claim.message,
        excerpt: match[0].replace(/\s+/g, " ").slice(0, 180),
      });
    }
  }
  return findings;
}

export function scanFile(file, { root = process.cwd() } = {}) {
  const content = fs.readFileSync(file, "utf8");
  return scanContent(content, path.relative(root, file));
}

export function scanPaths(entries, root = process.cwd()) {
  const files = [...new Set(entries.flatMap((entry) => walkFilePaths(entry, root)))].sort();
  return {
    files,
    findings: files.flatMap((file) => scanFile(file, { root })),
  };
}

export function runCli(
  inputs = [],
  { stderr = console.error, stdout = console.log, exit = process.exit, root = process.cwd() } = {},
) {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    stderr("tide-copy-lint: no input paths supplied. Pass file or directory paths as positional arguments.");
    stderr("Example: tide-copy-lint README.md docs/");
    exit(2);
    return { ok: false, findings: [] };
  }

  const { files, findings } = scanPaths(inputs, root);

  if (findings.length) {
    stderr("Regulatory copy lint failed.");
    stderr("Canon: Autopilot must be explicitly qualified as Rehearsal/testnet/gated; no guaranteed cashflow, no auto-repay execution, no audited live autopilot claims.");
    for (const finding of findings) {
      stderr(`- ${finding.file}:${finding.line}:${finding.column} [${finding.id}] ${finding.message}`);
      stderr(`  "${finding.excerpt}"`);
    }
    exit(1);
    return { ok: false, findings };
  }

  stdout(`Regulatory copy lint passed (${files.length} files).`);
  return { ok: true, findings: [] };
}

export const COPY_LINT_VERSION = "0.1.0";

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runCli(process.argv.slice(2));
}
