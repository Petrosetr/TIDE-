import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const distRoot = path.join(rootDir, "dist", "public-alpha");
const appDir = path.join(distRoot, "app");
const landingDir = path.join(distRoot, "landing");
const MAX_APP_BYTES = Number(process.env.TIDE_SMOKE_MAX_APP_BYTES || 50 * 1024 * 1024);
const REQUIRE_PROOF_COMMIT = process.env.TIDE_SMOKE_REQUIRE_PROOF_COMMIT === "true";
const cliOptions = parseSmokeArgs(process.argv.slice(2));
const smokeAppUrl = process.env.TIDE_SMOKE_APP_URL || cliOptions.appUrl || cliOptions.baseUrl || "";
const smokeApiUrl = process.env.TIDE_SMOKE_API_URL || cliOptions.apiUrl || cliOptions.baseUrl || "";

const failures = [];

function fail(message) {
  failures.push(message);
}

function parseSmokeArgs(args) {
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [name, inlineValue] = String(arg).split("=", 2);
    if (!name.startsWith("--")) {
      continue;
    }
    const value = inlineValue !== undefined ? inlineValue : args[index + 1];
    if (inlineValue === undefined) {
      index += 1;
    }

    if (name === "--base-url") {
      options.baseUrl = value;
    } else if (name === "--app-url") {
      options.appUrl = value;
    } else if (name === "--api-url") {
      options.apiUrl = value;
    }
  }

  return options;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readRuntimeConfig(filePath) {
  const raw = await readFile(filePath, "utf8");
  const prefix = "window.TIDE_CONFIG = ";
  if (!raw.startsWith(prefix) || !raw.trimEnd().endsWith(";")) {
    throw new Error(`${path.relative(rootDir, filePath)} is not a serialized runtime-config.js payload.`);
  }
  return JSON.parse(raw.slice(prefix.length, raw.lastIndexOf(";")));
}

async function dirSizeBytes(dir) {
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirSizeBytes(entryPath);
    } else if (entry.isFile()) {
      total += (await stat(entryPath)).size;
    }
  }

  return total;
}

async function collectHtmlFiles(dir) {
  const files = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectHtmlFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(entryPath);
    }
  }
  return files;
}

