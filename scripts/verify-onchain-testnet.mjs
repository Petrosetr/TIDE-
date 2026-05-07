#!/usr/bin/env node
// Pre-flight verifier for the Autopilot Rehearsal testnet dry-run.
//
// Reads `.env.testnet.local` produced by publish-move-package.mjs and
// checks, against the active `sui client`, that:
//
//   1. the published package exists on the current sui env
//   2. the AdminCap is an owned object of the expected type
//   3. the RailAllowlist is a shared object and lists the expected rails
//   4. the UpgradeCap / Publisher (if present) are live
//
// Prints a PASS/FAIL readout so an operator can run this before clicking
// Anchor policy object / Mint action receipt in the UI and know the backing objects
// are actually there. Never signs, never mutates state.
//
// Usage:
//   node scripts/verify-onchain-testnet.mjs [--network testnet] [--env .env.testnet.local]
//   node scripts/verify-onchain-testnet.mjs --print-command   # show the sui calls without running them

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { getAllRailIds } from "../shadow-mode/lib/policy-ids.mjs";
import {
  getSuiRpcUrlsWithFallback,
  postSuiRpcWithFallback,
} from "../shadow-mode/lib/sui-network.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Single source of truth for the rail id list lives in
// `shadow-mode/lib/policy-ids.mjs`. The verifier, the seeder
// (`scripts/seed-rail-allowlist.mjs`), and the UI all import from there —
// adding a new rail starts in that one file.
const EXPECTED_RAILS = getAllRailIds();
const RPC_BY_NETWORK = {
  mainnet: "https://fullnode.mainnet.sui.io:443",
  testnet: "https://fullnode.testnet.sui.io:443",
  devnet: "https://fullnode.devnet.sui.io:443",
};
const EXECUTION_RECEIPTS_MODULE = "execution_receipts";
const RECEIPT_SCHEMA_REQUIRED_FIELDS = [
  "decision_type",
  "limitations",
  "state_before_digest",
];
const SUI_FRAMEWORK_ADDRESS = "0x0000000000000000000000000000000000000000000000000000000000000002";
const STD_FRAMEWORK_ADDRESS = "0x0000000000000000000000000000000000000000000000000000000000000001";

// Canonical schema-v3 mint_receipt parameter template, in order. The on-chain
// ABI returned by sui_getNormalizedMoveModule must match this byte-for-byte
// (modulo address normalization). Any drift — extra param, swapped order,
// wrong vector inner type, struct from a different module — fails the
// verifier rather than letting the off-chain bundle anchor against an
// incompatible function.
function buildCanonicalMintReceiptParamsV3(packageId) {
  const ref = (inner) => ({ Reference: inner });
  const mutRef = (inner) => ({ MutableReference: inner });
  const vec = (inner) => ({ Vector: inner });
  const struct = (address, module, name, typeArguments = []) => ({
    Struct: { address, module, name, typeArguments },
  });
  return [
    mutRef(struct(packageId, "policy_registry", "Policy")),
    ref(struct(packageId, "policy_registry", "RailAllowlist")),
    vec("U8"), // action
    vec("U8"), // decision_type
    vec("U8"), // limitations
    vec("U8"), // state_before_digest
    vec("U8"), // walrus_blob_id
    vec("U8"), // rail_pack_digest
    vec("U8"), // content_digest
    vec("U8"), // expected_rail
    ref(struct(SUI_FRAMEWORK_ADDRESS, "clock", "Clock")),
    mutRef(struct(SUI_FRAMEWORK_ADDRESS, "tx_context", "TxContext")),
  ];
}

// Canonical ExecutionReceipt struct field shape (v2). Field order matters;
// Sui's normalized RPC returns fields as an array, so a mis-ordered struct
// is a real ABI break for indexers that decode by index.
function buildCanonicalExecutionReceiptFieldsV3(packageId) {
  const vec = (inner) => ({ Vector: inner });
  const struct = (address, module, name, typeArguments = []) => ({
    Struct: { address, module, name, typeArguments },
  });
  const STR = struct(STD_FRAMEWORK_ADDRESS, "string", "String");
  const ID = struct(SUI_FRAMEWORK_ADDRESS, "object", "ID");
  const UID = struct(SUI_FRAMEWORK_ADDRESS, "object", "UID");
  return [
    { name: "id", type: UID },
    { name: "policy_id", type: ID },
    { name: "policy_version", type: "U64" },
    { name: "owner", type: "Address" },
    { name: "action", type: STR },
    { name: "decision_type", type: STR },
    { name: "limitations", type: STR },
    { name: "state_before_digest", type: vec("U8") },
    { name: "selected_rail", type: STR },
    { name: "walrus_blob_id", type: STR },
    { name: "rail_pack_digest", type: vec("U8") },
    { name: "content_digest", type: vec("U8") },
    { name: "created_at_ms", type: "U64" },
  ];
}

