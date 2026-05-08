#!/usr/bin/env node
// tide-verify — standalone CLI for resolving + verifying a TIDE Action
// Receipt without the TIDE frontend. Pulls the lib at
// `shadow-mode/lib/receipt-resolver.mjs` so the verify path is identical
// to what the read-only HTML viewer uses.
//
// Usage:
//   node scripts/tide-verify.mjs <receipt-id>
//   node scripts/tide-verify.mjs <receipt-id> --network testnet
//   node scripts/tide-verify.mjs <receipt-id> --package-id 0x999c... --network testnet
//   node scripts/tide-verify.mjs <receipt-id> --bundle-file ./proof-bundle.json
//   node scripts/tide-verify.mjs <receipt-id> --allow-pending  # resolve only, no bundle proof
//   node scripts/tide-verify.mjs <receipt-id> --json    # machine-readable
//
// Exit codes:
//   0 — receipt resolved + bundle digest/semantics match
//   1 — receipt not found / wrong type / digest mismatch / RPC failure
//   2 — usage error

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { webcrypto } from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";

import {
  resolveReceiptFromRpc,
  buildResolvedReceiptView,
  ReceiptResolverError,
} from "../shadow-mode/lib/receipt-resolver.mjs";
import {
  classifyBlobId,
  fetchFromWalrus,
  WalrusStorageError,
} from "../shadow-mode/lib/walrus-storage.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");

const ACTION_TYPE_LABELS = {
  Hold: "Hold position",
  BuildBuffer: "Build buffer",
  BorrowForBuffer: "Borrow to rebuild buffer",
  PartialRepay: "Partial debt repayment",
  EmergencyDeRisk: "Emergency de-risk",
  ReducePayout: "Reduce payout target",
  PausePayout: "Pause payouts",
  RotateVenue: "Rotate venue exposure",
};

const PROOF_LIMITATION_LABELS = {
  "shadow-only": "Rehearsal — local only",
  "testnet-rehearsal": "Testnet proof — no mainnet funds move",
};

function splitEnumLabel(value) {
  const label = String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return label || "—";
}

function formatActionTypeLabel(value) {
  return ACTION_TYPE_LABELS[value] || splitEnumLabel(value);
}

function formatProofLimitationLabel(value) {
  return PROOF_LIMITATION_LABELS[value] || splitEnumLabel(value);
}

// Default packageId pulled from move/Published.toml so the operator does
// not have to repeat it on every invocation. If the file is missing the
// caller must pass --package-id.
function readDefaultPackageId() {
  const tomlPath = path.join(REPO_ROOT, "move", "Published.toml");
  try {
    const text = fs.readFileSync(tomlPath, "utf8");
    const match = text.match(/\[published\.testnet\][\s\S]*?published-at\s*=\s*"([^"]+)"/);
    return match?.[1] || "";
  } catch {
    return "";
  }
}

function parseArgs(argv) {
  const args = {
    receiptId: "",
    network: "testnet",
    packageId: "",
    rpcUrl: "",
    bundleFile: "",
    bundleFromWalrus: false,
    walrusAggregatorUrl: "",
    json: false,
    allowPending: false,
    resolveOnly: false,
    wantsHelp: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === "--help" || t === "-h") { args.wantsHelp = true; continue; }
    if (t === "--json") { args.json = true; continue; }
    if (t === "--allow-pending") { args.allowPending = true; continue; }
    if (t === "--resolve-only") { args.resolveOnly = true; args.allowPending = true; continue; }
    if (t === "--bundle-from-walrus") { args.bundleFromWalrus = true; continue; }
    if (t === "--network" && argv[i + 1]) { args.network = argv[++i]; continue; }
    if (t.startsWith("--network=")) { args.network = t.slice("--network=".length); continue; }
    if (t === "--package-id" && argv[i + 1]) { args.packageId = argv[++i]; continue; }
    if (t.startsWith("--package-id=")) { args.packageId = t.slice("--package-id=".length); continue; }
    if (t === "--rpc-url" && argv[i + 1]) { args.rpcUrl = argv[++i]; continue; }
    if (t.startsWith("--rpc-url=")) { args.rpcUrl = t.slice("--rpc-url=".length); continue; }
    if (t === "--bundle-file" && argv[i + 1]) { args.bundleFile = argv[++i]; continue; }
    if (t.startsWith("--bundle-file=")) { args.bundleFile = t.slice("--bundle-file=".length); continue; }
    if (t === "--walrus-aggregator" && argv[i + 1]) { args.walrusAggregatorUrl = argv[++i]; continue; }
    if (t.startsWith("--walrus-aggregator=")) { args.walrusAggregatorUrl = t.slice("--walrus-aggregator=".length); continue; }
    if (t.startsWith("--")) {
      // unknown flag — flag in usage error path
      args.unknownFlag = t;
      continue;
    }
    if (!args.receiptId) {
      args.receiptId = t;
      continue;
    }
    args.unknownPositional = t;
  }
  return args;
}

