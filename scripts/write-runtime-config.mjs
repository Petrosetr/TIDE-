import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const FULL_SUI_OBJECT_ID_RE = /^0x[a-fA-F0-9]{64}$/;

function envFlag(name, fallback = false) {
  const value = process.env[name];

  if (value === undefined) {
    return fallback;
  }

  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function envString(name, fallback = "") {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function envStringAlias(names, fallback = "") {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return fallback;
}

function envFlagAlias(names, fallback = false) {
  for (const name of names) {
    if (process.env[name] !== undefined) {
      return /^(1|true|yes|on)$/i.test(String(process.env[name]).trim());
    }
  }
  return fallback;
}

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function hasNonCanonicalWorkspacePath(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return false;
  }

  const blockedPaths = new Set([
    "/setup",
    "/results",
    "/live",
    "/library",
    "/shadow-mode",
  ]);

  if (isRemoteUrl(raw)) {
    try {
      const parsed = new URL(raw);
      const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
      return pathname !== "/" && blockedPaths.has(pathname.toLowerCase());
    } catch {
      return false;
    }
  }

  const normalized = raw.replace(/\/+$/, "");
  return normalized === "./shadow-mode" ||
    normalized === "shadow-mode" ||
    normalized === "./setup" ||
    normalized === "setup" ||
    normalized === "./results" ||
    normalized === "results" ||
    normalized === "./live" ||
    normalized === "live" ||
    normalized === "./library" ||
    normalized === "library";
}

function isRemoteUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function isLocalLikeUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    const hostname = parsed.hostname.toLowerCase();
    return hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]" ||
      hostname.endsWith(".localhost");
  } catch {
    return false;
  }
}

function isDevReadOnlyWorkspace({ workspaceUrl = "", deployTarget = "", suiNetwork = "", allowSigning = false } = {}) {
  if (String(deployTarget || "").trim().toLowerCase() !== "dev") {
    return false;
  }

  try {
    const parsed = new URL(String(workspaceUrl || "").trim());
    return parsed.hostname.toLowerCase() === "dev.tidesui.pro" &&
      String(suiNetwork || "").trim().toLowerCase() === "mainnet" &&
      allowSigning !== true;
  } catch {
    return false;
  }
}

function inferOpsBaseUrl({ explicit = "" } = {}) {
  return normalizeBaseUrl(explicit);
}

function getBuildId() {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  if (result.status === 0) {
    const value = String(result.stdout || "").trim();
    if (value) {
      return value;
    }
  }

  return String(Date.now());
}

function serializeConfig(config) {
  return `window.TIDE_CONFIG = ${JSON.stringify(config, null, 2)};\n`;
}

export function deriveAllowedMoveTargets({ packageId, policyModule, receiptsModule } = {}) {
  const pkg = typeof packageId === "string" ? packageId.trim() : "";
  if (!pkg) return [];
  const policy = typeof policyModule === "string" && policyModule.trim() ? policyModule.trim() : "policy_registry";
  const receipts = typeof receiptsModule === "string" && receiptsModule.trim() ? receiptsModule.trim() : "execution_receipts";
  return [
    `${pkg}::${policy}::create_policy`,
    `${pkg}::${policy}::update_policy`,
    `${pkg}::${policy}::select_rail`,
    `${pkg}::${policy}::migrate_policy`,
    `${pkg}::${policy}::delete_policy`,
    `${pkg}::${receipts}::mint_receipt`,
  ];
}

async function writeConfigFile(filePath, config) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, serializeConfig(config), "utf8");
}

export async function loadProofSummary(rootDir) {
  const candidatePath = path.join(rootDir, "docs", "proof", "latest-proof-loop.json");
  try {
    const raw = await readFile(candidatePath, "utf8");
    const parsed = JSON.parse(raw);
    const runs = Array.isArray(parsed?.runs) ? parsed.runs : [];
    const latest = runs[runs.length - 1];
    if (!latest) {
      return null;
    }
    const commitFull = typeof parsed.proofRef === "string" ? parsed.proofRef : "";
    return {
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : "",
      network: typeof parsed.network === "string" ? parsed.network : "testnet",
      commit: commitFull,
      commitShort: commitFull ? commitFull.slice(0, 7) : "",
      packageId: typeof parsed.packageId === "string" ? parsed.packageId.trim() : "",
      railAllowlistId: typeof parsed.railAllowlistId === "string" ? parsed.railAllowlistId.trim() : "",
      runLabel: typeof latest.label === "string" ? latest.label : "",
      policyAnchor: latest.policyAnchor || null,
      receiptMint: latest.receiptMint || null,
      railPackDigestHex:
        latest?.receiptMint?.railPackDigestHex ||
        latest?.proofBundle?.railPackDigestHex ||
        "",
    };
  } catch {
    return null;
  }
}

