// Move abort / error translator — turns a raw Sui RPC error string into
// a human-readable, judge-friendly explanation. Used by the renderer
// when a receipt-mint or policy-anchor transaction fails-closed, so
// the operator (or the judge watching the demo) sees:
//   "Rail revoked between simulation and mint (N2 — E_RAIL_NOT_ALLOWED).
//    Refresh the rail allowlist and rerun."
// instead of the raw:
//   "MoveAbort(MoveLocation { module: ModuleId { address: …, name: Identifier(\"execution_receipts\") }, function: 0, instruction: 145 }, 6)"
//
// Pure JS — no DOM, no globalThis, no app.js dependency. Works for both
// browser-side error rendering and CLI failure messages.

// Canonical abort table. KEEP IN SYNC with move/sources/*.move; the
// regression test (move-abort-translate.test.mjs) reads the Move source
// and compares the table.
const ABORT_TABLE = Object.freeze({
  execution_receipts: Object.freeze({
    1: {
      name: "E_NOT_POLICY_OWNER",
      summary: "Transaction sender is not the policy owner.",
      operatorMessage: "Only the wallet that created the policy can mint receipts against it. Switch to the owner wallet and try again.",
      guard: null,
    },
    2: {
      name: "E_POLICY_VERSION_STALE",
      summary: "Policy version has drifted since the simulator built the bundle.",
      operatorMessage: "Re-run the Autopilot Rehearsal so the bundle pins the current policy version, then retry the mint.",
      guard: null,
    },
    3: {
      name: "E_INVALID_DIGEST",
      summary: "A digest field is not exactly 32 bytes.",
      operatorMessage: "The signed proof bundle has malformed digests. Rebuild the rehearsal bundle and retry.",
      guard: null,
    },
    4: {
      name: "E_INVALID_INPUT",
      summary: "A string field exceeds its byte cap.",
      operatorMessage: "One of action / decision_type / limitations / walrus_blob_id is over its byte limit. Rebuild the rehearsal bundle and retry.",
      guard: null,
    },
    5: {
      name: "E_RAIL_MISMATCH",
      summary: "Caller's expected_rail does not match the policy's selected_rail.",
      operatorMessage: "Refresh the simulator — the policy's selected rail changed between Autopilot Rehearsal and mint. Pin the latest rail before retrying.",
      guard: "N1",
    },
    6: {
      name: "E_RAIL_NOT_ALLOWED",
      summary: "Selected rail was revoked from the allowlist between select_rail and mint.",
      operatorMessage: "Rail revoked between simulation and mint (N2 guard). Refresh the rail allowlist and rerun the Rehearsal.",
      guard: "N2",
    },
    7: {
      name: "E_INVALID_DECISION_TYPE",
      summary: "decision_type is not one of the documented controlled-vocabulary values.",
      operatorMessage: "The planner produced a decision type this receipt schema does not accept. Rebuild the rehearsal bundle and retry.",
      guard: null,
    },
    8: {
      name: "E_INVALID_LIMITATIONS",
      summary: "limitations is not one of shadow-only / testnet-rehearsal.",
      operatorMessage: "The planner produced a receipt limitation label this package does not accept. Rebuild the rehearsal bundle and retry.",
      guard: null,
    },
  }),
  policy_registry: Object.freeze({
    1: {
      name: "E_NOT_OWNER",
      summary: "Transaction sender is not the policy owner.",
      operatorMessage: "Only the wallet that created the policy can edit it. Switch to the owner wallet and try again.",
      guard: null,
    },
    2: {
      name: "E_WRONG_VERSION",
      summary: "Policy version drifted (e.g. another tab edited the policy first).",
      operatorMessage: "Refresh the policy view and retry — your local copy is one revision behind.",
      guard: null,
    },
    4: {
      name: "E_RAIL_NOT_ALLOWED",
      summary: "Selected rail is not in the on-chain allowlist.",
      operatorMessage: "Pick a rail that is in the on-chain allowlist (Suilend / NAVI / Scallop / Bucket / AlphaLend on testnet S0). Admin can extend the allowlist if a new rail is needed.",
      guard: "N2",
    },
    5: {
      name: "E_INVALID_LTV",
      summary: "LTV bounds outside the [0, 10000] basis-point range or low > high.",
      operatorMessage: "Pick LTV bounds inside 0–100% with low ≤ target ≤ repay ≤ emergency ≤ max.",
      guard: null,
    },
    6: {
      name: "E_INVALID_PAYOUT",
      summary: "Payout or stable-buffer target is outside the supported range.",
      operatorMessage: "Pick positive payout and minimum stable-buffer targets before anchoring.",
      guard: null,
    },
    7: {
      name: "E_INVALID_INPUT",
      summary: "An input field is empty or otherwise malformed.",
      operatorMessage: "Re-check the policy form — one of the fields is empty or out of range.",
      guard: null,
    },
    8: {
      name: "E_ADMIN_TRANSFER_TOO_EARLY",
      summary: "Admin-cap transfer attempted before the documented cooldown window.",
      operatorMessage: "Admin-cap rotation requires a cooldown window. Try again after the documented delay.",
      guard: null,
    },
    9: {
      name: "E_ADMIN_TRANSFER_NOT_REQUESTER",
      summary: "Admin-cap transfer accept attempted by a wallet that is not the documented receiver.",
      operatorMessage: "Only the wallet named in the transfer request can accept the AdminCap.",
      guard: null,
    },
    10: {
      name: "E_POLICY_HAS_RECEIPTS",
      summary: "Policy deletion was blocked because receipts have already been minted against it.",
      operatorMessage: "Archive the policy instead of deleting it: action receipts already reference this policy UID.",
      guard: null,
    },
  }),
});

