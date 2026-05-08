import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function fail(message) {
  throw new Error(message);
}

const FULL_SUI_OBJECT_ID_RE = /^0x[a-f0-9]{64}$/i;
function readLocalProofPins() {
  const parsed = JSON.parse(readFileSync("docs/proof/latest-proof-loop.json", "utf8"));
  const packageId = String(parsed?.packageId || "").trim();
  const railAllowlistId = String(parsed?.railAllowlistId || "").trim();
  const receiptObjectId = String(
    [...(Array.isArray(parsed?.runs) ? parsed.runs : [])]
      .reverse()
      .find((run) => FULL_SUI_OBJECT_ID_RE.test(String(run?.receiptMint?.objectId || "").trim()))
      ?.receiptMint?.objectId || ""
  ).trim();
  if (!FULL_SUI_OBJECT_ID_RE.test(packageId)) {
    fail("docs/proof/latest-proof-loop.json packageId must be a 32-byte Sui object id");
  }
  if (!FULL_SUI_OBJECT_ID_RE.test(railAllowlistId)) {
    fail("docs/proof/latest-proof-loop.json railAllowlistId must be a 32-byte Sui object id");
  }
  if (!FULL_SUI_OBJECT_ID_RE.test(receiptObjectId)) {
    fail("docs/proof/latest-proof-loop.json must include at least one 32-byte receiptMint.objectId");
  }
  return { packageId, railAllowlistId, receiptObjectId };
}

const LOCAL_PROOF_PINS = readLocalProofPins();
const CURRENT_TESTNET_RECEIPT_PACKAGE = LOCAL_PROOF_PINS.packageId;
const RETIRED_TESTNET_RECEIPT_PACKAGE = "0x6f21c392fe6521e2a58d50305383ad0fa6d133fe2f6792fce1bca067879ff50d";
const PUBLIC_PROOF_PACK_PATH = "docs/onchain_mvp_proof_pack.md";

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function envFlag(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

export function skipDeployFreshnessChecks(env = process.env) {
  return envFlag(env.TIDE_VERIFY_SKIP_BUILD_ID);
}

function expectedDeployGitSha(env = process.env) {
  if (skipDeployFreshnessChecks(env)) {
    return "";
  }
  return String(env.TIDE_VERIFY_EXPECT_GIT_SHA || env.GITHUB_SHA || "").trim();
}

function expectedDeployRef(env = process.env) {
  if (skipDeployFreshnessChecks(env)) {
    return "";
  }
  return String(env.TIDE_VERIFY_EXPECT_GIT_REF || env.GITHUB_REF_NAME || env.GITHUB_HEAD_REF || "").trim();
}

function expectedBuildId(env = process.env) {
  // Rollback workflows serve an earlier commit deliberately — the
  // dispatching workflow's GITHUB_SHA won't match. Let them skip the
  // buildId equality check while keeping every other golden-flow
  // assertion honest.
  if (skipDeployFreshnessChecks(env)) {
    return "";
  }
  const explicit = String(env.TIDE_VERIFY_EXPECT_BUILD_ID || "").trim();
  if (explicit) {
    return explicit;
  }
  const sha = String(env.GITHUB_SHA || "").trim();
  return sha ? sha.slice(0, 7) : "";
}

function parseSerializedConfig(raw, label) {
  const prefix = "window.TIDE_CONFIG = ";
  if (!raw.startsWith(prefix) || !raw.trimEnd().endsWith(";")) {
    fail(`${label} is not a serialized runtime-config payload.`);
  }
  return JSON.parse(raw.slice(prefix.length, raw.lastIndexOf(";")));
}

export function resolveExpectedRuntimeSuiNetwork(baseUrl, env = process.env) {
  const explicit = String(env.TIDE_VERIFY_EXPECT_SUI_NETWORK || "").trim().toLowerCase();
  if (explicit) return explicit;
  const deployTarget = String(env.TIDE_VERIFY_DEPLOY_TARGET || "").trim().toLowerCase();
  if (deployTarget === "testnet") return "testnet";
  if (deployTarget === "dev" || deployTarget === "prod" || deployTarget === "production" || deployTarget === "app") {
    return "mainnet";
  }
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (host === "testnet.tidesui.pro" || host.endsWith(".testnet.tidesui.pro")) {
      return "testnet";
    }
    if (host.includes("testnet")) return "testnet";
    if (host === "dev.tidesui.pro" || host === "app.tidesui.pro" || host === "tidesui.pro" || host === "www.tidesui.pro") {
      return "mainnet";
    }
  } catch {
    // Let URL validation failures surface through the surrounding fetch path.
  }
  return "";
}

