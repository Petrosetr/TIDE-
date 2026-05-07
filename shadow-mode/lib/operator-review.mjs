const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeDiv(a, b) {
  return b === 0 ? 0 : a / b;
}

function formatUsd(value) {
  return currencyFormatter.format(Math.round(value));
}

function formatDrawdown(value) {
  if (value === null || value === undefined) {
    return "No trigger";
  }

  if (value <= 0) {
    return "Current";
  }

  return `-${Math.round(value * 100)}%`;
}

export function deriveDraftMetrics(draft = {}) {
  const collateralUsd = asNumber(draft.btcUnits) * asNumber(draft.btcPriceUsd);
  const ltv = safeDiv(asNumber(draft.debtUsd), collateralUsd);
  const runwayMonths = safeDiv(
    asNumber(draft.stableBufferUsd),
    Math.max(1, asNumber(draft.monthlyPayoutTargetUsd)),
  );
  const requiredBufferUsd = Math.max(
    asNumber(draft.minStableBufferUsd),
    asNumber(draft.monthlyPayoutTargetUsd) * Math.max(1, asNumber(draft.desiredRunwayMonths)),
  );

  return {
    collateralUsd,
    ltv,
    runwayMonths,
    requiredBufferUsd,
    bufferGapUsd: Math.max(0, requiredBufferUsd - asNumber(draft.stableBufferUsd)),
  };
}

export function deriveReviewWindowHours(summary = {}) {
  if (summary.worstOperatingState === "StressLockdown" || summary.averageHealthScore < 50) {
    return 6;
  }

  if (summary.averageHealthScore < 70 || summary.bufferCoverageDays < 30) {
    return 12;
  }

  return 24;
}

export function buildOperatorReview(draft, report, previousReview = null) {
  const metrics = deriveDraftMetrics(draft);
  const summary = report.summary;
  const baseline = report.baseline;
  const doneIndex = new Map(
    (previousReview?.items || []).map((item) => [item.id, Boolean(item.done)]),
  );
  const reviewWindowHours = previousReview?.reviewWindowHours || deriveReviewWindowHours(summary);
  const backupLabel = summary.backupRailName ? ` with ${summary.backupRailName} as backup` : "";

  const items = [
    {
      id: "route-check",
      critical: true,
      title: "Review route selection",
      copy: `Confirm ${summary.primaryRailName || "the primary rail"}${backupLabel} is acceptable for the next operating window.`,
    },
    {
      id: "buffer-check",
      critical: metrics.bufferGapUsd > 0 || summary.bufferCoverageDays < 30,
      title: metrics.bufferGapUsd > 0 ? "Top up stable buffer" : "Confirm payout floor",
      copy: metrics.bufferGapUsd > 0
        ? `Fund ${formatUsd(metrics.bufferGapUsd)} to restore the requested stable runway.`
        : `Worst-case payout floor is ${formatUsd(summary.survivablePayoutBandLowUsd)} with ${summary.bufferCoverageDays} days of buffer coverage.`,
    },
    {
      id: "alert-check",
      critical: true,
      title: "Set breakwater alert",
      copy: `Prepare an operator review at ${formatDrawdown(summary.breakwaterTriggerDrawdownPct)} BTC drawdown before the planner escalates beyond ${baseline.operatingState}.`,
    },
    {
      id: "action-check",
      critical: baseline.result.decision.chosen.type !== "Hold",
      title: "Validate current action",
      copy: baseline.result.decision.chosen.explanation,
    },
  ].map((item) => ({
    ...item,
    done: doneIndex.get(item.id) ?? false,
  }));

  return {
    owner: previousReview?.owner || "",
    note: previousReview?.note || "",
    reviewWindowHours,
    items,
  };
}

export function getOperatorReviewProgress(review) {
  if (!review || !review.items?.length) {
    return {
      total: 0,
      completed: 0,
      criticalTotal: 0,
      criticalCompleted: 0,
    };
  }

  const criticalItems = review.items.filter((item) => item.critical);

  return {
    total: review.items.length,
    completed: review.items.filter((item) => item.done).length,
    criticalTotal: criticalItems.length,
    criticalCompleted: criticalItems.filter((item) => item.done).length,
  };
}

export function getOperatorReviewStatus(review, report) {
  const progress = getOperatorReviewProgress(review);

  if (progress.criticalCompleted === progress.criticalTotal && progress.criticalTotal > 0) {
    return {
      label: "Ready",
      tone: "good",
      copy: `All critical checks are complete. Review again in ${review.reviewWindowHours}h.`,
    };
  }

  if (report.summary.averageHealthScore < 50 || report.summary.worstOperatingState === "StressLockdown") {
    return {
      label: "Attention",
      tone: "warn",
      copy: "Health is compressed. Critical checks should be cleared before capital changes.",
    };
  }

  return {
    label: "In review",
    tone: "neutral",
    copy: `${progress.criticalTotal - progress.criticalCompleted} critical checks still need operator sign-off.`,
  };
}
