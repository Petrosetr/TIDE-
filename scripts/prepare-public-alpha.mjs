import { mkdir, rm, cp, access, writeFile, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distRoot = path.join(rootDir, "dist", "public-alpha");
const landingOutDir = path.join(distRoot, "landing");
const appOutDir = path.join(distRoot, "app");
export const TEST_FILE_RE = /(?:^|[.-])(test|spec)\.m?js$/i;

const landingFiles = [
  "index.html",
  "styles.css",
  "landing.js",
  "runtime-config.js",
  "telemetry.js",
  "privacy.html",
  "terms.html",
  "risk.html",
  "tide-mark.svg",
];

const appFiles = [
  "index.html",
  "setup.html",
  "live.html",
  "results.html",
  "library.html",
  "styles-workspace.css",
  "styles-readout.css",
  "styles-setup.css",
  "app.js",
  "wallet.js",
  "runtime-config.js",
  "telemetry.js",
  "tide-mark.svg",
  "lib",
  "assets",
  "examples",
];

const optionalAppFiles = new Set(["library.html", "examples"]);

function runBuild(relativeScript) {
  const scriptPath = path.join(rootDir, relativeScript);
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: rootDir,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function getBuildId() {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: rootDir,
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

async function copyIntoRoot(fromRoot, targetRoot, entries, { optional = new Set() } = {}) {
  await mkdir(targetRoot, { recursive: true });

  for (const entry of entries) {
    const source = path.join(fromRoot, entry);
    const destination = path.join(targetRoot, path.basename(entry));
    try {
      await access(source);
    } catch (error) {
      if (optional.has(entry) && error?.code === "ENOENT") {
        continue;
      }
      throw error;
    }
    await cp(source, destination, { recursive: true });
  }
}

export async function copyTreeFiltered(sourceRoot, targetRoot) {
  await mkdir(targetRoot, { recursive: true });
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && TEST_FILE_RE.test(entry.name)) {
      continue;
    }
    const source = path.join(sourceRoot, entry.name);
    const destination = path.join(targetRoot, entry.name);
    if (entry.isDirectory()) {
      await copyTreeFiltered(source, destination);
    } else {
      await cp(source, destination);
    }
  }
}

async function maybeCopyGeneratedRailPack() {
  const generatedPack = path.join(rootDir, "shadow-mode", "examples", "live-rail-pack.generated.json");

  try {
    await access(generatedPack);
    await cp(generatedPack, path.join(appOutDir, "examples", "live-rail-pack.generated.json"));
    await cp(generatedPack, path.join(appOutDir, "live-rail-pack.json"));
  } catch {
    // optional demo artifact
  }
}

async function copyRuntimeVendor() {
  const vendorOutDir = path.join(appOutDir, "vendor");
  await mkdir(vendorOutDir, { recursive: true });
  await cp(
    path.join(rootDir, "shadow-mode", "vendor", "sui-runtime.mjs"),
    path.join(vendorOutDir, "sui-runtime.mjs")
  );
}

async function writeAppRouteIndexes() {
  // Nginx serves `/setup/` and friends as real directories on some hosts.
  // Without explicit index files, those routes fall through to the Workspace
  // shell and look hydrated while showing the wrong page.
  const routes = [
    ["workspace", "index.html"],
    ["setup", "setup.html"],
    ["results", "results.html"],
    ["live", "live.html"],
    ["library", "library.html"],
  ];

  for (const [route, sourceFile] of routes) {
    try {
      await access(path.join(appOutDir, sourceFile));
    } catch (error) {
      if (optionalAppFiles.has(sourceFile) && error?.code === "ENOENT") {
        continue;
      }
      throw error;
    }
    await mkdir(path.join(appOutDir, route), { recursive: true });
    await cp(path.join(appOutDir, sourceFile), path.join(appOutDir, route, "index.html"));
  }
}

async function copyPublicReceiptDocs(targetRoot) {
  const files = [
    ["docs", "onchain_mvp_proof_pack.md"],
    ["docs", "overflow_2026", "RFC-0001-action-receipt-schema.md"],
  ];

  for (const parts of files) {
    const source = path.join(rootDir, ...parts);
    const destination = path.join(targetRoot, ...parts);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination);
  }
}

async function copyReceiptViewerTo(targetRoot) {
  await copyTreeFiltered(path.join(rootDir, "r"), path.join(targetRoot, "r"));
}

async function rewriteHtmlCacheBust(targetRoot, buildId) {
  const entries = await readdir(targetRoot, { withFileTypes: true });

  for (const entry of entries) {
    const filePath = path.join(targetRoot, entry.name);
    if (entry.isDirectory()) {
      await rewriteHtmlCacheBust(filePath, buildId);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".html")) {
      continue;
    }

    const raw = await readFile(filePath, "utf8");
    const updated = raw.replace(/\?v=[^"' )]+/g, `?v=${buildId}`);
    await writeFile(filePath, updated, "utf8");
  }
}

async function writeManifest() {
  const manifest = [
    "TIDE Public Alpha Deploy Pack",
    "",
    "landing/",
    "  Publish on the root domain. This contains the public landing surface.",
    "",
    "app/",
    "  Publish on the app subdomain. This contains the multipage workspace.",
    "",
    "release-manifest.json",
    "  Build provenance for rollback and post-deploy verification. Publish copies stay in root, landing/, and app/.",
    "",
    "Before deploy:",
    "1. Edit runtime-config.js inside each root.",
    "2. Set the real workspace URLs.",
    "3. Set analytics and error beacons if needed.",
    "4. Optionally point app/runtime-config.js liveRailPack.url to ./live-rail-pack.json and enable autoLoad.",
    "",
  ].join("\n");

  await writeFile(path.join(distRoot, "README.txt"), manifest);
}

const buildId = getBuildId();

await rm(distRoot, { recursive: true, force: true });
runBuild(path.join("shadow-mode", "build.mjs"));
await copyIntoRoot(rootDir, landingOutDir, landingFiles);
await copyIntoRoot(path.join(rootDir, "shadow-mode"), appOutDir, appFiles, { optional: optionalAppFiles });
await writeAppRouteIndexes();
await copyReceiptViewerTo(landingOutDir);
await copyReceiptViewerTo(appOutDir);
await copyPublicReceiptDocs(landingOutDir);
await copyPublicReceiptDocs(appOutDir);
await copyRuntimeVendor();
await maybeCopyGeneratedRailPack();
await rewriteHtmlCacheBust(landingOutDir, buildId);
await rewriteHtmlCacheBust(appOutDir, buildId);
await writeManifest();

console.log(`Prepared public alpha deploy pack in ${distRoot}`);
