#!/usr/bin/env node
// Smoke-verify that a deployed URL serves the documented security headers.
//
// Usage:
//   node scripts/verify-security-headers.mjs https://dev.tidesui.pro
//   node scripts/verify-security-headers.mjs https://testnet.tidesui.pro
//   node scripts/verify-security-headers.mjs https://tidesui.pro
//
// What it checks:
//   - Each header listed in JSON_API_HEADER_EXPECTATIONS is present in the
//     HTTP response and its value passes the documented `check` predicate.
//   - For known TIDE app hosts, the HTTP CSP `connect-src` includes the Sui
//     primary RPC and PublicNode fallback expected for that environment.
//   - For HTML bodies that ship a meta CSP, that meta `connect-src` also
//     includes the fallback RPC.
//   - For /v1/healthz and /v1/readyz, the JSON response still matches the
//     current signed-ops status/readiness shape.
//
// Exit status:
//   0 — every expectation passes
//   1 — one or more expectations failed (printed with the actual value)
//   2 — usage / network error before any header check ran
//
// Non-goals:
//   - Does not verify the inline `script-src 'sha256-...'` hash; the hash is
//     updated when the inline script changes.

import process from "node:process";
import { pathToFileURL } from "node:url";

const JSON_API_HEADER_EXPECTATIONS = [
  {
    name: "strict-transport-security",
    check: (value) => {
      const match = /max-age=(\d+)/.exec(value || "");
      return (match ? Number(match[1]) : 0) >= 31_536_000;
    },
    description: "HSTS max-age >= 1 year",
  },
  {
    name: "x-content-type-options",
    check: (value) => /\bnosniff\b/i.test(value || ""),
    description: "X-Content-Type-Options: nosniff",
  },
  {
    name: "referrer-policy",
    check: (value) => /strict-origin-when-cross-origin|no-referrer/i.test(value || ""),
    description: "Referrer-Policy: strict-origin-when-cross-origin (or stricter)",
  },
  {
    name: "permissions-policy",
    check: (value) => /geolocation=\(\)/i.test(value || ""),
    description: "Permissions-Policy: deny camera/mic/geolocation/payment",
  },
  {
    name: "content-security-policy",
    check: (value) => /frame-ancestors\s+'none'/i.test(value || ""),
    description: "CSP: frame-ancestors 'none' (clickjacking guard)",
  },
];

const CSP_CONNECT_SRC_BY_ENV = {
  mainnet: [
    "https://fullnode.mainnet.sui.io",
    "https://sui-rpc.publicnode.com",
  ],
  testnet: [
    "https://fullnode.testnet.sui.io",
    "https://sui-testnet-rpc.publicnode.com",
  ],
  receipt: [
    "https://fullnode.testnet.sui.io",
    "https://sui-testnet-rpc.publicnode.com",
    "https://aggregator.walrus-testnet.walrus.space",
  ],
};

const CSP_FORBIDDEN_CONNECT_SRC_BY_ENV = {
  mainnet: CSP_CONNECT_SRC_BY_ENV.testnet,
  testnet: CSP_CONNECT_SRC_BY_ENV.mainnet,
};

async function fetchHeaders(targetUrl) {
  const response = await fetch(targetUrl, {
    method: "GET",
    redirect: "manual",
    headers: { accept: "*/*", "user-agent": "tide-security-header-verifier/1" },
  });
  const body = await response.text();
  return { status: response.status, headers: response.headers, body };
}

function readHeader(headers, name) {
  if (typeof headers?.get === "function") {
    return headers.get(name);
  }
  return headers?.[name] ?? headers?.[name.toLowerCase()] ?? null;
}

function expectedCspConnectHosts(targetUrl) {
  let url;
  try {
    url = new URL(targetUrl);
  } catch {
    return null;
  }
  if (url.pathname.startsWith("/v1/") || url.pathname.startsWith("/api/")) {
    return null;
  }
  if (url.pathname === "/r" || url.pathname === "/r/" || url.pathname.startsWith("/r/")) {
    return { env: "receipt", hosts: CSP_CONNECT_SRC_BY_ENV.receipt };
  }
  const host = url.hostname.toLowerCase();
  if (host === "testnet.tidesui.pro" || host.endsWith(".testnet.tidesui.pro")) {
    return { env: "testnet", hosts: CSP_CONNECT_SRC_BY_ENV.testnet };
  }
  if (
    host === "tidesui.pro" ||
    host === "www.tidesui.pro" ||
    host === "app.tidesui.pro" ||
    host === "dev.tidesui.pro"
  ) {
    return { env: "mainnet", hosts: CSP_CONNECT_SRC_BY_ENV.mainnet };
  }
  return null;
}

function extractDirective(policy, directive) {
  const re = new RegExp(`(?:^|;)\\s*${directive}\\s+([^;]+)`, "i");
  return policy?.match(re)?.[1] || "";
}

