// Market-implied scenarios: turn prediction-market strike ladders into a
// discrete BTC price CDF, then sample quantiles for the shadow simulator.
//
// Input shape (normalized across Kalshi / Polymarket / others):
//   {
//     source: "kalshi" | "polymarket" | string,
//     observedAt: ISO8601,            // when the quotes were snapped
//     horizonAt:  ISO8601,            // when the markets resolve
//     strikes: [                      // sorted or unsorted; we sort.
//       { priceUsd: 80_000, probAbove: 0.74 },
//       { priceUsd: 100_000, probAbove: 0.48 },
//       ...
//     ]
//   }
//
// Each strike's `probAbove` is the market-implied probability that BTC settles
// strictly above `priceUsd` at horizon. We convert that to a CDF(p) = P(X ≤ p)
// = 1 − probAbove, enforce monotonicity, then invert to sample quantiles.

const DEFAULT_QUANTILES = [0.10, 0.25, 0.50, 0.75, 0.90];

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function sortByPrice(strikes) {
  return strikes
    .filter((s) => Number.isFinite(s.priceUsd) && Number.isFinite(s.probAbove))
    .map((s) => ({
      priceUsd: Number(s.priceUsd),
      probAbove: clamp(Number(s.probAbove), 0, 1),
    }))
    .sort((a, b) => a.priceUsd - b.priceUsd);
}

// Build a CDF: array of { priceUsd, cdf } with cdf monotonically non-decreasing
// in price. Enforces the no-arbitrage constraint that P(X ≤ p) must not
// decrease as p grows — when the raw feed violates it (noise / stale quotes),
// we take the running max so a downstream quantile lookup stays coherent.
export function buildCdfFromStrikes(strikes) {
  const sorted = sortByPrice(strikes);
  if (sorted.length === 0) return [];

  const points = sorted.map((s) => ({
    priceUsd: s.priceUsd,
    cdf: clamp(1 - s.probAbove, 0, 1),
  }));

  // Enforce monotonicity: CDF must be non-decreasing in price.
  let running = points[0].cdf;
  for (const point of points) {
    running = Math.max(running, point.cdf);
    point.cdf = running;
  }

  return points;
}

// Invert the CDF via linear interpolation between adjacent strikes to recover
// an estimated price at the given cumulative probability. Flat outside the
// ladder — we don't extrapolate, since the tails are where prediction markets
// are thinnest and most unreliable.
export function quantileFromCdf(cdfPoints, q) {
  if (!Array.isArray(cdfPoints) || cdfPoints.length === 0) return null;
  const target = clamp(q, 0, 1);

  if (target <= cdfPoints[0].cdf) return cdfPoints[0].priceUsd;
  if (target >= cdfPoints[cdfPoints.length - 1].cdf) {
    return cdfPoints[cdfPoints.length - 1].priceUsd;
  }

  for (let i = 0; i < cdfPoints.length - 1; i++) {
    const lo = cdfPoints[i];
    const hi = cdfPoints[i + 1];
    if (target >= lo.cdf && target <= hi.cdf) {
      const span = hi.cdf - lo.cdf;
      if (span <= 0) return lo.priceUsd;
      const frac = (target - lo.cdf) / span;
      return lo.priceUsd + (hi.priceUsd - lo.priceUsd) * frac;
    }
  }
  return cdfPoints[cdfPoints.length - 1].priceUsd;
}

// Turn a quantile's market-implied price into a drawdown-compatible scenario
// for createShadowScenarioInput. The simulator clamps drawdownPct to [0, 0.9]
// — upside quantiles therefore collapse to baseline (drawdown = 0), which is
// the honest representation: "at this quantile the market says no stress".
export function priceToScenario({ id, label, priceUsd, currentPriceUsd, quantile, observedAt, horizonAt, source }) {
  const basis = Number(currentPriceUsd);
  const target = Number(priceUsd);
  if (!Number.isFinite(basis) || basis <= 0 || !Number.isFinite(target)) {
    return null;
  }
  const rawDrawdown = 1 - target / basis;
  const drawdownPct = clamp(rawDrawdown, 0, 0.9);
  return {
    id: id || `market-p${Math.round(quantile * 100)}`,
    label: label || `Market p${Math.round(quantile * 100)} (${formatPrice(target)})`,
    drawdownPct,
    source: "market-implied",
    origin: source,
    quantile,
    impliedPriceUsd: Math.round(target),
    rawDrawdownPct: rawDrawdown,
    observedAt,
    horizonAt,
  };
}