export function assertRuntimeSuiNetwork(baseUrl, config, env = process.env) {
  const expected = resolveExpectedRuntimeSuiNetwork(baseUrl, env);
  if (!expected) return;
  const actual = String(config?.sui?.network || "").trim().toLowerCase();
  if (actual !== expected) {
    fail(`${baseUrl}/runtime-config.js sui.network=${actual || "missing"} expected ${expected}`);
  }
}

export function assertRuntimeTestnetProofPins(baseUrl, config, env = process.env) {
  const expectedNetwork = resolveExpectedRuntimeSuiNetwork(baseUrl, env);
  if (expectedNetwork !== "testnet") return;
  const packageId = String(config?.policyRegistry?.packageId || "").trim();
  const railAllowlistId = String(config?.policyRegistry?.railAllowlistId || "").trim();
  if (packageId.toLowerCase() !== LOCAL_PROOF_PINS.packageId.toLowerCase()) {
    fail(
      `${baseUrl}/runtime-config.js policyRegistry.packageId=${packageId || "missing"} expected proof package ${LOCAL_PROOF_PINS.packageId}`
    );
  }
  if (railAllowlistId.toLowerCase() !== LOCAL_PROOF_PINS.railAllowlistId.toLowerCase()) {
    fail(
      `${baseUrl}/runtime-config.js policyRegistry.railAllowlistId=${railAllowlistId || "missing"} expected proof allowlist ${LOCAL_PROOF_PINS.railAllowlistId}`
    );
  }
}

function withCacheBust(url) {
  const parsed = new URL(url);
  parsed.searchParams.set("verify", String(Date.now()));
  return parsed.toString();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url) {
  let lastError;
  let response;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch(withCacheBust(url), {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok || response.status < 500) break;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await wait(750 * attempt);
  }
  if (!response) {
    fail(`${url} fetch failed: ${lastError?.message || "unknown error"}`);
  }
  if (!response.ok) {
    fail(`${url} returned ${response.status}`);
  }
  return response.text();
}

async function fetchHead(url) {
  let lastError;
  let response;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch(withCacheBust(url), {
        method: "HEAD",
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok || response.status < 500) break;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await wait(750 * attempt);
  }
  if (!response) {
    fail(`${url} fetch failed: ${lastError?.message || "unknown error"}`);
  }
  if (!response.ok) {
    fail(`${url} returned ${response.status}`);
  }
  return response.headers;
}

