import { getLiveUnwindProgressSummary } from "./live-unwind-progress.mjs";

function normalizeMode(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function canMarkPolicyUnwound(unwindProgress = null, exitEvidence = null) {
  const checklistComplete = getLiveUnwindProgressSummary(unwindProgress).allDone;
  if (!checklistComplete) {
    return false;
  }
  if (exitEvidence && typeof exitEvidence.canMarkUnwound === "boolean") {
    return exitEvidence.canMarkUnwound;
  }
  return checklistComplete;
}

export function buildLivePolicyStatus({
  policy = null,
  receipts = [],
  controlState = null,
  unwindProgress = null,
  snapshot = null,
  exitEvidence = null,
} = {}) {
  const hasPolicy = Boolean(policy?.id);
  const hasReceipts = Array.isArray(receipts) && receipts.length > 0;
  const mode = normalizeMode(controlState?.mode || "active");
  const progressSummary = getLiveUnwindProgressSummary(unwindProgress);
  const missingSnapshot = hasPolicy && !snapshot;

  if (!hasPolicy) {
    return {
      id: "no-policy",
      label: "No live policy bound",
      badge: "Setup only",
      tone: "neutral",
      copy: "Anchor a policy first before Workspace can track receipts, operator posture, or unwind progress.",
      missingSnapshot: false,
      progressSummary,
      exitEvidence,
      canMarkUnwound: false,
    };
  }

  if (mode === "unwound") {
    const proofSealed = Boolean(exitEvidence?.canMarkUnwound);
    return {
      id: proofSealed ? "unwound-sealed" : "unwound-local",
      label: proofSealed ? "Unwound with final proof" : "Locally marked unwound",
      badge: proofSealed ? "Exit sealed" : "Exit logged",
      tone: proofSealed ? "success" : "warning",
      copy: proofSealed
        ? "Workspace records this policy family as unwound and has a final receipt newer than the exit checkpoint."
        : "Workspace records this policy family as locally unwound, but the final receipt evidence is still missing or stale.",
      missingSnapshot,
      progressSummary,
      exitEvidence,
      canMarkUnwound: canMarkPolicyUnwound(unwindProgress, exitEvidence),
    };
  }

  if (mode === "unwind-planned" || progressSummary.done > 0) {
    return {
      id: "unwind-in-progress",
      label: "Unwind in progress",
      badge: "Exit in review",
      tone: "warning",
      copy: progressSummary.done > 0
        ? (exitEvidence?.copy || "The manual exit checklist has started. Complete the rail close and mint the final receipt before marking the policy unwound.")
        : "This policy is marked for unwind, but no checklist steps are complete yet.",
      missingSnapshot,
      progressSummary,
      exitEvidence,
      canMarkUnwound: canMarkPolicyUnwound(unwindProgress, exitEvidence),
    };
  }

  if (mode === "paused") {
    return {
      id: "paused-review",
      label: "Paused for review",
      badge: "Paused",
      tone: "warning",
      copy: "Local operator posture is paused. Review the modeled snapshot and the recent proof trail before the next approval.",
      missingSnapshot,
      progressSummary,
      exitEvidence,
      canMarkUnwound: canMarkPolicyUnwound(unwindProgress, exitEvidence),
    };
  }

  if (hasReceipts) {
    return {
      id: "proof-live",
      label: "Proof trail live",
      badge: "Trail live",
      tone: "success",
      copy: missingSnapshot
        ? "Receipts exist for this policy, but Workspace does not yet have a fresh modeled snapshot attached."
        : "Receipts and the latest modeled snapshot are both attached to this live policy family.",
      missingSnapshot,
      progressSummary,
      exitEvidence,
      canMarkUnwound: canMarkPolicyUnwound(unwindProgress, exitEvidence),
    };
  }

  return {
    id: "anchored-awaiting-proof",
    label: "Anchored, awaiting proof",
    badge: "Anchor first",
    tone: "neutral",
    copy: "The policy is on-chain, but no receipt has been minted for this policy family yet.",
    missingSnapshot,
    progressSummary,
    exitEvidence,
    canMarkUnwound: canMarkPolicyUnwound(unwindProgress, exitEvidence),
  };
}
