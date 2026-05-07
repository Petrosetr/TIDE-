#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveVersion() {
  const envSha = process.env.GITHUB_SHA || process.env.VERCEL_GIT_COMMIT_SHA || process.env.COMMIT_SHA;
  if (envSha) return String(envSha).trim().slice(0, 7);
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12);
  }
}

const version = resolveVersion();
const assetPattern = /(href|src)="(\.\/(?:styles(?:-[a-z-]+)?\.css|runtime-config\.js|telemetry\.js|app\.js))(?:\?v=[^"]*)?"/g;

for (const fileName of readdirSync(__dirname)) {
  if (!fileName.endsWith(".html")) continue;
  const filePath = path.join(__dirname, fileName);
  const before = readFileSync(filePath, "utf8");
  const after = before.replace(assetPattern, (_, attr, assetPath) => `${attr}="${assetPath}?v=${version}"`);
  if (after !== before) writeFileSync(filePath, after);
}

process.stdout.write(`Stamped shadow-mode assets with ${version}\n`);
