import { getLiveUnwindProgressSummary } from "./live-unwind-progress.mjs";

function normalizeTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function pickLatestReceipt(receipts = []) {
  const list = Array.isArray(receipts) ? receipts : [];
  let latest = null;
  let latestAt = 0;
  for (const receipt of list) {
    const createdAt = normalizeTimestamp(receipt?.createdAtMs || receipt?.createdAt || receipt?.timestamp);
    if (createdAt >= latestAt) {
      latest = receipt;
      latestAt = createdAt;
    }
  }
  return { latestReceipt: latest, latestReceiptAt: latestAt };
}

function resolveReceiptBaseline(unwindProgress = null, controlState = null) {
  const completed = unwindProgress?.completed && typeof unwindProgress.completed === "object"
    ? unwindProgress.completed
    : {};

  const repayAt = normalizeTimestamp(completed["repay-withdraw"]);
  if (repayAt > 0) {
    return {
      stepId: "repay-withdraw",
      stepLabel: "Repay and withdraw",
      timestamp: repayAt,
    };
  }

  const reviewAt = normalizeTimestamp(completed.review);
  if (reviewAt > 0) {
    return {
      stepId: "review",
      stepLabel: "Review",
      timestamp: reviewAt,
    };
  }

  const planAt = String(controlState?.mode || "").trim().toLowerCase() === "unwind-planned"
    ? normalizeTimestamp(controlState?.updatedAt)
    : 0;
  if (planAt > 0) {
    return {
      stepId: "unwind-planned",
      stepLabel: "Unwind planned",
      timestamp: planAt,
    };
  }

  return {
    stepId: "",
    stepLabel: "",
    timestamp: 0,
  };
}

export function buildLiveExitEvidence({
  receipts = [],
  controlState = null,
  unwindProgress = null,
} = {}) {
  const progressSummary = getLiveUnwindProgressSummary(unwindProgress);
  const { latestReceipt, latestReceiptAt } = pickLatestReceipt(receipts);
  const baseline = resolveReceiptBaseline(unwindProgress, controlState);
  const hasReceipt = latestReceiptAt > 0;
  const receiptAfterBaseline = baseline.timestamp > 0
    ? latestReceiptAt >= baseline.timestamp
    : hasReceipt;

  if (!progressSummary.allDone) {
    return {
      id: progressSummary.done > 0 ? "checklist-in-progress" : "checklist-open",
      label: progressSummary.done > 0 ? "Checklist in progress" : "Checklist open",
      badge: "Checklist open",
      tone: "neutral",
      copy: "Complete the full manual exit checklist before marking this policy family unwound.",
      progressSummary,
      latestReceipt,
      latestReceiptAt,
      requiredReceiptAfterMs: baseline.timestamp,
      requiredReceiptAfterLabel: baseline.stepLabel,
      hasReceipt,
      hasFreshReceipt: false,
      canMarkUnwound: false,
    };
  }

  if (!hasReceipt) {
    return {
      id: "awaiting-final-receipt",
      label: "Awaiting final receipt",
      badge: "Receipt required",
      tone: "warning",
      copy: "Checklist is complete, but no receipt has been minted yet. Mint a final receipt after the unwind is complete.",
      progressSummary,
      latestReceipt,
      latestReceiptAt,
      requiredReceiptAfterMs: baseline.timestamp,
      requiredReceiptAfterLabel: baseline.stepLabel,
      hasReceipt,
      hasFreshReceipt: false,
      canMarkUnwound: false,
    };
  }

  if (!receiptAfterBaseline) {
    return {
      id: "stale-final-receipt",
      label: "Final receipt is stale",
      badge: "Receipt stale",
      tone: "warning",
      copy: baseline.stepLabel
        ? `A receipt exists, but it predates the "${baseline.stepLabel}" checkpoint. Mint a fresh final receipt after the unwind is actually complete.`
        : "A receipt exists, but it does not prove the latest exit posture yet. Mint a fresh final receipt after the unwind is complete.",
      progressSummary,
      latestReceipt,
      latestReceiptAt,
      requiredReceiptAfterMs: baseline.timestamp,
      requiredReceiptAfterLabel: baseline.stepLabel,
      hasReceipt,
      hasFreshReceipt: false,
      canMarkUnwound: false,
    };
  }

  return {
    id: "exit-evidence-sealed",
    label: "Exit evidence sealed",
    badge: "Receipt sealed",
    tone: "success",
    copy: "Checklist is complete and the latest receipt is newer than the unwind checkpoint. Workspace has the final exit evidence it needs.",
    progressSummary,
    latestReceipt,
    latestReceiptAt,
    requiredReceiptAfterMs: baseline.timestamp,
    requiredReceiptAfterLabel: baseline.stepLabel,
    hasReceipt,
    hasFreshReceipt: true,
    canMarkUnwound: true,
  };
}
