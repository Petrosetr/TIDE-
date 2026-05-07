import { fetchManualMainnetEventReadback } from "./mainnet-event-readback.mjs";

export const SCALLOP_READBACK_SHAPE_VERSION = 1;

export async function fetchScallopReadback({
  obligationId = "",
  walletAddress = "",
  railId = "scallop-sui",
  observedAt = undefined,
  staleMaxMs = undefined,
} = {}) {
  return fetchManualMainnetEventReadback({
    railId,
    protocolLabel: "Scallop",
    walletAddress,
    obligationId,
    observedAt,
    staleMaxMs,
  });
}
