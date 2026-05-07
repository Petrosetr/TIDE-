(function initTideTelemetry() {
  if (window.__tideTelemetryInitialized) {
    return;
  }

  window.__tideTelemetryInitialized = true;

  const config = window.TIDE_CONFIG || {};
  const telemetryConfig = config.telemetry || {};
  const errorConfig = config.errorTracking || {};
  const page = document.body && document.body.dataset ? document.body.dataset.page || "landing" : "landing";
  const site = page === "landing" ? "landing" : "workspace";
  const sessionKey = "tide.telemetry.session.v1";
  const sensitivePropertyMatchers = [
    /scenario(name|id)/i,
    /draft(name|id)/i,
    /(policy|receipt)(id)?/i,
    /tx(digest)?/i,
    /(wallet|owner|address)/i,
    /(email|company|organization|contact|handle)/i,
    /(message|stack)/i,
    /(href|url)/i,
    /(amount|value|price|debt|buffer|collateral|payout|usd)/i,
    /^(from|to)$/i,
  ];

  function sanitizeUrl(value) {
    try {
      const parsed = new URL(value, window.location.href);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return `${window.location.origin}${window.location.pathname}`;
    }
  }

  function sanitizeString(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) return "";
    if (/^https?:\/\//i.test(trimmed)) {
      return sanitizeUrl(trimmed);
    }
    return trimmed.slice(0, 96);
  }

  function scrubSensitiveText(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) {
      return "";
    }

    return trimmed
      .replace(/https?:\/\/\S+/gi, "[url]")
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
      .replace(/\b0x[a-f0-9]{8,}\b/gi, "[hex]")
      .replace(/\b[A-HJ-NP-Za-km-z1-9]{24,}\b/g, "[id]")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
  }

  function sanitizeErrorSource(value) {
    if (!value) {
      return "";
    }
    try {
      const parsed = new URL(String(value), window.location.href);
      return parsed.origin === window.location.origin
        ? parsed.pathname
        : parsed.origin;
    } catch {
      return scrubSensitiveText(value);
    }
  }

  function sanitizeErrorDetails(details) {
    const safe = {};
    const source = sanitizeErrorSource(details && details.source);
    const kind = sanitizeString(details && details.kind);
    const message = scrubSensitiveText(details && details.message);
    const name = sanitizeString(details && details.name);
    const tag = sanitizeString(details && details.tag);
    const line = Number(details && details.line);
    const column = Number(details && details.column);

    if (kind) safe.kind = kind;
    if (name) safe.name = name;
    if (message) safe.message = message;
    if (source) safe.source = source;
    if (tag) safe.tag = tag;
    if (Number.isFinite(line) && line > 0) safe.line = line;
    if (Number.isFinite(column) && column > 0) safe.column = column;

    const fingerprintParts = [safe.kind || "error", safe.name || "", safe.source || "", safe.line || 0, safe.column || 0];
    safe.fingerprint = fingerprintParts.join(":");
    return safe;
  }

  function isSensitiveKey(key) {
    return sensitivePropertyMatchers.some((matcher) => matcher.test(key));
  }

  function sanitizeProperties(properties) {
    const out = {};

    Object.entries(properties || {}).forEach(([key, value]) => {
      if (!key || isSensitiveKey(key)) {
        return;
      }

      if (typeof value === "boolean") {
        out[key] = value;
        return;
      }

      if (typeof value === "number") {
        if (Number.isFinite(value)) {
          out[key] = value;
        }
        return;
      }

      if (typeof value === "string") {
        const sanitized = sanitizeString(value);
        if (sanitized) {
          out[key] = sanitized;
        }
      }
    });

    return out;
  }

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
  const pageUrl = sanitizeUrl(window.location.href);

  function basePayload() {
    return {
      site,
      page,
      title: scrubSensitiveText(document.title).slice(0, 120),
      path: window.location.pathname,
      url: pageUrl,
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
    }).catch((err) => {
      if (typeof console !== "undefined" && console.debug) {
        console.debug("[tide-telemetry] beacon failed:", err.message || err);
      }
    });
  }

  function ensureAnalyticsVendors() {
    if (telemetryConfig.plausibleDomain) {
      appendScript(telemetryConfig.plausibleScriptUrl, {
        "data-domain": telemetryConfig.plausibleDomain,
      });
    }
  }

  function trackPageview(properties) {
    const safeProperties = sanitizeProperties(properties);
    const payload = {
      ...basePayload(),
      type: "pageview",
      properties: safeProperties,
    };

    if (telemetryConfig.plausibleDomain && typeof window.plausible === "function") {
      try {
        window.plausible("pageview", { u: pageUrl });
      } catch {
        // ignore tracker errors
      }
    }

    sendJson(telemetryConfig.beaconUrl, payload);
    return payload;
  }

  function trackEvent(name, properties) {
    const safeProperties = sanitizeProperties(properties);
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
      details: sanitizeErrorDetails(details),
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

    let destination = "";
    let external = false;
    const rawHref = target.getAttribute("href") || "";
    if (rawHref) {
      try {
        const resolved = new URL(rawHref, window.location.href);
        external = resolved.origin !== window.location.origin;
        destination = external ? resolved.origin : resolved.pathname;
      } catch {
        destination = rawHref.startsWith("#") ? rawHref : "";
      }
    }

    trackEvent(target.dataset.track, {
      label: target.getAttribute("aria-label") || target.textContent.trim(),
      destination,
      external,
      target: target.getAttribute("target") || "",
    });
  });

  window.addEventListener("error", (event) => {
    const eventTarget = event.target instanceof Element ? event.target : null;
    const sourceCandidate =
      (eventTarget && eventTarget.getAttribute && (eventTarget.getAttribute("src") || eventTarget.getAttribute("href"))) ||
      event.filename ||
      "";
    reportError({
      kind: eventTarget ? "resource-error" : "error",
      name: event.error && event.error.name ? event.error.name : "",
      message: event.message,
      source: sourceCandidate,
      line: event.lineno,
      column: event.colno,
      tag: eventTarget ? eventTarget.tagName.toLowerCase() : "",
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    reportError({
      name: reason && reason.name ? reason.name : "",
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
