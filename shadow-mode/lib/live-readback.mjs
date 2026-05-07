import { lookupRailIdByDisplay, getRailDisplay } from "./policy-ids.mjs";

function normalizeSymbol(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function normalizeCoinType(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function findBalanceEntry(entries = [], { coinType = "", symbol = "" } = {}) {
  const normalizedCoinType = normalizeCoinType(coinType);
  const normalizedSymbol = normalizeSymbol(symbol);
  const list = Array.isArray(entries) ? entries : [];

  if (normalizedCoinType) {
    const exact = list.find((entry) => normalizeCoinType(entry?.coinType) === normalizedCoinType);
    if (exact) return exact;
  }

  if (normalizedSymbol) {
    const bySymbol = list.find((entry) => normalizeSymbol(entry?.symbol) === normalizedSymbol);
    if (bySymbol) return bySymbol;
  }

  return null;
}

function findRailSnapshot(railPack = null, selectedRail = "") {
  const rails = Array.isArray(railPack?.rails) ? railPack.rails : [];
  const normalizedRailId = lookupRailIdByDisplay(selectedRail);
  if (!normalizedRailId) return null;
  return rails.find((rail) => String(rail?.id || "").trim() === normalizedRailId) || null;
}

export function buildLiveReadbackContext({
  policy = null,
  snapshot = null,
  portfolio = null,
  railPack = null,
} = {}) {
  const selectedRail = policy?.selectedRail || snapshot?.report?.summary?.primaryRailId || snapshot?.report?.summary?.primaryRailName || "";
  const collateralSymbol = normalizeSymbol(policy?.collateralSymbol || snapshot?.draft?.collateralAssetSymbol || "BTC");
  const collateralCoinType = normalizeCoinType(policy?.collateralCoinType || snapshot?.draft?.collateralCoinType || "");
  const stableSymbol = normalizeSymbol(snapshot?.draft?.stableAssetSymbol || "USDC");
  const collateralBalance = findBalanceEntry(portfolio?.btcBalances, {
    coinType: collateralCoinType,
    symbol: collateralSymbol,
  });
  const stableBalance = findBalanceEntry(portfolio?.stableBalances, {
    symbol: stableSymbol,
  });
  const rail = findRailSnapshot(railPack, selectedRail);

  return {
    fetchedAt: typeof portfolio?.fetchedAt === "string" ? portfolio.fetchedAt : "",
    collateral: {
      symbol: collateralSymbol || "BTC",
      coinType: collateralCoinType,
      balanceDisplay: String(collateralBalance?.display || "0"),
      matched: Boolean(collateralBalance),
    },
    stable: {
      symbol: stableBalance?.symbol || stableSymbol || "USD",
      balanceDisplay: String(stableBalance?.display || portfolio?.totalStableDisplay || "0"),
      matched: Boolean(stableBalance),
      aggregate: !stableBalance,
    },
    rail: rail
      ? {
          id: String(rail.id || ""),
          label: getRailDisplay(rail.id, rail.name || selectedRail || "Rail"),
          healthScore: normalizeNumber(rail.healthScore),
          availableDebtUsd: normalizeNumber(rail.availableDebtUsd),
          updatedAt: typeof rail.updatedAt === "string" ? rail.updatedAt : "",
        }
      : null,
  };
}