function buildCanonicalReceiptMintedFieldsV3(packageId) {
  const vec = (inner) => ({ Vector: inner });
  const struct = (address, module, name, typeArguments = []) => ({
    Struct: { address, module, name, typeArguments },
  });
  const STR = struct(STD_FRAMEWORK_ADDRESS, "string", "String");
  const ID = struct(SUI_FRAMEWORK_ADDRESS, "object", "ID");
  return [
    { name: "receipt_id", type: ID },
    { name: "policy_id", type: ID },
    { name: "policy_version", type: "U64" },
    { name: "owner", type: "Address" },
    { name: "action", type: STR },
    { name: "decision_type", type: STR },
    { name: "limitations", type: STR },
    { name: "state_before_digest", type: vec("U8") },
    { name: "selected_rail", type: STR },
    { name: "walrus_blob_id", type: STR },
    { name: "rail_pack_digest", type: vec("U8") },
    { name: "content_digest", type: vec("U8") },
    { name: "created_at_ms", type: "U64" },
    { name: "revocation_seq", type: "U64" },
    { name: "schema_version", type: "U16" },
  ];
}

export const HELP_TEXT =
  "Usage: node scripts/verify-onchain-testnet.mjs [options]\n" +
  "  --network <testnet|devnet>          target network (default: testnet)\n" +
  "  --env <path>                        env file (default: .env.<network>.local)\n" +
  "  --rail <id>                         rail that must be in the allowlist (repeatable)\n" +
  "  --require-upgrade-cap-owner <addr>  fail-closed if UpgradeCap owner ≠ this address\n" +
  "  --print-command                     list the sui client object calls, do not run them\n";

export const REQUIRED_ENV_KEYS = [
  "TIDE_POLICY_PACKAGE_ID",
  "TIDE_POLICY_ADMIN_CAP_ID",
  "TIDE_POLICY_RAIL_ALLOWLIST_ID",
  "TIDE_POLICY_UPGRADE_CAP_ID",
];

export function parseArgs(argv, { repoRoot = REPO_ROOT } = {}) {
  const args = {
    network: "testnet",
    envFile: "",
    printCommand: false,
    expectedRails: EXPECTED_RAILS.slice(),
    requireUpgradeCapOwner: "",
    wantsHelp: false,
  };
  let railsResetByUser = false;
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === "--network" && argv[i + 1]) { args.network = argv[++i]; continue; }
    if (t.startsWith("--network=")) { args.network = t.slice("--network=".length); continue; }
    if (t === "--env" && argv[i + 1]) { args.envFile = argv[++i]; continue; }
    if (t.startsWith("--env=")) { args.envFile = t.slice("--env=".length); continue; }
    if (t === "--print-command") { args.printCommand = true; continue; }
    if (t === "--rail" && argv[i + 1]) {
      // The first user-supplied --rail clears the registry default so the
      // operator's explicit list is the source of truth, not a superset.
      // Pre-fix behaviour silently appended to the default list.
      if (!railsResetByUser) {
        args.expectedRails = [];
        railsResetByUser = true;
      }
      args.expectedRails.push(argv[++i]);
      continue;
    }
    if (t === "--require-upgrade-cap-owner" && argv[i + 1]) {
      args.requireUpgradeCapOwner = String(argv[++i]).toLowerCase();
      continue;
    }
    if (t.startsWith("--require-upgrade-cap-owner=")) {
      args.requireUpgradeCapOwner = t.slice("--require-upgrade-cap-owner=".length).toLowerCase();
      continue;
    }
    if (t === "--help" || t === "-h") {
      args.wantsHelp = true;
      continue;
    }
  }
  if (!args.envFile) args.envFile = path.join(repoRoot, `.env.${args.network}.local`);
  return args;
}

