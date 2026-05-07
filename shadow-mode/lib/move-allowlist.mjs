/**
 * Pure helpers for the wallet-layer Move-call allowlist. Extracted from
 * wallet.js so vitest can exercise the fail-closed behaviour without a
 * browser / wallet mock.
 *
 * Contract: when executionProof signing is enabled, every signed transaction
 * must be a Move-call PTB whose MoveCall targets appear in the allowlist.
 * Empty MoveCall sets and non-Move PTB command kinds fail closed.
 */

function normalizeTarget(target) {
  return typeof target === "string" ? target.trim() : "";
}

const KNOWN_PTB_COMMAND_KINDS = new Set([
  "MoveCall",
  "TransferObjects",
  "SplitCoins",
  "MergeCoins",
  "Publish",
  "MakeMoveVec",
  "Upgrade",
]);

const ALLOWED_PTB_COMMAND_KINDS = new Set(["MoveCall"]);
const UNKNOWN_PTB_COMMAND_KIND = "UnknownCommand";

/**
 * Build the set of allowed Move targets from a runtime config. The config
 * ships an explicit `execution.allowedMoveTargets` array; we also derive a
 * defense-in-depth fallback from the policy package id + module names so a
 * config missing the explicit list still produces a safe allowlist rather
 * than a silently-empty one.
 */
export function getAllowedMoveTargets(config) {
  const targets = new Set();
  const cfg = config || {};
  const configuredTargets = Array.isArray(cfg?.execution?.allowedMoveTargets)
    ? cfg.execution.allowedMoveTargets
    : [];

  configuredTargets.forEach((target) => {
    const normalized = normalizeTarget(target);
    if (normalized) targets.add(normalized);
  });

  const policyPackageId = normalizeTarget(cfg?.policyRegistry?.packageId);
  const policyModule = normalizeTarget(cfg?.policyRegistry?.module) || "policy_registry";
  const receiptsModule = normalizeTarget(cfg?.executionReceipts?.module) || "execution_receipts";
  if (policyPackageId) {
    // Full operator-callable surface on policy_registry. Earlier builds
    // listed only create/update/select_rail; migrate_policy and
    // delete_policy fell through the allowlist and the signing path
    // refused them silently with "target-not-allowlisted" — the user
    // saw a generic abort with no UI surface explaining which call
    // had been blocked.
    [
      "create_policy",
      "update_policy",
      "select_rail",
      "migrate_policy",
      "delete_policy",
    ].forEach((fn) => {
      targets.add(`${policyPackageId}::${policyModule}::${fn}`);
    });
    targets.add(`${policyPackageId}::${receiptsModule}::mint_receipt`);
  }

  return targets;
}

/**
 * Walk a transaction JSON tree collecting every MoveCall target. Accepts
 * both the modern `{ MoveCall: { target } }` and legacy
 * `{ kind: "MoveCall", package, module, function }` shapes.
 */
export function collectMoveCallTargets(node, targets = new Set()) {
  if (!node || typeof node !== "object") {
    return targets;
  }

  if (Array.isArray(node)) {
    node.forEach((child) => collectMoveCallTargets(child, targets));
    return targets;
  }

  const moveCall = node.MoveCall || (node.kind === "MoveCall" ? node : null);
  if (moveCall && typeof moveCall === "object") {
    const directTarget = normalizeTarget(moveCall.target);
    const splitTarget = normalizeTarget(moveCall.package) &&
      normalizeTarget(moveCall.module) &&
      normalizeTarget(moveCall.function)
        ? `${normalizeTarget(moveCall.package)}::${normalizeTarget(moveCall.module)}::${normalizeTarget(moveCall.function)}`
        : "";
    const target = directTarget || splitTarget;
    if (target) {
      targets.add(target);
    }
  }

  Object.values(node).forEach((child) => collectMoveCallTargets(child, targets));
  return targets;
}

function getCommandKind(command) {
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    return "";
  }
  if (typeof command.$kind === "string" && command.$kind) {
    return command.$kind;
  }
  if (typeof command.kind === "string" && command.kind) {
    return command.kind;
  }
  for (const kind of KNOWN_PTB_COMMAND_KINDS) {
    if (Object.prototype.hasOwnProperty.call(command, kind)) {
      return kind;
    }
  }
  return "";
}

/**
 * Collect top-level PTB command kinds from the JSON shapes emitted by the Sui
 * SDK (`commands`) and older transaction-block adapters (`transactions`).
 */
export function collectPtbCommandKinds(node, kinds = new Set()) {
  if (!node || typeof node !== "object") {
    return kinds;
  }

  const commandLists = [];
  if (Array.isArray(node.commands)) commandLists.push(node.commands);
  if (Array.isArray(node.transactions)) commandLists.push(node.transactions);

  commandLists.forEach((commands) => {
    commands.forEach((command) => {
      const kind = getCommandKind(command);
      kinds.add(kind || UNKNOWN_PTB_COMMAND_KIND);
    });
  });

  return kinds;
}

/**
 * Compare observed Move targets against the allowlist. Returns a verdict
 * object instead of throwing so the caller can shape the error message.
 */
export function checkAllowlist(observedTargets, allowedTargets, { commandKinds } = {}) {
  const kinds = Array.from(commandKinds || []);
  const unsupportedKinds = kinds.filter((kind) => !ALLOWED_PTB_COMMAND_KINDS.has(kind));
  if (unsupportedKinds.length) {
    return {
      ok: false,
      reason: "unsupported-command-kind",
      commandKinds: kinds,
      blockedKinds: unsupportedKinds,
    };
  }

  const observed = Array.from(observedTargets || []);
  if (!observed.length) {
    return { ok: false, reason: "no-move-calls", commandKinds: kinds };
  }
  const allowed = allowedTargets instanceof Set ? allowedTargets : new Set(allowedTargets || []);
  if (!allowed.size) {
    return { ok: false, reason: "empty-allowlist", observed, blocked: observed };
  }
  const blocked = observed.filter((target) => !allowed.has(target));
  if (blocked.length) {
    return { ok: false, reason: "target-not-allowlisted", observed, blocked, allowed: Array.from(allowed) };
  }
  return { ok: true, reason: "all-allowlisted" };
}