// Sui RPC's MoveAbort serialization wraps a MoveLocation that has its
// own nested `, function: N, instruction: N }` segment. The non-greedy
// `[\s\S]*?,\s*(\d+)\s*\)` keeps walking until it finds the FIRST
// `, NUM)` that's actually closed by `)` — that is the abort code at
// the end of MoveAbort(MoveLocation{…}, CODE).
const RAW_ABORT_RE = /MoveAbort\([\s\S]*?Identifier\("([^"]+)"\)[\s\S]*?,\s*(\d+)\s*\)/;
const COMPACT_ABORT_RE = /\babort code\s*[:=]\s*(\d+)\b.*?\bmodule[:=]\s*([A-Za-z_]+)/i;

function lookup(moduleName, code) {
  const numericCode = Number(code);
  if (!Number.isFinite(numericCode)) return null;
  const moduleTable = ABORT_TABLE[moduleName];
  if (!moduleTable) return null;
  return moduleTable[numericCode] || null;
}

// Parse a raw Sui RPC error string and return a structured translation.
// Returns null when the input is not recognizably a Move abort (e.g. an
// HTTP error or an Insufficient-Gas panic). Callers pattern-match on
// the result and fall back to the raw string when null.
export function translateMoveAbort(input) {
  if (input === null || input === undefined) return null;
  const text = typeof input === "string" ? input : (input?.message || String(input));
  if (!text) return null;
  let match = RAW_ABORT_RE.exec(text);
  let moduleName;
  let code;
  if (match) {
    moduleName = match[1];
    code = match[2];
  } else {
    match = COMPACT_ABORT_RE.exec(text);
    if (match) {
      moduleName = match[2];
      code = match[1];
    } else {
      return null;
    }
  }
  const entry = lookup(moduleName, code);
  if (!entry) {
    return {
      recognized: false,
      moduleName,
      code: Number(code),
      raw: text,
    };
  }
  return {
    recognized: true,
    moduleName,
    code: Number(code),
    name: entry.name,
    summary: entry.summary,
    operatorMessage: entry.operatorMessage,
    guard: entry.guard,
    raw: text,
  };
}

// Compose a one-line operator-facing string from a translation. Useful
// for the renderer surface that wants a single "what to do" sentence.
// Falls back to the raw text when no translation is available.
export function formatTranslatedAbort(translation) {
  if (!translation) return "";
  if (!translation.recognized) {
    return `Move abort code ${translation.code} from module '${translation.moduleName}' (no translation registered). Raw: ${translation.raw.slice(0, 200)}`;
  }
  const guardTag = translation.guard ? ` (${translation.guard} guard) ` : " ";
  return `${translation.name}${guardTag}— ${translation.operatorMessage}`;
}

// Returns the full canonical table for callers that want to render an
// "all guards" reference (e.g. a /docs page or a debug overlay).
export function getKnownAborts() {
  const out = [];
  for (const [moduleName, byCode] of Object.entries(ABORT_TABLE)) {
    for (const [code, entry] of Object.entries(byCode)) {
      out.push({
        moduleName,
        code: Number(code),
        name: entry.name,
        summary: entry.summary,
        operatorMessage: entry.operatorMessage,
        guard: entry.guard,
      });
    }
  }
  return out;
}

export const KNOWN_ABORT_MODULES = Object.freeze(Object.keys(ABORT_TABLE));
