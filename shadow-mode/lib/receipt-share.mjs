// Receipt sharing primitives — pure transforms over a normalized receipt.
//
// The renderer integrates with these via receipt-card actions
// (Copy, Download, View on SuiVision).
//
// All functions here are pure: they take a normalized receipt + a runtime
// config + (for URL builders) explicit overrides, and return strings or
// plain objects. No DOM, no clipboard, no fetch — those live in the
// renderer (app.js receipt-card binding) and call into this module so the
// transform is unit-testable in isolation.

import { buildSuiExplorerUrl, getSuiNetwork } from "./sui-network.mjs";

const TIDE_VERSION_TAG = "tide-receipt/v2";
const READ_ONLY_RECEIPT_NETWORK = "testnet";
const DEFAULT_READ_ONLY_BASE_PATH = "";

function isValidNetwork(network) {
  return network === "mainnet" || network === "testnet" || network === "devnet";
}

function resolveNetwork(config = {}, override = "") {
  const explicit = String(override || "").trim().toLowerCase();
  if (isValidNetwork(explicit)) return explicit;
  const detected = String(getSuiNetwork(config) || "").trim().toLowerCase();
  return isValidNetwork(detected) ? detected : "testnet";
}

function shortHash(value, max = 12) {
  if (typeof value !== "string" || !value) return "";
  if (value.length <= max) return value;
  const head = Math.max(4, Math.floor((max - 1) / 2));
  const tail = max - head - 1;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function pickReceiptId(receipt) {
  if (!receipt || typeof receipt !== "object") return "";
  return String(receipt.id ?? receipt.receiptId ?? receipt.objectId ?? "").trim();
}

function pickTxDigest(receipt) {
  if (!receipt || typeof receipt !== "object") return "";
  return String(receipt.txDigest ?? receipt.digest ?? receipt.transactionDigest ?? "").trim();
}

function pickPolicyId(receipt) {
  if (!receipt || typeof receipt !== "object") return "";
  return String(receipt.policyId ?? receipt.policy?.id ?? "").trim();
}

function pickField(receipt, key, fallback = "") {
  const value = receipt?.[key];
  if (value === undefined || value === null) return fallback;
  return value;
}

// Canonical share payload. The shape is stable across this module — every
// share surface (download / copy text / read-only URL) reads from this so
// they cannot disagree about which fields a receipt presents. Bumping the
// shape is a coordinated change with the read-only route and the JSON
// downloader test fixtures.
function configForNetwork(network) {
  // `buildSuiExplorerUrl` consumes a runtime config of shape `{ sui: { network } }`;
  // produce a minimal one keyed off the resolved network so the share URLs
  // are deterministic regardless of the caller's config layout.
  return { sui: { network } };
}

export function buildReceiptCanonicalPayload(receipt, { config = {}, network = "" } = {}) {
  const id = pickReceiptId(receipt);
  const txDigest = pickTxDigest(receipt);
  const policyId = pickPolicyId(receipt);
  const resolvedNetwork = resolveNetwork(config, network);
  const explorerConfig = configForNetwork(resolvedNetwork);

  const explorer = {};
  if (id) explorer.receipt = buildSuiExplorerUrl("object", id, explorerConfig);
  if (txDigest) explorer.tx = buildSuiExplorerUrl("tx", txDigest, explorerConfig);
  if (policyId) explorer.policy = buildSuiExplorerUrl("object", policyId, explorerConfig);

  return {
    schema: TIDE_VERSION_TAG,
    network: resolvedNetwork,
    receipt: {
      id,
      txDigest,
      policyId,
      policyVersion: pickField(receipt, "policyVersion", null),
      schemaVersion: pickField(receipt, "schemaVersion", null),
      owner: pickField(receipt, "owner", ""),
      action: pickField(receipt, "action", ""),
      decisionType: pickField(receipt, "decisionType", ""),
      limitations: pickField(receipt, "limitations", ""),
      selectedRail: pickField(receipt, "selectedRail", ""),
      walrusBlobId: pickField(receipt, "walrusBlobId", ""),
      stateBeforeDigest: pickField(receipt, "stateBeforeDigest", ""),
      railPackDigest: pickField(receipt, "railPackDigest", ""),
      contentDigest: pickField(receipt, "contentDigest", ""),
      createdAtMs: pickField(receipt, "createdAtMs", null),
    },
    explorer,
  };
}

export function buildReceiptDownloadFile(receipt, { config = {}, network = "" } = {}) {
  const payload = buildReceiptCanonicalPayload(receipt, { config, network });
  const id = payload.receipt.id || pickTxDigest(receipt) || "unknown";
  return {
    filename: `tide-receipt-${shortHash(id, 12).replace(/[^A-Za-z0-9._-]/g, "_")}.json`,
    mimeType: "application/json",
    text: JSON.stringify(payload, null, 2),
  };
}

export function buildReceiptCopyText(receipt, { config = {}, network = "" } = {}) {
  const payload = buildReceiptCanonicalPayload(receipt, { config, network });
  const r = payload.receipt;
  const lines = [];
  lines.push(`TIDE Action Receipt — ${payload.network}`);
  if (r.id) lines.push(`Receipt id: ${r.id}`);
  if (r.txDigest) lines.push(`Tx digest: ${r.txDigest}`);
  if (r.policyId) lines.push(`Policy id: ${r.policyId}`);
  if (r.policyVersion !== null) lines.push(`Policy version: ${r.policyVersion}`);
  if (r.schemaVersion !== null) lines.push(`Schema version: v${r.schemaVersion}`);
  if (r.decisionType) lines.push(`Decision: ${r.decisionType}`);
  if (r.limitations) lines.push(`Limitations: ${r.limitations}`);
  if (r.selectedRail) lines.push(`Rail: ${r.selectedRail}`);
  if (r.walrusBlobId) lines.push(`Bundle: ${r.walrusBlobId}`);
  if (payload.explorer.receipt) lines.push(`SuiVision (object): ${payload.explorer.receipt}`);
  if (payload.explorer.tx) lines.push(`SuiVision (tx): ${payload.explorer.tx}`);
  return lines.join("\n");
}

export function buildReceiptCopyMarkdown(receipt, { config = {}, network = "" } = {}) {
  const payload = buildReceiptCanonicalPayload(receipt, { config, network });
  const r = payload.receipt;
  const fields = [];
  if (r.decisionType) fields.push(`**Decision:** ${r.decisionType}`);
  if (r.limitations) fields.push(`**Limitations:** ${r.limitations}`);
  if (r.selectedRail) fields.push(`**Rail:** ${r.selectedRail}`);
  if (r.policyVersion !== null) fields.push(`**Policy v:** ${r.policyVersion}`);
  if (r.schemaVersion !== null) fields.push(`**Schema:** v${r.schemaVersion}`);
  const meta = fields.length ? fields.join(" · ") + "\n\n" : "";
  const links = [];
  if (payload.explorer.receipt) links.push(`[Receipt object](${payload.explorer.receipt})`);
  if (payload.explorer.tx) links.push(`[Tx digest](${payload.explorer.tx})`);
  if (payload.explorer.policy) links.push(`[Policy object](${payload.explorer.policy})`);
  const linkLine = links.length ? links.join(" · ") + "\n" : "";
  return `**TIDE Action Receipt** — ${payload.network}\n\n${meta}${linkLine}`.trim();
}

export function buildReceiptExplorerUrl(receipt, { config = {}, network = "" } = {}) {
  const id = pickReceiptId(receipt);
  if (!id) return "";
  const resolvedNetwork = resolveNetwork(config, network);
  return buildSuiExplorerUrl("object", id, configForNetwork(resolvedNetwork));
}

// Public submission builds do not ship a separate read-only receipt route.
// Keep this API for older renderer call sites, but resolve to the SuiVision
// object URL so the app never publishes a dead internal route.
export function buildReceiptReadOnlyUrl(receipt, { config = {}, network = "", origin = "", form = "clean" } = {}) {
  const id = pickReceiptId(receipt);
  if (!id) return "";
  void origin;
  void form;
  const resolvedNetwork = resolveNetwork(config, network) || READ_ONLY_RECEIPT_NETWORK;
  return buildSuiExplorerUrl("object", id, configForNetwork(resolvedNetwork));
}

export const RECEIPT_SHARE_SCHEMA_TAG = TIDE_VERSION_TAG;
// Kept for back-compat with code that imported the constant.
export const READ_ONLY_RECEIPT_PATH = DEFAULT_READ_ONLY_BASE_PATH;
