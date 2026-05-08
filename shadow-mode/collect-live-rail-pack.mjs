#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { BucketClient } from "bucket-protocol-sdk";
import { ScallopIndexer } from "@scallop-io/sui-scallop-sdk";

const execFileAsync = promisify(execFile);
const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_PATH = resolve(
  process.cwd(),
  "shadow-mode/examples/live-rail-pack.generated.json"
);

// USDB (Bucket Protocol stablecoin) uses 6 decimals on Sui mainnet.
// Verified via: sui client object 0xfa7ac3951fdca12c007a....::usdb::USDB → decimals: 6
const USDB_DECIMALS = 6;
const WAD = 1e18;
const SUI_FULLNODE_URL = "https://fullnode.mainnet.sui.io:443";
const SUILEND_MAIN_MARKET_ID =
  "0x84030d26d85eaa7035084a057f2f11f701b7e2e4eda87551becbc7c97505ece1";
const ALPHALEND_RUNTIME_DIR = resolve(CURRENT_DIR, "vendor/alphalend-live");
const ALPHALEND_COLLECTOR_SCRIPT = resolve(ALPHALEND_RUNTIME_DIR, "collect-markets.mjs");
const KAI_RUNTIME_DIR = resolve(CURRENT_DIR, "vendor/kai-live");
const KAI_COLLECTOR_SCRIPT = resolve(KAI_RUNTIME_DIR, "collect-vaults.mjs");
const ASTROS_VAULTS_URL = "https://astros.ag/vaults";
const VOLO_VAULTS_URL = "https://www.volosui.com/vaults";
const HAEADAL_HOME_URL = "https://haedal.my/";
const ALPHAFI_DOCS_URL = "https://docs.alphafi.xyz/";
const LOTUS_FARMS_URL = "https://beta.lotusfinance.io/en/";
const METASTABLE_MBTC_URL = "https://docs.mstable.io/faq/what-backs-mbtc";
const NATIVE_DOCS_URL = "https://docs.native.org/native-dev";
const NEMO_DOCS_URL = "https://docs.nemoprotocol.com/tutorial/yt";
const TYPUS_HOME_URL = "https://typus.finance/";
const MAGMA_HOME_URL = "https://magmafinance.io/";

