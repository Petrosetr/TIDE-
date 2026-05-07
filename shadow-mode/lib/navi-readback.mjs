import { fetchManualMainnetEventReadback } from "./mainnet-event-readback.mjs";

export const NAVI_READBACK_SHAPE_VERSION = 1;

export async function fetchNaviReadback({
  accountId = "",
  obligationId = "",
  walletAddress = "",
  railId = "navi-sui",
  observedAt = undefined,
  staleMaxMs = undefined,
} = {}) {
  return fetchManualMainnetEventReadback({
    railId,
    protocolLabel: "NAVI",
    walletAddress,
    obligationId: obligationId || accountId,
    accountId: accountId || obligationId,
    observedAt,
    staleMaxMs,
  });
}
