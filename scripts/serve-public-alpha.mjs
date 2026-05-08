import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const rootDir = resolve(currentDir, "..");
const appDir = resolve(rootDir, process.env.PUBLIC_ALPHA_ROOT || "dist/public-alpha/app");
const port = Number(process.env.PORT || process.argv[2] || 4173);
const host = process.env.HOST || "127.0.0.1";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

function empty(res, statusCode = 204) {
  res.writeHead(statusCode, {
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  });
  res.end();
}

function forecastPayload(source) {
  const now = Date.now();
  const horizonDays = source === "kalshi" ? 3 : 365;
  const horizonAt = new Date(now + horizonDays * 24 * 60 * 60 * 1000).toISOString();
  return {
    ok: true,
    stale: false,
    forecast: {
      source,
      observedAt: new Date(now).toISOString(),
      horizonAt,
      spotPriceUsd: 79035,
      strikes: source === "kalshi"
        ? [
          { priceUsd: 76000, probAbove: 0.72 },
          { priceUsd: 80000, probAbove: 0.46 },
          { priceUsd: 84000, probAbove: 0.22 },
        ]
        : [
          { priceUsd: 65000, probAbove: 0.88 },
          { priceUsd: 75000, probAbove: 0.68 },
          { priceUsd: 85000, probAbove: 0.42 },
          { priceUsd: 100000, probAbove: 0.24 },
        ],
      diagnostics: {
        origin: "playwright-public-alpha-server",
        note: "Deterministic local fixture for browser smoke tests.",
        strikeCount: source === "kalshi" ? 3 : 4,
      },
    },
  };
}

function resolveRequestPath(urlPath) {
  const pathname = decodeURIComponent((urlPath || "/").split("?")[0]);
  const normalizedPath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  let targetPath = resolve(appDir, `.${normalizedPath}`);

  if (!targetPath.startsWith(appDir)) return null;

  if (existsSync(targetPath) && statSync(targetPath).isDirectory()) {
    targetPath = join(targetPath, "index.html");
  }

  if (!existsSync(targetPath) && extname(targetPath) === "") {
    const htmlPath = `${targetPath}.html`;
    if (existsSync(htmlPath)) targetPath = htmlPath;
  }

  if (!existsSync(targetPath) && pathname === "/") {
    targetPath = join(appDir, "index.html");
  }

  if (
    !existsSync(targetPath)
    && (pathname === "/r" || pathname === "/r/" || (pathname.startsWith("/r/") && extname(pathname) === ""))
  ) {
    targetPath = join(appDir, "r", "index.html");
  }

  return targetPath;
}

const server = createServer((req, res) => {
  const pathname = decodeURIComponent((req.url || "/").split("?")[0]);

  if (req.method === "OPTIONS" && pathname.startsWith("/v1/")) {
    empty(res);
    return;
  }

  if (req.method === "GET" && (pathname === "/healthz" || pathname === "/v1/healthz")) {
    json(res, 200, { ok: true, service: "public-alpha-playwright", appDir });
    return;
  }

  if (req.method === "GET" && pathname === "/v1/market-forecast") {
    json(res, 200, forecastPayload("polymarket"));
    return;
  }

  if (req.method === "GET" && pathname === "/v1/market-forecast/kalshi") {
    json(res, 200, forecastPayload("kalshi"));
    return;
  }

  if (req.method === "GET" && pathname === "/v1/live-rail-pack") {
    const packPath = join(appDir, "live-rail-pack.json");
    if (existsSync(packPath)) {
      res.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(readFileSync(packPath));
      return;
    }
    json(res, 404, { ok: false, error: "missing_live_rail_pack" });
    return;
  }

  if (req.method === "POST" && ["/v1/track", "/v1/error"].includes(pathname)) {
    empty(res, 204);
    return;
  }

  const targetPath = resolveRequestPath(req.url || "/");
  if (!targetPath || !existsSync(targetPath)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  try {
    const contentType = MIME_TYPES[extname(targetPath)] || "application/octet-stream";
    res.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": contentType,
    });
    res.end(readFileSync(targetPath));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown read error";
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(message);
  }
});

server.listen(port, host, () => {
  console.log(`TIDE public alpha: http://${host}:${port}`);
  console.log(`  root: ${appDir}`);
});
