(function initTideTelemetry() {
  if (window.__tideTelemetryInitialized) {
    return;
  }

  window.__tideTelemetryInitialized = true;

  const config = window.TIDE_CONFIG || {};
  const telemetryConfig = config.telemetry || {};
  const errorConfig = config.errorTracking || {};
  const page = document.body && document.body.dataset ? document.body.dataset.page || "workspace" : "workspace";
  const site = "workspace";
  const sessionKey = "tide.telemetry.session.v1";
  const telemetryPropAllowlist = new Set([
    "action", "preset", "surface", "deliveryMode", "reason", "source",
    "periodDays", "overlayKey", "runwayMonths", "maxLtvBps",
    "stressSurvived", "theme", "status", "ok", "count", "signed",
    "assetId", "railId", "protocol", "outcome", "durationMs", "blocked",
    "stale", "mode", "step", "ledgerVariant", "walletKind", "verdict",
    "hasDraft", "hasRun", "walletConnected", "liveEnabled", "rail",
    "railChanged", "failureClass", "proofVerified", "verifiedAgeMs",
    "fieldCount", "replaced", "active",
    "hadCurrent", "railMode", "primaryRail", "backupRail", "averageHealthScore",
  ]);

  function loadSessionId() {
    try {
      const existing = window.sessionStorage.getItem(sessionKey);

      if (existing) {
        return existing;
      }

      const created = `tf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      window.sessionStorage.setItem(sessionKey, created);
      return created;
    } catch {
      return `tf_${Date.now().toString(36)}`;
    }
  }

  const sessionId = loadSessionId();

  function safePageUrl() {
    const origin = window.location.origin && window.location.origin !== "null"
      ? window.location.origin
      : "";
    return `${origin}${safePath(window.location.pathname)}`;
  }

  function safePath(value) {
    return String(value || "")
      .replace(/\/r\/0x[a-f0-9]{1,64}(?=\/|$)/gi, "/r/[receipt]")
      .replace(/\/receipt\/0x[a-f0-9]{1,64}(?=\/|$)/gi, "/receipt/[object]")
      .replace(/\b0x[a-f0-9]{16,64}\b/gi, "0x[redacted]");
  }

  function safeHref(value) {
    if (!value) {
      return "";
    }

    try {
      const parsed = new URL(value, window.location.origin || "https://example.invalid");
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return `${parsed.origin}${parsed.pathname}`;
      }
      return parsed.protocol.replace(/:$/, "");
    } catch {
      return "";
    }
  }

  function redactSensitiveText(value, maxLength) {
    return String(value || "")
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
      .replace(/\b0x[a-f0-9]{40,64}\b/gi, "0x[redacted]")
      .replace(/\b(?:\$?\d[\d,]*(?:\.\d+)?\s?(?:USD|USDC|BTC|WBTC|XBTC|LBTC)|\$\d[\d,]*(?:\.\d+)?)\b/gi, "[amount]")
      .replace(/https?:\/\/[^\s)"']+/gi, (match) => safeHref(match) || "[url]")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength);
  }

  function sanitizeErrorDetails(details) {
    const source = details && details.source ? safeHref(details.source) : "";
    const line = Number(details && details.line);
    const column = Number(details && details.column);

    return {
      kind: redactSensitiveText(details && details.kind ? details.kind : "error", 80) || "error",
      message: redactSensitiveText(details && details.message ? details.message : "Unknown error", 500) || "Unknown error",
      source,
      line: Number.isFinite(line) && line >= 0 ? line : 0,
      column: Number.isFinite(column) && column >= 0 ? column : 0,
    };
  }

  function sanitizeTelemetryProperties(properties) {
    if (!properties || typeof properties !== "object") {
      return {};
    }

    const sanitized = {};

    Object.entries(properties).forEach(([key, value]) => {
      if (!telemetryPropAllowlist.has(key)) {
        return;
      }

      if (typeof value === "string") {
        sanitized[key] = redactSensitiveText(value, 120);
      } else if (typeof value === "number" && Number.isFinite(value)) {
        sanitized[key] = value;
      } else if (typeof value === "boolean") {
        sanitized[key] = value;
      }
    });

    return sanitized;
  }

  function basePayload() {
    return {
      site,
      page,
      title: redactSensitiveText(document.title, 120),
      path: safePath(window.location.pathname),
      url: safePageUrl(),
      host: window.location.host,
      sessionId,
      at: new Date().toISOString(),
    };
  }

  function appendScript(src, attributes) {
    if (!src || document.querySelector(`script[src="${src}"]`)) {
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.defer = true;

    Object.entries(attributes || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") {
        return;
      }

      script.setAttribute(key, String(value));
    });

    document.head.appendChild(script);
  }

  function sendJson(url, payload) {
    if (!url) {
      return;
    }

    const body = JSON.stringify(payload);

    if (navigator.sendBeacon) {
      try {
        const blob = new Blob([body], { type: "application/json" });
        if (navigator.sendBeacon(url, blob)) {
          return;
        }
      } catch {
        // fall through to fetch
      }
    }

    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
      mode: "cors",
    }).catch(() => {});
  }

  function ensureAnalyticsVendors() {
    if (telemetryConfig.plausibleDomain) {
      appendScript(telemetryConfig.plausibleScriptUrl, {
        "data-domain": telemetryConfig.plausibleDomain,
      });
    }
  }

  function trackPageview(properties) {
    const safeProperties = sanitizeTelemetryProperties(properties || {});
    const payload = {
      ...basePayload(),
      type: "pageview",
      properties: safeProperties,
    };

    if (telemetryConfig.plausibleDomain && typeof window.plausible === "function") {
      try {
        window.plausible("pageview", { u: safePageUrl() });
      } catch {
        // ignore tracker errors
      }
    }

    sendJson(telemetryConfig.beaconUrl, payload);
    return payload;
  }

  function trackEvent(name, properties) {
    const safeProperties = sanitizeTelemetryProperties(properties || {});
    const payload = {
      ...basePayload(),
      type: "event",
      name,
      properties: safeProperties,
    };

    if (telemetryConfig.plausibleDomain && typeof window.plausible === "function") {
      try {
        window.plausible(name, { props: safeProperties });
      } catch {
        // ignore tracker errors
      }
    }

    sendJson(telemetryConfig.beaconUrl, payload);
    return payload;
  }

  function reportError(details) {
    const beaconUrl = errorConfig.beaconUrl || telemetryConfig.errorBeaconUrl || telemetryConfig.beaconUrl;

    if (!beaconUrl) {
      return;
    }

    sendJson(beaconUrl, {
      ...basePayload(),
      type: "error",
      details: sanitizeErrorDetails(details || {}),
    });
  }

  ensureAnalyticsVendors();

  window.tideTrackPageview = trackPageview;
  window.tideTrackEvent = trackEvent;
  window.tideReportError = reportError;

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-track]") : null;

    if (!target) {
      return;
    }

    trackEvent(target.dataset.track, {
      label: target.getAttribute("aria-label") || target.textContent.trim(),
      href: safeHref(target.getAttribute("href") || ""),
      target: target.getAttribute("target") || "",
    });
  });

  window.addEventListener("error", (event) => {
    reportError({
      message: event.message,
      source: event.filename,
      line: event.lineno,
      column: event.colno,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    reportError({
      message: reason && reason.message ? reason.message : String(reason),
      kind: "unhandledrejection",
    });
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      trackPageview();
    }, { once: true });
  } else {
    queueMicrotask(() => {
      trackPageview();
    });
  }
})();
