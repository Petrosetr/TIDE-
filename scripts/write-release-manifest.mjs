import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

function parseSerializedConfig(raw, label) {
  const prefix = "window.TIDE_CONFIG = ";
  if (!raw.startsWith(prefix) || !raw.trimEnd().endsWith(";")) {
    throw new Error(`${label} is not a serialized runtime-config payload.`);
  }
  return JSON.parse(raw.slice(prefix.length, raw.lastIndexOf(";")));
}

function gitValue(args, fallback = "") {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status === 0) {
    const value = String(result.stdout || "").trim();
    if (value) {
      return value;
    }
  }
  return fallback;
}

const rootDir = process.cwd();
const distRoot = path.resolve(rootDir, process.env.TIDE_CONFIG_ROOT || "dist/public-alpha");
const landingConfigPath = path.join(distRoot, "landing", "runtime-config.js");
const appConfigPath = path.join(distRoot, "app", "runtime-config.js");

const landingConfig = parseSerializedConfig(
  await readFile(landingConfigPath, "utf8"),
  path.relative(rootDir, landingConfigPath)
);
const appConfig = parseSerializedConfig(
  await readFile(appConfigPath, "utf8"),
  path.relative(rootDir, appConfigPath)
);

const buildId = String(appConfig?.buildId || landingConfig?.buildId || "").trim();
const gitSha = process.env.GITHUB_SHA || gitValue(["rev-parse", "HEAD"]);
const gitShortSha = gitSha ? gitSha.slice(0, 7) : gitValue(["rev-parse", "--short", "HEAD"], buildId);
const gitBranch =
  process.env.GITHUB_REF_NAME ||
  process.env.GITHUB_HEAD_REF ||
  gitValue(["rev-parse", "--abbrev-ref", "HEAD"]);

const manifest = {
  generatedAt: new Date().toISOString(),
  buildId,
  gitSha,
  gitShortSha,
  gitBranch,
  landing: {
    buildId: String(landingConfig?.buildId || buildId || ""),
    landingUrl: String(landingConfig?.landingUrl || "").trim(),
  },
  app: {
    buildId: String(appConfig?.buildId || buildId || ""),
    workspaceUrl: String(appConfig?.workspaceUrl || "").trim(),
    apiBaseUrl: String(appConfig?.apiBaseUrl || "").trim(),
    liveEnabled: Boolean(appConfig?.liveEnabled),
    signedOpsExpected:
      Boolean(String(appConfig?.liveRailPack?.verifyKey || "").trim()) &&
      !Boolean(appConfig?.liveRailPack?.allowUnsignedForecast),
    executionProofAllowSigning: Boolean(appConfig?.executionProof?.allowSigning),
    unsignedForecastAllowed: Boolean(appConfig?.liveRailPack?.allowUnsignedForecast),
    testnetProofSigningExpected:
      Boolean(appConfig?.executionProof?.allowSigning) &&
      String(appConfig?.sui?.network || "mainnet").trim() === "testnet",
    suiNetwork: String(appConfig?.sui?.network || "mainnet").trim(),
  },
  routes: {
    landing: ["/"],
    app: ["/", "/setup", "/results", "/live"],
  },
};

const destinations = [
  path.join(distRoot, "release-manifest.json"),
  path.join(distRoot, "landing", "release-manifest.json"),
  path.join(distRoot, "app", "release-manifest.json"),
];

for (const filePath of destinations) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

process.stdout.write(`Wrote release-manifest.json into ${distRoot}.\n`);