async function fetchRedirect(url) {
  return fetch(url, {
    method: "GET",
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
}

async function fetchJson(url) {
  let lastError;
  let response;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch(withCacheBust(url), {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok || response.status < 500) break;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await wait(750 * attempt);
  }
  if (!response) {
    fail(`${url} fetch failed: ${lastError?.message || "unknown error"}`);
  }
  if (!response.ok) {
    fail(`${url} returned ${response.status}`);
  }
  return response.json();
}

async function assertContentType(baseUrl, route, expectedPattern) {
  const url = `${baseUrl}${route}`;
  const headers = await fetchHead(url);
  const contentType = headers.get("content-type") || "";
  if (!expectedPattern.test(contentType)) {
    fail(`${url} content-type=${contentType || "missing"} expected ${expectedPattern}`);
  }
}

async function assertRouteContains(baseUrl, route, needles) {
  const url = `${baseUrl}${route}`;
  const body = await fetchText(url);
  for (const needle of needles) {
    if (!body.includes(needle)) {
      fail(`${url} is missing expected marker: ${needle}`);
    }
  }
}

async function assertRouteNotContains(baseUrl, route, needles) {
  const url = `${baseUrl}${route}`;
  const body = await fetchText(url);
  for (const needle of needles) {
    if (body.includes(needle)) {
      fail(`${url} contains retired/forbidden marker: ${needle}`);
    }
  }
}

function assertTextContains(label, body, needles) {
  for (const needle of needles) {
    if (!body.includes(needle)) {
      fail(`${label} is missing expected marker: ${needle}`);
    }
  }
}

export function assertProofDocEvidencePosture(label, body) {
  const text = String(body || "");
  if (!text.includes("walrusSource=walrus")) {
    fail(`${label} is missing expected marker: walrusSource=walrus`);
  }
  if (/\bpythSource=configured\b/.test(text)) {
    fail(`${label} still uses ambiguous oracle marker pythSource=configured; use live, stale, or missing`);
  }
  if (!/\bpythSource=(?:live|stale|missing)\b/.test(text)) {
    fail(`${label} is missing expected oracle marker: pythSource=live|stale|missing`);
  }
}

function normalizeProofDocText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trimEnd();
}

export function publicProofDocMatchesCheckout(remoteText, checkoutText) {
  return normalizeProofDocText(remoteText) === normalizeProofDocText(checkoutText);
}

export function assertPublicProofDocFreshness(baseUrl, remoteText, checkoutText = "", env = process.env) {
  if (skipDeployFreshnessChecks(env)) {
    return;
  }
  const expectedText = checkoutText || readFileSync(PUBLIC_PROOF_PACK_PATH, "utf8");
  if (!publicProofDocMatchesCheckout(remoteText, expectedText)) {
    fail(
      `${baseUrl}/${PUBLIC_PROOF_PACK_PATH} does not match checkout ${PUBLIC_PROOF_PACK_PATH}; redeploy the public proof docs or remove this stale fallback proof URL.`
    );
  }
}

async function verifyHydrationAssets(baseUrl) {
  // Static HTML can pass while the bundled JS is stale or missing. The
  // release verifier does not execute a browser, so it checks both the
  // hydrated entry route and the concrete dynamic strings that only live
  // in the client bundle.
  await assertRouteContains(baseUrl, "/setup?judge=1", [
    'data-page="setup"',
    "<title>TIDE Create</title>",
  ]);
  await assertContentType(baseUrl, "/app.js", /(?:^|;|\s)(?:text|application)\/javascript\b/i);
  await assertContentType(baseUrl, "/wallet.js", /(?:^|;|\s)(?:text|application)\/javascript\b/i);
  await assertContentType(baseUrl, "/runtime-config.js", /(?:^|;|\s)(?:text|application)\/javascript\b/i);
  await assertContentType(baseUrl, "/styles-setup.css", /^text\/css\b/i);
  await assertRouteContains(baseUrl, "/app.js", [
    "Run rehearsal",
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
  ]);
  await assertRouteContains(baseUrl, "/styles-setup.css", [
    "--setup-footer-reserve: clamp(6.5rem, 9vh, 8rem)",
    "scroll-padding-bottom: calc(var(--setup-footer-reserve) + var(--space-4))",
    "position: sticky",
    "bottom: max(var(--space-3), env(safe-area-inset-bottom))",
    "max-height: none",
    "overflow: visible",
    "padding-bottom: var(--setup-footer-reserve, var(--space-5))",
    "padding-bottom: var(--setup-footer-reserve, 8.75rem)",
  ]);
  await assertRouteContains(baseUrl, "/wallet.js", [
    "unsupported-command-kind",
    "no-move-calls",
    "Mainnet signing is disabled",
  ]);
}

async function verifyRootedAppShell(baseUrl, route) {
  await assertRouteContains(baseUrl, route, [
    'src="/runtime-config.js',
    'src="/telemetry.js',
    'src="/app.js',
    'src="/tide-mark.svg"',
  ]);
  await assertRouteNotContains(baseUrl, route, [
    'src="./runtime-config.js',
    'src="./telemetry.js',
    'src="./app.js',
    'src="./tide-mark.svg"',
    'href="./styles-',
    'href="./setup"',
    'href="./live"',
    'href="./results"',
    'href="./library"',
  ]);
}

async function verifyAppPageRoute(baseUrl, route, markers) {
  await assertRouteContains(baseUrl, route, markers);
  await assertRouteContains(baseUrl, `${route}/`, markers);
  await verifyRootedAppShell(baseUrl, `${route}/`);
}

async function verifyProofDocs(baseUrl) {
  await assertRouteContains(baseUrl, "/docs/overflow_2026/RFC-0001-action-receipt-schema.md", [
    "# RFC-0001",
    "Action Receipt",
  ]);
  const proofPack = await fetchText(`${baseUrl}/${PUBLIC_PROOF_PACK_PATH}`);
  assertPublicProofDocFreshness(baseUrl, proofPack);
  assertTextContains(`${baseUrl}/${PUBLIC_PROOF_PACK_PATH}`, proofPack, [
    "Autopilot Rehearsal proof pack",
    CURRENT_TESTNET_RECEIPT_PACKAGE,
    "Walrus blob:",
  ]);
  assertProofDocEvidencePosture(`${baseUrl}/${PUBLIC_PROOF_PACK_PATH}`, proofPack);
  for (const forbidden of [RETIRED_TESTNET_RECEIPT_PACKAGE]) {
    if (proofPack.includes(forbidden)) {
      fail(`${baseUrl}/${PUBLIC_PROOF_PACK_PATH} contains retired proof package marker: ${forbidden}`);
    }
  }
}

async function verifyReceiptViewer(baseUrl) {
  await assertContentType(baseUrl, "/r/viewer.js", /(?:^|;|\s)(?:text|application)\/javascript\b/i);
  await assertRouteContains(baseUrl, "/r/", [
    'data-page="receipt-viewer"',
    "<title>TIDE Receipt</title>",
    'src="/r/viewer.js"',
  ]);
  await assertRouteContains(baseUrl, `/r/${LOCAL_PROOF_PINS.receiptObjectId}`, [
    'data-page="receipt-viewer"',
    "<title>TIDE Receipt</title>",
    'src="/r/viewer.js"',
  ]);
}

export function assertManifestBuildFreshness(baseUrl, manifest, buildId, kind = "app", env = process.env) {
  if (buildId && manifest?.buildId !== buildId) {
    fail(`${baseUrl}/release-manifest.json buildId=${manifest?.buildId} expected ${buildId}`);
  }
  if (buildId && String(manifest?.gitShortSha || "").trim() !== buildId) {
    fail(`${baseUrl}/release-manifest.json gitShortSha=${manifest?.gitShortSha || "missing"} expected ${buildId}`);
  }
  const deployGitSha = expectedDeployGitSha(env).toLowerCase();
  if (deployGitSha) {
    const manifestGitSha = String(manifest?.gitSha || "").trim().toLowerCase();
    if (manifestGitSha !== deployGitSha) {
      fail(`${baseUrl}/release-manifest.json gitSha=${manifestGitSha || "missing"} expected deploy sha ${deployGitSha}`);
    }
  }
  const deployRef = expectedDeployRef(env);
  if (deployRef) {
    const manifestRef = String(manifest?.gitBranch || "").trim();
    if (manifestRef !== deployRef) {
      fail(`${baseUrl}/release-manifest.json gitBranch=${manifestRef || "missing"} expected deploy ref ${deployRef}`);
    }
  }
  if (kind === "landing" && manifest?.landing?.buildId && buildId && manifest.landing.buildId !== buildId) {
    fail(`${baseUrl}/release-manifest.json landing.buildId=${manifest.landing.buildId} expected ${buildId}`);
  }
  if (kind === "app" && manifest?.app?.buildId && buildId && manifest.app.buildId !== buildId) {
    fail(`${baseUrl}/release-manifest.json app.buildId=${manifest.app.buildId} expected ${buildId}`);
  }
}

async function verifyManifest(baseUrl, kind, buildId) {
  const manifest = await fetchJson(`${baseUrl}/release-manifest.json`);
  assertManifestBuildFreshness(baseUrl, manifest, buildId, kind);
  return manifest;
}

async function verifyRuntimeConfig(baseUrl, buildId) {
  const config = parseSerializedConfig(
    await fetchText(`${baseUrl}/runtime-config.js`),
    `${baseUrl}/runtime-config.js`
  );
  if (buildId && String(config?.buildId || "").trim() !== buildId) {
    fail(`${baseUrl}/runtime-config.js buildId=${config?.buildId} expected ${buildId}`);
  }
  return config;
}

export function runtimeProofMatchesManifest({ proofCommit, manifestSha, manifestBuildId } = {}) {
  const proof = String(proofCommit || "").trim().toLowerCase();
  if (!proof) {
    return true;
  }
  const sha = String(manifestSha || "").trim().toLowerCase();
  const build = String(manifestBuildId || "").trim().toLowerCase();
  const matchesSha = Boolean(sha && proof === sha);
  const matchesBuild = Boolean(build && proof === build);
  return matchesSha || matchesBuild;
}

export function assertRuntimeProofMatchesManifest(baseUrl, config, manifest) {
  const proofCommit = String(config?.proof?.commit || "").trim().toLowerCase();
  if (!proofCommit) {
    return;
  }
  const manifestSha = String(manifest?.gitSha || "").trim().toLowerCase();
  const manifestBuildId = String(manifest?.buildId || "").trim().toLowerCase();
  if (!runtimeProofMatchesManifest({ proofCommit, manifestSha, manifestBuildId })) {
    fail(
      `${baseUrl}/runtime-config.js proof.commit=${proofCommit} does not match release-manifest gitSha=${manifestSha || "missing"} buildId=${manifestBuildId || "missing"}`
    );
  }
}

async function verifyLanding(baseUrl, buildId) {
  const manifest = await verifyManifest(baseUrl, "landing", buildId);
  const config = await verifyRuntimeConfig(baseUrl, buildId);
  assertRuntimeProofMatchesManifest(baseUrl, config, manifest);
  // Golden-flow markers on the deployed landing — each one guards a
  // regression we have already tripped over in a prior cycle.
  await assertRouteContains(baseUrl, "/", [
    "<title>TIDE — Bitcoin Treasury Policy Cockpit on Sui | Shadow-first, Simulate First</title>",
    'data-track="landing_open_workspace_hero"',
    'id="live-proof"',
    'class="proof-screen"',
    "Modeled. Non-custodial. Not investment advice.",
  ]);
  await assertRouteContains(baseUrl, "/privacy.html", [
    'data-page="legal-privacy"',
    "Privacy notice",
    "privacy@tidesui.pro",
  ]);
  await assertRouteContains(baseUrl, "/terms.html", [
    'data-page="legal-terms"',
    "Public alpha terms",
    "No investment advice",
  ]);
  await assertRouteContains(baseUrl, "/risk.html", [
    'data-page="legal-risk"',
    "Risk disclosure",
    "Modeled results are not guaranteed",
  ]);
  await verifyProofDocs(baseUrl);
  if (resolveExpectedRuntimeSuiNetwork(baseUrl) === "testnet") {
    await verifyReceiptViewer(baseUrl);
  }
}

async function verifyApp(baseUrl, buildId) {
  const manifest = await verifyManifest(baseUrl, "app", buildId);
  const config = await verifyRuntimeConfig(baseUrl, buildId);
  assertRuntimeSuiNetwork(baseUrl, config);
  assertRuntimeTestnetProofPins(baseUrl, config);
  if (buildId && manifest?.buildId !== config?.buildId) {
    fail(`${baseUrl} manifest/runtime buildId mismatch: ${manifest?.buildId} vs ${config?.buildId}`);
  }
  await fetchText(`${baseUrl}/live-rail-pack.json`);
  await assertRouteContains(baseUrl, "/", [
    'data-page="workspace"',
    "<title>TIDE Workspace</title>",
  ]);
  await verifyRootedAppShell(baseUrl, "/");
  await assertRouteContains(baseUrl, "/workspace/", [
    'data-page="workspace"',
    "<title>TIDE Workspace</title>",
  ]);
  await verifyRootedAppShell(baseUrl, "/workspace/");
  // Setup golden flow: preset buttons, wired stat suffix, and the
  // Publish CTA must all survive to the deployed setup surface.
  await verifyAppPageRoute(baseUrl, "/setup", [
    'data-page="setup"',
    "<title>TIDE Create</title>",
    'data-preset="starter"',
    'data-preset="safety"',
    'data-preset="drift"',
    'Accumulate',
    'Lower draw, longer runway',
    'data-preset-stat-suffix="starter-payout"',
    'id="save-policy-toolbar"',
  ]);
  await verifyHydrationAssets(baseUrl);
  await verifyAppPageRoute(baseUrl, "/results", [
    'data-page="results"',
    "<title>TIDE Readout</title>",
  ]);
  await verifyAppPageRoute(baseUrl, "/live", [
    'data-page="live"',
    "<title>TIDE Live</title>",
  ]);
  await verifyProofDocs(baseUrl);
  if (resolveExpectedRuntimeSuiNetwork(baseUrl) === "testnet") {
    await verifyReceiptViewer(baseUrl);
  }
}

async function verifyApi(baseUrl, requireSignedOps) {
  const healthz = await fetchJson(`${baseUrl}/v1/healthz`);
  const digestRe = /^0x[0-9a-f]{64}$/i;
  for (const route of ["/v1/onchain/last-receipt", "/api/onchain/last-receipt"]) {
    const lastReceipt = await fetchJson(`${baseUrl}${route}`);
    const configured = lastReceipt?.configured === true;
    if (!configured) {
      if (requireSignedOps) {
        fail(`${baseUrl}${route} is not configured`);
      }
      continue;
    }
    if (lastReceipt?.ok !== true) {
      fail(`${baseUrl}${route} is not ok`);
    }
    if (
      !digestRe.test(String(lastReceipt.content_digest || "")) ||
      !digestRe.test(String(lastReceipt.state_before_digest || "")) ||
      !digestRe.test(String(lastReceipt.rail_pack_digest || "")) ||
      !String(lastReceipt.walrus_blob_id || "").trim()
    ) {
      fail(`${baseUrl}${route} is missing integrity anchors`);
    }
    if (!["fresh", "recent", "stale", "cold", "unknown"].includes(String(lastReceipt.freshness_label || ""))) {
      fail(`${baseUrl}${route} has invalid freshness_label=${lastReceipt.freshness_label || "missing"}`);
    }
    if (lastReceipt.schemaVersion !== lastReceipt.eventSchemaVersion || lastReceipt.schemaVersionMismatch === true) {
      fail(`${baseUrl}${route} schemaVersion=${lastReceipt.schemaVersion || "missing"} expected ${lastReceipt.eventSchemaVersion || "missing"}`);
    }
    if (!Number.isFinite(Number(lastReceipt.revocationSeq))) {
      fail(`${baseUrl}${route} is missing revocationSeq`);
    }
  }
  if (requireSignedOps) {
    const readyz = await fetchJson(`${baseUrl}/v1/readyz`);
    if (readyz?.ready !== true || readyz?.ok !== true) {
      fail(`${baseUrl}/v1/readyz is not ready`);
    }
    if (readyz?.checks?.packSigner !== true) {
      fail(`${baseUrl}/v1/readyz reports packSigner=false`);
    }
    if (readyz?.checks?.livePack !== true || readyz?.checks?.livePackSigned !== true) {
      fail(`${baseUrl}/v1/readyz reports livePack/livePackSigned=false`);
    }
    if (readyz?.checks?.onchainLivenessConfigured !== true) {
      fail(`${baseUrl}/v1/readyz reports onchainLivenessConfigured=false`);
    }
  }
}

async function main() {
  const buildId = expectedBuildId();
  const landingUrl = normalizeBaseUrl(process.env.TIDE_VERIFY_LANDING_URL);
  const appUrl = normalizeBaseUrl(process.env.TIDE_VERIFY_APP_URL);
  const apiUrl = normalizeBaseUrl(process.env.TIDE_VERIFY_API_URL);
  const requireSignedOps = /^(1|true|yes|on)$/i.test(
    String(process.env.TIDE_VERIFY_REQUIRE_SIGNED_OPS || "").trim()
  );

  if (!landingUrl && !appUrl && !apiUrl) {
    fail("No remote targets configured. Set TIDE_VERIFY_LANDING_URL and/or TIDE_VERIFY_APP_URL and/or TIDE_VERIFY_API_URL.");
  }

  if (landingUrl) {
    await verifyLanding(landingUrl, buildId);
  }
  if (appUrl) {
    await verifyApp(appUrl, buildId);
  }
  if (apiUrl) {
    await verifyApi(apiUrl, requireSignedOps);
  }

  process.stdout.write("Remote release verification passed.\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
