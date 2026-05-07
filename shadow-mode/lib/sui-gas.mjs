export const SUI_GAS_BUDGETS = Object.freeze({
  POLICY_CREATE: 25_000_000,
  POLICY_UPDATE: 25_000_000,
  POLICY_SELECT_RAIL: 25_000_000,
  POLICY_MIGRATE: 25_000_000,
  POLICY_DELETE: 25_000_000,
  RECEIPT_MINT: 30_000_000,
  RECEIPT_SELECT_RAIL_AND_MINT: 35_000_000,
  LIVE_CETUS_SWAP: 60_000_000,
  LIVE_SCALLOP_MANAGE: 50_000_000,
  LIVE_NAVI_MANAGE: 45_000_000,
  LIVE_BUCKET_MANAGE: 30_000_000,
  LIVE_SUILEND_MANAGE: 40_000_000,
});

export function getSuiGasBudget(operation) {
  const key = String(operation || "").trim();
  const budget = SUI_GAS_BUDGETS[key];
  if (!Number.isSafeInteger(budget) || budget <= 0) {
    throw new Error(`Unknown Sui gas budget operation: ${key || "(empty)"}`);
  }
  return budget;
}
