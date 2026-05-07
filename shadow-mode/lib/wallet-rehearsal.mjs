// Browser wallet rehearsal harness — captures the manual sign-flow
// rehearsal as a structured, auditable record.
//
// Usage from the operator console (after running through the steps in
// docs/overflow_2026/wallet_rehearsal.md):
//
//   import { createRehearsalLog } from "./lib/wallet-rehearsal.mjs";
//   const log = createRehearsalLog({
//     network: "testnet",
//     packageId: "0x812c...",
//     operatorAddress: "0xd800...",
//   });
//   log.step("anchor-policy", "pass", { policyId: "0x6b7a..." });
//   log.step("mint-receipt", "pass", { receiptId: "0xc8e0..." });
//   log.step("cancel-n5",    "pass", { reason: "wallet-cancel" });
//   log.step("wrong-network","pass", { detected: "mainnet", refused: true });
//   log.step("rpc-timeout",  "pass", { fallbackHit: true });
//   const record = log.finalize();
//   console.log(JSON.stringify(record, null, 2)); // paste into proof pack
//
// The harness is intentionally pure: no DOM, no wallet handles, no
// network. The operator is the runtime — this lib only structures the
// record so the proof artifact is consistent across rehearsals and
// reviewers can grep for missing steps.

const REQUIRED_STEPS = Object.freeze([
  "anchor-policy",     // policy_registry::create_policy + select_rail
  "mint-receipt",      // execution_receipts::mint_receipt
  "cancel-n5",         // user cancels signing → no PTB sent (N5 guard)
  "wrong-network",     // wallet on wrong chain → fail-closed (B-11 wrong-chain)
  "rpc-timeout",       // RPC times out → app surfaces error, no silent state
]);

const ALLOWED_STATUSES = new Set(["pass", "fail", "skip"]);

function nowIso() {
  return new Date().toISOString();
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
    return Object.freeze(value);
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    return Object.freeze(value);
  }
  return value;
}

export function createRehearsalLog({
  network = "",
  packageId = "",
  operatorAddress = "",
  startedAt = nowIso(),
  schemaVersion = "tide-rehearsal/v1",
  gitShortSha = "",
} = {}) {
  if (!network) throw new Error("createRehearsalLog: network is required.");
  if (!packageId) throw new Error("createRehearsalLog: packageId is required.");
  // gitShortSha is the build the operator was running while rehearsing.
  // It rides into the record so a reviewer can ask "was this rehearsal
  // captured against a build that has the current wallet.js path?"
  // without re-running the manual flow. Validation is enforced in
  // validateRehearsalRecord; collection is permissive (empty allowed
  // for older records).
  const trimmedSha = typeof gitShortSha === "string" ? gitShortSha.trim() : "";
  const stepsByName = new Map();
  let finalized = false;

  function step(name, status, evidence = {}) {
    if (finalized) {
      throw new Error("rehearsal log is finalized; cannot append more steps.");
    }
    if (typeof name !== "string" || !name.trim()) {
      throw new Error("step.name must be a non-empty string.");
    }
    if (!ALLOWED_STATUSES.has(status)) {
      throw new Error(`step.status must be one of ${[...ALLOWED_STATUSES].join("|")}, got '${status}'.`);
    }
    if (!isPlainObject(evidence)) {
      throw new Error("step.evidence must be a plain object.");
    }
    stepsByName.set(name.trim(), {
      name: name.trim(),
      status,
      at: nowIso(),
      evidence: { ...evidence },
    });
  }

  function finalize() {
    finalized = true;
    const recorded = [...stepsByName.values()];
    const recordedNames = new Set(recorded.map((s) => s.name));
    const missing = REQUIRED_STEPS.filter((s) => !recordedNames.has(s));
    const failed = recorded.filter((s) => s.status === "fail");
    const skipped = recorded.filter((s) => s.status === "skip");
    const skippedRequired = skipped.filter((s) => REQUIRED_STEPS.includes(s.name));
    const passed = recorded.filter((s) => s.status === "pass");
    const finishedAt = nowIso();
    return deepFreeze({
      schemaVersion,
      network,
      packageId,
      operatorAddress,
      gitShortSha: trimmedSha,
      startedAt,
      finishedAt,
      finishedAtMs: Date.parse(finishedAt),
      requiredSteps: [...REQUIRED_STEPS],
      steps: recorded.map((s) => ({ ...s, evidence: { ...s.evidence } })),
      summary: {
        total: recorded.length,
        passed: passed.length,
        failed: failed.length,
        skipped: skipped.length,
        skippedRequired: skippedRequired.map((s) => s.name),
        missing: missing.slice(),
        ok: missing.length === 0 && failed.length === 0 && skippedRequired.length === 0,
      },
    });
  }

  return Object.freeze({ step, finalize });
}

