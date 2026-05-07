function normalizeBaseUrl(value) {
  return typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
}

function tryResolveOrigin(candidate, origin = "") {
  if (typeof candidate !== "string" || !candidate.trim()) {
    return "";
  }

  try {
    return new URL(candidate, origin || "https://example.invalid").origin;
  } catch {
    return "";
  }
}

function tryResolveHostname(candidate, origin = "") {
  if (typeof candidate !== "string" || !candidate.trim()) {
    return "";
  }

  try {
    return new URL(candidate, origin || "https://example.invalid").hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function allowsUnsignedForecast(config = {}, origin = "") {
  if (config?.liveRailPack?.allowUnsignedForecast === true) {
    return true;
  }

  const hostname = tryResolveHostname(origin, origin);
  if (!hostname) {
    return false;
  }

  return hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost");
}

export function resolveOpsBaseUrl(config = {}, origin = "") {
  const explicit = normalizeBaseUrl(config?.apiBaseUrl);
  if (explicit) {
    return explicit;
  }

  const candidates = [
    config?.telemetry?.beaconUrl,
    config?.errorTracking?.beaconUrl,
  ];

  for (const candidate of candidates) {
    const resolved = tryResolveOrigin(candidate, origin);
    if (resolved) {
      return resolved;
    }
  }

  // Fall back to the page origin: the ops backend is now served on the same
  // host behind nginx (/v1/*), so no external base URL is needed in that mode.
  return normalizeBaseUrl(origin);
}