function extractMetaCsp(body) {
  const html = String(body || "");
  const match = html.match(
    /<meta\b(?=[^>]*\bhttp-equiv=(["'])Content-Security-Policy\1)(?=[^>]*\bcontent=(["'])([\s\S]*?)\2)[^>]*>/i,
  );
  return match?.[3] || "";
}

function buildConnectSrcResults(targetUrl, headerCsp, body) {
  const expected = expectedCspConnectHosts(targetUrl);
  if (!expected) return [];

  const headerConnectSrc = extractDirective(headerCsp, "connect-src");
  const missingHeaderHosts = expected.hosts.filter((host) => !headerConnectSrc.includes(host));
  const forbiddenHosts = CSP_FORBIDDEN_CONNECT_SRC_BY_ENV[expected.env] || [];
  const unexpectedHeaderHosts = forbiddenHosts.filter((host) => headerConnectSrc.includes(host));
  const results = [{
    name: "content-security-policy/connect-src",
    description: `CSP connect-src includes ${expected.env} Sui RPC primary + PublicNode fallback`,
    actual: headerConnectSrc || headerCsp || null,
    ok: missingHeaderHosts.length === 0 && unexpectedHeaderHosts.length === 0,
  }];

  const metaCsp = extractMetaCsp(body);
  if (metaCsp) {
    const metaConnectSrc = extractDirective(metaCsp, "connect-src");
    const missingMetaHosts = expected.hosts.filter((host) => !metaConnectSrc.includes(host));
    results.push({
      name: "meta-content-security-policy/connect-src",
      description: `Meta CSP connect-src includes ${expected.env} Sui RPC primary + PublicNode fallback`,
      actual: metaConnectSrc || metaCsp || null,
      ok: missingMetaHosts.length === 0,
    });
  }

  return results;
}

function buildApiShapeResults(targetUrl, body) {
  let url;
  try {
    url = new URL(targetUrl);
  } catch {
    return [];
  }
  const readiness = url.pathname === "/v1/readyz";
  if (!readiness && url.pathname !== "/v1/healthz") {
    return [];
  }

  let payload = null;
  try {
    payload = JSON.parse(body || "");
  } catch {
    return [{
      name: "api-shape",
      description: "Ops API status endpoint returns parseable signed-ops JSON shape",
      actual: body || null,
      ok: false,
    }];
  }

  const expectedMode = readiness ? "signed-ops-readiness" : "signed-ops-status";
  const ok = (
    payload &&
    payload.service === "tide-ops" &&
    payload.mode === expectedMode &&
    typeof payload.ok === "boolean" &&
    payload.readinessPath === "/v1/readyz" &&
    payload.checks &&
    typeof payload.checks === "object" &&
    payload.routes?.liveRailPack?.path === "/v1/live-rail-pack" &&
    payload.routes?.marketForecast?.path === "/v1/market-forecast" &&
    (!readiness || typeof payload.ready === "boolean")
  );

  return [{
    name: "api-shape",
    description: "Ops API status endpoint returns current signed-ops JSON shape",
    actual: JSON.stringify({
      service: payload?.service,
      mode: payload?.mode,
      readinessPath: payload?.readinessPath,
      hasChecks: Boolean(payload?.checks),
      liveRailPackPath: payload?.routes?.liveRailPack?.path,
      marketForecastPath: payload?.routes?.marketForecast?.path,
    }),
    ok,
  }];
}

export async function verifyUrl(targetUrl, fetcher = fetchHeaders) {
  const { status, headers, body = "" } = await fetcher(targetUrl);
  const results = [];
  for (const expectation of JSON_API_HEADER_EXPECTATIONS) {
    const actual = readHeader(headers, expectation.name);
    const ok = expectation.check(actual);
    results.push({
      name: expectation.name,
      description: expectation.description,
      actual: actual ?? null,
      ok,
    });
  }
  const headerCsp = readHeader(headers, "content-security-policy") || "";
  results.push(...buildConnectSrcResults(targetUrl, headerCsp, body));
  results.push(...buildApiShapeResults(targetUrl, body));
  return { url: targetUrl, status, results, ok: results.every((r) => r.ok) };
}

function formatReport(report) {
  const lines = [];
  lines.push(`URL:    ${report.url}`);
  lines.push(`Status: ${report.status}`);
  lines.push("Headers:");
  for (const result of report.results) {
    const mark = result.ok ? "ok" : "FAIL";
    const value = result.actual === null ? "(missing)" : result.actual;
    lines.push(`  [${mark}] ${result.name} — ${result.description}`);
    lines.push(`        actual: ${value}`);
  }
  lines.push(report.ok ? "PASS" : "FAIL");
  return lines.join("\n");
}

async function runCli(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || argv[0] === "--help" || argv[0] === "-h") {
    console.error("Usage: node scripts/verify-security-headers.mjs <https-url>");
    process.exit(2);
    return;
  }
  const target = argv[0];
  try {
    const url = new URL(target);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      console.error(`Refusing to verify non-HTTP target: ${target}`);
      process.exit(2);
      return;
    }
  } catch (err) {
    console.error(`Invalid URL: ${target} (${err?.message || err})`);
    process.exit(2);
    return;
  }

  let report;
  try {
    report = await verifyUrl(target);
  } catch (err) {
    console.error(`fetch failed: ${err?.message || err}`);
    process.exit(2);
    return;
  }
  console.log(formatReport(report));
  process.exit(report.ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runCli();
}