function readEnv(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`env file not found: ${filePath}. Run publish-move-package.mjs first.`);
  }
  const out = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

function runSui(args) {
  const res = spawnSync("sui", args, { stdio: ["inherit", "pipe", "pipe"], encoding: "utf8" });
  if (res.error) return { ok: false, error: `sui ${args.join(" ")} failed to spawn: ${res.error.message}` };
  if (res.status !== 0) {
    const stderr = res.stderr ? res.stderr.toString().trim() : "";
    return { ok: false, error: `sui ${args.join(" ")} exited ${res.status}\n${stderr}` };
  }
  return { ok: true, stdout: res.stdout.toString() };
}

function buildRpcRuntimeConfig(network) {
  return {
    sui: {
      network,
      rpcUrl: process.env.TIDE_SUI_RPC_URL || "",
      rpcUrlFallback: process.env.TIDE_SUI_RPC_URL_FALLBACK,
    },
  };
}

function resolveVerifierRpcUrls(network) {
  const urls = getSuiRpcUrlsWithFallback(buildRpcRuntimeConfig(network));
  if (urls.length) return urls;
  return [RPC_BY_NETWORK[network] || RPC_BY_NETWORK.testnet];
}

async function fetchJsonRpcWithFallback(network, method, params) {
  const urls = resolveVerifierRpcUrls(network);
  const rpcLabel = urls.map(maskRpcUrl).join(" → ");
  const response = await postSuiRpcWithFallback({
    urls,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    }),
  });
  if (!response.ok) {
    throw new Error(`RPC ${rpcLabel} returned ${response.status}`);
  }
  const payload = await response.json();
  if (payload?.error) {
    throw new Error(payload.error.message || `RPC ${method} failed`);
  }
  return payload.result;
}

async function fetchObjectRpc(objectId, network) {
  return fetchJsonRpcWithFallback(
    network,
    "sui_getObject",
    [objectId, { showType: true, showContent: true, showOwner: true }],
  );
}

async function fetchNormalizedMoveModuleRpc(packageId, moduleName, network) {
  return fetchJsonRpcWithFallback(
    network,
    "sui_getNormalizedMoveModule",
    [packageId, moduleName],
  );
}

async function fetchObject(objectId, network) {
  const res = runSui(["client", "object", objectId, "--json"]);
  if (!res.ok) {
    try {
      const object = await fetchObjectRpc(objectId, network);
      return { ok: true, object, source: "rpc" };
    } catch (rpcError) {
      return {
        ok: false,
        error: `${res.error}\nRPC fallback failed: ${rpcError?.message || rpcError}`,
      };
    }
  }
  try {
    return { ok: true, object: JSON.parse(res.stdout), source: "cli" };
  } catch (err) {
    return { ok: false, error: `sui client object --json returned non-JSON: ${err.message}` };
  }
}

// Treat all values from RPC as strings — object fields can come back as
// `String` objects, string literals, or wrapper objects depending on how
// the field was declared (`vector<u8>` comes back as an array; `String`
// as a plain string in JSON). Be defensive.
export function normalizeRailString(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    try { return String.fromCharCode(...value); } catch { return ""; }
  }
  if (value && typeof value === "object" && typeof value.fields === "object") {
    if (typeof value.fields.contents === "string") return value.fields.contents;
  }
  return "";
}

export function extractAllowlistRails(allowlistObject) {
  // Sui's CLI JSON shape changed between 1.x lines: older releases nest
  // `data.content.fields.rails.fields.contents`, newer releases (1.70+)
  // return a flat `content.rails.contents` with no `fields` wrapper and
  // a plain `[String, ...]` array. We fall through both, plus a few
  // defensive mid-shapes, so the verifier keeps working either way.
  const content = allowlistObject?.data?.content || allowlistObject?.content || null;
  if (!content) return [];
  const fieldsOrRoot = content.fields || content;
  const rails = fieldsOrRoot.rails;
  const inner = rails?.fields?.contents
    || rails?.contents
    || (Array.isArray(rails) ? rails : null);
  if (!Array.isArray(inner)) return [];
  return inner.map(normalizeRailString).filter(Boolean);
}

