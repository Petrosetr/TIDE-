const TIDE_CONFIG_INPUT = window.TIDE_CONFIG || {};
const TIDE_DEFAULT_OPS_BASE_URL = typeof TIDE_CONFIG_INPUT.apiBaseUrl === "string"
  ? TIDE_CONFIG_INPUT.apiBaseUrl.trim().replace(/\/+$/, "")
  : "";

window.TIDE_CONFIG = {
  ...(window.TIDE_CONFIG || {}),
  siteName: "TIDE",
  landingUrl: (window.TIDE_CONFIG && window.TIDE_CONFIG.landingUrl) || "./",
  workspaceUrl: (window.TIDE_CONFIG && window.TIDE_CONFIG.workspaceUrl) || "./",
  apiBaseUrl: (window.TIDE_CONFIG && window.TIDE_CONFIG.apiBaseUrl) || TIDE_DEFAULT_OPS_BASE_URL,
  telemetry: {
    plausibleDomain:
      (window.TIDE_CONFIG &&
        window.TIDE_CONFIG.telemetry &&
        window.TIDE_CONFIG.telemetry.plausibleDomain) ||
      "",
    plausibleScriptUrl:
      (window.TIDE_CONFIG &&
        window.TIDE_CONFIG.telemetry &&
        window.TIDE_CONFIG.telemetry.plausibleScriptUrl) ||
      "https://plausible.io/js/script.js",
    beaconUrl:
      (window.TIDE_CONFIG &&
        window.TIDE_CONFIG.telemetry &&
        window.TIDE_CONFIG.telemetry.beaconUrl) ||
      (TIDE_DEFAULT_OPS_BASE_URL ? `${TIDE_DEFAULT_OPS_BASE_URL}/v1/track` : ""),
    errorBeaconUrl:
      (window.TIDE_CONFIG &&
        window.TIDE_CONFIG.telemetry &&
        window.TIDE_CONFIG.telemetry.errorBeaconUrl) ||
      (TIDE_DEFAULT_OPS_BASE_URL ? `${TIDE_DEFAULT_OPS_BASE_URL}/v1/error` : ""),
  },
  errorTracking: {
    beaconUrl:
      (window.TIDE_CONFIG &&
        window.TIDE_CONFIG.errorTracking &&
        window.TIDE_CONFIG.errorTracking.beaconUrl) ||
      (TIDE_DEFAULT_OPS_BASE_URL ? `${TIDE_DEFAULT_OPS_BASE_URL}/v1/error` : ""),
  },
  proof: (window.TIDE_CONFIG && window.TIDE_CONFIG.proof) || null,
};
