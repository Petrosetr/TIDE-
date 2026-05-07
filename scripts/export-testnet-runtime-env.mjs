#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const FULL_ID_RE = /^0x[0-9a-f]{64}$/i;

function readText(rootDir, relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), "utf8");
}

function readPublishedPackageId(rootDir) {
  const text = readText(rootDir, "move/Published.toml");
  const match = text.match(/\[published\.testnet\][\s\S]*?published-at\s*=\s*"([^"]+)"/);
  const packageId = match?.[1]?.trim() || "";
  if (!FULL_ID_RE.test(packageId)) {
    throw new Error("move/Published.toml: published.testnet.published-at must be a 32-byte Sui object id.");
  }
  return packageId;
}

function readProofLoop(rootDir) {
  const proof = JSON.parse(readText(rootDir, "docs/proof/latest-proof-loop.json"));
  const packageId = String(proof.packageId || "").trim();
  const railAllowlistId = String(proof.railAllowlistId || "").trim();
  if (!FULL_ID_RE.test(packageId)) {
    throw new Error("docs/proof/latest-proof-loop.json: packageId must be a 32-byte Sui object id.");
  }
  if (!FULL_ID_RE.test(railAllowlistId)) {
    throw new Error("docs/proof/latest-proof-loop.json: railAllowlistId must be a 32-byte Sui object id.");
  }
  return { packageId, railAllowlistId };
}

function warnIfStaleSecret(envName, expected, stderr = process.stderr) {
  const actual = String(process.env[envName] || "").trim();
  if (actual && actual.toLowerCase() !== expected.toLowerCase()) {
    stderr.write(
      `warning: ${envName}=${actual} differs from repository proof source ${expected}; ` +
      "exporting the proof source for this deploy.\n"
    );
  }
}

export function buildTestnetRuntimeEnv({ rootDir = process.cwd(), stderr = process.stderr } = {}) {
  const publishedPackageId = readPublishedPackageId(rootDir);
  const proof = readProofLoop(rootDir);
  if (proof.packageId.toLowerCase() !== publishedPackageId.toLowerCase()) {
    throw new Error(
      "Testnet runtime id mismatch: docs/proof/latest-proof-loop.json packageId " +
      `${proof.packageId} does not match move/Published.toml ${publishedPackageId}.`
    );
  }

  warnIfStaleSecret("TIDE_TESTNET_POLICY_PACKAGE_ID", proof.packageId, stderr);
  warnIfStaleSecret("TIDE_TESTNET_POLICY_RAIL_ALLOWLIST_ID", proof.railAllowlistId, stderr);

  return {
    TIDE_POLICY_PACKAGE_ID: proof.packageId,
    TIDE_POLICY_RAIL_ALLOWLIST_ID: proof.railAllowlistId,
  };
}

export function runCli({ cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {}) {
  const env = buildTestnetRuntimeEnv({ rootDir: cwd, stderr });
  for (const [key, value] of Object.entries(env)) {
    stdout.write(`${key}=${value}\n`);
  }
  return env;
}

if (import.meta.url === pathToFileURL(process.argv[1] || fileURLToPath(import.meta.url)).href) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  }
}