export function extractObjectType(obj) {
  // Newer sui CLIs return `objType` at the root; older RPC shape used
  // `data.type`. Accept both (plus a bare `type`) so we don't false-FAIL
  // on a shape bump.
  return obj?.objType || obj?.data?.type || obj?.type || "";
}

export function extractOwnerKind(obj) {
  const owner = obj?.data?.owner || obj?.owner || null;
  if (!owner) return "";
  if (typeof owner === "string") return owner;
  if (typeof owner === "object") {
    if (owner.Shared || owner.shared) return "Shared";
    if (typeof owner.AddressOwner === "string") return "AddressOwner";
    if (typeof owner.ObjectOwner === "string") return "ObjectOwner";
    if (owner.Immutable === true) return "Immutable";
    const first = Object.keys(owner)[0];
    return first || "";
  }
  return "";
}

// Returns the actual owner address (lowercased, no padding) when the owner
// is an AddressOwner. F-C-CK-1 cap-separation gate compares two of these.
export function extractOwnerAddress(obj) {
  const owner = obj?.data?.owner || obj?.owner || null;
  if (!owner || typeof owner !== "object") return "";
  if (typeof owner.AddressOwner === "string") return owner.AddressOwner.toLowerCase();
  if (typeof owner.ObjectOwner === "string") return owner.ObjectOwner.toLowerCase();
  return "";
}

function getNormalizedStruct(module, name) {
  if (!module || typeof module !== "object") return null;
  if (module.structs && !Array.isArray(module.structs)) return module.structs[name] || null;
  if (Array.isArray(module.structs)) {
    return module.structs.find((entry) => entry?.name === name) || null;
  }
  return null;
}

function extractNormalizedFieldNames(structDef) {
  const fields = structDef?.fields;
  if (!fields) return [];
  if (Array.isArray(fields)) {
    return fields.map((field) => field?.name).filter(Boolean);
  }
  if (typeof fields === "object") return Object.keys(fields);
  return [];
}

function getNormalizedFunction(module, name) {
  if (!module || typeof module !== "object") return null;
  return module.exposedFunctions?.[name]
    || module.functions?.[name]
    || null;
}

function extractNormalizedFields(structDef) {
  const fields = structDef?.fields;
  if (!fields) return [];
  if (Array.isArray(fields)) {
    return fields
      .filter((field) => field?.name)
      .map((field) => ({ name: field.name, type: field.type }));
  }
  if (typeof fields === "object") {
    return Object.entries(fields).map(([name, type]) => ({ name, type }));
  }
  return [];
}

// Normalize Move addresses to canonical 32-byte hex form. Sui CLI sometimes
// returns short forms (`0x2`) for framework addresses and full 64-hex forms
// for package ids; we always compare in 64-hex.
export function normalizeMoveAddress(address) {
  if (typeof address !== "string") return "";
  const hex = address.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]+$/.test(hex)) return "";
  return "0x" + hex.padStart(64, "0");
}

