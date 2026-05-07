import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const entryPath = path.join(rootDir, "scripts", "sui-vendor-entry.mjs");
const suiClientShimPath = path.join(rootDir, "scripts", "shims", "mysten-sui-client.mjs");
const suiGrpcShimPath = path.join(rootDir, "scripts", "shims", "mysten-sui-grpc.mjs");
const suiTransactionsShimPath = path.join(rootDir, "scripts", "shims", "mysten-sui-transactions.mjs");
const suiUtilsShimPath = path.join(rootDir, "scripts", "shims", "mysten-sui-utils.mjs");
const nodeBufferShimPath = path.join(rootDir, "scripts", "shims", "node-buffer.mjs");
const nodeCryptoShimPath = path.join(rootDir, "scripts", "shims", "node-crypto.mjs");
const eventsShimPath = path.join(rootDir, "scripts", "shims", "events.mjs");
const outDir = path.join(rootDir, "shadow-mode", "vendor");
const outFile = path.join(outDir, "sui-runtime.mjs");

await mkdir(outDir, { recursive: true });

const aliasSuiClientPlugin = {
  name: "alias-sui-client",
  setup(buildCtx) {
    buildCtx.onResolve({ filter: /^@mysten\/sui\/client$/ }, () => ({
      path: suiClientShimPath,
    }));
    buildCtx.onResolve({ filter: /^@mysten\/sui\/transactions$/ }, () => ({
      path: suiTransactionsShimPath,
    }));
    buildCtx.onResolve({ filter: /^@mysten\/sui\/grpc$/ }, () => ({
      path: suiGrpcShimPath,
    }));
    buildCtx.onResolve({ filter: /^@mysten\/sui\/utils$/ }, () => ({
      path: suiUtilsShimPath,
    }));
    buildCtx.onResolve({ filter: /^node:buffer$/ }, () => ({
      path: nodeBufferShimPath,
    }));
    buildCtx.onResolve({ filter: /^node:crypto$/ }, () => ({
      path: nodeCryptoShimPath,
    }));
    buildCtx.onResolve({ filter: /^events$/ }, () => ({
      path: eventsShimPath,
    }));
  },
};

await build({
  entryPoints: [entryPath],
  outfile: outFile,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  legalComments: "none",
  minify: true,
  sourcemap: false,
  banner: {
    js: [
      "globalThis.__tideProcessShim ||= {",
      "  env: {},",
      "  nextTick(callback, ...args) {",
      "    queueMicrotask(() => callback(...args));",
      "  },",
      "};",
      "globalThis.process ||= globalThis.__tideProcessShim;",
    ].join(""),
  },
  plugins: [aliasSuiClientPlugin],
});

console.log(`Built ${outFile}`);
