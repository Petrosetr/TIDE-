#!/usr/bin/env node
// In-repo entry point for the regulatory copy lint. The generic canon
// lives in packages/copy-lint so it can also ship as @tide/copy-lint;
// this shim only supplies the TIDE-specific default scan paths.

import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  CLAIMS,
  scanContent,
  scanFile,
  scanPaths,
  walkFilePaths,
  runCli as runCliCore,
} from "../packages/copy-lint/index.mjs";

export const DEFAULT_PATHS = [
  "README.md",
  "index.html",
  "docs/brand_system.md",
  "docs/landing_copy.md",
  "docs/one_pager.md",
  "docs/overflow_2026",
];

export { CLAIMS, scanContent, scanFile, scanPaths, walkFilePaths };

export function runCli(inputs = process.argv.slice(2), options = {}) {
  const resolved = inputs && inputs.length ? inputs : DEFAULT_PATHS;
  return runCliCore(resolved, options);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runCli();
}