const HELP_TEXT =
  "Usage: tide-verify <receipt-id> [options]\n" +
  "\n" +
  "  --network <testnet|devnet>            default: testnet; mainnet receipts unsupported until a package pin exists\n" +
  "  --package-id <0x…>                   default: published.testnet from move/Published.toml\n" +
  "  --rpc-url <url>                      override default Sui RPC for the network\n" +
  "  --bundle-file <path>                 verify SHA-256 of bundle file matches receipt content_digest\n" +
  "  --bundle-from-walrus                 fetch bundle from Walrus aggregator using receipt.walrusBlobId,\n" +
  "                                       then verify (refused for stub blob ids — they have no off-chain bytes)\n" +
  "  --walrus-aggregator <url>            override default Walrus aggregator URL\n" +
  "  --allow-pending                      exit 0 when no bundle is supplied (resolver-only mode)\n" +
  "  --resolve-only                       alias for --allow-pending; resolves receipt without proof bytes\n" +
  "  --json                               machine-readable output\n";

function containsRedactedSummary(value, seen = new Set()) {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);
  if (
    value.canonicalKind === "redacted-summary" ||
    value.redacted === true ||
    typeof value.redactionNotice === "string"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsRedactedSummary(item, seen));
  }
  return Object.values(value).some((item) => containsRedactedSummary(item, seen));
}

function readCanonicalBundleFile(filePath) {
  const bytes = new Uint8Array(fs.readFileSync(filePath));
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (containsRedactedSummary(parsed)) {
      throw new Error(
        "redacted proof summary is not a canonical proof bundle; use the original unredacted bundle or --bundle-from-walrus for real Walrus receipts.",
      );
    }
  } catch (err) {
    if (String(err?.message || "").includes("redacted proof summary")) {
      throw err;
    }
  }
  return bytes;
}

function printHumanReceipt(view, { exitOk }, write) {
  const r = view.canonical.receipt;
  write(`TIDE receipt — ${view.canonical.network}\n`);
  if (r.id) write(`  Receipt id:     ${r.id}\n`);
  if (r.txDigest) write(`  Tx digest:      ${r.txDigest}\n`);
  if (r.policyId) write(`  Policy id:      ${r.policyId}\n`);
  if (r.policyVersion !== null) write(`  Policy version: ${r.policyVersion}\n`);
  if (r.schemaVersion !== null) write(`  Schema version: v${r.schemaVersion}\n`);
  if (r.decisionType) write(`  Decision:       ${formatActionTypeLabel(r.decisionType)}\n`);
  if (r.limitations) write(`  Limitations:    ${formatProofLimitationLabel(r.limitations)}\n`);
  if (r.selectedRail) write(`  Rail:           ${r.selectedRail}\n`);
  if (r.contentDigest) write(`  Content digest: ${r.contentDigest}\n`);
  if (view.explorerUrl) write(`  SuiVision:      ${view.explorerUrl}\n`);
  write("\n");
  write(`Verification: ${view.verification.status.toUpperCase()}\n`);
  if (view.verification.reason) write(`  Reason: ${view.verification.reason}\n`);
  if (view.verification.code) write(`  Code: ${view.verification.code}\n`);
  write(`  ${view.verification.message}\n`);
  if (view.verification.expected) {
    write(`  expected: ${view.verification.expected}\n`);
    write(`  actual:   ${view.verification.actual}\n`);
  }
  if (view.evidencePosture) {
    write("Evidence posture:\n");
    write(`  railDataMode:  ${view.evidencePosture.railDataMode || "unknown"}\n`);
    write(`  walrusSource:  ${view.evidencePosture.walrusSource || "unknown"}\n`);
    write(`  pythSource:    ${view.evidencePosture.pythSource || "unknown"}\n`);
    write(`  executionMode: ${view.evidencePosture.executionMode || "unknown"}\n`);
    write(`  boundary:      ${view.evidencePosture.claimBoundary || "unknown"}\n`);
  }
  const verdict = exitOk && view.verification.status === "pending"
    ? "RESOLVED - PROOF PENDING"
    : exitOk
    ? "PASS"
    : "FAIL";
  write(`\n${verdict}\n`);
}