// Recursive structural compare of two MoveNormalizedType values. Returns
// { ok: true } on match, { ok: false, why } with a path-prefixed reason
// on mismatch — so the operator-facing failure message points to the exact
// nested position that drifted.
export function compareMoveType(actual, expected, path = "") {
  if (typeof expected === "string") {
    if (actual !== expected) {
      return { ok: false, why: `${path || "type"} expected ${expected}, got ${JSON.stringify(actual)}` };
    }
    return { ok: true };
  }
  if (!actual || typeof actual !== "object") {
    return { ok: false, why: `${path || "type"} expected object ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}` };
  }
  if (expected.Reference !== undefined) {
    if (actual.Reference === undefined) return { ok: false, why: `${path || "type"} expected Reference` };
    return compareMoveType(actual.Reference, expected.Reference, `${path}.Reference`);
  }
  if (expected.MutableReference !== undefined) {
    if (actual.MutableReference === undefined) return { ok: false, why: `${path || "type"} expected MutableReference` };
    return compareMoveType(actual.MutableReference, expected.MutableReference, `${path}.MutableReference`);
  }
  if (expected.Vector !== undefined) {
    if (actual.Vector === undefined) return { ok: false, why: `${path || "type"} expected Vector` };
    return compareMoveType(actual.Vector, expected.Vector, `${path}.Vector`);
  }
  if (expected.Struct !== undefined) {
    const actualStruct = actual.Struct;
    if (!actualStruct) return { ok: false, why: `${path || "type"} expected Struct` };
    const expectedAddr = normalizeMoveAddress(expected.Struct.address);
    const actualAddr = normalizeMoveAddress(actualStruct.address);
    if (expectedAddr && expectedAddr !== actualAddr) {
      return { ok: false, why: `${path}.Struct.address expected ${expectedAddr}, got ${actualAddr || actualStruct.address || "—"}` };
    }
    if (expected.Struct.module !== actualStruct.module) {
      return { ok: false, why: `${path}.Struct.module expected ${expected.Struct.module}, got ${actualStruct.module}` };
    }
    if (expected.Struct.name !== actualStruct.name) {
      return { ok: false, why: `${path}.Struct.name expected ${expected.Struct.name}, got ${actualStruct.name}` };
    }
    const expectedTA = expected.Struct.typeArguments || [];
    const actualTA = actualStruct.typeArguments || [];
    if (expectedTA.length !== actualTA.length) {
      return { ok: false, why: `${path}.Struct.typeArguments expected ${expectedTA.length}, got ${actualTA.length}` };
    }
    for (let i = 0; i < expectedTA.length; i += 1) {
      const child = compareMoveType(actualTA[i], expectedTA[i], `${path}.Struct.typeArguments[${i}]`);
      if (!child.ok) return child;
    }
    return { ok: true };
  }
  return { ok: false, why: `${path || "type"} unknown expected variant ${JSON.stringify(expected)}` };
}

export function validateMintReceiptAbiV3(module, packageId) {
  const failures = [];
  const mint = getNormalizedFunction(module, "mint_receipt");
  if (!mint) {
    failures.push("missing mint_receipt function");
    return { ok: false, failures };
  }
  if (mint.isEntry !== true) {
    failures.push("mint_receipt must be an entry function");
  }
  if (mint.visibility === "Public") {
    failures.push("mint_receipt must not be public; expected non-public entry visibility");
  }
  const expected = buildCanonicalMintReceiptParamsV3(normalizeMoveAddress(packageId) || packageId);
  const actual = Array.isArray(mint.parameters) ? mint.parameters : [];
  if (actual.length !== expected.length) {
    failures.push(
      `mint_receipt has ${actual.length} parameters; v3 ABI expects exactly ${expected.length}`,
    );
    return { ok: false, failures };
  }
  for (let i = 0; i < expected.length; i += 1) {
    const result = compareMoveType(actual[i], expected[i], `mint_receipt.params[${i}]`);
    if (!result.ok) failures.push(result.why);
  }
  return { ok: failures.length === 0, failures };
}

function validateStructFieldsAgainstCanonical(structName, structDef, canonical) {
  const failures = [];
  if (!structDef) {
    failures.push(`missing ${structName} struct`);
    return failures;
  }
  const actualFields = extractNormalizedFields(structDef);
  if (actualFields.length !== canonical.length) {
    failures.push(
      `${structName} has ${actualFields.length} fields; v3 expects exactly ${canonical.length}`,
    );
    return failures;
  }
  for (let i = 0; i < canonical.length; i += 1) {
    const expected = canonical[i];
    const actual = actualFields[i];
    if (actual.name !== expected.name) {
      failures.push(
        `${structName}.fields[${i}] expected '${expected.name}', got '${actual.name}'`,
      );
      continue;
    }
    const compare = compareMoveType(actual.type, expected.type, `${structName}.${expected.name}`);
    if (!compare.ok) failures.push(compare.why);
  }
  return failures;
}

