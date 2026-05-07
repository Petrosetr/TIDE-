const DEFAULT_INPUTS = Object.freeze({
  spotPriceUsd: 82_500,
  periodDays: 30,
  realizedVolPct: 0,
  dailyMovePct: 0,
  weeklyDrawdownPct: 0,
  trendStrengthPct: 50,
});

export const STRESS_ENVELOPE_LIMITS = Object.freeze({
  spotPriceUsd: Object.freeze({ min: 1, max: 10_000_000 }),
  periodDays: Object.freeze({ min: 2, max: 365 }),
  realizedVolPct: Object.freeze({ min: 0, max: 200 }),
  dailyMovePct: Object.freeze({ min: 0, max: 40 }),
  weeklyDrawdownPct: Object.freeze({ min: 0, max: 85 }),
  trendStrengthPct: Object.freeze({ min: 0, max: 100 }),
});

const INPUT_ALIASES = Object.freeze({
  spotPriceUsd: Object.freeze(["spotPriceUsd", "btcPriceUsd"]),
  periodDays: Object.freeze(["periodDays", "days"]),
  realizedVolPct: Object.freeze(["realizedVolPct", "marketRealizedVolPct"]),
  dailyMovePct: Object.freeze(["dailyMovePct", "marketDailyMovePct"]),
  weeklyDrawdownPct: Object.freeze(["weeklyDrawdownPct", "marketWeeklyDrawdownPct"]),
  trendStrengthPct: Object.freeze(["trendStrengthPct", "marketTrendStrengthPct"]),
});

function isBlank(value) {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function readInputNumber(input, keys, fallback) {
  for (const key of keys) {
    if (!Object.hasOwn(input, key) || isBlank(input[key])) continue;
    const parsed = Number(input[key]);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function clampInput(raw, limits) {
  const value = clamp(raw, limits.min, limits.max);
  return {
    value,
    clamped: value !== raw,
  };
}

function roundPct(value) {
  return Math.round(value * 1000) / 10;
}

function buildPoint({ x, day, priceUsd, spotPriceUsd }) {
  const safePrice = Math.max(1, Number(priceUsd) || 1);
  return {
    x,
    day,
    price: safePrice,
    priceUsd: safePrice,
    drawdownPct: Math.max(0, 1 - safePrice / spotPriceUsd),
  };
}

export function normalizeStressEnvelopeInputs(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const raw = {};
  const values = {};
  const clamps = {};

  for (const [field, aliases] of Object.entries(INPUT_ALIASES)) {
    raw[field] = readInputNumber(source, aliases, DEFAULT_INPUTS[field]);
    const normalized = clampInput(raw[field], STRESS_ENVELOPE_LIMITS[field]);
    values[field] = normalized.value;
    clamps[field] = normalized.clamped;
  }

  values.periodDays = Math.round(values.periodDays);
  clamps.periodDays = clamps.periodDays || values.periodDays !== raw.periodDays;

  return { values, clamps };
}

export function buildStressEnvelope(input = {}) {
  const { values, clamps } = normalizeStressEnvelopeInputs(input);
  const {
    spotPriceUsd,
    periodDays,
    realizedVolPct,
    dailyMovePct,
    weeklyDrawdownPct,
    trendStrengthPct,
  } = values;

  const realizedVol = realizedVolPct / 100;
  const dailyMove = dailyMovePct / 100;
  const weeklyDrawdown = weeklyDrawdownPct / 100;
  const trendStrength = trendStrengthPct / 100;

  const stressScore = Math.max(
    weeklyDrawdown,
    dailyMove * Math.sqrt(Math.min(periodDays, 30)),
    realizedVol * Math.sqrt(Math.min(periodDays, 365) / 365) * 0.72,
  );
  const terminalBias = (trendStrength - 0.5) * 0.18;
  const shockPeak = clamp(stressScore + dailyMove * 0.8, 0, 0.82);
  const rebound = clamp(terminalBias - shockPeak * 0.18, -0.24, 0.18);
  const sampleCount = Math.max(16, Math.min(96, periodDays + 1));
  const low = [];
  const mid = [];
  const high = [];

  for (let i = 0; i < sampleCount; i += 1) {
    const x = i / Math.max(1, sampleCount - 1);
    const day = x * periodDays;
    const shockRamp = Math.sin(Math.min(1, x / 0.58) * Math.PI * 0.5);
    const recovery = Math.max(0, (x - 0.58) / 0.42);
    const waveDamping = shockRamp * (1 - recovery * 0.5);
    const wave = (
      Math.sin(x * Math.PI * 2.2) * dailyMove * 0.22
      + Math.sin(x * Math.PI * 5.6 + trendStrength * Math.PI) * dailyMove * 0.12
    ) * waveDamping;
    const drawdown = Math.max(0, shockPeak * shockRamp * (1 - recovery * 0.42) - rebound * x - wave);
    const midPrice = spotPriceUsd * Math.max(0.18, 1 - drawdown);
    const widthPct = Math.min(
      0.36,
      Math.max(0.004, dailyMove * 0.55 + realizedVol * 0.028) * (0.55 + shockRamp * 0.9),
    );
    const bandWidth = spotPriceUsd * widthPct;

    mid.push(buildPoint({ x, day, priceUsd: midPrice, spotPriceUsd }));
    low.push(buildPoint({ x, day, priceUsd: midPrice - bandWidth, spotPriceUsd }));
    high.push(buildPoint({ x, day, priceUsd: midPrice + bandWidth, spotPriceUsd }));
  }

  return {
    inputs: values,
    clamps,
    stress: {
      scorePct: roundPct(stressScore),
      shockPeakPct: roundPct(shockPeak),
      terminalBiasPct: roundPct(terminalBias),
      reboundPct: roundPct(rebound),
    },
    sampleCount,
    bands: { low, mid, high },
    points: mid,
    band: { low, high },
    note: `Your stress · ${periodDays}d slider envelope · ${Math.round(weeklyDrawdownPct)}% weekly drawdown / ${Math.round(realizedVolPct)}% vol`,
  };
}

export function buildStressEnvelopeSeries({ draft = {}, spot, periodDays } = {}) {
  const sourceDraft = draft && typeof draft === "object" ? draft : {};
  const envelope = buildStressEnvelope({
    ...sourceDraft,
    spotPriceUsd: spot ?? sourceDraft.spotPriceUsd ?? sourceDraft.btcPriceUsd,
    periodDays: periodDays ?? sourceDraft.periodDays,
  });

  return {
    points: envelope.bands.mid,
    band: {
      low: envelope.bands.low,
      high: envelope.bands.high,
    },
    bands: envelope.bands,
    note: envelope.note,
    synthesized: false,
    inputs: envelope.inputs,
    clamps: envelope.clamps,
    stress: envelope.stress,
  };
}