export async function runCli(argv = process.argv.slice(2), {
  stdout = process.stdout,
  stderr = process.stderr,
  exit = process.exit,
  fetchImpl = globalThis.fetch,
  cryptoImpl = webcrypto,
  defaultPackageIdReader = readDefaultPackageId,
} = {}) {
  const args = parseArgs(argv);
  if (args.wantsHelp) {
    stdout.write(HELP_TEXT);
    exit(0);
    return;
  }
  if (args.unknownFlag) {
    stderr.write(`Unknown flag: ${args.unknownFlag}\n${HELP_TEXT}`);
    exit(2);
    return;
  }
  if (args.unknownPositional) {
    stderr.write(`Unexpected positional: ${args.unknownPositional}\n${HELP_TEXT}`);
    exit(2);
    return;
  }
  if (!args.receiptId) {
    stderr.write(`Missing required <receipt-id>.\n${HELP_TEXT}`);
    exit(2);
    return;
  }
  if (String(args.network || "").toLowerCase() === "mainnet") {
    stderr.write(
      "Mainnet receipt verification is not enabled yet: no trusted TIDE mainnet receipt package is pinned.\n" +
      "Use --network testnet for current receipts, or verify mainnet-observed evidence through a testnet receipt bundle.\n",
    );
    exit(2);
    return;
  }
  if (!args.packageId) {
    args.packageId = defaultPackageIdReader();
    if (!args.packageId) {
      stderr.write(
        "No --package-id supplied and move/Published.toml has no published.testnet entry.\n" +
        "Pass --package-id explicitly.\n",
      );
      exit(2);
      return;
    }
  }

  let receipt;
  try {
    receipt = await resolveReceiptFromRpc({
      receiptId: args.receiptId,
      network: args.network,
      packageId: args.packageId,
      rpcUrl: args.rpcUrl || null,
      fetchImpl,
    });
  } catch (err) {
    if (err instanceof ReceiptResolverError) {
      if (args.json) {
        stdout.write(JSON.stringify({ ok: false, code: err.code, message: err.message, details: err.details }, null, 2) + "\n");
      } else {
        stderr.write(`tide-verify: ${err.code} — ${err.message}\n`);
      }
    } else {
      stderr.write(`tide-verify: unexpected error — ${err?.message || err}\n`);
    }
    exit(1);
    return;
  }

  let bundleBytes = null;
  if (args.resolveOnly && (args.bundleFile || args.bundleFromWalrus)) {
    stderr.write("tide-verify: --resolve-only cannot be combined with bundle verification flags.\n");
    exit(2);
    return;
  }
  if (args.bundleFile && args.bundleFromWalrus) {
    stderr.write("tide-verify: --bundle-file and --bundle-from-walrus are mutually exclusive.\n");
    exit(2);
    return;
  }
  if (args.bundleFile) {
    try {
      bundleBytes = readCanonicalBundleFile(args.bundleFile);
    } catch (err) {
      stderr.write(`tide-verify: cannot read bundle file '${args.bundleFile}': ${err?.message || err}\n`);
      exit(1);
      return;
    }
  }
  if (args.bundleFromWalrus) {
    const classified = classifyBlobId(receipt.walrusBlobId);
    if (classified.mode === "stub") {
      stderr.write(
        `tide-verify: receipt.walrusBlobId is a stub (mode=stub, network=${classified.network}); ` +
        "no off-chain bytes exist on Walrus to fetch. Use --bundle-file with the canonical proof bundle JSON, " +
        "or wait for the receipt to be re-anchored against a real Walrus blob.\n",
      );
      exit(1);
      return;
    }
    if (classified.mode !== "walrus") {
      stderr.write(
        `tide-verify: receipt.walrusBlobId is mode='${classified.mode}', not a Walrus blob id; cannot fetch.\n`,
      );
      exit(1);
      return;
    }
    try {
      bundleBytes = await fetchFromWalrus({
        blobId: classified.blobId,
        aggregatorUrl: args.walrusAggregatorUrl || undefined,
        fetchImpl,
      });
    } catch (err) {
      if (err instanceof WalrusStorageError) {
        stderr.write(`tide-verify: walrus ${err.code} — ${err.message}\n`);
      } else {
        stderr.write(`tide-verify: walrus fetch failed — ${err?.message || err}\n`);
      }
      exit(1);
      return;
    }
  }

  const view = await buildResolvedReceiptView({
    receipt,
    network: args.network,
    bundleBytes,
    cryptoImpl,
  });

  // Determine exit status.
  const verificationOk =
    view.verification.status === "ok" ||
    (view.verification.status === "pending" && args.allowPending);
  const exitOk = verificationOk;

  if (args.json) {
    stdout.write(JSON.stringify({
      ok: exitOk,
      proofVerified: view.verification.status === "ok",
      pendingOnly: view.verification.status === "pending",
      evidencePosture: view.evidencePosture,
      view,
    }, null, 2) + "\n");
  } else {
    printHumanReceipt(view, { exitOk }, (s) => stdout.write(s));
  }
  exit(exitOk ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runCli();
}