export function validateExecutionReceiptsModule(module, packageId = "") {
  const failures = [];

  // Soft v2-field set check stays as a defensive sanity layer in case the
  // strict structural compare can't run (e.g. packageId not supplied for an
  // older caller). When packageId is supplied, the strict compare below
  // supersedes this check.
  for (const structName of ["ExecutionReceipt", "ReceiptMinted"]) {
    const structDef = getNormalizedStruct(module, structName);
    if (!structDef) {
      failures.push(`missing ${structName} struct`);
      continue;
    }
    const fields = new Set(extractNormalizedFieldNames(structDef));
    const missing = RECEIPT_SCHEMA_REQUIRED_FIELDS.filter((field) => !fields.has(field));
    if (missing.length) {
      failures.push(`${structName} is missing required receipt fields: ${missing.join(", ")}`);
    }
  }

  if (packageId) {
    const normalizedPkg = normalizeMoveAddress(packageId) || packageId;
    const receiptCanon = buildCanonicalExecutionReceiptFieldsV3(normalizedPkg);
    failures.push(
      ...validateStructFieldsAgainstCanonical(
        "ExecutionReceipt",
        getNormalizedStruct(module, "ExecutionReceipt"),
        receiptCanon,
      ),
    );
    const eventCanon = buildCanonicalReceiptMintedFieldsV3(normalizedPkg);
    failures.push(
      ...validateStructFieldsAgainstCanonical(
        "ReceiptMinted",
        getNormalizedStruct(module, "ReceiptMinted"),
        eventCanon,
      ),
    );
    const abi = validateMintReceiptAbiV3(module, packageId);
    failures.push(...abi.failures);
  } else {
    // Legacy mode: no packageId → fall back to the loose param-count guard
    // that older callers used. New callers pass packageId for strict ABI.
    const mint = getNormalizedFunction(module, "mint_receipt");
    const params = Array.isArray(mint?.parameters) ? mint.parameters : [];
    if (!mint) {
      failures.push("missing mint_receipt function");
    } else if (params.length < 11) {
      failures.push(
        `mint_receipt has ${params.length} parameters; expected at least 11 for receipt schema v3`,
      );
    }
  }

  // De-duplicate failures (the soft and strict checks both fire when a
  // struct field is renamed); keep the first occurrence's order.
  const seen = new Set();
  const uniqueFailures = [];
  for (const failure of failures) {
    if (seen.has(failure)) continue;
    seen.add(failure);
    uniqueFailures.push(failure);
  }
  return { ok: uniqueFailures.length === 0, failures: uniqueFailures };
}

export {
  buildCanonicalMintReceiptParamsV3,
  buildCanonicalExecutionReceiptFieldsV3,
  buildCanonicalReceiptMintedFieldsV3,
};

// F-C-CK-1: returns null when the cap separation invariant holds; returns a
// human-readable string explaining the collision otherwise. This helper stays
// tolerant for unit tests and historical callers; hardened main() requires the
// UpgradeCap object id before this comparison runs.
export function checkCapSeparation(ownerAddresses = {}) {
  const adminCap = String(ownerAddresses["admin cap"] || "").toLowerCase();
  const upgradeCap = String(ownerAddresses["upgrade cap"] || "").toLowerCase();
  if (!adminCap || !upgradeCap) return null;
  if (adminCap === upgradeCap) {
    return `AdminCap and UpgradeCap are colocated on ${adminCap.slice(0, 10)}…${adminCap.slice(-4)}; rotate one to a separate wallet.`;
  }
  return null;
}

// F-U-A-1: pin the UpgradeCap holder to a specific address. Returns
// { ok: true } on a match, { ok: false, message } otherwise. Both inputs
// are lowercased before comparing so a hex-case mismatch in a CI secret
// doesn't false-FAIL.
export function checkRequiredUpgradeCapOwner(actual, expected) {
  const actualLc = String(actual || "").toLowerCase();
  const expectedLc = String(expected || "").toLowerCase();
  if (!expectedLc) {
    return { ok: false, message: "no expected owner provided" };
  }
  if (!actualLc) {
    return {
      ok: false,
      message: `UpgradeCap owner is unknown but --require-upgrade-cap-owner=${expectedLc.slice(0, 10)}…${expectedLc.slice(-4)} was set.`,
    };
  }
  if (actualLc !== expectedLc) {
    return {
      ok: false,
      message: `UpgradeCap owner is ${actualLc.slice(0, 10)}…${actualLc.slice(-4)}, expected ${expectedLc.slice(0, 10)}…${expectedLc.slice(-4)}.`,
    };
  }
  return { ok: true };
}