function formatPrice(usd) {
  if (!Number.isFinite(usd)) return "$?";
  if (usd >= 1_000) return `$${Math.round(usd / 1_000)}k`;
  return `$${Math.round(usd)}`;
}

// Derive the full set of quantile scenarios from a market forecast snapshot.
// Caller supplies the current BTC spot — we don't try to re-derive it from the
// forecast, since the ladder's mid may drift off the spot oracle.
export function deriveMarketScenarios({ forecast, currentPriceUsd, quantiles = DEFAULT_QUANTILES }) {
  if (!forecast || !Array.isArray(forecast.strikes)) {
    return { scenarios: [], warnings: ["No forecast strikes available."] };
  }

  const cdf = buildCdfFromStrikes(forecast.strikes);
  if (cdf.length < 2) {
    return {
      scenarios: [],
      warnings: ["Market forecast has fewer than two usable strikes — skipping market-implied scenarios."],
    };
  }

  const warnings = [];
  const scenarios = [];
  for (const q of quantiles) {
    const priceUsd = quantileFromCdf(cdf, q);
    if (!Number.isFinite(priceUsd)) continue;
    const scenario = priceToScenario({
      priceUsd,
      currentPriceUsd,
      quantile: q,
      observedAt: forecast.observedAt,
      horizonAt: forecast.horizonAt,
      source: forecast.source,
    });
    if (scenario) scenarios.push(scenario);
  }

  // Sanity: if all quantiles resolved to prices at or above the current spot,
  // the downside band is empty and stress-testing is vacuous. Flag it so the
  // UI can render "market sees no downside — fall back to hardcoded stress".
  const allUpside = scenarios.every((s) => s.drawdownPct === 0);
  if (allUpside) {
    warnings.push("All market-implied quantiles are at or above current spot; downside band collapsed to baseline.");
  }

  // Thin-ladder guard: if p10 and p90 map to the same extreme strike we're
  // hitting the ladder boundary and interpolation is unreliable in the tails.
  const distinctPrices = new Set(scenarios.map((s) => s.impliedPriceUsd)).size;
  if (distinctPrices < Math.min(3, quantiles.length)) {
    warnings.push("Market ladder too thin — quantiles collapsed; treat band as indicative only.");
  }

  return { scenarios, warnings, cdf, observedAt: forecast.observedAt, horizonAt: forecast.horizonAt, source: forecast.source };
}

// Describe the coverage of the resulting band in a single human-readable line
// for the UI. Returns null if nothing useful to say.
export function describeMarketBand(result) {
  if (!result || !Array.isArray(result.scenarios) || result.scenarios.length === 0) return null;
  const byQuantile = new Map(result.scenarios.map((s) => [s.quantile, s]));
  const p10 = byQuantile.get(0.10);
  const p50 = byQuantile.get(0.50);
  const p90 = byQuantile.get(0.90);
  if (!p10 || !p50 || !p90) return null;
  const obs = result.observedAt ? new Date(result.observedAt).toISOString().slice(0, 10) : "unknown";
  const horizon = result.horizonAt ? new Date(result.horizonAt).toISOString().slice(0, 10) : "unknown";
  return {
    summary: `Market-implied BTC @ ${horizon}: p10 ${formatPrice(p10.impliedPriceUsd)} · p50 ${formatPrice(p50.impliedPriceUsd)} · p90 ${formatPrice(p90.impliedPriceUsd)}`,
    observedAt: obs,
    horizonAt: horizon,
    source: result.source || "market",
  };
}
