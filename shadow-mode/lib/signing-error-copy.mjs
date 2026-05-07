import {
  formatTranslatedAbort,
  translateMoveAbort,
} from "./move-abort-translate.mjs";

const ACTION_LABELS = Object.freeze({
  "execute-live-action": "Live action",
  "save-policy-on-chain": "Policy sync",
  "policy.anchor": "Policy anchor",
  "policy.update": "Policy update",
  "mint-receipt": "Action receipt mint",
  "receipt.mint": "Action receipt mint",
});

export function getSigningErrorMessage(error) {
  if (error instanceof Error) return error.message || error.name || "";
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof error.message === "string") return error.message;
  return String(error || "");
}

function labelFor(action) {
  const key = typeof action === "string" ? action.trim() : "";
  return ACTION_LABELS[key] || "Signing";
}

function sanitizeClassName(value) {
  return String(value || "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function compactMoveAbortClass(translation) {
  if (!translation) return "";
  if (translation.recognized) {
    return `move-abort-${sanitizeClassName(translation.moduleName)}-${sanitizeClassName(translation.name)}`;
  }
  return `move-abort-${sanitizeClassName(translation.moduleName)}-${translation.code}`;
}

export function classifySigningError(error, options = {}) {
  const rawMessage = getSigningErrorMessage(error);
  const lower = rawMessage.toLowerCase();
  const errorName = typeof error?.name === "string" ? error.name.toLowerCase() : "";
  const errorCode = typeof error?.code === "number" || typeof error?.code === "string"
    ? String(error.code).toLowerCase()
    : "";
  const action = typeof options.action === "string" ? options.action : "";
  const actionLabel = labelFor(action);
  const moveAbort = translateMoveAbort(rawMessage);

  if (error?.code === "TIDE_RAIL_NOT_ALLOWLISTED") {
    const safeMessage = typeof error.userMessage === "string" && error.userMessage.trim()
      ? error.userMessage.trim()
      : "Policy data could not be saved. Refresh and try again.";
    return {
      failureClass: "rail-not-allowlisted",
      userMessage: safeMessage,
      developerMessage: error.developerMessage || rawMessage || "Selected rail is not on the on-chain allowlist.",
      rawMessage,
      moveAbort: null,
    };
  }

  if (moveAbort) {
    const userMessage = moveAbort.recognized
      ? formatTranslatedAbort(moveAbort)
      : `Move guard rejected the transaction with ${moveAbort.moduleName} code ${moveAbort.code}. Refresh on-chain state and retry.`;
    return {
      failureClass: compactMoveAbortClass(moveAbort),
      userMessage,
      developerMessage: rawMessage || userMessage,
      rawMessage,
      moveAbort,
    };
  }

  if (
    errorCode === "4001"
    || lower.includes("reject")
    || lower.includes("denied")
    || lower.includes("cancel")
    || lower.includes("user abort")
  ) {
    return {
      failureClass: "wallet-reject",
      userMessage: `${actionLabel} cancelled — nothing was signed or submitted.`,
      developerMessage: rawMessage || "Wallet rejected signing.",
      rawMessage,
      moveAbort: null,
      isUserCancellation: true,
    };
  }

  if (lower.includes("insufficient") && lower.includes("gas")) {
    return {
      failureClass: "insufficient-gas",
      userMessage: `${actionLabel} failed — this wallet does not have enough SUI for gas.`,
      developerMessage: rawMessage || "Insufficient gas.",
      rawMessage,
      moveAbort: null,
    };
  }

  if (lower.includes("incorrect number of arguments")) {
    return {
      failureClass: "abi-mismatch",
      userMessage: `${actionLabel} failed — the frontend ABI does not match the deployed testnet package. Refresh the app, anchor a fresh policy object, then retry.`,
      developerMessage: rawMessage || "Incorrect number of Move call arguments.",
      rawMessage,
      moveAbort: null,
    };
  }

  if (lower.includes("older testnet package") || (lower.includes("package") && lower.includes("mismatch"))) {
    return {
      failureClass: "package-mismatch",
      userMessage: `${actionLabel} failed — this object belongs to an older testnet package. Anchor a fresh policy object, then retry.`,
      developerMessage: rawMessage || "Policy package mismatch.",
      rawMessage,
      moveAbort: null,
    };
  }

  if (
    errorName === "aborterror"
    || lower.includes("timeout")
    || lower.includes("timed out")
    || lower.includes("deadline")
  ) {
    return {
      failureClass: "rpc-timeout",
      userMessage: `${actionLabel} is waiting on Sui RPC. Check the object or transaction in the explorer, then retry the same action if it did not land.`,
      developerMessage: rawMessage || "RPC timeout.",
      rawMessage,
      moveAbort: null,
    };
  }

  if (
    lower.includes("wrong network")
    || lower.includes("wrong-chain")
    || (lower.includes("expected 'sui:") && lower.includes("testnet"))
    || lower.includes("mainnet signing is disabled")
    || lower.includes("use testnet proof signing")
    || lower.includes("use testnet action-receipt signing")
  ) {
    return {
      failureClass: "wrong-wallet-network",
      userMessage: `${actionLabel} blocked — switch to testnet in your wallet, then retry.`,
      developerMessage: rawMessage || "Wallet is not on the configured testnet chain.",
      rawMessage,
      moveAbort: null,
    };
  }

  if (
    lower.includes("pre-sign unavailable")
    || lower.includes("local pre-sign")
    || lower.includes("execution preview only")
    || lower.includes("preview-only")
    || lower.includes("cannot build signable")
    || lower.includes("no signable transaction")
    || lower.includes("wallet refuses to sign")
  ) {
    return {
      failureClass: "pre-sign-unavailable",
      userMessage: `${actionLabel} blocked before wallet signing. This surface is preview-only or the wallet cannot build a signable transaction for it.`,
      developerMessage: rawMessage || "Local pre-sign checks refused signing.",
      rawMessage,
      moveAbort: null,
      isPreSignUnavailable: true,
    };
  }

  if (lower.includes("network") || lower.includes("rpc") || lower.includes("fetch")) {
    return {
      failureClass: "rpc",
      userMessage: `${actionLabel} failed — Sui RPC or network access is unavailable. Refresh, then retry the same action.`,
      developerMessage: rawMessage || "RPC/network failure.",
      rawMessage,
      moveAbort: null,
    };
  }

  const fallback = typeof options.fallbackMessage === "string" && options.fallbackMessage.trim()
    ? options.fallbackMessage.trim()
    : `${actionLabel} failed. Check wallet and network state, then retry.`;
  return {
    failureClass: "unknown",
    userMessage: fallback,
    developerMessage: rawMessage || fallback,
    rawMessage,
    moveAbort: null,
  };
}

export function buildSigningErrorTelemetry(classified) {
  const moveAbort = classified?.moveAbort || null;
  return {
    failureClass: classified?.failureClass || "unknown",
    moveAbortModule: moveAbort?.moduleName || "",
    moveAbortCode: Number.isFinite(moveAbort?.code) ? moveAbort.code : null,
    moveAbortName: moveAbort?.recognized ? moveAbort.name : "",
    moveAbortGuard: moveAbort?.recognized ? moveAbort.guard || "" : "",
  };
}