export async function loadTestnetProofPins(rootDir) {
  const candidatePath = path.join(rootDir, "docs", "proof", "latest-proof-loop.json");
  const raw = await readFile(candidatePath, "utf8");
  const parsed = JSON.parse(raw);
  const packageId = String(parsed?.packageId || "").trim();
  const railAllowlistId = String(parsed?.railAllowlistId || "").trim();
  if (!FULL_SUI_OBJECT_ID_RE.test(packageId)) {
    throw new Error(`${path.relative(rootDir, candidatePath)} packageId must be a 32-byte Sui object id.`);
  }
  if (!FULL_SUI_OBJECT_ID_RE.test(railAllowlistId)) {
    throw new Error(`${path.relative(rootDir, candidatePath)} railAllowlistId must be a 32-byte Sui object id.`);
  }
  return { packageId, railAllowlistId };
}

async function loadPublishedTestnetPackageId(rootDir) {
  const candidatePath = path.join(rootDir, "move", "Published.toml");
  const raw = await readFile(candidatePath, "utf8");
  const match = raw.match(/\[published\.testnet\][\s\S]*?published-at\s*=\s*"([^"]+)"/);
  const packageId = String(match?.[1] || "").trim();
  if (!FULL_SUI_OBJECT_ID_RE.test(packageId)) {
    throw new Error(`${path.relative(rootDir, candidatePath)} published.testnet.published-at must be a 32-byte Sui object id.`);
  }
  return packageId;
}

export function proofSummaryMatchesBuild(proofSummary, buildId) {
  const proof = String(proofSummary?.commit || "").trim().toLowerCase();
  const build = String(buildId || "").trim().toLowerCase();
  if (!proof || !build) {
    return false;
  }
  return proof.startsWith(build) || build.startsWith(proof);
}

export async function loadSeedMarket(rootDir) {
  const candidatePaths = [
    envStringAlias(["TIDE_LIVE_RAIL_PACK_FILE", "TIDEFORGE_LIVE_RAIL_PACK_FILE"], ""),
    path.join(rootDir, "shadow-mode", "examples", "live-rail-pack.generated.json"),
    path.join(rootDir, "shadow-mode", "live-rail-pack.json"),
  ].filter(Boolean);

  for (const candidatePath of candidatePaths) {
    try {
      const raw = await readFile(candidatePath, "utf8");
      const parsed = JSON.parse(raw);
      const btcPriceUsd = Number(parsed?.market?.btcPriceUsd || 0);

      if (Number.isFinite(btcPriceUsd) && btcPriceUsd > 1_000) {
        return {
          btcPriceUsd,
          updatedAt:
            typeof parsed?.market?.updatedAt === "string" && parsed.market.updatedAt.trim()
              ? parsed.market.updatedAt.trim()
              : "",
          source:
            typeof parsed?.market?.source === "string" && parsed.market.source.trim()
              ? parsed.market.source.trim()
              : "build-seeded",
        };
      }
    } catch {
      // ignore missing or invalid candidate files and try the next one
    }
  }

  return null;
}

