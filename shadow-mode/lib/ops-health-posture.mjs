function boolLabel(value) {
  if (value === true) return "Ready";
  if (value === false) return "Missing";
  return "Unknown";
}

function normalizeStatus(value) {
  const status = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ["idle", "loading", "loaded", "error"].includes(status) ? status : "idle";
}

export function buildOpsHealthPosture(state = {}) {
  const status = normalizeStatus(state.status);
  const payload = state.payload && typeof state.payload === "object" ? state.payload : null;
  const checks = payload?.checks && typeof payload.checks === "object" ? payload.checks : {};
  const packSigner = checks.packSigner;
  const livePack = checks.livePack;
  const livePackSigned = checks.livePackSigned;
  const uploadToken = checks.uploadToken;
  const sessionSecret = checks.sessionSecret;
  const marketForecastCache = checks.marketForecastCache;
  const marketForecastFresh = checks.marketForecastFresh;
  const marketForecastSigned = checks.marketForecastSigned;
  const healthy = status === "loaded" && payload?.ready === true;
  const degraded = status === "loaded" && !healthy;
  const error = typeof state.error === "string" ? state.error.trim() : "";
  const fetchedAt = Number(state.fetchedAt) || 0;

  let badge = "Ops not checked";
  let copy = "The browser has not checked the same-origin ops health endpoint yet.";
  let tone = "neutral";

  if (status === "loading") {
    badge = "Checking ops";
    copy = "Checking the same-origin ops health endpoint.";
  } else if (healthy) {
    badge = "Signed ops healthy";
    copy = "The ops backend reports the signed rail pack, signer, forecast cache, and readiness gates as healthy.";
    tone = "success";
  } else if (degraded) {
    badge = "Ops degraded";
    copy = "The ops backend responded, but one or more signed trust-path checks are not healthy.";
    tone = "warn";
  } else if (status === "error") {
    badge = "Ops unavailable";
    copy = error || "The browser could not read the ops health endpoint.";
    tone = "danger";
  }

  const lastChecked = fetchedAt > 0 ? new Date(fetchedAt).toISOString() : "";

  return {
    badge,
    status,
    tone,
    copy,
    healthy,
    facts: [
      {
        label: "Ops health",
        value: badge,
        copy,
        tone,
      },
      {
        label: "Pack signer",
        value: boolLabel(packSigner),
        copy: packSigner === true
          ? "Backend can sign live rail-pack payloads."
          : packSigner === false
            ? "Backend reports no active rail-pack signer."
            : "Signer state has not been read from /v1/healthz yet.",
        tone: packSigner === true ? "success" : packSigner === false ? "warn" : "neutral",
      },
      {
        label: "Live pack endpoint",
        value: livePack === true && livePackSigned === true ? "Ready" : boolLabel(livePack),
        copy: livePack === true && livePackSigned === true
          ? "Backend can serve a signed hosted live rail pack."
          : livePack === true
            ? "Backend has a live rail pack, but it is not signed."
            : livePack === false
              ? "Backend reports the live rail-pack route is not healthy."
              : "Live pack state has not been read from /v1/readyz yet.",
        tone: livePack === true && livePackSigned === true ? "success" : livePack === false || livePackSigned === false ? "warn" : "neutral",
      },
      {
        label: "Readiness gates",
        value: healthy ? "Ready" : "Incomplete",
        copy: [
          `Upload token ${boolLabel(uploadToken).toLowerCase()}`,
          `session secret ${boolLabel(sessionSecret).toLowerCase()}`,
          `forecast cache ${boolLabel(marketForecastCache).toLowerCase()}`,
          `forecast fresh ${boolLabel(marketForecastFresh).toLowerCase()}`,
          `forecast signed ${boolLabel(marketForecastSigned).toLowerCase()}`,
        ].join(" · "),
        tone: healthy ? "success" : status === "loaded" ? "warn" : "neutral",
      },
      {
        label: "Last ops check",
        value: lastChecked || "Not checked",
        copy: fetchedAt > 0 ? "Browser-side readiness read-back time." : "Use refresh to read /v1/readyz.",
        tone: fetchedAt > 0 ? "neutral" : "warn",
      },
    ],
  };
}