export function maskRpcUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function mask(s) {
  if (!s || typeof s !== "string") return "—";
  if (s.length <= 12) return s;
  return `${s.slice(0, 8)}…${s.slice(-4)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.wantsHelp) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  const env = readEnv(args.envFile);

  const missing = REQUIRED_ENV_KEYS.filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(`env is missing: ${missing.join(", ")} — publish the package first`);
  }

  const packageId = env.TIDE_POLICY_PACKAGE_ID;
  const adminCapId = env.TIDE_POLICY_ADMIN_CAP_ID;
  const allowlistId = env.TIDE_POLICY_RAIL_ALLOWLIST_ID;
  const upgradeCapId = env.TIDE_POLICY_UPGRADE_CAP_ID;
  const publisherId = env.TIDE_POLICY_PUBLISHER_ID || "";

  const checks = [
    { label: "package", id: packageId, expectOwner: "Immutable" },
    { label: "admin cap", id: adminCapId, expectType: `::policy_registry::AdminCap`, expectOwner: "AddressOwner" },
    {
      label: "rail allowlist",
      id: allowlistId,
      expectType: `::policy_registry::RailAllowlist`,
      expectRails: args.expectedRails,
      expectOwner: "Shared",
    },
  ];
  checks.push({ label: "upgrade cap", id: upgradeCapId, expectType: `::package::UpgradeCap`, expectOwner: "AddressOwner" });
  if (publisherId) checks.push({ label: "publisher", id: publisherId, expectType: `::package::Publisher`, expectOwner: "AddressOwner" });

  if (args.printCommand) {
    process.stdout.write(`[verify] PRINT-COMMAND — would run sui client object --json on:\n`);
    for (const c of checks) process.stdout.write(`  ${c.label.padEnd(16)} ${c.id}\n`);
    process.stdout.write(`  ${"receipt schema".padEnd(16)} ${packageId}::${EXECUTION_RECEIPTS_MODULE}\n`);
    process.stdout.write(`(active sui env must be "${args.network}".)\n`);
    return 0;
  }

  process.stdout.write(`[verify] network=${args.network} envFile=${path.relative(REPO_ROOT, args.envFile)}\n`);
  process.stdout.write(`[verify] package=${mask(packageId)}\n`);

  const active = runSui(["client", "active-env"]);
  if (active.ok) {
    const activeEnv = active.stdout.trim();
    if (activeEnv !== args.network) {
      process.stderr.write(`[verify] FAIL: active sui env is "${activeEnv}", expected "${args.network}"\n`);
      process.stderr.write(`[verify] run: sui client switch --env ${args.network}\n`);
      return 1;
    }
  }

  let failures = 0;
  const ownerAddresses = {};
  for (const check of checks) {
    const result = await fetchObject(check.id, args.network);
    if (!result.ok) {
      process.stderr.write(`[verify] FAIL ${check.label} (${mask(check.id)}) — ${result.error}\n`);
      failures += 1;
      continue;
    }
    const type = extractObjectType(result.object);
    const ownerKind = extractOwnerKind(result.object);
    const typeOk = !check.expectType || (typeof type === "string" && type.includes(check.expectType));
    if (!typeOk) {
      process.stderr.write(`[verify] FAIL ${check.label} — type="${type}" does not contain "${check.expectType}"\n`);
      failures += 1;
      continue;
    }
    if (check.expectOwner && ownerKind !== check.expectOwner) {
      process.stderr.write(
        `[verify] FAIL ${check.label} — owner="${ownerKind || "unknown"}" does not match "${check.expectOwner}"\n`
      );
      failures += 1;
      continue;
    }
    if (check.expectRails) {
      const onChain = new Set(extractAllowlistRails(result.object));
      const missingRails = check.expectRails.filter((rail) => !onChain.has(rail));
      if (missingRails.length) {
        process.stderr.write(`[verify] FAIL ${check.label} — missing rails: ${missingRails.join(", ")}\n`);
        process.stderr.write(`[verify]   run: npm run seed:rails -- --network ${args.network}\n`);
        failures += 1;
        continue;
      }
      process.stdout.write(
        `[verify] PASS ${check.label.padEnd(16)} ${mask(check.id)} (${result.source || "cli"}, owner ${ownerKind || "unknown"}, rails: ${[...onChain].join(", ")})\n`
      );
      continue;
    }
    if (ownerKind === "AddressOwner") {
      ownerAddresses[check.label] = extractOwnerAddress(result.object);
    }
    process.stdout.write(
      `[verify] PASS ${check.label.padEnd(16)} ${mask(check.id)} (${result.source || "cli"}, owner ${ownerKind || "unknown"})\n`
    );
  }

  // Cap-separation gate.
  //
  // Default: hard-fail when AdminCap and UpgradeCap colocate (hardening
  // beyond the older cap-separation baseline, which only forbids colocation with the
  // demo wallet). This is the path we recommend for production.
  //
  // S0 testnet escape hatch: the founder may legitimately hold both caps
  // on the same cold wallet pre-mainnet. Set
  //   TIDE_VERIFY_ALLOW_CAP_COLOCATION=1
  // to downgrade the failure to an explicit warning. This is gated by a
  // companion check in verify-overflow-submission.mjs that requires
  // docs/onchain_mvp_proof_pack.md to carry an explicit disclosure
  // section (## Cap posture — S0 testnet) so submission is honest about
  // the colocation.
  const collision = checkCapSeparation(ownerAddresses);
  if (collision) {
    const allowColocation = process.env.TIDE_VERIFY_ALLOW_CAP_COLOCATION === "1";
    if (allowColocation) {
      process.stderr.write(
        `[verify] WARN cap separation — ${collision}\n` +
        `[verify]   TIDE_VERIFY_ALLOW_CAP_COLOCATION=1 set; expecting docs/onchain_mvp_proof_pack.md ## Cap posture — S0 testnet disclosure.\n` +
        `[verify]   Hardened state requires rotating one cap to a separate wallet (see docs/alpha_allowlist.md §2).\n`
      );
    } else {
      process.stderr.write(`[verify] FAIL cap separation — ${collision}\n`);
      process.stderr.write(`[verify]   see docs/alpha_allowlist.md §2; rotate one cap to a separate wallet, or set TIDE_VERIFY_ALLOW_CAP_COLOCATION=1 with proof-pack disclosure.\n`);
      failures += 1;
    }
  } else if (ownerAddresses["admin cap"] && ownerAddresses["upgrade cap"]) {
    process.stdout.write(
      `[verify] PASS ${"cap separation".padEnd(16)} admin cap ≠ upgrade cap (hardened beyond the older cap-separation baseline)\n`
    );
  }

  // F-U-A-1: pin the UpgradeCap owner to a specific address. CI passes
  // --require-upgrade-cap-owner <expected> from the deploy-prep secrets;
  // anything else fails-closed. Useful when a key rotation SHOULD have
  // updated the deploy state but didn't.
  if (args.requireUpgradeCapOwner) {
    const verdict = checkRequiredUpgradeCapOwner(
      ownerAddresses["upgrade cap"] || "",
      args.requireUpgradeCapOwner,
    );
    if (verdict.ok) {
      process.stdout.write(
        `[verify] PASS ${"upgrade cap pin".padEnd(16)} owner matches --require-upgrade-cap-owner\n`
      );
    } else {
      process.stderr.write(`[verify] FAIL upgrade cap pin — ${verdict.message}\n`);
      failures += 1;
    }
  }

  try {
    const module = await fetchNormalizedMoveModuleRpc(packageId, EXECUTION_RECEIPTS_MODULE, args.network);
    const schema = validateExecutionReceiptsModule(module, packageId);
    if (!schema.ok) {
      process.stderr.write(`[verify] FAIL receipt schema — ${schema.failures.join("; ")}\n`);
      failures += 1;
    } else {
      process.stdout.write(
        `[verify] PASS ${"receipt schema".padEnd(16)} ${mask(packageId)}::${EXECUTION_RECEIPTS_MODULE} (strict v3 ABI)\n`
      );
    }
  } catch (err) {
    process.stderr.write(`[verify] FAIL receipt schema — ${err?.message || err}\n`);
    failures += 1;
  }

  if (failures) {
    process.stderr.write(`[verify] ${failures} check(s) failed — do not proceed with mint until green.\n`);
    return 1;
  }
  process.stdout.write(`[verify] all checks passed.\n`);
  return 0;
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`[verify] error: ${err.message}\n`);
      process.exitCode = 1;
    });
}