export const REHEARSAL_REQUIRED_STEPS = REQUIRED_STEPS;
export const REHEARSAL_ALLOWED_STATUSES = Object.freeze([...ALLOWED_STATUSES]);

// Schema-checker for an existing rehearsal record. Lets a CI gate or a
// review tool consume a record JSON file and assert the shape is valid +
// every required step is present + every step is a pass. Useful when
// the operator pastes their record into the proof pack and a reviewer
// wants to validate it without re-running the manual flow.
//
// Optional freshness bindings (used by `verify-wallet-rehearsal.mjs
// --require` and TIDE_VERIFY_MODE=final):
//   - `maxAgeMs`: fail when `finishedAt` is older than this budget. The
//     gap closed: a stale rehearsal artifact silently passes after a
//     wallet.js regression because the structural shape is still valid.
//   - `expectedGitShortSha`: fail when `gitShortSha` is missing or does
//     not match the current build. Pair with `maxAgeMs` so a rehearsal
//     captured 27 days ago against a now-modified wallet flow does not
//     paper over the regression.
//   - `now`: clock injection for tests.
export function validateRehearsalRecord(record, options = {}) {
  const {
    maxAgeMs = null,
    expectedGitShortSha = "",
    now = Date.now(),
  } = options || {};
  const failures = [];
  if (!isPlainObject(record)) {
    return { ok: false, failures: ["record must be an object"] };
  }
  if (typeof record.schemaVersion !== "string" || !record.schemaVersion) {
    failures.push("schemaVersion must be a non-empty string");
  }
  if (typeof record.network !== "string" || !record.network) {
    failures.push("network must be a non-empty string");
  }
  if (typeof record.packageId !== "string" || !/^0x[0-9a-f]{64}$/i.test(record.packageId)) {
    failures.push("packageId must be a 32-byte 0x-hex string");
  }
  if (Number.isFinite(maxAgeMs) && maxAgeMs > 0) {
    const finishedAt = typeof record.finishedAt === "string" ? Date.parse(record.finishedAt) : NaN;
    if (!Number.isFinite(finishedAt)) {
      failures.push("finishedAt is required when --require is set");
    } else {
      const ageMs = Number(now) - finishedAt;
      if (ageMs > maxAgeMs) {
        const ageDays = (ageMs / (24 * 60 * 60_000)).toFixed(1);
        const limitDays = (maxAgeMs / (24 * 60 * 60_000)).toFixed(1);
        failures.push(`rehearsal record is stale: ${ageDays}d old, max ${limitDays}d`);
      }
    }
  }
  if (typeof expectedGitShortSha === "string" && expectedGitShortSha.trim()) {
    const expected = expectedGitShortSha.trim();
    const actual = typeof record.gitShortSha === "string" ? record.gitShortSha.trim() : "";
    if (!actual) {
      failures.push("gitShortSha is required when expectedGitShortSha is set");
    } else if (actual !== expected) {
      failures.push(`gitShortSha mismatch: record=${actual}, expected=${expected}`);
    }
  }
  if (!Array.isArray(record.steps)) {
    failures.push("steps must be an array");
  } else {
    const seen = new Set();
    for (const step of record.steps) {
      if (!isPlainObject(step)) {
        failures.push("each step must be an object");
        continue;
      }
      if (typeof step.name !== "string" || !step.name) {
        failures.push("step.name must be a non-empty string");
      } else if (seen.has(step.name)) {
        failures.push(`step '${step.name}' is duplicated`);
      } else {
        seen.add(step.name);
      }
      if (!ALLOWED_STATUSES.has(step.status)) {
        failures.push(`step '${step.name || "?"}' has unknown status '${step.status}'`);
      }
    }
    const recordedNames = new Set(record.steps.filter(isPlainObject).map((s) => s.name));
    for (const required of REQUIRED_STEPS) {
      if (!recordedNames.has(required)) {
        failures.push(`required step '${required}' is missing`);
      }
    }
    const failed = record.steps.filter(
      (s) => isPlainObject(s) && s.status === "fail",
    );
    if (failed.length) {
      failures.push(
        `${failed.length} step(s) failed: ${failed.map((s) => s.name).join(", ")}`,
      );
    }
    const skippedRequired = record.steps.filter(
      (s) => isPlainObject(s) && s.status === "skip" && REQUIRED_STEPS.includes(s.name),
    );
    if (skippedRequired.length) {
      failures.push(
        `${skippedRequired.length} required step(s) skipped: ${skippedRequired.map((s) => s.name).join(", ")}`,
      );
    }
  }
  return { ok: failures.length === 0, failures };
}
