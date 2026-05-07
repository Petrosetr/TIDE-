#!/usr/bin/env node

import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { AlphalendClient } from "@alphafi/alphalend-sdk";

function toNumericString(value) {
  return value?.toString?.() ?? String(value ?? 0);
}

const client = new SuiClient({ url: getFullnodeUrl("mainnet") });
const alphalend = new AlphalendClient("mainnet", client);
const markets = await alphalend.getAllMarkets();

const normalized = markets.map((market) => ({
  marketId: String(market.marketId),
  coinType: String(market.coinType),
  symbol: String(market.coinType).split("::").pop() || String(market.coinType),
  price: Number(toNumericString(market.price)),
  totalSupply: Number(toNumericString(market.totalSupply)),
  totalBorrow: Number(toNumericString(market.totalBorrow)),
  utilizationRate: Number(toNumericString(market.utilizationRate)),
  supplyApr: Number(toNumericString(market.supplyApr?.interestApr)),
  borrowApr: Number(toNumericString(market.borrowApr?.interestApr)),
  ltv: Number(toNumericString(market.ltv)),
  liquidationThreshold: Number(toNumericString(market.liquidationThreshold)),
  availableLiquidity: Number(toNumericString(market.availableLiquidity)),
  allowedBorrowAmount: Number(toNumericString(market.allowedBorrowAmount)),
}));

process.stdout.write(`${JSON.stringify(normalized, null, 2)}\n`);
