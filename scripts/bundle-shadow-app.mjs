#!/usr/bin/env node
// Bundle + minify shadow-mode/app.js into a single ES module so the
// prod deploy serves one file instead of ~30 cascading imports. Keeps
// ./vendor/sui-runtime.mjs external — the vendor bundle is already
// produced by build-sui-vendor.mjs and carries its own cache key.
//
// Invoked by npm run build:public-alpha after prepare-public-alpha.mjs
// has copied the raw shadow-mode tree into dist/public-alpha/app.

import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const appDistDir = path.join(rootDir, "dist", "public-alpha", "app");

async function assertExists(target) {
  try {
    await stat(target);
  } catch {
    throw new Error(`bundle-shadow-app: ${target} not found. Did prepare-public-alpha.mjs run first?`);
  }
}

async function main() {
  const entry = path.join(appDistDir, "app.js");
  const out = path.join(appDistDir, "app.js");
  const libDir = path.join(appDistDir, "lib");

  await assertExists(entry);

  // esbuild writes into a temp path, then we atomically swap in place
  // so any import map / cache referencing the old file doesn't see a
  // half-written artifact.
  const tmpOut = path.join(appDistDir, ".app.bundle.js.tmp");

  // Mark every import whose path hits ./vendor/ as external so the
  // bundle only contains TIDE's own code. Without this the dynamic
  // imports of sui-runtime inside lib/*.mjs drag ~2 MB of Sui SDK
  // code into app.js, which is exactly what we are trying to avoid.
  const externalVendorPlugin = {
    name: "external-vendor",
    setup(build) {
      build.onResolve({ filter: /\/vendor\// }, (args) => ({
        path: args.path,
        external: true,
      }));
    },
  };

  const result = await esbuild.build({
    entryPoints: [entry],
    outfile: tmpOut,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    minify: true,
    sourcemap: false,
    legalComments: "none",
    plugins: [externalVendorPlugin],
    logLevel: "warning",
  });

  if (result.errors.length) {
    for (const err of result.errors) {
      process.stderr.write(`bundle error: ${err.text}\n`);
    }
    throw new Error("bundle-shadow-app: esbuild reported errors");
  }

  // Replace the raw app.js with the bundled copy and drop the lib/
  // directory that was only needed by the raw ES-module tree.
  const { renameSync, statSync } = await import("node:fs");
  renameSync(tmpOut, out);
  await rm(libDir, { recursive: true, force: true });

  const bytes = statSync(out).size;
  process.stdout.write(
    `bundle-shadow-app: wrote ${path.relative(rootDir, out)} (${(bytes / 1024).toFixed(1)} KB)\n`
  );
}

main().catch((err) => {
  process.stderr.write(`${err?.stack || err}\n`);
  process.exit(1);
});
