// Pre-signing check — fail-closed gate before any wallet.signAndExecute call.
//
// The live TIDE public site and simulator are intentionally accessible
// without any geo or IP check: Shadow Mode is read-only, no wallet, no
// signing. Screening kicks in at the moment a wallet is asked to sign
// something on-chain, which is where legal-risk actually begins.
//
// This module owns ONE rule: if any precondition fails, refuse signing
// with an explicit reason. Multiple preconditions can fail simultaneously;
// the result captures all of them as a stable shape that the dialog
// renderer can display layer-by-layer.
//
// Plug-in extension points (each documented as TODO hook):
//   - Address-level sanctions screening (Chainalysis Address Screening
//     or equivalent) against the connected wallet address.
//   - Jurisdiction check, ONLY where counsel has signed off on a list —
//     NEVER default to a broad block. The public simulation surface must
//     stay reachable.
//   - In-session caching so every signAndExecute does not re-hit upstream;
//     invalidate the cache on wallet change.

const KNOWN_ACTIONS = new Set([
  "save-policy-on-chain",
  "select-rail",
  "mint-receipt",
  "update-policy",
  "execute-live-action",
  "anchor-rail-allowlist",
]);

const FAILURE_DEFAULTS = Object.freeze({
  "wallet-not-connected": "Connect a wallet before signing on-chain actions.",
  "wallet-disconnected": "Wallet is not connected. Reconnect before signing.",
  "wrong-chain": "Wallet is on the wrong network. Switch to the expected network in your wallet, then retry.",
  "unknown-action": "Refusing to sign an unrecognized action. Reload and try again.",
  "screening-deny": "Signing is not allowed for this wallet right now.",
  "jurisdiction-deny": "Signing is not allowed from your jurisdiction.",
});

function buildReason(id, messageOverride) {
  return {
    id,
    message: messageOverride || FAILURE_DEFAULTS[id] || "Signing is blocked.",
  };
}

function denied(reasons, extra = {}) {
  const list = Array.isArray(reasons) ? reasons : [reasons];
  const first = list[0] || buildReason("screening-deny");
  return {
    allowed: false,
    reason: first.id,
    message: first.message,
    reasons: list,
    ...extra,
  };
}

function permitted({ address, action, hooks = {} }) {
  return {
    allowed: true,
    reason: "default-permit",
    address,
    action,
    reasons: [],
    hooks,
  };
}

export async function preSigningCheck({
  address = "",
  action = "unknown",
  walletConnected = null,
  expectedChain = null,
  walletChain = null,
  screeningHook = null,
  jurisdictionHook = null,
} = {}) {
  const reasons = [];
  const normalizedAddress = typeof address === "string" ? address.trim() : "";

  if (!normalizedAddress) {
    reasons.push(buildReason("wallet-not-connected"));
  } else if (walletConnected === false) {
    // Explicit disconnect signal from the renderer beats a stale address.
    reasons.push(buildReason("wallet-disconnected"));
  }

  const wantedChain = typeof expectedChain === "string" ? expectedChain.trim().toLowerCase() : "";
  const actualChain = typeof walletChain === "string" ? walletChain.trim().toLowerCase() : "";
  if (wantedChain && actualChain && wantedChain !== actualChain) {
    const targetNetwork = wantedChain.startsWith("sui:") ? wantedChain.slice(4) : wantedChain;
    reasons.push(buildReason(
      "wrong-chain",
      `Wallet is on '${actualChain}', expected '${wantedChain}'. Switch to ${targetNetwork} in your wallet, then retry.`,
    ));
  }

  const normalizedAction = typeof action === "string" && action.trim() ? action.trim() : "unknown";
  if (!KNOWN_ACTIONS.has(normalizedAction)) {
    reasons.push(buildReason("unknown-action", `Refusing to sign unrecognized action '${normalizedAction}'.`));
  }

  // Sanctions / address screening hook. The default is a permissive no-op
  // so test fixtures and dev work, but the production wiring should pass
  // a real screener that returns { allowed: boolean, reason?: string,
  // message?: string }. Any thrown error is treated as fail-closed.
  if (typeof screeningHook === "function" && normalizedAddress) {
    try {
      const verdict = await screeningHook({ address: normalizedAddress, action: normalizedAction });
      if (verdict && verdict.allowed === false) {
        reasons.push(buildReason("screening-deny", verdict.message || FAILURE_DEFAULTS["screening-deny"]));
      }
    } catch (err) {
      reasons.push(buildReason("screening-deny", `Screening check failed: ${err?.message || err}. Refusing to sign.`));
    }
  }

  // Jurisdiction check hook. Same shape as screening.
  if (typeof jurisdictionHook === "function" && normalizedAddress) {
    try {
      const verdict = await jurisdictionHook({ address: normalizedAddress, action: normalizedAction });
      if (verdict && verdict.allowed === false) {
        reasons.push(buildReason("jurisdiction-deny", verdict.message || FAILURE_DEFAULTS["jurisdiction-deny"]));
      }
    } catch (err) {
      reasons.push(buildReason("jurisdiction-deny", `Jurisdiction check failed: ${err?.message || err}. Refusing to sign.`));
    }
  }

  if (reasons.length) {
    return denied(reasons, { address: normalizedAddress, action: normalizedAction });
  }

  return permitted({ address: normalizedAddress, action: normalizedAction });
}

export const PRE_SIGNING_KNOWN_ACTIONS = Object.freeze([...KNOWN_ACTIONS]);
export const PRE_SIGNING_FAILURE_IDS = Object.freeze(Object.keys(FAILURE_DEFAULTS));