async function main() {
  const cwd = process.cwd();
  const root = path.resolve(cwd, process.env.TIDE_CONFIG_ROOT || "dist/public-alpha");
  const buildId = envStringAlias(["TIDE_BUILD_ID", "TIDEFORGE_BUILD_ID"], getBuildId());
  const landingUrl = envStringAlias(["TIDE_LANDING_URL", "TIDEFORGE_LANDING_URL"], "https://tidesui.pro");
  const workspaceUrl = envStringAlias(["TIDE_WORKSPACE_URL", "TIDEFORGE_WORKSPACE_URL"], "https://app.tidesui.pro");
  const deployTarget = envStringAlias(["TIDE_DEPLOY_TARGET", "TIDEFORGE_DEPLOY_TARGET"], "").toLowerCase();
  const opsBaseUrl = inferOpsBaseUrl({
    explicit: envStringAlias(["TIDE_OPS_BASE_URL", "TIDEFORGE_OPS_BASE_URL"], ""),
  });
  const tideEnv = envStringAlias(["TIDE_ENV", "TIDEFORGE_ENV"], "").toLowerCase();
  // When no ops base URL is configured, fall back to same-origin paths so
  // telemetry hits the nginx-fronted /v1/* routes on the page host (dev
  // serves ops on dev.tidesui.pro same-origin; no separate api.* subdomain).
  const beaconUrl = envStringAlias(
    ["TIDE_TELEMETRY_BEACON_URL", "TIDEFORGE_TELEMETRY_BEACON_URL"],
    opsBaseUrl ? `${opsBaseUrl}/v1/track` : "/v1/track"
  );
  const errorBeaconUrl = envStringAlias(
    ["TIDE_ERROR_BEACON_URL", "TIDEFORGE_ERROR_BEACON_URL"],
    opsBaseUrl ? `${opsBaseUrl}/v1/error` : "/v1/error"
  );
  const liveRailPackUrl = envStringAlias(
    ["TIDE_LIVE_RAIL_PACK_URL", "TIDEFORGE_LIVE_RAIL_PACK_URL"],
    opsBaseUrl ? `${opsBaseUrl}/v1/live-rail-pack` : `${normalizeBaseUrl(workspaceUrl)}/live-rail-pack.json`
  );
  const liveRailPackVerifyKey = envStringAlias(
    ["TIDE_LIVE_RAIL_PACK_VERIFY_KEY", "TIDEFORGE_LIVE_RAIL_PACK_VERIFY_KEY"],
    ""
  );
  // When no verifyKey is configured, opt in explicitly to accept unsigned
  // /v1/market-forecast responses. Defaults to false so production and
  // mainnet read-only builds require signatures by default; the guard below
  // only permits remote unsigned forecast on same-origin non-mainnet proof
  // builds or on the explicit dev.tidesui.pro read-only preview host where
  // the forecast cannot move mainnet capital.
  const allowUnsignedForecast = envFlagAlias(
    ["TIDE_ALLOW_UNSIGNED_FORECAST", "TIDEFORGE_ALLOW_UNSIGNED_FORECAST"],
    false
  );
  const liveRailPackIsRemote = isRemoteUrl(liveRailPackUrl);
  const liveRailPackNeedsSignature = liveRailPackIsRemote && !isLocalLikeUrl(liveRailPackUrl);
  const canAutoloadLiveRailPack = Boolean(liveRailPackUrl) && (!liveRailPackIsRemote || Boolean(liveRailPackVerifyKey));
  const liveRailPackAutoLoad = envFlagAlias(
    ["TIDE_LIVE_RAIL_PACK_AUTOLOAD", "TIDEFORGE_LIVE_RAIL_PACK_AUTOLOAD"],
    canAutoloadLiveRailPack
  ) && canAutoloadLiveRailPack;
  const liveRailPackPreferRemote = envFlagAlias(
    ["TIDE_LIVE_RAIL_PACK_PREFER_REMOTE", "TIDEFORGE_LIVE_RAIL_PACK_PREFER_REMOTE"],
    liveRailPackIsRemote && Boolean(liveRailPackVerifyKey)
  ) && liveRailPackIsRemote && Boolean(liveRailPackVerifyKey);
  const liveEnabled = envFlagAlias(["TIDE_LIVE_ENABLED", "TIDEFORGE_LIVE_ENABLED"], false);
  // Sui network/chain wiring (read by shadow-mode/lib/sui-network.mjs).
  // SEC-8: this must be explicit. Silent fallback to mainnet makes a
  // missing testnet env var look like an intentional mainnet build.
  const suiNetworkRaw = envStringAlias(["TIDE_SUI_NETWORK", "TIDEFORGE_SUI_NETWORK"], "").toLowerCase();
  if (!suiNetworkRaw) {
    throw new Error(
      [
        "Refusing to write runtime-config: TIDE_SUI_NETWORK is required.",
        "Set TIDE_SUI_NETWORK=mainnet|testnet|devnet before invoking the writer.",
        "Production deploys must set mainnet explicitly; testnet proof builds must set testnet explicitly.",
      ].join(" ")
    );
  }
  if (!["mainnet", "testnet", "devnet"].includes(suiNetworkRaw)) {
    throw new Error(
      `Refusing to write runtime-config: TIDE_SUI_NETWORK="${suiNetworkRaw}" is not a known network (expected mainnet | testnet | devnet).`
    );
  }
  const suiNetwork = suiNetworkRaw;
  const suiRpcUrl = envStringAlias(["TIDE_SUI_RPC_URL", "TIDEFORGE_SUI_RPC_URL"], "");
  const suiExplorerBase = envStringAlias(["TIDE_SUI_EXPLORER_BASE", "TIDEFORGE_SUI_EXPLORER_BASE"], "");
  const executionProofEnabled = envFlagAlias(
    ["TIDE_EXECUTION_PROOF_ENABLED", "TIDEFORGE_EXECUTION_PROOF_ENABLED"],
    false
  );
  const executionProofAllowSigning = envFlagAlias(
    ["TIDE_EXECUTION_PROOF_ALLOW_SIGNING", "TIDEFORGE_EXECUTION_PROOF_ALLOW_SIGNING"],
    false
  );
  const devReadOnlyWorkspace = isDevReadOnlyWorkspace({
    workspaceUrl,
    deployTarget,
    suiNetwork,
    allowSigning: executionProofAllowSigning,
  });

  // Sui object id shape: 0x + 1–64 hex chars. We tolerate the abbreviated
  // 0x6 Clock singleton, but for freshly published package/cap/object ids
  // require the full 32-byte address. Anything shorter is almost certainly a
  // placeholder or truncation bug in the env wiring.
  const SUI_OBJECT_ID_RE = /^0x[a-fA-F0-9]{1,64}$/;
  const SUI_FULL_ID_RE = FULL_SUI_OBJECT_ID_RE;

  const policyPackageId = envStringAlias(["TIDE_POLICY_PACKAGE_ID", "TIDEFORGE_POLICY_PACKAGE_ID"], "");
  const policyRailAllowlistId = envStringAlias(
    ["TIDE_POLICY_RAIL_ALLOWLIST_ID", "TIDEFORGE_POLICY_RAIL_ALLOWLIST_ID"],
    ""
  );
  const policyAdminCapId = envStringAlias(["TIDE_POLICY_ADMIN_CAP_ID", "TIDEFORGE_POLICY_ADMIN_CAP_ID"], "");
  const policyClockObjectId = envStringAlias(["TIDE_CLOCK_OBJECT_ID", "TIDEFORGE_CLOCK_OBJECT_ID"], "0x6");
  const pythPriceInfoObjectId = envStringAlias(
    ["TIDE_PYTH_BTC_USD_PRICE_INFO_OBJECT_ID", "TIDEFORGE_PYTH_BTC_USD_PRICE_INFO_OBJECT_ID"],
    ""
  );

  const nonProductionViolations = [];
  if (hasNonCanonicalWorkspacePath(workspaceUrl)) {
    nonProductionViolations.push(
      `TIDE_WORKSPACE_URL="${workspaceUrl}" points at a subpage/legacy path — Workspace must resolve to the app root, not /setup, /results, /live, /library, or /shadow-mode.`
    );
  }
  const unsignedForecastAllowedOnRemote =
    tideEnv !== "production" &&
    !opsBaseUrl &&
    (
      (suiNetwork !== "mainnet" && executionProofAllowSigning) ||
      devReadOnlyWorkspace
    );
  if (
    allowUnsignedForecast &&
    !isLocalLikeUrl(workspaceUrl) &&
    !isLocalLikeUrl(landingUrl) &&
    !unsignedForecastAllowedOnRemote
  ) {
    nonProductionViolations.push(
      "TIDE_ALLOW_UNSIGNED_FORECAST is truthy on a non-local build — unsigned /v1/market-forecast responses are only permitted on localhost or same-origin non-mainnet proof builds."
    );
  }
  if (liveEnabled && liveRailPackNeedsSignature && !liveRailPackVerifyKey) {
    nonProductionViolations.push(
      "TIDE_LIVE_ENABLED=true but TIDE_LIVE_RAIL_PACK_VERIFY_KEY is empty for a remote live rail pack — remote trust inputs must be signed."
    );
  }
  if (nonProductionViolations.length > 0) {
    const lines = [
      "Refusing to write runtime-config: non-local fail-open configuration.",
      ...nonProductionViolations.map((line) => `  - ${line}`),
      "Fix the offending environment variables before re-running the build.",
    ];
    throw new Error(lines.join("\n"));
  }

  // Hard rejection #1 (applies to every build, not just production):
  // signing on mainnet is never allowed during the MVP. Without this guard
  // a misconfigured dev build could flip to mainnet + allowSigning=true and
  // lose the "no mainnet capital" invariant that the UI advertises.
  if (suiNetwork === "mainnet" && executionProofAllowSigning) {
    throw new Error(
      "Refusing to write runtime-config: TIDE_SUI_NETWORK=mainnet with " +
      "TIDE_EXECUTION_PROOF_ALLOW_SIGNING=true is banned on every build. " +
      "Signing is only permitted on testnet/devnet during the Autopilot Rehearsal."
    );
  }

  // Hard rejection #2: when signing is enabled the on-chain ids must be
  // present and shape-valid, otherwise the wallet allowlist is vacuous or
  // the user sees a confusing runtime error on the first mint. We validate
  // the shape here at build time so broken env wiring fails CI, not a user.
  if (executionProofAllowSigning) {
    const shapeViolations = [];
    if (!policyPackageId) {
      shapeViolations.push("TIDE_POLICY_PACKAGE_ID is empty — mint PTBs cannot be assembled.");
    } else if (!SUI_FULL_ID_RE.test(policyPackageId)) {
      shapeViolations.push(
        `TIDE_POLICY_PACKAGE_ID="${policyPackageId}" is not a 32-byte Sui object id (expected 0x + 64 hex chars).`
      );
    }
    if (!policyRailAllowlistId) {
      shapeViolations.push(
        "TIDE_POLICY_RAIL_ALLOWLIST_ID is empty — mint_receipt takes &RailAllowlist and will fail at anchor time."
      );
    } else if (!SUI_FULL_ID_RE.test(policyRailAllowlistId)) {
      shapeViolations.push(
        `TIDE_POLICY_RAIL_ALLOWLIST_ID="${policyRailAllowlistId}" is not a 32-byte Sui object id.`
      );
    }
    if (policyAdminCapId && !SUI_FULL_ID_RE.test(policyAdminCapId)) {
      shapeViolations.push(
        `TIDE_POLICY_ADMIN_CAP_ID="${policyAdminCapId}" is set but not a 32-byte Sui object id.`
      );
    }
    if (policyClockObjectId && !SUI_OBJECT_ID_RE.test(policyClockObjectId)) {
      shapeViolations.push(
        `TIDE_CLOCK_OBJECT_ID="${policyClockObjectId}" is not a Sui object id (expected 0x… hex).`
      );
    }
    if (shapeViolations.length > 0) {
      const lines = [
        "Refusing to write runtime-config: TIDE_EXECUTION_PROOF_ALLOW_SIGNING=true but on-chain ids are missing or malformed:",
        ...shapeViolations.map((line) => `  - ${line}`),
        "Fix the offending environment variables before re-running the build.",
      ];
      throw new Error(lines.join("\n"));
    }
  }

  // Hard rejection #2e: testnet signing must point at the exact package /
  // allowlist exercised by the current public proof pack. A package republish
  // is a real proof boundary: until docs/proof/latest-proof-loop.json and
  // move/Published.toml are refreshed, the browser must not sign against the
  // new ids while still presenting the old proof pack.
  if (executionProofAllowSigning && suiNetwork === "testnet") {
    const pinViolations = [];
    try {
      const proofPins = await loadTestnetProofPins(cwd);
      const publishedPackageId = await loadPublishedTestnetPackageId(cwd);
      if (policyPackageId.toLowerCase() !== proofPins.packageId.toLowerCase()) {
        pinViolations.push(
          `TIDE_POLICY_PACKAGE_ID=${policyPackageId} does not match docs/proof/latest-proof-loop.json packageId ${proofPins.packageId}.`
        );
      }
      if (policyRailAllowlistId.toLowerCase() !== proofPins.railAllowlistId.toLowerCase()) {
        pinViolations.push(
          `TIDE_POLICY_RAIL_ALLOWLIST_ID=${policyRailAllowlistId} does not match docs/proof/latest-proof-loop.json railAllowlistId ${proofPins.railAllowlistId}.`
        );
      }
      if (policyPackageId.toLowerCase() !== publishedPackageId.toLowerCase()) {
        pinViolations.push(
          `TIDE_POLICY_PACKAGE_ID=${policyPackageId} does not match move/Published.toml published.testnet.published-at ${publishedPackageId}.`
        );
      }
    } catch (error) {
      pinViolations.push(error?.message || String(error));
    }
    if (pinViolations.length > 0) {
      const lines = [
        "Refusing to write runtime-config: testnet signing ids drift from the current proof package.",
        ...pinViolations.map((line) => `  - ${line}`),
        "Republish only with a refreshed proof loop, proof pack, package pins, and verifier fixtures.",
      ];
      throw new Error(lines.join("\n"));
    }
  }

  if (pythPriceInfoObjectId && !SUI_FULL_ID_RE.test(pythPriceInfoObjectId)) {
    throw new Error(
      `Refusing to write runtime-config: TIDE_PYTH_BTC_USD_PRICE_INFO_OBJECT_ID="${pythPriceInfoObjectId}" is not a 32-byte Sui object id.`
    );
  }

  if (tideEnv === "production") {
    const violations = [];
    if (suiNetwork !== "mainnet") {
      violations.push(
        `TIDE_SUI_NETWORK="${suiNetworkRaw || suiNetwork}" is not permitted in production (must resolve to mainnet).`
      );
    }
    if (executionProofAllowSigning) {
      violations.push(
        "TIDE_EXECUTION_PROOF_ALLOW_SIGNING=true is not permitted in production — on-chain proof loop may only sign on testnet/dev builds."
      );
    }
    if (violations.length > 0) {
      const lines = [
        "Refusing to write runtime-config: TIDE_ENV=production with fail-open configuration.",
        ...violations.map((line) => `  - ${line}`),
        "Fix the offending environment variables before re-running the build.",
      ];
      throw new Error(lines.join("\n"));
    }
  }

  const seedMarket = await loadSeedMarket(cwd);
  const proofSummary = await loadProofSummary(cwd);
  const proofSummaryMatchesCurrentBuild = proofSummaryMatchesBuild(proofSummary, buildId);
  const activeProofSummary = proofSummary
    ? {
        ...proofSummary,
        sourceRefMatchesBuild: proofSummaryMatchesCurrentBuild,
        buildId,
        proofRefDisclosurePath: "docs/proof/proof_ref_disclosure.md",
      }
    : null;

  const sharedTelemetry = {
    plausibleDomain: envStringAlias(["TIDE_PLAUSIBLE_DOMAIN", "TIDEFORGE_PLAUSIBLE_DOMAIN"], ""),
    plausibleScriptUrl: envStringAlias(["TIDE_PLAUSIBLE_SCRIPT_URL", "TIDEFORGE_PLAUSIBLE_SCRIPT_URL"], "https://plausible.io/js/script.js"),
    beaconUrl,
    errorBeaconUrl,
  };

  const sharedErrorTracking = {
    beaconUrl: errorBeaconUrl,
  };

  const landingConfig = {
    siteName: "TIDE",
    buildId,
    landingUrl,
    workspaceUrl,
    apiBaseUrl: opsBaseUrl,
    telemetry: sharedTelemetry,
    errorTracking: sharedErrorTracking,
    proof: activeProofSummary,
  };

  const appConfig = {
    siteName: "TIDE",
    buildId,
    landingUrl,
    workspaceUrl,
    apiBaseUrl: opsBaseUrl,
    telemetry: sharedTelemetry,
    errorTracking: sharedErrorTracking,
    proof: activeProofSummary,
    liveRailPack: {
      url: liveRailPackUrl,
      autoLoad: liveRailPackAutoLoad,
      preferRemote: liveRailPackPreferRemote,
      persist: envFlagAlias(["TIDE_LIVE_RAIL_PACK_PERSIST", "TIDEFORGE_LIVE_RAIL_PACK_PERSIST"], true),
      seedMarket,
      verifyKey: liveRailPackVerifyKey,
      allowUnsignedForecast,
    },
    liveEnabled,
    sui: {
      network: suiNetwork,
      rpcUrl: suiRpcUrl,
      explorerBase: suiExplorerBase,
    },
    executionProof: {
      enabled: executionProofEnabled,
      allowSigning: executionProofAllowSigning,
    },
    policyRegistry: {
      packageId: envStringAlias(["TIDE_POLICY_PACKAGE_ID", "TIDEFORGE_POLICY_PACKAGE_ID"], ""),
      module: envStringAlias(["TIDE_POLICY_MODULE", "TIDEFORGE_POLICY_MODULE"], "policy_registry"),
      clockObjectId: envStringAlias(["TIDE_CLOCK_OBJECT_ID", "TIDEFORGE_CLOCK_OBJECT_ID"], "0x6"),
      railAllowlistId: envStringAlias(
        ["TIDE_POLICY_RAIL_ALLOWLIST_ID", "TIDEFORGE_POLICY_RAIL_ALLOWLIST_ID"],
        ""
      ),
      adminCapId: envStringAlias(["TIDE_POLICY_ADMIN_CAP_ID", "TIDEFORGE_POLICY_ADMIN_CAP_ID"], ""),
    },
    executionReceipts: {
      module: envStringAlias(["TIDE_RECEIPTS_MODULE", "TIDEFORGE_RECEIPTS_MODULE"], "execution_receipts"),
    },
    execution: {
      allowedMoveTargets: deriveAllowedMoveTargets({
        packageId: envStringAlias(["TIDE_POLICY_PACKAGE_ID", "TIDEFORGE_POLICY_PACKAGE_ID"], ""),
        policyModule: envStringAlias(["TIDE_POLICY_MODULE", "TIDEFORGE_POLICY_MODULE"], "policy_registry"),
        receiptsModule: envStringAlias(["TIDE_RECEIPTS_MODULE", "TIDEFORGE_RECEIPTS_MODULE"], "execution_receipts"),
      }),
    },
    walrus: {
      publisherUrl: envStringAlias(
        ["TIDE_WALRUS_PUBLISHER_URL", "TIDEFORGE_WALRUS_PUBLISHER_URL"],
        ""
      ),
      aggregatorUrl: envStringAlias(
        ["TIDE_WALRUS_AGGREGATOR_URL", "TIDEFORGE_WALRUS_AGGREGATOR_URL"],
        "https://aggregator.walrus-testnet.walrus.space"
      ),
      epochs: Number(
        envStringAlias(["TIDE_WALRUS_EPOCHS", "TIDEFORGE_WALRUS_EPOCHS"], "5")
      ),
    },
    oracle: {
      pyth: {
        priceInfoObjectId: pythPriceInfoObjectId,
        feedSymbol: envStringAlias(["TIDE_PYTH_FEED_SYMBOL", "TIDEFORGE_PYTH_FEED_SYMBOL"], "BTC/USD"),
        rpcUrl: envStringAlias(["TIDE_PYTH_RPC_URL", "TIDEFORGE_PYTH_RPC_URL"], ""),
        staleMaxMs: Number(
          envStringAlias(["TIDE_PYTH_STALE_MAX_MS", "TIDEFORGE_PYTH_STALE_MAX_MS"], "60000")
        ),
      },
    },
  };

  if (executionProofEnabled && executionProofAllowSigning && appConfig.execution.allowedMoveTargets.length === 0) {
    throw new Error(
      "Refusing to write runtime-config: executionProof signing is enabled but execution.allowedMoveTargets is empty. " +
      "Set TIDE_POLICY_PACKAGE_ID (and optionally TIDE_POLICY_MODULE / TIDE_RECEIPTS_MODULE) so the wallet allowlist is concrete."
    );
  }

  await writeConfigFile(path.join(root, "landing", "runtime-config.js"), landingConfig);
  await writeConfigFile(path.join(root, "app", "runtime-config.js"), appConfig);

  process.stdout.write(`Wrote configured runtime-config.js files into ${root}.\n`);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
