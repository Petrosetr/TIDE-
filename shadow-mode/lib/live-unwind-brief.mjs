import { getRailDisplay } from "./policy-ids.mjs";
import { getLiveRailLinks } from "./live-rail-links.mjs";
import { buildLiveExitEvidence } from "./live-exit-semantics.mjs";

function normalizeText(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function safeDiv(a, b) {
  return b > 0 ? a / b : 0;
}

function compactCurrency(value) {
  return Math.round(asNumber(value));
}

export function buildLiveUnwindBrief({
  policy = null,
  snapshot = null,
  receipts = [],
  txHistory = [],
  controlState = null,
  unwindProgress = null,
  exitEvidence = null,
} = {}) {
  const draft = snapshot?.draft || {};
  const report = snapshot?.report || {};
  const summary = report?.summary || {};
  const collateralUnits = asNumber(draft?.btcUnits);
  const collateralPriceUsd = asNumber(draft?.btcPriceUsd);
  const collateralUsd = collateralUnits * collateralPriceUsd;
  const debtUsd = asNumber(draft?.debtUsd);
  const bufferUsd = asNumber(draft?.stableBufferUsd);
  const payoutTargetUsd = asNumber(draft?.monthlyPayoutTargetUsd || policy?.payoutTargetUsd);
  const runwayMonths = Math.max(1, Math.round(asNumber(draft?.desiredRunwayMonths) || 0));
  const currentLtv = asNumber(summary?.currentLtv) || safeDiv(debtUsd, collateralUsd);
  const receiptList = Array.isArray(receipts) ? receipts : [];
  const walletTxList = Array.isArray(txHistory) ? txHistory : [];
  const lastReceipt = receiptList[0] || null;
  const lastWalletTx = walletTxList[0] || null;
  const railId = normalizeText(policy?.selectedRail || draft?.selectedRail);
  const railLabel = getRailDisplay(railId) || railId || "Underlying rail";
  const railLinks = getLiveRailLinks(railId);
  const controlMode = normalizeText(controlState?.mode, "active");
  const completedSteps = unwindProgress?.completed && typeof unwindProgress.completed === "object"
    ? unwindProgress.completed
    : {};
  const resolvedExitEvidence = exitEvidence || buildLiveExitEvidence({
    receipts,
    controlState,
    unwindProgress,
  });

  const warnings = [
    "Amounts below come from the latest modeled snapshot, not a live protocol balance read-back.",
    "Use the underlying rail UI and wallet balances as source of truth before signing or closing anything.",
    resolvedExitEvidence.copy,
  ];

  const steps = [
    {
      id: "pause",
      title: "Pause the next approval",
      copy: controlMode === "paused"
        ? "This policy family is already marked paused locally. Keep the next approval on hold."
        : "Mark the policy paused in Workspace if you want the operator log to reflect that no new live step should be approved.",
    },
    {
      id: "review",
      title: `Review the ${railLabel} position`,
      copy: debtUsd > 0
        ? `Confirm the live debt and collateral balances on ${railLabel} before repaying. The latest modeled snapshot expects about $${compactCurrency(debtUsd)} debt against roughly $${compactCurrency(collateralUsd)} collateral.`
        : `Confirm the live collateral and any residual debt on ${railLabel} before withdrawing or closing.`,
    },
    {
      id: "repay-withdraw",
      title: debtUsd > 0 ? "Repay debt, then withdraw collateral" : "Withdraw collateral and clear any residual balances",
      copy: debtUsd > 0
        ? `Repay the live stable debt on ${railLabel}, then withdraw the BTC wrapper back to the wallet. Treat $${compactCurrency(bufferUsd)} stable buffer and ${collateralUnits.toFixed(4)} BTC as modeled guidance, not exact protocol balances.`
        : `Withdraw the remaining collateral from ${railLabel}. Keep a note of anything that stays on the rail so the final receipt explains the residual posture.`,
    },
    {
      id: "final-proof",
      title: "Mint the final receipt",
      copy: "Return to Setup after the unwind is complete, refresh the scenario if needed, and mint a final receipt so Workspace captures the exit cleanly.",
    },
  ];

  return {
    policyId: normalizeText(policy?.id),
    policyName: normalizeText(policy?.name, "Untitled policy"),
    railId,
    railLabel,
    railLinks,
    controlMode,
    unwindProgress: {
      completed: completedSteps,
      updatedAt: normalizeTimestamp(unwindProgress?.updatedAt),
    },
    receiptCount: receiptList.length,
    walletTxCount: walletTxList.length,
    latestReceiptAt: normalizeTimestamp(lastReceipt?.createdAtMs),
    latestWalletTxAt: normalizeTimestamp(lastWalletTx?.timestamp),
    exitEvidence: resolvedExitEvidence,
    modeledSnapshot: {
      capturedAt: snapshot?.moment || 0,
      collateralSymbol: normalizeText(policy?.collateralSymbol || draft?.collateralAssetSymbol, "BTC"),
      collateralUnits,
      collateralUsd,
      debtUsd,
      bufferUsd,
      payoutTargetUsd,
      runwayMonths,
      currentLtv,
    },
    warnings,
    steps,
  };
}

export function renderLiveUnwindMarkdown(brief = {}) {
  const lines = [
    `# ${normalizeText(brief.policyName, "Untitled policy")} — manual unwind brief`,
    "",
    `- Policy ID: ${normalizeText(brief.policyId, "unknown")}`,
    `- Rail: ${normalizeText(brief.railLabel, "Underlying rail")} (${normalizeText(brief.railId, "unknown")})`,
    `- Control posture: ${normalizeText(brief.controlMode, "active")}`,
    `- Unwind checklist updated: ${Number(brief.unwindProgress?.updatedAt || 0) > 0 ? new Date(Number(brief.unwindProgress.updatedAt)).toISOString() : "not yet"}`,
    `- Latest receipt count: ${Number(brief.receiptCount) || 0}`,
    `- Wallet tx count: ${Number(brief.walletTxCount) || 0}`,
    `- Exit evidence: ${normalizeText(brief.exitEvidence?.label, "Checklist open")}`,
    "",
    "## Modeled snapshot",
    "",
    `- Collateral: ${Number(brief.modeledSnapshot?.collateralUnits || 0).toFixed(4)} ${normalizeText(brief.modeledSnapshot?.collateralSymbol, "BTC")}`,
    `- Collateral USD: $${Math.round(Number(brief.modeledSnapshot?.collateralUsd || 0))}`,
    `- Debt USD: $${Math.round(Number(brief.modeledSnapshot?.debtUsd || 0))}`,
    `- Stable buffer USD: $${Math.round(Number(brief.modeledSnapshot?.bufferUsd || 0))}`,
    `- Target payout USD/month: $${Math.round(Number(brief.modeledSnapshot?.payoutTargetUsd || 0))}`,
    `- Runway intent: ${Math.max(1, Math.round(Number(brief.modeledSnapshot?.runwayMonths || 0)))} months`,
    `- Modeled LTV: ${(Number(brief.modeledSnapshot?.currentLtv || 0) * 100).toFixed(1)}%`,
    "",
    "## Warnings",
    "",
    ...(Array.isArray(brief.warnings) ? brief.warnings.map((warning) => `- ${normalizeText(warning)}`) : []),
    "",
    "## Exit steps",
    "",
    ...(Array.isArray(brief.steps) ? brief.steps.map((step, index) => `${index + 1}. ${normalizeText(step?.title)} — ${normalizeText(step?.copy)}`) : []),
  ];

  if (brief.exitEvidence?.copy) {
    lines.push("", "## Exit evidence", "", `- ${normalizeText(brief.exitEvidence.copy)}`);
  }

  if (brief.unwindProgress?.completed && Object.keys(brief.unwindProgress.completed).length) {
    lines.push("", "## Checklist progress", "");
    for (const step of brief.steps || []) {
      const done = Number(brief.unwindProgress.completed[step.id] || 0) > 0;
      lines.push(`- [${done ? "x" : " "}] ${normalizeText(step?.title)}`);
    }
  }

  if (brief.railLinks?.siteUrl || brief.railLinks?.docsUrl) {
    lines.push("", "## Rail links", "");
    if (brief.railLinks.siteUrl) {
      lines.push(`- ${normalizeText(brief.railLinks.siteLabel, "Open protocol")}: ${brief.railLinks.siteUrl}`);
    }
    if (brief.railLinks.docsUrl) {
      lines.push(`- ${normalizeText(brief.railLinks.docsLabel, "Protocol docs")}: ${brief.railLinks.docsUrl}`);
    }
  }

  return lines.join("\n").trim();
}
