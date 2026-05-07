// Thin client for the ops worker's /v1/market-forecast endpoint. Resilient
// by design: any network or parsing failure returns null, never throws, so
// the simulator can fall back to the hardcoded stress scenarios without the
// UI having to special-case "forecast missing".

import { allowsUnsignedForecast, resolveOpsBaseUrl } from "./runtime-config.mjs";
import { verifyPackResponse } from "./pack-signature.mjs";

const FORECAST_PATH = "/v1/market-forecast";
const KALSHI_FORECAST_PATH = "/v1/market-forecast/kalshi";

async function fetchForecastFromPath(config, path, { signal } = {}) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const base = resolveOpsBaseUrl(config, origin);
  if (!base) return null;

  const verifyKeyB64 =
    typeof config?.liveRailPack?.verifyKey === "string"
      ? config.liveRailPack.verifyKey.trim()
      : "";
  const unsignedAllowed = allowsUnsignedForecast(config, origin);

  if (!verifyKeyB64 && !unsignedAllowed) {
    return null;
  }

  try {
    const response = await fetch(`${base}${path}`, {
      method: "GET",
      headers: { accept: "application/json" },
      signal,
    });
    if (!response.ok) return null;
    const bodyText = await response.text();

    // Integrity check: if a verify key is configured, the forecast
    // response must be signed. The forecast drives stress scenarios and
    // the Create page's worst-case slider — a spoofed payload biases
    // user-visible risk numbers, so reject unsigned/invalid payloads.
    if (verifyKeyB64) {
      const sigHeader = response.headers.get("x-tide-signature") || "";
      const verdict = await verifyPackResponse({
        bodyText,
        signatureB64: sigHeader,
        verifyKeyB64,
      });
      if (verdict.verified !== true) return null;
    }

    const payload = JSON.parse(bodyText);
    if (!payload || !payload.forecast) return null;
    return {
      forecast: payload.forecast,
      stale: Boolean(payload.stale),
    };
  } catch {
    return null;
  }
}

export function fetchMarketForecast(config, opts = {}) {
  return fetchForecastFromPath(config, FORECAST_PATH, opts);
}

export function fetchKalshiForecast(config, opts = {}) {
  return fetchForecastFromPath(config, KALSHI_FORECAST_PATH, opts);
}