export function sanitizePublicWarning(value) {
  return String(value || "")
    .replace(/\b(https?:\/\/[^\s)"']+)[?#][^\s)"']+/gi, "$1?[redacted]")
    .replace(/\b(authorization|bearer|token|api[_-]?key|secret)=([^\s&)"']+)/gi, "$1=[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b0x[a-fA-F0-9]{16,64}\b/g, "0x[redacted]")
    .replace(/\/home\/runner\/work\/[^\s)"']+/g, "[ci-path]")
    .replace(/\/Users\/[^\s)"']+/g, "[local-path]")
    .replace(/\bat\s+[^\n]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function roundUsd(value) {
  return Math.round(value * 100) / 100;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseArgs(argv) {
  const args = {
    out: DEFAULT_OUTPUT_PATH,
    stdout: false,
    rails: [
      "scallop",
      "bucket",
      "navi",
      "suilend",
      "alphalend",
      "kai",
      "astros",
      "volo",
      "haedal",
      "alphafi",
      "lotus",
      "metastable",
      "native",
      "nemo",
      "typus",
      "magma",
    ],
    label: "Sui BTCfi live rail pack",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--stdout") {
      args.stdout = true;
      continue;
    }

    if (token === "--out" && argv[index + 1]) {
      args.out = resolve(process.cwd(), argv[index + 1]);
      index += 1;
      continue;
    }

    if (token.startsWith("--out=")) {
      args.out = resolve(process.cwd(), token.slice("--out=".length));
      continue;
    }

    if (token === "--label" && argv[index + 1]) {
      args.label = argv[index + 1].trim() || args.label;
      index += 1;
      continue;
    }

    if (token.startsWith("--label=")) {
      args.label = token.slice("--label=".length).trim() || args.label;
      continue;
    }

    if (token === "--rails" && argv[index + 1]) {
      args.rails = argv[index + 1]
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
      index += 1;
      continue;
    }

    if (token.startsWith("--rails=")) {
      args.rails = token
        .slice("--rails=".length)
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
    }
  }

  return args;
}

function toUsdFromUnits(amount, decimals, price = 1) {
  return (Number(amount) / 10 ** decimals) * price;
}

function toUsdFromCoins(amount, price = 1) {
  return Number(amount) * price;
}

function toTokenAmount(amount, decimals) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return numeric / 10 ** decimals;
}

function normalizeSymbolKey(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function parsePercentApy(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return numeric / 100;
}

function decimalFieldToNumber(field) {
  const numeric = Number(field?.fields?.value ?? field?.value ?? 0);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return numeric / WAD;
}

function interpolateApr(points, utilizationPercent) {
  if (points.length === 0) {
    return 0;
  }

  const sorted = [...points].sort((a, b) => a.util - b.util);

  if (utilizationPercent <= sorted[0].util) {
    return sorted[0].apr;
  }

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];

    if (utilizationPercent <= current.util) {
      const range = current.util - previous.util;

      if (range <= 0) {
        return current.apr;
      }

      const weight = (utilizationPercent - previous.util) / range;
      return previous.apr + (current.apr - previous.apr) * weight;
    }
  }

  return sorted[sorted.length - 1].apr;
}

function parseCompactNumber(value) {
  const match = String(value || "")
    .trim()
    .replace(/,/g, "")
    .match(/^([0-9]+(?:\.[0-9]+)?)([KMB])?$/i);

  if (!match) {
    return 0;
  }

  const numeric = Number(match[1]);
  const multiplier = {
    K: 1_000,
    M: 1_000_000,
    B: 1_000_000_000,
  }[String(match[2] || "").toUpperCase()] || 1;

  return numeric * multiplier;
}

function htmlToLines(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#36;/g, "$")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function fetchPageLines(url, label) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`${label} returned ${response.status}.`);
  }

  const html = await response.text();
  const lines = htmlToLines(html);

  if (lines.length === 0) {
    throw new Error(`${label} returned an empty page payload.`);
  }

  return { html, lines };
}

function extractUsdFromText(value) {
  const match = String(value || "")
    .replace(/,/g, "")
    .match(/\$([0-9]+(?:\.[0-9]+)?)([KMB])?/i);

  if (!match) {
    return 0;
  }

  return parseCompactNumber(`${match[1]}${match[2] || ""}`);
}

function extractPercentFromText(value) {
  const match = String(value || "").match(/([0-9]+(?:\.[0-9]+)?)\s*%/);
  return match ? Number(match[1]) / 100 : 0;
}

function extractUsdLikeText(value) {
  const directUsd = extractUsdFromText(value);

  if (directUsd > 0) {
    return directUsd;
  }

  return parseCompactNumber(
    String(value || "")
      .replace(/\$/g, "")
      .replace(/\s*USD/i, "")
      .trim()
  );
}

function buildSupplementalSurface({
  id,
  name,
  surfaceClass,
  wrapper = "",
  stableAsset = "",
  healthy = true,
  yieldApr = 0,
  borrowApr = 0,
  tvlUsd = 0,
  capacityUsd = 0,
  tags = [],
  notes = [],
  updatedAt,
}) {
  return {
    supplementalRail: {
      id,
      name,
      surfaceClass,
      source: "adapter",
      wrapper,
      stableAsset,
      healthy,
      yieldApr: round(yieldApr),
      borrowApr: round(borrowApr),
      tvlUsd: roundUsd(tvlUsd),
      capacityUsd: roundUsd(capacityUsd),
      tags,
      notes,
      updatedAt,
    },
  };
}

function findLineMatching(lines, pattern, startIndex = 0) {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (pattern.test(lines[index])) {
      return lines[index];
    }
  }

  return "";
}

function findNextLine(lines, label) {
  const index = lines.findIndex((line) => line === label);
  return index >= 0 ? lines[index + 1] || "" : "";
}

function computeMedian(values) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
  }

  return sorted[midpoint];
}

const MAX_RAIL_STALENESS_MS = 5 * 60 * 1000; // 5 minutes

function buildMarketSnapshot(rails, generatedAt) {
  const generatedAtMs = new Date(generatedAt).getTime();

  const freshRails = rails.filter((rail) => {
    if (!rail?.updatedAt) return false;
    const ageMs = generatedAtMs - new Date(rail.updatedAt).getTime();
    return ageMs >= 0 && ageMs <= MAX_RAIL_STALENESS_MS;
  });

  const btcPriceCandidates = freshRails
    .map((rail) => Number(rail?.referencePriceUsd || 0))
    .filter((value) => Number.isFinite(value) && value > 1_000);

  if (btcPriceCandidates.length === 0) {
    const staleCount = rails.filter(
      (r) => Number.isFinite(Number(r?.referencePriceUsd || 0)) && Number(r.referencePriceUsd) > 1_000
    ).length;
    if (staleCount > 0) {
      console.warn(`[market-snapshot] ${staleCount} rails had valid prices but exceeded ${MAX_RAIL_STALENESS_MS / 1000}s staleness threshold`);
    }
    return null;
  }

  return {
    btcPriceUsd: roundUsd(computeMedian(btcPriceCandidates)),
    updatedAt: generatedAt,
    source: "allocator-median",
    contributors: freshRails
      .filter((rail) => Number.isFinite(Number(rail?.referencePriceUsd || 0)) && Number(rail.referencePriceUsd) > 1_000)
      .map((rail) => rail.id),
  };
}

function buildTopLevelPayload({ label, generatedAt, market, rails, supplementalRails, warnings }) {
  return {
    label,
    generatedAt,
    market,
    collector: {
      id: "tide-live-rail-pack",
      version: "0.3.0",
      rails: rails.map((rail) => rail.id),
      supplementalRails: supplementalRails.map((rail) => rail.id),
    },
    warnings,
    rails,
    supplementalRails,
  };
}

function resolveBucketWrapper(collateralType) {
  if (collateralType.includes("::tlp::TLP")) {
    return "BTC basket";
  }

  if (collateralType.includes("::xbtc::XBTC")) {
    return "xBTC";
  }

  if (collateralType.includes("::btc::BTC")) {
    return "BTC";
  }

  return "BTC basket";
}

function normalizeBucketCandidate([collateralType, vault]) {
  const currentDebtUsd = toUsdFromUnits(vault.usdbSupply, USDB_DECIMALS, 1);
  const maxDebtUsd =
    Number(vault.maxUsdbSupply) > 0
      ? toUsdFromUnits(vault.maxUsdbSupply, USDB_DECIMALS, 1)
      : null;
  const availableDebtUsd =
    maxDebtUsd !== null ? Math.max(0, maxDebtUsd - currentDebtUsd) : 0;
  const utilization =
    maxDebtUsd && maxDebtUsd > 0 ? clamp(currentDebtUsd / maxDebtUsd, 0, 1) : 0;

  return {
    collateralType,
    wrapper: resolveBucketWrapper(collateralType),
    vault,
    currentDebtUsd,
    maxDebtUsd,
    availableDebtUsd,
    utilization,
    score:
      (maxDebtUsd !== null ? 100 : 0) +
      Math.min(availableDebtUsd / 50000, 40) +
      Math.min(vault.positionTableSize, 25),
  };
}

async function collectBucketRail(now) {
  const client = new BucketClient({ network: "mainnet" });
  const vaults = await client.getAllVaultObjects();
  const candidates = Object.entries(vaults)
    .filter(([collateralType]) => /btc|wbtc|lbtc|nbtc|stbtc|xbtc|tlp/i.test(collateralType))
    .map(normalizeBucketCandidate)
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    throw new Error("Bucket returned no BTC-related vaults.");
  }

  const selected = candidates[0];
  const { vault } = selected;
  const maxLtv = clamp(1 / vault.minCollateralRatio, 0.12, 0.95);
  const liquidityScore = clamp(
    0.58 +
      Math.min(selected.availableDebtUsd / 4_000_000, 0.23) +
      Math.min(vault.positionTableSize / 40, 0.11) -
      selected.utilization * 0.18,
    0.4,
    0.96
  );
  const oracleConfidence = 0.91;
  const healthScore = clamp(
    0.62 + liquidityScore * 0.22 + maxLtv * 0.08 - selected.utilization * 0.12,
    0.45,
    0.95
  );

  return {
    id: "bucket",
    name: "Bucket Protocol",
    source: "adapter",
    wrapper: selected.wrapper,
    stableAsset: "USDB",
    healthy: selected.availableDebtUsd > 100000,
    oracleConfidence: round(oracleConfidence),
    liquidityScore: round(liquidityScore),
    healthScore: round(healthScore),
    borrowApr: round(vault.interestRate),
    depositApr: 0,
    maxLtv: round(maxLtv),
    availableDebtUsd: roundUsd(selected.availableDebtUsd),
    referencePriceUsd: 0,
    rebalanceCostBps: 18,
    supportsRefinance: true,
    tags: ["Lending", "Collateral", "Stablecoin"],
    notes: [
      "Collected live via bucket-protocol-sdk getAllVaultObjects().",
      `Selected collateral: ${selected.collateralType}.`,
      "Bucket oracle price collection is currently unstable, so depth is derived from USDB cap headroom.",
    ],
    updatedAt: now,
  };
}

function buildScallopCandidate(key, pool, collateral) {
  return {
    key,
    pool,
    collateral,
    collateralDepthUsd: toUsdFromCoins(collateral.depositCoin, collateral.coinPrice),
    collateralHeadroomUsd:
      collateral.maxDepositCoin > 0
        ? Math.max(0, (collateral.maxDepositCoin - collateral.depositCoin) * collateral.coinPrice)
        : 0,
    score:
      collateral.collateralFactor * 100 +
      Math.min(toUsdFromCoins(collateral.depositCoin, collateral.coinPrice) / 100000, 40),
  };
}

export function buildScallopPriceReferences(candidates, now) {
  const references = candidates
    .map((candidate) => ({
      wrapper: candidate?.pool?.symbol,
      referencePriceUsd: roundUsd(candidate?.collateral?.coinPrice),
      source: "scallop",
      updatedAt: now,
    }))
    .filter((item) => item.wrapper && item.referencePriceUsd > 1_000);

  const hasSuiWbtc = references.some((item) => normalizeSymbolKey(item.wrapper) === "SUIWBTC");
  if (!hasSuiWbtc) {
    const proxySource = references.find((item) => normalizeSymbolKey(item.wrapper) === "SBWBTC")
      || references.find((item) => normalizeSymbolKey(item.wrapper) === "WBTC");
    if (proxySource) {
      references.push({
        wrapper: "suiWBTC",
        referencePriceUsd: proxySource.referencePriceUsd,
        source: "scallop",
        updatedAt: now,
        quoteKind: "proxy",
        proxyOf: proxySource.wrapper,
        disclosure: `No direct suiWBTC quote; priced from Scallop ${proxySource.wrapper} market quote.`,
      });
    }
  }

  return references;
}

async function collectScallopRail(now) {
  const indexer = new ScallopIndexer();
  const [usdcPool, wbtcPool, wbtcCollateral, sbwbtcPool, sbwbtcCollateral] = await Promise.all([
    indexer.getMarketPool("usdc"),
    indexer.getMarketPool("wbtc"),
    indexer.getMarketCollateral("wbtc"),
    indexer.getMarketPool("sbwbtc"),
    indexer.getMarketCollateral("sbwbtc"),
  ]);

  const candidates = [
    buildScallopCandidate("wbtc", wbtcPool, wbtcCollateral),
    buildScallopCandidate("sbwbtc", sbwbtcPool, sbwbtcCollateral),
  ].sort((a, b) => b.score - a.score);

  const selected = candidates[0];
  const stableLiquidityUsd = Math.max(
    0,
    (usdcPool.supplyCoin - usdcPool.borrowCoin - usdcPool.reserveCoin) * usdcPool.coinPrice
  );
  const remainingCapUsd =
    usdcPool.maxBorrowCoin > 0
      ? Math.max(0, (usdcPool.maxBorrowCoin - usdcPool.borrowCoin) * usdcPool.coinPrice)
      : stableLiquidityUsd;
  const availableDebtUsd = Math.min(stableLiquidityUsd, remainingCapUsd);
  const liquidityScore = clamp(
    0.6 +
      Math.min(availableDebtUsd / 5_000_000, 0.21) +
      Math.min(selected.collateralDepthUsd / 2_500_000, 0.1) -
      usdcPool.utilizationRate * 0.12,
    0.45,
    0.98
  );
  const oracleConfidence = 0.97;
  const healthScore = clamp(
    0.64 +
      liquidityScore * 0.2 +
      selected.collateral.collateralFactor * 0.08 -
      usdcPool.utilizationRate * 0.08,
    0.48,
    0.97
  );

  return {
    id: "scallop",
    name: "Scallop",
    source: "adapter",
    wrapper: selected.pool.symbol,
    stableAsset: "USDC",
    healthy: availableDebtUsd > 250000 && usdcPool.utilizationRate < 0.92,
    oracleConfidence: round(oracleConfidence),
    liquidityScore: round(liquidityScore),
    healthScore: round(healthScore),
    borrowApr: round(usdcPool.borrowApr),
    depositApr: round(selected.pool.supplyApr),
    maxLtv: round(selected.collateral.collateralFactor),
    availableDebtUsd: roundUsd(availableDebtUsd),
    referencePriceUsd: roundUsd(selected.collateral.coinPrice),
    priceReferences: buildScallopPriceReferences(candidates, now),
    rebalanceCostBps: 12,
    supportsRefinance: true,
    tags: ["Lending", "Borrow", "Collateral"],
    notes: [
      "Collected live via @scallop-io/sui-scallop-sdk ScallopIndexer.",
      `Selected BTC collateral market: ${selected.pool.symbol}.`,
      "Borrow depth and APR are mapped from the live USDC borrow pool.",
    ],
    updatedAt: now,
  };
}

function getNaviTokenMeta(pool) {
  const symbol = String(pool?.token?.symbol || pool?.symbol || "UNKNOWN");
  const decimals = Number(pool?.token?.decimals || 0);
  const price = Number(pool?.oracle?.price || pool?.token?.price || 0);
  return {
    symbol,
    normalizedSymbol: normalizeSymbolKey(symbol),
    decimals,
    price: Number.isFinite(price) ? price : 0,
  };
}

function getNaviBorrowHeadroomTokens(pool) {
  const { decimals } = getNaviTokenMeta(pool);
  const leftSupplyTokens = Math.max(0, Number(pool?.leftSupply) || 0);
  const availableBorrowTokens = Math.max(0, toTokenAmount(pool?.availableBorrow, decimals));
  const leftBorrowTokens = Math.max(0, toTokenAmount(pool?.leftBorrowAmount, decimals));
  const headroom = Math.min(leftSupplyTokens, availableBorrowTokens, leftBorrowTokens);
  return Number.isFinite(headroom) ? headroom : 0;
}

function buildNaviCollateralCandidate(pool) {
  const meta = getNaviTokenMeta(pool);
  const totalSupplyTokens = Math.max(0, toTokenAmount(pool?.totalSupplyAmount, meta.decimals));
  const supplyHeadroomTokens = Math.max(0, Number(pool?.leftSupply) || 0);
  const totalSupplyUsd = totalSupplyTokens * meta.price;
  const supplyHeadroomUsd = supplyHeadroomTokens * meta.price;
  const ltv = clamp(Number(pool?.ltvValue || 0), 0, 0.95);
  const score =
    ltv * 100 +
    Math.min(totalSupplyUsd / 1_000_000, 24) +
    Math.min(supplyHeadroomUsd / 1_000_000, 16) +
    (pool?.oracle?.valid ? 6 : 0);

  return {
    pool,
    meta,
    ltv,
    totalSupplyUsd,
    supplyHeadroomUsd,
    score,
  };
}

function getNaviStablePriority(symbol) {
  const normalized = normalizeSymbolKey(symbol);
  return {
    WUSDC: 18,
    USDC: 18,
    USDCET: 16,
    USDSUI: 15,
    BUCK: 14,
    FDUSD: 13,
    AUSD: 12,
    SUIUSDE: 11,
    SUIUSDT: 10,
  }[normalized] || 6;
}

function resolveNaviStableAsset(symbol) {
  const normalized = normalizeSymbolKey(symbol);
  if (normalized === "WUSDC") {
    return "USDC";
  }
  if (normalized === "WUSDT") {
    return "USDT";
  }
  return symbol;
}

function buildNaviStableCandidate(pool) {
  const meta = getNaviTokenMeta(pool);
  const borrowHeadroomTokens = getNaviBorrowHeadroomTokens(pool);
  const availableDebtUsd = borrowHeadroomTokens * meta.price;
  const borrowApr = parsePercentApy(pool?.borrowIncentiveApyInfo?.apy || pool?.borrowIncentiveApyInfo?.vaultApr);
  const priceDistance = Math.abs(1 - (meta.price || 1));
  const score =
    getNaviStablePriority(meta.symbol) +
    Math.min(availableDebtUsd / 500_000, 28) +
    Math.max(0, 0.14 - borrowApr) * 100 -
    priceDistance * 10 +
    (pool?.oracle?.valid ? 4 : 0);

  return {
    pool,
    meta,
    availableDebtUsd,
    borrowApr,
    score,
  };
}

async function collectNaviRail(now) {
  const response = await fetch(
    "https://open-api.naviprotocol.io/api/navi/pools?env=prod&sdk=1.4.0&market=main"
  );

  if (!response.ok) {
    throw new Error(`NAVI pools API returned ${response.status}.`);
  }

  const payload = await response.json();
  const pools = Array.isArray(payload?.data) ? payload.data : [];
  const isActiveLike = (pool) => {
    const status = String(pool?.status || "").toLowerCase();
    return pool?.isDeprecated !== true && status !== "inactive" && status !== "paused";
  };

  const btcCandidates = pools
    .filter((pool) => {
      const tags = Array.isArray(pool?.tags) ? pool.tags : [];
      const normalizedSymbol = normalizeSymbolKey(pool?.token?.symbol || pool?.symbol);
      return (
        isActiveLike(pool) &&
        (tags.includes("btc") || normalizedSymbol.includes("BTC"))
      );
    })
    .map(buildNaviCollateralCandidate)
    .sort((a, b) => b.score - a.score);

  const stableCandidates = pools
    .filter((pool) => {
      const tags = Array.isArray(pool?.tags) ? pool.tags : [];
      const normalizedSymbol = normalizeSymbolKey(pool?.token?.symbol || pool?.symbol);
      return (
        isActiveLike(pool) &&
        (tags.includes("stable") || getNaviStablePriority(normalizedSymbol) > 6)
      );
    })
    .map(buildNaviStableCandidate)
    .filter((candidate) => candidate.availableDebtUsd > 50_000)
    .sort((a, b) => b.score - a.score);

  if (btcCandidates.length === 0) {
    throw new Error("NAVI returned no active BTC collateral pools.");
  }

  if (stableCandidates.length === 0) {
    throw new Error("NAVI returned no stable borrow pools with usable headroom.");
  }

  const collateral = btcCandidates[0];
  const stable = stableCandidates[0];
  const oracleConfidence = collateral.pool?.oracle?.valid && stable.pool?.oracle?.valid ? 0.97 : 0.88;
  const liquidityScore = clamp(
    0.58 +
      Math.min(stable.availableDebtUsd / 5_000_000, 0.22) +
      Math.min(collateral.totalSupplyUsd / 10_000_000, 0.12) +
      Math.min(collateral.supplyHeadroomUsd / 5_000_000, 0.06),
    0.46,
    0.98
  );
  const healthScore = clamp(
    0.61 + liquidityScore * 0.2 + collateral.ltv * 0.12 + oracleConfidence * 0.04,
    0.5,
    0.97
  );

  return {
    id: "navi",
    name: "NAVI Protocol",
    source: "adapter",
    wrapper: collateral.meta.symbol,
    stableAsset: resolveNaviStableAsset(stable.meta.symbol),
    healthy: stable.availableDebtUsd > 150_000,
    oracleConfidence: round(oracleConfidence),
    liquidityScore: round(liquidityScore),
    healthScore: round(healthScore),
    borrowApr: round(stable.borrowApr),
    depositApr: round(
      parsePercentApy(
        collateral.pool?.supplyIncentiveApyInfo?.apy || collateral.pool?.supplyIncentiveApyInfo?.vaultApr
      )
    ),
    maxLtv: round(collateral.ltv),
    availableDebtUsd: roundUsd(stable.availableDebtUsd),
    referencePriceUsd: roundUsd(collateral.meta.price),
    priceReferences: btcCandidates
      .map((candidate) => ({
        wrapper: candidate.meta.symbol,
        referencePriceUsd: roundUsd(candidate.meta.price),
        source: "navi",
        updatedAt: now,
      }))
      .filter((item) => item.referencePriceUsd > 1_000),
    rebalanceCostBps: 14,
    supportsRefinance: true,
    tags: ["Lending", "Borrow", "Collateral", "AggregatorAPI"],
    notes: [
      "Collected live via NAVI public pools API.",
      `Selected BTC collateral market: ${collateral.meta.symbol}.`,
      `Selected stable borrow market: ${stable.meta.symbol}.`,
      "Borrow depth is derived from live stable pool supply headroom and borrow headroom.",
    ],
    updatedAt: now,
  };
}

function parseSuilendReserve(reserve, nowMs) {
  const fields = reserve?.fields || {};
  const coinType = String(fields?.coin_type?.fields?.name || "");
  const symbol = coinType.split("::").pop() || coinType;
  const mintDecimals = Number(fields?.mint_decimals || 0);
  const price = decimalFieldToNumber(fields?.price);
  const smoothedPrice = decimalFieldToNumber(fields?.smoothed_price);
  const availableAmount = toTokenAmount(fields?.available_amount, mintDecimals);
  const borrowedAmount = decimalFieldToNumber(fields?.borrowed_amount) / 10 ** mintDecimals;
  const depositLimit = toTokenAmount(fields?.config?.fields?.element?.fields?.deposit_limit, mintDecimals);
  const borrowLimit = toTokenAmount(fields?.config?.fields?.element?.fields?.borrow_limit, mintDecimals);
  const rawOpenLtv = Number(fields?.config?.fields?.element?.fields?.open_ltv_pct || 0) / 100;
  const openLtv = Number.isFinite(rawOpenLtv) ? clamp(rawOpenLtv, 0, 0.95) : 0;
  const spreadFeeBps = Number(fields?.config?.fields?.element?.fields?.spread_fee_bps || 0);
  const updatedAtMs = Number(fields?.price_last_update_timestamp_s || 0) * 1000;
  const stalenessMs = Math.max(0, nowMs - updatedAtMs);
  const utilization =
    borrowedAmount + availableAmount > 0 ? borrowedAmount / (borrowedAmount + availableAmount) : 0;
  const interestRateUtils = Array.isArray(fields?.config?.fields?.element?.fields?.interest_rate_utils)
    ? fields.config.fields.element.fields.interest_rate_utils.map((value) => Number(value))
    : [];
  const interestRateAprs = Array.isArray(fields?.config?.fields?.element?.fields?.interest_rate_aprs)
    ? fields.config.fields.element.fields.interest_rate_aprs.map((value) => Number(value) / 10000)
    : [];
  const interestCurve = interestRateUtils.map((util, index) => ({
    util,
    apr: interestRateAprs[index] || 0,
  }));
  const borrowApr = interpolateApr(interestCurve, utilization * 100);
  const depositApr = utilization * borrowApr * (1 - spreadFeeBps / 10000);
  const priceGap =
    Math.max(price, smoothedPrice) > 0 ? Math.abs(price - smoothedPrice) / Math.max(price, smoothedPrice) : 0;
  const remainingBorrowCapacity = Math.max(0, borrowLimit - borrowedAmount);
  const availableBorrowTokens = Math.min(availableAmount, remainingBorrowCapacity);

  return {
    coinType,
    symbol,
    mintDecimals,
    price,
    smoothedPrice,
    openLtv,
    availableAmount,
    borrowedAmount,
    depositLimit,
    borrowLimit,
    availableBorrowTokens,
    availableDebtUsd: availableBorrowTokens * price,
    utilization,
    borrowApr,
    depositApr,
    priceGap,
    stalenessMs,
  };
}

function getSuilendStablePriority(symbol) {
  return {
    USDC: 18,
    USDSUI: 16,
    SUI_USDE: 15,
    USDT: 14,
  }[normalizeSymbolKey(symbol)] || 8;
}

function resolveSuilendStableAsset(symbol) {
  const normalized = normalizeSymbolKey(symbol);

  if (normalized === "SUIUSDE") {
    return "suiUSDE";
  }

  return symbol;
}

async function fetchSuilendMainMarketObject() {
  const response = await fetch(SUI_FULLNODE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sui_getObject",
      params: [SUILEND_MAIN_MARKET_ID, { showContent: true }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Suilend fullnode request returned ${response.status}.`);
  }

  const payload = await response.json();
  const reserves = payload?.result?.data?.content?.fields?.reserves;

  if (!Array.isArray(reserves)) {
    throw new Error("Suilend market response did not include reserve data.");
  }

  return reserves;
}

async function collectSuilendRail(now) {
  const nowMs = Date.parse(now);
  const reserves = await fetchSuilendMainMarketObject();
  const parsedReserves = reserves.map((reserve) => parseSuilendReserve(reserve, nowMs));
  const btcCandidates = parsedReserves
    .filter((reserve) => normalizeSymbolKey(reserve.symbol).includes("BTC") && reserve.openLtv > 0)
    .sort(
      (a, b) =>
        b.openLtv * 100 +
        Math.min(b.availableAmount * b.price / 1_000_000, 20) -
        (a.openLtv * 100 + Math.min(a.availableAmount * a.price / 1_000_000, 20))
    );
  const stableCandidates = parsedReserves
    .filter((reserve) => getSuilendStablePriority(reserve.symbol) > 8)
    .filter((reserve) => reserve.availableDebtUsd > 50_000)
    .sort((a, b) => {
      const scoreA =
        getSuilendStablePriority(a.symbol) +
        Math.min(a.availableDebtUsd / 500_000, 24) +
        Math.max(0, 0.14 - a.borrowApr) * 100 -
        a.priceGap * 10;
      const scoreB =
        getSuilendStablePriority(b.symbol) +
        Math.min(b.availableDebtUsd / 500_000, 24) +
        Math.max(0, 0.14 - b.borrowApr) * 100 -
        b.priceGap * 10;
      return scoreB - scoreA;
    });

  if (btcCandidates.length === 0) {
    throw new Error("Suilend returned no active BTC collateral reserves.");
  }

  if (stableCandidates.length === 0) {
    throw new Error("Suilend returned no stable borrow reserves with usable headroom.");
  }

  const collateral = btcCandidates[0];
  const stable = stableCandidates[0];
  const stalenessPenalty = Math.min(
    Math.max(collateral.stalenessMs, stable.stalenessMs) / (1000 * 60 * 60 * 24),
    1
  );
  const oracleConfidence = clamp(
    0.97 - Math.max(collateral.priceGap, stable.priceGap) * 2 - stalenessPenalty * 0.08,
    0.78,
    0.98
  );
  const liquidityScore = clamp(
    0.6 +
      Math.min(stable.availableDebtUsd / 5_000_000, 0.23) +
      Math.min(collateral.availableAmount * collateral.price / 5_000_000, 0.09) -
      stable.utilization * 0.12,
    0.45,
    0.98
  );
  const healthScore = clamp(
    0.62 + liquidityScore * 0.2 + collateral.openLtv * 0.08 + oracleConfidence * 0.06,
    0.48,
    0.98
  );

  return {
    id: "suilend",
    name: "Suilend",
    source: "adapter",
    wrapper: collateral.symbol,
    stableAsset: resolveSuilendStableAsset(stable.symbol),
    healthy: stable.availableDebtUsd > 150_000 && stable.utilization < 0.92,
    oracleConfidence: round(oracleConfidence),
    liquidityScore: round(liquidityScore),
    healthScore: round(healthScore),
    borrowApr: round(stable.borrowApr),
    depositApr: round(collateral.depositApr),
    maxLtv: round(collateral.openLtv),
    availableDebtUsd: roundUsd(stable.availableDebtUsd),
    referencePriceUsd: roundUsd(collateral.price),
    priceReferences: btcCandidates
      .map((candidate) => ({
        wrapper: candidate.symbol,
        referencePriceUsd: roundUsd(candidate.price),
        source: "suilend",
        updatedAt: now,
      }))
      .filter((item) => item.referencePriceUsd > 1_000),
    rebalanceCostBps: 13,
    supportsRefinance: true,
    tags: ["Lending", "Borrow", "Collateral", "Onchain"],
    notes: [
      "Collected live via direct Sui fullnode read of the Suilend main lending market object.",
      `Selected BTC collateral reserve: ${collateral.symbol}.`,
      `Selected stable borrow reserve: ${stable.symbol}.`,
      "APR and utilization are interpolated from the live reserve interest-rate curve.",
    ],
    updatedAt: now,
  };
}

function getAlphalendBtcPriority(symbol) {
  return {
    WBTC: 18,
    XBTC: 17,
    LBTC: 16,
    BTC: 15,
    TBTC: 14,
    EXBTC: 13,
    EBTC: 12,
    BTCVC: 8,
  }[normalizeSymbolKey(symbol)] || 6;
}

function getAlphalendStablePriority(symbol) {
  return {
    USDC: 18,
    USDT: 16,
    SUIUSDE: 14,
    USDSUI: 13,
    AUSD: 12,
  }[normalizeSymbolKey(symbol)] || 8;
}

function resolveAlphalendStableAsset(symbol) {
  const normalized = normalizeSymbolKey(symbol);

  if (normalized === "SUIUSDE") {
    return "suiUSDE";
  }

  return symbol;
}

async function collectAlphalendMarkets() {
  const { stdout } = await execFileAsync(process.execPath, [ALPHALEND_COLLECTOR_SCRIPT], {
    cwd: ALPHALEND_RUNTIME_DIR,
    maxBuffer: 8 * 1024 * 1024,
  });

  const payload = JSON.parse(stdout);

  if (!Array.isArray(payload)) {
    throw new Error("AlphaLend collector did not return a market array.");
  }

  return payload;
}

async function collectAlphalendRail(now) {
  const markets = await collectAlphalendMarkets();
  const btcCandidates = markets
    .filter((market) => getAlphalendBtcPriority(market.symbol) > 6)
    .filter((market) => Number.isFinite(market.price) && market.price > 1_000)
    .filter((market) => Number.isFinite(market.ltv) && market.ltv > 0)
    .filter((market) => Number.isFinite(market.availableLiquidity) && market.availableLiquidity > 0)
    .map((market) => ({
      ...market,
      maxLtv: clamp(market.ltv / 100, 0, 0.95),
      liquidationThreshold: clamp(market.liquidationThreshold / 100, 0, 0.99),
      depositAprDecimal: market.supplyApr / 100,
      totalSupplyUsd: market.totalSupply * market.price,
      availableLiquidityUsd: market.availableLiquidity * market.price,
      score:
        getAlphalendBtcPriority(market.symbol) +
        Math.min((market.totalSupply * market.price) / 1_000_000, 22) +
        Math.min((market.availableLiquidity * market.price) / 1_000_000, 10) +
        market.ltv / 10 -
        market.utilizationRate * 8,
    }))
    .sort((a, b) => b.score - a.score);
  const stableCandidates = markets
    .filter((market) => getAlphalendStablePriority(market.symbol) > 8)
    .filter((market) => Number.isFinite(market.price) && market.price > 0.8)
    .map((market) => {
      const availableBorrowTokens = Math.max(
        0,
        Math.min(market.availableLiquidity || 0, market.allowedBorrowAmount || 0)
      );
      const availableDebtUsd = availableBorrowTokens * market.price;

      return {
        ...market,
        borrowAprDecimal: market.borrowApr / 100,
        availableBorrowTokens,
        availableDebtUsd,
        score:
          getAlphalendStablePriority(market.symbol) +
          Math.min(availableDebtUsd / 500_000, 24) +
          Math.max(0, 0.14 - market.borrowApr / 100) * 100 -
          market.utilizationRate * 8,
      };
    })
    .filter((market) => market.availableDebtUsd > 50_000)
    .sort((a, b) => b.score - a.score);

  if (btcCandidates.length === 0) {
    throw new Error("AlphaLend returned no active BTC collateral markets.");
  }

  if (stableCandidates.length === 0) {
    throw new Error("AlphaLend returned no stable borrow markets with usable headroom.");
  }

  const collateral = btcCandidates[0];
  const stable = stableCandidates[0];
  const oracleConfidence = 0.94;
  const liquidityScore = clamp(
    0.58 +
      Math.min(stable.availableDebtUsd / 5_000_000, 0.22) +
      Math.min(collateral.totalSupplyUsd / 10_000_000, 0.1) -
      stable.utilizationRate * 0.1,
    0.45,
    0.98
  );
  const healthScore = clamp(
    0.61 + liquidityScore * 0.22 + collateral.maxLtv * 0.08 + oracleConfidence * 0.04,
    0.48,
    0.97
  );

  return {
    id: "alphalend",
    name: "AlphaLend",
    source: "adapter",
    wrapper: collateral.symbol,
    stableAsset: resolveAlphalendStableAsset(stable.symbol),
    healthy: stable.availableDebtUsd > 150_000 && stable.utilizationRate < 0.92,
    oracleConfidence: round(oracleConfidence),
    liquidityScore: round(liquidityScore),
    healthScore: round(healthScore),
    borrowApr: round(stable.borrowAprDecimal),
    depositApr: round(collateral.depositAprDecimal),
    maxLtv: round(collateral.maxLtv),
    availableDebtUsd: roundUsd(stable.availableDebtUsd),
    referencePriceUsd: roundUsd(collateral.price),
    priceReferences: btcCandidates
      .map((candidate) => ({
        wrapper: candidate.symbol,
        referencePriceUsd: roundUsd(candidate.price),
        source: "alphalend",
        updatedAt: now,
      }))
      .filter((item) => item.referencePriceUsd > 1_000),
    rebalanceCostBps: 16,
    supportsRefinance: true,
    tags: ["Lending", "Borrow", "Collateral", "SDK"],
    notes: [
      "Collected live via the official AlphaLend SDK in an isolated runtime pinned to the protocol's required Sui client.",
      `Selected BTC collateral market: ${collateral.symbol}.`,
      `Selected stable borrow market: ${stable.symbol}.`,
      "Borrow headroom is derived from live available liquidity and allowed borrow amount.",
    ],
    updatedAt: now,
  };
}

async function collectKaiSurfaceData() {
  const { stdout } = await execFileAsync(process.execPath, [KAI_COLLECTOR_SCRIPT], {
    cwd: KAI_RUNTIME_DIR,
    maxBuffer: 8 * 1024 * 1024,
  });

  const payload = JSON.parse(stdout);

  if (!payload || typeof payload !== "object") {
    throw new Error("Kai collector did not return an object payload.");
  }

  return payload;
}

async function collectKaiSurface(now) {
  const payload = await collectKaiSurfaceData();
  const primaryVault = payload?.primaryVault;
  const stableContext = payload?.stableContext;

  if (!primaryVault?.symbol || !stableContext?.symbol) {
    throw new Error("Kai collector returned incomplete vault or stable-pool data.");
  }

  return {
    supplementalRail: {
      id: "kai-finance",
      name: "Kai Finance",
      surfaceClass: "VaultSurface",
      source: "adapter",
      wrapper: primaryVault.symbol,
      stableAsset: stableContext.symbol,
      healthy:
        Number(primaryVault.tvlTokens || 0) > 0 &&
        Number(stableContext.availableLiquidityUsd || 0) > 50_000,
      yieldApr: round(primaryVault.apr || 0),
      borrowApr: round(stableContext.borrowApr || 0),
      availableLiquidityUsd: roundUsd(stableContext.availableLiquidityUsd || 0),
      tags: ["Vaults", "Supplemental", "BTC", "StablePoolContext"],
      notes: [
        "Collected live via the official Kai SDK in an isolated runtime pinned to the protocol's required Sui client.",
        `Selected BTC vault: ${primaryVault.symbol} (${round(primaryVault.tvlTokens || 0, 4)} tokens TVL).`,
        `Selected stable context: ${stableContext.symbol} (${roundUsd(stableContext.availableLiquidityUsd || 0)} USD available).`,
        "Kai is attached as a supplemental vault surface because its public BTC surface is vault and supply-pool based rather than a direct BTC-backed stable borrow rail.",
      ],
      updatedAt: now,
    },
  };
}

async function collectAstrosSurface(now) {
  const { lines } = await fetchPageLines(ASTROS_VAULTS_URL, "Astros vault page");
  const vaultName = lines.find((line) => /^STABLE ASTROS#/i.test(line)) || "Astros Yield Vault";
  const partnerLineIndex = lines.findIndex((line) => line === vaultName);
  const partnerLine =
    partnerLineIndex >= 0 && /^with /i.test(lines[partnerLineIndex + 1] || "")
      ? lines[partnerLineIndex + 1]
      : "with Volo";
  const strategyLine = lines.find((line) => /Lending Looping/i.test(line)) || "Lending Looping";
  const aprText = findNextLine(lines, "Base APR");
  const tvlText = findNextLine(lines, "Total Value") || findNextLine(lines, "TVL");
  const capLine = lines.find((line) => /^Stake Cap/i.test(line)) || "";
  const aprValue = extractPercentFromText(aprText);
  const tvlUsd = extractUsdLikeText(tvlText);
  const capacityUsd = parseCompactNumber(capLine.replace(/^Stake Cap\s*\$?\s*/i, "").trim());
  const partner = partnerLine.replace(/^with\s+/i, "").trim() || "Volo";

  return {
    supplementalRail: {
      id: "astros",
      name: "Astros",
      surfaceClass: "StrategySurface",
      source: "adapter",
      wrapper: partner,
      stableAsset: "",
      healthy: true,
      yieldApr: round(aprValue),
      tvlUsd: roundUsd(tvlUsd),
      capacityUsd: roundUsd(capacityUsd),
      tags: ["Strategy", "Supplemental", "Vaults"],
      notes: [
        "Collected live from the official Astros Yield vault page.",
        `Selected vault: ${vaultName} ${partnerLine}.`,
        `Current strategy: ${strategyLine}.`,
        aprValue > 0 || tvlUsd > 0 || capacityUsd > 0
          ? `Public metrics snapshot: APR ${Math.round(aprValue * 10000) / 100}% · TVL ${tvlUsd > 0 ? `$${roundUsd(tvlUsd)}` : "n/a"} · Stake cap ${capacityUsd > 0 ? `$${roundUsd(capacityUsd)}` : "n/a"}.`
          : "The public page is reachable, but numeric vault metrics are not exposed in a machine-readable format in the current payload.",
        "Astros is attached as a supplemental strategy surface because the public page exposes vault metrics, not a direct BTC-backed stable borrow rail.",
      ],
      updatedAt: now,
    },
  };
}

function parseVoloVaultCandidate(lines, vaultLabel, wrapperLabel) {
  const indexes = lines.reduce((matches, line, index) => {
    if (line === vaultLabel) {
      matches.push(index);
    }
    return matches;
  }, []);

  if (indexes.length === 0) {
    return null;
  }

  const candidates = indexes
    .map((index) => {
      const block = lines.slice(index, index + 24);
      const aprIndex = block.findIndex((line) => line === "APR");
      const aprLine =
        (aprIndex >= 0 ? block.slice(aprIndex + 1, aprIndex + 4).find((line) => /%/.test(line)) : "") ||
        block.find((line) => /%/.test(line)) ||
        "";
      const totalStakedIndex = block.findIndex((line) => line === "Total Staked");
      const tvlLine =
        (totalStakedIndex >= 0
          ? block.slice(totalStakedIndex + 1, totalStakedIndex + 5).find((line) => /\$/.test(line))
          : "") ||
        block.find((line) => /\$/.test(line) && !/^\$0(?:\.0+)?$/.test(line)) ||
        "";
      const strategy =
        block.find((line) => /Balanced|Conservative|Principal Protected/i.test(line)) || "Balanced";
      const amountLine =
        (totalStakedIndex >= 0
          ? block
              .slice(totalStakedIndex + 1, totalStakedIndex + 4)
              .find(
                (line) =>
                  new RegExp(`\\b${wrapperLabel.replace(".", "\\.")}\\b`, "i").test(line) &&
                  /^[0-9]/.test(line)
              )
          : "") ||
        block.find(
          (line) =>
            new RegExp(`\\b${wrapperLabel.replace(".", "\\.")}\\b`, "i").test(line) &&
            /^[0-9]/.test(line)
        ) ||
        "";

      return {
        label: vaultLabel,
        wrapper: wrapperLabel,
        strategy,
        apr: extractPercentFromText(aprLine),
        tvlUsd: extractUsdLikeText(tvlLine),
        amountLine,
      };
    })
    .sort((a, b) => {
      const scoreA = (a.tvlUsd > 0 ? 100 : 0) + (a.amountLine ? 10 : 0);
      const scoreB = (b.tvlUsd > 0 ? 100 : 0) + (b.amountLine ? 10 : 0);
      return scoreB - scoreA;
    });

  return candidates[0] || null;
}

async function collectVoloSurface(now) {
  const { lines } = await fetchPageLines(VOLO_VAULTS_URL, "Volo vaults page");
  const candidates = [
    parseVoloVaultCandidate(lines, "xBTC Vault", "xBTC"),
    parseVoloVaultCandidate(lines, "wBTC Vault", "wBTC"),
    parseVoloVaultCandidate(lines, "WBTC Vault", "WBTC"),
    parseVoloVaultCandidate(lines, "YBTC.B Vault", "YBTC.B"),
  ]
    .filter(Boolean)
    .sort((a, b) => b.tvlUsd - a.tvlUsd);

  if (candidates.length === 0) {
    throw new Error("Volo vault page returned no BTC vault cards.");
  }

  const selected = candidates[0];

  return buildSupplementalSurface({
    id: "volo",
    name: "Volo",
    surfaceClass: "VaultSurface",
    wrapper: selected.wrapper,
    stableAsset: "USDC",
    healthy: selected.tvlUsd > 0 ? selected.tvlUsd > 500_000 : true,
    yieldApr: selected.apr,
    tvlUsd: selected.tvlUsd,
    capacityUsd: selected.tvlUsd,
    tags: ["Vaults", "Supplemental", "BTC"],
    notes: [
      "Collected live from the official Volo vaults page.",
      `Selected BTC vault: ${selected.label} (${selected.strategy} strategy).`,
      selected.amountLine
        ? `Current vault size: ${selected.amountLine}.`
        : "The public vault card is reachable, but the size metric is not machine-readable in the current payload.",
      "Volo is attached as a supplemental vault surface because the public page exposes vault APR and staked size rather than a direct BTC-backed stable borrow rail.",
    ],
    updatedAt: now,
  });
}

async function collectHaedalSurface(now) {
  const { lines } = await fetchPageLines(HAEADAL_HOME_URL, "Haedal home page");
  const totalStakedIndex = lines.findIndex((line) => line === "Total Staked");
  const totalStakedLine =
    totalStakedIndex >= 0 ? lines.slice(totalStakedIndex + 1, totalStakedIndex + 4).join(" ") : "";
  const apyLine = findNextLine(lines, "APY");
  const hmmTvlLine = findNextLine(lines, "TVL");
  const totalStakedUsd = extractUsdFromText(totalStakedLine);
  const hmmTvlUsd = extractUsdFromText(hmmTvlLine);
  const apy = extractPercentFromText(apyLine);

  return buildSupplementalSurface({
    id: "haedal",
    name: "Haedal",
    surfaceClass: "VaultSurface",
    wrapper: "haSUI",
    stableAsset: "",
    healthy: totalStakedUsd > 1_000_000,
    yieldApr: apy,
    tvlUsd: totalStakedUsd,
    capacityUsd: hmmTvlUsd,
    tags: ["Vaults", "Supplemental", "LST"],
    notes: [
      "Collected live from the official Haedal app.",
      totalStakedLine ? `Total staked snapshot: ${totalStakedLine}.` : "Total staked snapshot is available on the official app.",
      hmmTvlLine ? `HMM TVL snapshot: ${hmmTvlLine}.` : "HMM TVL is published on the official app.",
      "Haedal is attached as a supplemental collateral surface because its public Sui app exposes staking and liquidity state that can influence BTCfi collateral routing quality.",
    ],
    updatedAt: now,
  });
}

async function collectAlphaFiSurface(now) {
  const { lines } = await fetchPageLines(ALPHAFI_DOCS_URL, "AlphaFi docs");
  const headline =
    findLineMatching(lines, /Premium Smart Yield Aggregator/i) ||
    findLineMatching(lines, /yield farming pools/i);

  return buildSupplementalSurface({
    id: "alphafi",
    name: "AlphaFi",
    surfaceClass: "VaultSurface",
    wrapper: "wBTC",
    stableAsset: "USDC",
    healthy: true,
    tags: ["Vaults", "Supplemental", "Yield"],
    notes: [
      "Collected live reachability from the official AlphaFi docs surface.",
      headline ? `Current product signal: ${headline}.` : "AlphaFi docs currently expose the strategy stack and AlphaLend integration surface.",
      "AlphaFi is attached as a supplemental vault surface until a structured public vault metrics endpoint is available.",
    ],
    updatedAt: now,
  });
}

async function collectLotusSurface(now) {
  let lines = [];

  try {
    ({ lines } = await fetchPageLines(LOTUS_FARMS_URL, "Lotus Finance explore farms page"));
  } catch {
    ({ lines } = await fetchPageLines("https://app.lotusfinance.io/", "Lotus Finance app"));
  }

  const title = findLineMatching(lines, /^Lotus Finance$/) || "Lotus Finance";
  const btcSignal = findLineMatching(lines, /wBTC|xBTC|BTC/i);

  return buildSupplementalSurface({
    id: "lotus-finance",
    name: "Lotus Finance",
    surfaceClass: "VaultSurface",
    wrapper: btcSignal || "wBTC / xBTC",
    stableAsset: "USDC",
    healthy: true,
    tags: ["Vaults", "Supplemental", "Farms"],
    notes: [
      "Collected live reachability from the official Lotus Finance farms surface.",
      `Current page title: ${title}.`,
      btcSignal ? `BTC signal found on page: ${btcSignal}.` : "BTC-specific farm metadata is not exposed in a stable structured format on the public page.",
      "Lotus Finance is attached as a supplemental vault surface until a structured public farms API is available.",
    ],
    updatedAt: now,
  });
}

async function collectMetastableSurface(now) {
  const { lines } = await fetchPageLines(METASTABLE_MBTC_URL, "METASTABLE mBTC docs");
  const title = findLineMatching(lines, /What backs mBTC/i) || "What backs mBTC?";
  const backingLine =
    findLineMatching(lines, /mBTC/i, lines.findIndex((line) => /What backs mBTC/i.test(line)) + 1) ||
    "mBTC backing details are published on the official docs page.";

  return buildSupplementalSurface({
    id: "metastable",
    name: "Metastable",
    surfaceClass: "VaultSurface",
    wrapper: "mBTC",
    stableAsset: "mUSD",
    healthy: true,
    tags: ["Vaults", "Supplemental", "StructuredBTC"],
    notes: [
      "Collected live reachability from the official METASTABLE docs.",
      `Current page title: ${title}.`,
      backingLine,
      "METASTABLE is attached as a supplemental vault surface until a structured public mBTC metrics endpoint is available.",
    ],
    updatedAt: now,
  });
}

async function collectNativeSurface(now) {
  const { lines } = await fetchPageLines(NATIVE_DOCS_URL, "Native docs");
  const headline = findLineMatching(lines, /What is Native/i) || "What is Native";
  const productLine =
    findLineMatching(lines, /Native Credit Pool/i) ||
    findLineMatching(lines, /Native Swap Engine/i) ||
    "Native Credit Pool";

  return buildSupplementalSurface({
    id: "native",
    name: "Native",
    surfaceClass: "BridgeSurface",
    wrapper: "nBTC",
    stableAsset: "",
    healthy: true,
    tags: ["Ingress", "Supplemental", "Routing"],
    notes: [
      "Collected live reachability from the official Native docs surface.",
      `Current page title: ${headline}.`,
      `Current product signal: ${productLine}.`,
      "Native is attached as a supplemental ingress and routing surface because the public docs currently expose product modules rather than a BTC borrow-capacity endpoint.",
    ],
    updatedAt: now,
  });
}

async function collectNemoSurface(now) {
  const { lines } = await fetchPageLines(NEMO_DOCS_URL, "Nemo docs");
  const title = findLineMatching(lines, /^YT$/) || findLineMatching(lines, /Yield Token/i) || "Yield Token";
  const definition =
    findLineMatching(lines, /Yield Token/i, lines.findIndex((line) => /^YT$/.test(line)) + 1) ||
    "Yield tokenization is published on the official Nemo docs surface.";

  return buildSupplementalSurface({
    id: "nemo",
    name: "Nemo",
    surfaceClass: "StrategySurface",
    wrapper: "Yield tokenization",
    stableAsset: "",
    healthy: true,
    tags: ["Strategy", "Supplemental", "YieldSplits"],
    notes: [
      "Collected live reachability from the official Nemo docs surface.",
      `Current page title: ${title}.`,
      definition,
      "Nemo is attached as a supplemental strategy surface until a structured public vault or zap metrics endpoint is available.",
    ],
    updatedAt: now,
  });
}

async function collectTypusSurface(now) {
  const { lines } = await fetchPageLines(TYPUS_HOME_URL, "Typus home page");
  const tvlLine = findNextLine(lines, "TOTAL VALUE LOCKED");
  const tlpLine = findLineMatching(lines, /SUPPLY TLP/i) || "SUPPLY TLP";
  const tvlUsd = extractUsdFromText(tvlLine);

  return buildSupplementalSurface({
    id: "typus",
    name: "Typus",
    surfaceClass: "DerivativesSurface",
    wrapper: "TLP",
    stableAsset: "",
    healthy: true,
    tvlUsd,
    capacityUsd: tvlUsd,
    tags: ["Derivatives", "Supplemental", "Options"],
    notes: [
      "Collected live from the official Typus home page.",
      tvlUsd > 0 ? `TVL snapshot: ${tvlLine}.` : "Typus currently does not expose a numeric TVL figure on the public page.",
      `Current product signal: ${tlpLine}.`,
      "Typus is attached as a supplemental derivatives surface because the public page exposes options and TLP context rather than a direct BTC-backed stable borrow rail.",
    ],
    updatedAt: now,
  });
}

async function collectMagmaSurface(now) {
  const { lines } = await fetchPageLines(MAGMA_HOME_URL, "Magma home page");
  const headline =
    findLineMatching(lines, /liquidity/i) ||
    findLineMatching(lines, /adaptive/i) ||
    "Magma Finance";

  return buildSupplementalSurface({
    id: "magma",
    name: "Magma",
    surfaceClass: "RoutingSurface",
    wrapper: "wBTC / xBTC",
    stableAsset: "USDC",
    healthy: true,
    tags: ["Routing", "Supplemental", "Liquidity"],
    notes: [
      "Collected live reachability from the official Magma site.",
      `Current product signal: ${headline}.`,
      "Magma is attached as a supplemental routing surface until a stable public liquidity metrics endpoint is available.",
    ],
    updatedAt: now,
  });
}

async function collectRails(now, requestedRails) {
  const collectors = {
    bucket: () => collectBucketRail(now),
    scallop: () => collectScallopRail(now),
    navi: () => collectNaviRail(now),
    suilend: () => collectSuilendRail(now),
    alphalend: () => collectAlphalendRail(now),
    kai: () => collectKaiSurface(now),
    astros: () => collectAstrosSurface(now),
    volo: () => collectVoloSurface(now),
    haedal: () => collectHaedalSurface(now),
    alphafi: () => collectAlphaFiSurface(now),
    lotus: () => collectLotusSurface(now),
    metastable: () => collectMetastableSurface(now),
    native: () => collectNativeSurface(now),
    nemo: () => collectNemoSurface(now),
    typus: () => collectTypusSurface(now),
    magma: () => collectMagmaSurface(now),
  };
  const warnings = [];
  const rails = [];
  const supplementalRails = [];

  const settled = await Promise.allSettled(
    requestedRails.map(async (key) => {
      const collector = collectors[key];

      if (!collector) {
        throw new Error(`Unsupported rail collector: ${key}`);
      }

      return collector();
    })
  );

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      if (result.value?.supplementalRail) {
        supplementalRails.push(result.value.supplementalRail);
        return;
      }

      rails.push(result.value);
      return;
    }

    warnings.push(sanitizePublicWarning(
      `${requestedRails[index]} collector failed: ${result.reason?.message || result.reason}`,
    ));
  });

  return { rails, supplementalRails, warnings };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const { rails, supplementalRails, warnings } = await collectRails(generatedAt, args.rails);

  if (rails.length === 0) {
    throw new Error("No live rails were collected.");
  }

  const payload = buildTopLevelPayload({
    label: args.label,
    generatedAt,
    market: buildMarketSnapshot(rails, generatedAt),
    rails,
    supplementalRails,
    warnings,
  });
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;

  if (args.stdout) {
    process.stdout.write(serialized);
    return;
  }

  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, serialized, "utf8");
  process.stdout.write(
    `Wrote ${rails.length} allocator rail snapshots and ${supplementalRails.length} supplemental surfaces to ${args.out}${warnings.length ? ` with ${warnings.length} warning(s)` : ""}.\n`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
