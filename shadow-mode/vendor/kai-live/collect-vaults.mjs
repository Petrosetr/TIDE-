#!/usr/bin/env node

import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { SUPPLY_POOL_INFOS, VAULTS, getVaultDataBatch, getVaultStats } from "@kunalabs-io/kai";

const client = new SuiClient({ url: getFullnodeUrl("mainnet") });

const BTC_VAULT_KEYS = ["wBTC", "LBTC", "xBTC"];
const STABLE_POOL_KEYS = ["USDC", "suiUSDT"];

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeBigIntAmount(value, decimals) {
  return Number(value || 0n) / 10 ** decimals;
}

function normalizeAprBps(value) {
  const numeric = Number(value || 0n);
  return Number.isFinite(numeric) ? numeric / 10000 : 0;
}

async function collectVaults() {
  const vaultInfos = BTC_VAULT_KEYS.map((key) => ({
    key,
    info: VAULTS[key],
  })).filter((item) => item.info);

  const vaultData = await getVaultDataBatch(
    client,
    vaultInfos.map((item) => item.info.id)
  );

  return vaultData.map((data, index) => {
    const { key, info } = vaultInfos[index];
    const stats = getVaultStats(data);

    return {
      key,
      symbol: key,
      vaultId: info.id,
      tvlTokens: round(stats.tvl.toNumber(), 8),
      apr: round(stats.apr, 6),
      apy: round(stats.apy, 6),
    };
  }).sort((left, right) => right.tvlTokens - left.tvlTokens);
}

async function collectStablePools() {
  const pools = await Promise.all(
    STABLE_POOL_KEYS.map(async (key) => {
      const info = SUPPLY_POOL_INFOS[key];
      const pool = await info.fetch(client);
      const facil = pool.data.debtInfo.contents[0];

      return {
        key,
        symbol: key,
        poolId: info.id,
        availableLiquidityUsd: round(
          normalizeBigIntAmount(pool.data.availableBalance.value, pool.T.decimals),
          2
        ),
        utilization: round(Number(pool.calcUtilization().toString()), 6),
        borrowApr: facil ? round(normalizeAprBps(pool.calcInterestRateBps(facil.key)), 6) : 0,
        lendFacilId: facil?.key || "",
        lendFacilCount: pool.data.debtInfo.contents.length,
      };
    })
  );

  return pools.sort((left, right) => right.availableLiquidityUsd - left.availableLiquidityUsd);
}

const [vaults, stablePools] = await Promise.all([collectVaults(), collectStablePools()]);
const primaryVault = vaults[0] || null;
const stableContext = stablePools[0] || null;

process.stdout.write(
  `${JSON.stringify(
    {
      updatedAt: new Date().toISOString(),
      primaryVault,
      stableContext,
      vaults,
      stablePools,
    },
    null,
    2
  )}\n`
);
