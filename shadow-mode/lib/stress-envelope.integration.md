# Stress Envelope Integration

Use `buildStressEnvelope` from `shadow-mode/lib/stress-envelope.mjs` for the Setup Chart Workbench slider overlay. It accepts direct fields (`spotPriceUsd`, `periodDays`, `realizedVolPct`, `dailyMovePct`, `weeklyDrawdownPct`, `trendStrengthPct`) and the existing draft aliases (`btcPriceUsd`, `marketRealizedVolPct`, `marketDailyMovePct`, `marketWeeklyDrawdownPct`, `marketTrendStrengthPct`).

Render `bands.mid` as the main stress path and `bands.low`/`bands.high` as the filled envelope. The function is pure: no DOM, app state, time, storage, or network reads. Inputs clamp to 2-365 days, 0-200% vol, 0-40% daily move, 0-85% weekly drawdown, and 0-100% trend strength.

For the existing guardrails chart renderer, `buildStressEnvelopeSeries({ draft, spot, periodDays })` returns the legacy `{ points, band: { low, high }, note, synthesized }` shape with `price` aliases on each point.