async function assertHtmlCacheBustBuildIds(dir, buildId, label) {
  if (!buildId || !(await exists(dir))) return;
  for (const filePath of await collectHtmlFiles(dir)) {
    const html = await readFile(filePath, "utf8");
    const matches = html.matchAll(/\?v=([^"' )]+)/g);
    for (const match of matches) {
      if (match[1] !== buildId) {
        fail(`${label || path.relative(rootDir, dir)} ${path.relative(rootDir, filePath)} has stale asset version ?v=${match[1]} expected ?v=${buildId}`);
      }
    }
  }
}

async function assertFetchOk(baseUrl, paths) {
  if (!baseUrl) {
    return;
  }

  const normalizedBase = String(baseUrl).replace(/\/+$/, "");
  for (const route of paths) {
    const url = `${normalizedBase}${route}`;
    try {
      const response = await fetch(url, { method: "GET" });
      if (!response.ok) {
        fail(`${url} returned ${response.status}`);
      }
    } catch (error) {
      fail(`${url} failed: ${error?.message || error}`);
    }
  }
}

async function assertFetchContains(baseUrl, routeExpectations) {
  if (!baseUrl) {
    return;
  }

  const normalizedBase = String(baseUrl).replace(/\/+$/, "");
  for (const [route, needles] of routeExpectations) {
    const url = `${normalizedBase}${route}`;
    try {
      const response = await fetch(url, { method: "GET" });
      if (!response.ok) {
        fail(`${url} returned ${response.status}`);
        continue;
      }
      const body = await response.text();
      for (const needle of needles) {
        if (!body.includes(needle)) {
          fail(`${url} is missing expected marker: ${needle}`);
        }
      }
    } catch (error) {
      fail(`${url} failed: ${error?.message || error}`);
    }
  }
}

async function assertSignedOps(baseUrl) {
  if (!baseUrl || process.env.TIDE_SMOKE_REQUIRE_SIGNED_OPS !== "true") {
    return;
  }

  const normalizedBase = String(baseUrl).replace(/\/+$/, "");
  const healthzUrl = `${normalizedBase}/v1/healthz`;
  const readyzUrl = `${normalizedBase}/v1/readyz`;

  try {
    const healthzResponse = await fetch(healthzUrl, { method: "GET" });
    if (!healthzResponse.ok) {
      fail(`${healthzUrl} returned ${healthzResponse.status}`);
      return;
    }
    await healthzResponse.json();
  } catch (error) {
    fail(`${healthzUrl} failed: ${error?.message || error}`);
    return;
  }

  try {
    const readyzResponse = await fetch(readyzUrl, { method: "GET" });
    if (!readyzResponse.ok) {
      fail(`${readyzUrl} returned ${readyzResponse.status}`);
      return;
    }
    const payload = await readyzResponse.json();
    if (payload?.ready !== true || payload?.ok !== true) {
      fail(`${readyzUrl} is not ready.`);
    }
    if (payload?.checks?.packSigner !== true) {
      fail(`${readyzUrl} reports packSigner=false.`);
    }
    if (payload?.checks?.livePack !== true || payload?.checks?.livePackSigned !== true) {
      fail(`${readyzUrl} reports livePack/livePackSigned=false.`);
    }
  } catch (error) {
    fail(`${readyzUrl} failed: ${error?.message || error}`);
    return;
  }

  for (const route of ["/v1/market-forecast", "/v1/market-forecast/kalshi", "/v1/live-rail-pack"]) {
    const url = `${normalizedBase}${route}`;
    try {
      const response = await fetch(url, { method: "GET" });
      if (!response.ok) {
        fail(`${url} returned ${response.status}`);
        continue;
      }
      if (!response.headers.get("x-tide-signature")) {
        fail(`${url} is missing x-tide-signature.`);
      }
    } catch (error) {
      fail(`${url} failed: ${error?.message || error}`);
    }
  }
}

function assertRuntimeTrustConfig(configPath, config) {
  if (!config || typeof config !== "object") {
    fail(`${path.relative(rootDir, configPath)} is not valid JSON config.`);
    return;
  }

  const requireSignedOps = process.env.TIDE_SMOKE_REQUIRE_SIGNED_OPS === "true";

  if (!requireSignedOps) {
    return;
  }

  if (config?.liveRailPack?.allowUnsignedForecast === true) {
    fail(`${path.relative(rootDir, configPath)} still allows unsigned forecasts while signed ops smoke is enabled.`);
  }

  if (!String(config?.liveRailPack?.verifyKey || "").trim()) {
    fail(`${path.relative(rootDir, configPath)} is missing liveRailPack.verifyKey while signed ops smoke is enabled.`);
  }

  if (!String(config?.apiBaseUrl || "").trim()) {
    fail(`${path.relative(rootDir, configPath)} resolved apiBaseUrl empty while signed ops smoke is enabled.`);
  }
}

function assertRuntimeProofMatchesManifest(configPath, config, manifestPath, manifest) {
  const proofCommit = String(config?.proof?.commit || "").trim().toLowerCase();
  if (!proofCommit) {
    if (REQUIRE_PROOF_COMMIT) {
      fail(`${path.relative(rootDir, configPath)} is missing proof.commit while TIDE_SMOKE_REQUIRE_PROOF_COMMIT=true.`);
    }
    return;
  }
  const manifestSha = String(manifest?.gitSha || "").trim().toLowerCase();
  const manifestBuildId = String(manifest?.buildId || "").trim().toLowerCase();
  const matchesSha = Boolean(manifestSha && proofCommit === manifestSha);
  const matchesBuild = Boolean(manifestBuildId && proofCommit === manifestBuildId);
  if (!matchesSha && !matchesBuild) {
    if (config?.proof?.sourceRefMatchesBuild === false) {
      return;
    }
    fail(
      `${path.relative(rootDir, configPath)} proof.commit=${proofCommit} does not match ${path.relative(rootDir, manifestPath)} gitSha=${manifestSha || "missing"} buildId=${manifestBuildId || "missing"}.`
    );
  }
}

async function assertFileContains(filePath, needles, label) {
  if (!(await exists(filePath))) {
    return;
  }
  const body = await readFile(filePath, "utf8");
  for (const needle of needles) {
    if (!body.includes(needle)) {
      fail(`${label || path.relative(rootDir, filePath)} missing golden-flow marker: ${needle}`);
    }
  }
}

async function main() {
  const appIndex = path.join(appDir, "index.html");
  const appSetup = path.join(appDir, "setup.html");
  const appScript = path.join(appDir, "app.js");
  const appSetupStyles = path.join(appDir, "styles-setup.css");
  const landingIndex = path.join(landingDir, "index.html");
  const landingScript = path.join(landingDir, "landing.js");
  const landingPrivacy = path.join(landingDir, "privacy.html");
  const landingTerms = path.join(landingDir, "terms.html");
  const landingRisk = path.join(landingDir, "risk.html");
  const appRuntimeConfig = path.join(appDir, "runtime-config.js");
  const appReleaseManifest = path.join(appDir, "release-manifest.json");
  const landingRuntimeConfig = path.join(landingDir, "runtime-config.js");
  const landingReleaseManifest = path.join(landingDir, "release-manifest.json");
  const rootReleaseManifest = path.join(distRoot, "release-manifest.json");
  const runtimeVendor = path.join(appDir, "vendor", "sui-runtime.mjs");
  const kaiNodeModules = path.join(appDir, "vendor", "kai-live", "node_modules");
  const alphalendNodeModules = path.join(appDir, "vendor", "alphalend-live", "node_modules");

  for (const required of [
    appIndex,
    appScript,
    appSetupStyles,
    appRuntimeConfig,
    landingRuntimeConfig,
    landingScript,
    appReleaseManifest,
    landingReleaseManifest,
    rootReleaseManifest,
    runtimeVendor,
    landingPrivacy,
    landingTerms,
    landingRisk,
  ]) {
    if (!(await exists(required))) {
      fail(`Missing required artifact: ${path.relative(rootDir, required)}`);
    }
  }

  if (await exists(kaiNodeModules)) {
    fail("Public alpha artifact still contains vendor/kai-live/node_modules.");
  }

  if (await exists(alphalendNodeModules)) {
    fail("Public alpha artifact still contains vendor/alphalend-live/node_modules.");
  }

  if (await exists(appDir)) {
    const size = await dirSizeBytes(appDir);
    if (size > MAX_APP_BYTES) {
      fail(`Public alpha app artifact is ${(size / 1024 / 1024).toFixed(1)}MB, over ${(MAX_APP_BYTES / 1024 / 1024).toFixed(1)}MB.`);
    }
  }

  if (await exists(appIndex)) {
    const html = await readFile(appIndex, "utf8");
    // index.html is the Workspace landing (v1 workspace rebuild). It must
    // boot the app runtime — data-page="workspace" gates the renderer in
    // app.js, and app.js itself must be referenced with a root-absolute
    // URL so /workspace/ and other trailing-slash routes hydrate. Earlier revisions
    // redirected here to /setup; that behaviour is intentionally gone so
    // a wallet's list of on-chain policies is the first surface users see.
    if (!html.includes('data-page="workspace"')) {
      fail('App root is not the Workspace landing (missing body[data-page="workspace"]).');
    }
    if (!html.includes('/app.js')) {
      fail("App root does not load /app.js — Workspace renderer won't boot on trailing-slash routes.");
    }
    if (html.includes("./app.js") || html.includes("./runtime-config.js")) {
      fail("App root still uses relative runtime assets; trailing-slash routes will request nested files.");
    }
  }

  for (const configPath of [appRuntimeConfig, landingRuntimeConfig]) {
    if (await exists(configPath)) {
      const raw = await readFile(configPath, "utf8");
      for (const needle of ["/v1/track", "/v1/error"]) {
        if (!raw.includes(needle)) {
          fail(`${path.relative(rootDir, configPath)} does not expose ${needle} hook.`);
        }
      }
    }
  }

  if (await exists(appRuntimeConfig)) {
    try {
      const config = await readRuntimeConfig(appRuntimeConfig);
      assertRuntimeTrustConfig(appRuntimeConfig, config);
    } catch (error) {
      fail(`${path.relative(rootDir, appRuntimeConfig)} failed to parse: ${error?.message || error}`);
    }
  }

  const expectedBuildId = process.env.TIDE_BUILD_ID || process.env.TIDEFORGE_BUILD_ID || "";
  const parsedManifests = new Map();
  for (const manifestPath of [rootReleaseManifest, landingReleaseManifest, appReleaseManifest]) {
    if (!(await exists(manifestPath))) {
      continue;
    }
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      parsedManifests.set(manifestPath, manifest);
      if (expectedBuildId && String(manifest?.buildId || "").trim() !== expectedBuildId) {
        fail(`${path.relative(rootDir, manifestPath)} buildId=${manifest?.buildId} expected ${expectedBuildId}`);
      }
      if (manifestPath === landingReleaseManifest && manifest?.landing?.buildId !== manifest?.buildId) {
        fail(`${path.relative(rootDir, manifestPath)} landing.buildId mismatch.`);
      }
      if (manifestPath === appReleaseManifest && manifest?.app?.buildId !== manifest?.buildId) {
        fail(`${path.relative(rootDir, manifestPath)} app.buildId mismatch.`);
      }
    } catch (error) {
      fail(`${path.relative(rootDir, manifestPath)} failed to parse: ${error?.message || error}`);
    }
  }

  for (const [configPath, manifestPath] of [
    [landingRuntimeConfig, landingReleaseManifest],
    [appRuntimeConfig, appReleaseManifest],
  ]) {
    if (!(await exists(configPath)) || !(await exists(manifestPath))) {
      continue;
    }
    try {
      const config = await readRuntimeConfig(configPath);
      const manifest = parsedManifests.get(manifestPath)
        || JSON.parse(await readFile(manifestPath, "utf8"));
      assertRuntimeProofMatchesManifest(configPath, config, manifestPath, manifest);
    } catch (error) {
      fail(`${path.relative(rootDir, configPath)} proof/release check failed: ${error?.message || error}`);
    }
  }

  const appManifest = parsedManifests.get(appReleaseManifest);
  const landingManifest = parsedManifests.get(landingReleaseManifest);
  await assertHtmlCacheBustBuildIds(appDir, String(appManifest?.buildId || ""), "app artifact");
  await assertHtmlCacheBustBuildIds(landingDir, String(landingManifest?.buildId || ""), "landing artifact");

  // Golden-flow markers in the built artifacts. Each marker guards one
  // regression we have already tripped over: a missing preset button
  // means the Setup surface won't load a Harbor starter; a missing
  // data-preset-stat means the preset cards no longer auto-sync with
  // STRATEGY_PRESETS; a missing Publish CTA means the on-chain path
  // vanished from the demo; a missing live-proof section means the
  // verified-run card silently disappeared from the landing.
  await assertFileContains(appSetup, [
    'data-preset="starter"',
    'data-preset="safety"',
    'data-preset="drift"',
    'data-preset-stat="starter-payout"',
    'data-preset-stat-suffix="starter-payout"',
    'id="save-policy-toolbar"',
    'name="debtUsd" type="hidden"',
  ], "Built app/setup.html (golden flow)");
  await assertFileContains(appScript, [
    "Run rehearsal check",
    "Managed repay",
    "Polymarket",
    "Kalshi",
    "Public",
    "30D",
    "public path",
    "forecast unavailable",
    "horizon \\xB7 period locked",
    "data-guardrail-group",
    "data-guardrail-value",
    "aria-disabled",
    "guardrails-chart__chips--period",
    "guardrails-chart__svg",
    "guardrails-chart__note",
    "kalshi-horizon",
    "disabled aria-disabled=\"true\"",
    "forecast unavailable",
    "forecast strikes could not be mapped",
    "period locked",
    "receipt.mint",
  ], "Built app/app.js (hydration)");
  await assertFileContains(appSetupStyles, [
    "--setup-footer-reserve: 8.75rem",
    "position: fixed",
    "max-height: min(15rem, calc(100dvh - var(--space-6)))",
    "overflow-y: auto",
    "--setup-footer-reserve: 0px",
    "position: static",
    "padding-bottom: var(--space-4)",
  ], "Built app/styles-setup.css (setup dock)");
  await assertFileContains(landingIndex, [
    'id="live-proof"',
    'class="proof-screen"',
    "Modeled. Non-custodial. Not investment advice.",
    '<script src="landing.js',
  ], "Built landing/index.html (golden flow)");
  await assertFileContains(landingScript, [
    "IntersectionObserver",
    "riverSvg",
    "renderLiveProof",
  ], "Built landing/landing.js (runtime)");
  await assertFileContains(landingPrivacy, [
    'data-page="legal-privacy"',
    "Privacy notice",
    "privacy@tidesui.pro",
  ], "Built landing/privacy.html (legal)");
  await assertFileContains(landingTerms, [
    'data-page="legal-terms"',
    "Public alpha terms",
    "No investment advice",
  ], "Built landing/terms.html (legal)");
  await assertFileContains(landingRisk, [
    'data-page="legal-risk"',
    "Risk disclosure",
    "Modeled results are not guaranteed",
  ], "Built landing/risk.html (legal)");
  await assertFetchOk(smokeAppUrl, [
    "/",
    "/setup",
    "/results",
    "/live",
    "/library",
    "/runtime-config.js",
    "/live-rail-pack.json",
  ]);
  await assertFetchContains(smokeAppUrl, [
    ["/", ['data-page="workspace"', "<title>TIDE Workspace</title>"]],
    ["/setup", [
      'data-page="setup"',
      "<title>TIDE Create</title>",
      'data-preset="starter"',
      'id="save-policy-toolbar"',
    ]],
    ["/results", ['data-page="results"', "<title>TIDE Readout</title>"]],
    ["/live", ['data-page="live"', "<title>TIDE Live</title>"]],
    ["/library", ['data-page="library"', "<title>TIDE Policy Library</title>"]],
  ]);

  await assertFetchOk(smokeApiUrl, [
    "/healthz",
    "/v1/healthz",
    "/v1/market-forecast",
    "/v1/market-forecast/kalshi",
  ]);
  await assertSignedOps(smokeApiUrl);

  if (failures.length) {
    failures.forEach((message) => process.stderr.write(`smoke failed: ${message}\n`));
    process.exitCode = 1;
    return;
  }

  process.stdout.write("Public alpha smoke checks passed.\n");
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
