import {
  findSuilendObligationOwnerCap,
  getProtocolExecutionCapability,
} from "./execution.mjs";
import { getRailDisplay, lookupRailIdByDisplay } from "./policy-ids.mjs";
import { fetchSuilendReadback } from "./suilend-readback.mjs";

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRailId(value) {
  return lookupRailIdByDisplay(value) || normalizeText(value);
}

function isLiveReadbackSource(value) {
  const source = normalizeText(value).toLowerCase();
  return source === "live" || source === "live-mainnet-readonly";
}

function getExecutionSupportFacts(railId = "") {
  const capability = getProtocolExecutionCapability(railId);
  if (!capability) {
    return {
      executionLevel: "unknown",
      signable: false,
      executionLabel: "Execution unknown",
      executionMessage: "",
    };
  }

  if (capability.signable && capability.overflowGated) {
    return {
      executionLevel: "proof-gated",
      signable: false,
      sdkPresent: true,
      executionLabel: "SDK present, signing gated",
      executionMessage: capability.message || "",
    };
  }

  if (capability.signable) {
    return {
      executionLevel: capability.level || "signable",
      signable: true,
      sdkPresent: true,
      executionLabel: "Signable rail",
      executionMessage: capability.message || "",
    };
  }

  if (capability.builderAvailable) {
    return {
      executionLevel: capability.level || "builder-only",
      signable: false,
      executionLabel: "Builder only",
      executionMessage: capability.message || "",
    };
  }

  return {
    executionLevel: capability.level || "monitor-only",
    signable: false,
    executionLabel: capability.level === "monitor-only" ? "Monitor-only" : "Read-only support",
    executionMessage: capability.message || "",
  };
}

function buildSupportProfile(railId = "") {
  const resolvedRailId = normalizeRailId(railId);
  const railLabel = getRailDisplay(resolvedRailId) || resolvedRailId || "Underlying rail";
  const executionSupport = getExecutionSupportFacts(resolvedRailId);

  if (resolvedRailId === "suilend-sui") {
    return {
      railId: resolvedRailId,
      railLabel,
      label: "Direct obligation posture",
      status: "refreshable",
      badge: "Owner-cap",
      tone: "success",
      refreshable: true,
      ...executionSupport,
      copy: "TIDE can verify whether this wallet currently holds a Suilend obligation owner-cap. Rail balances still need the Suilend UI as source of truth.",
    };
  }

  const unsupportedCopy = resolvedRailId === "alphalend-sui"
    ? "AlphaLend stays monitor-only in TIDE. Use wallet context, receipts, and the AlphaLend UI as source of truth."
    : `${railLabel} obligation read-back is not wired yet. Use wallet context, action receipts, and the underlying rail UI as source of truth.`;

  return {
    railId: resolvedRailId,
    railLabel,
    label: executionSupport.sdkPresent ? "SDK present, signing gated" : "Wallet + proof only",
    status: executionSupport.sdkPresent ? "sdk-gated-no-readback" : "unsupported",
    badge: executionSupport.sdkPresent ? "SDK gated" : "Wallet + proof",
    tone: executionSupport.sdkPresent ? "warning" : "neutral",
    refreshable: false,
    ...executionSupport,
    copy: unsupportedCopy,
  };
}

export async function fetchLiveProtocolReadback({
  railId = "",
  walletAddress = "",
  obligationResolver = findSuilendObligationOwnerCap,
  readbackFetcher = fetchSuilendReadback,
  network = "testnet",
  rpcUrl = null,
  fetchImpl = null,
} = {}) {
  const support = buildSupportProfile(railId);
  const fetchedAt = new Date().toISOString();

  if (!normalizeText(walletAddress)) {
    return {
      ...support,
      status: "wallet-disconnected",
      fetchedAt,
      ownerCapId: "",
      obligationId: "",
      error: "",
      copy: "Connect a wallet to inspect protocol posture for this rail.",
    };
  }

  if (!support.refreshable) {
    return {
      ...support,
      fetchedAt,
      ownerCapId: "",
      obligationId: "",
      error: "",
    };
  }

  try {
    const { ownerCapId, obligationId } = await obligationResolver(walletAddress, {
      railId: support.railId,
      network,
      rpcUrl,
      fetchImpl,
    });
    if (!ownerCapId || !obligationId) {
      return {
        ...support,
        status: "error",
        fetchedAt,
        ownerCapId: ownerCapId || "",
        obligationId: obligationId || "",
        error: "Suilend owner-cap was found, but the linked obligation ID could not be resolved.",
        copy: "Suilend owner-cap exists, but TIDE could not resolve its obligation object cleanly. Use the rail UI as source of truth until this is fixed.",
      };
    }

    let balanceReadback = null;
    let readbackError = "";
    try {
      balanceReadback = typeof readbackFetcher === "function"
        ? await readbackFetcher({
            obligationId,
            walletAddress,
            railId: support.railId,
            network,
            rpcUrl,
            fetchImpl,
          })
        : null;
    } catch (err) {
      readbackError = err instanceof Error ? err.message : String(err);
    }

    const hasLiveBalanceReadback = isLiveReadbackSource(balanceReadback?.source);
    const readbackIsMainnetReadonly = normalizeText(balanceReadback?.source).toLowerCase() === "live-mainnet-readonly";
    return {
      ...support,
      status: hasLiveBalanceReadback ? "detected-live-readback" : "detected",
      fetchedAt,
      ownerCapId,
      obligationId,
      error: "",
      balanceReadback,
      readbackError,
      badge: hasLiveBalanceReadback
        ? readbackIsMainnetReadonly ? "Mainnet observed" : "Live read-back"
        : support.badge,
      copy: hasLiveBalanceReadback
        ? readbackIsMainnetReadonly
          ? "Suilend owner-cap, obligation object, and debt/collateral snapshot were read from mainnet Sui RPC. TIDE did not sign mainnet; review the rail UI as source of truth."
          : "Suilend owner-cap, obligation object, and debt/collateral snapshot were read from Sui RPC. Review the rail UI before signing."
        : "Suilend owner-cap and obligation object were detected for this wallet. Debt and collateral balances still need the rail UI as source of truth.",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/No Suilend obligation owner-cap/i.test(message)) {
      return {
        ...support,
        status: "missing",
        fetchedAt,
        ownerCapId: "",
        obligationId: "",
        error: "",
        copy: "No Suilend obligation owner-cap was found for this wallet. Open or restore the rail position first, then refresh protocol posture.",
      };
    }
    return {
      ...support,
      status: "error",
      fetchedAt,
      ownerCapId: "",
      obligationId: "",
      error: message,
      copy: "TIDE could not refresh the rail posture from chain. Keep the rail UI and wallet as source of truth until the next refresh succeeds.",
    };
  }
}

export function buildLiveProtocolReadbackModel({
  railId = "",
  latestReceipt = null,
  latestReadback = null,
} = {}) {
  const support = buildSupportProfile(railId);
  const latestReceiptAt = latestReceipt?.createdAtMs || latestReceipt?.createdAt || latestReceipt?.timestamp || 0;
  const next = latestReadback && normalizeRailId(latestReadback.railId) === support.railId
    ? { ...support, ...latestReadback }
    : support;
  const balanceSource = normalizeText(next.balanceReadback?.source).toLowerCase();
  const hasLiveReadback = isLiveReadbackSource(balanceSource);
  const mainnetReadonly = balanceSource === "live-mainnet-readonly";

  return {
    ...next,
    latestReceipt,
    latestReceiptAt,
    truthBoundary: next.refreshable
      ? hasLiveReadback
        ? mainnetReadonly
          ? `Suilend obligation read-back is live from mainnet Sui RPC (${next.balanceReadback.trustLabel || "not execution"}). TIDE did not sign mainnet; the rail UI remains the source of truth.`
          : `Suilend obligation read-back is live from Sui RPC (${next.balanceReadback.trustLabel || "not execution"}). Review the rail UI before signing.`
        : `Owner-cap detection only. ${next.executionLabel || "Rail support"} is available, but the rail UI remains the source of truth for live debt, collateral, and health.`
      : `${next.executionLabel || "Wallet + proof"} is available here. Rail UI remains the source of truth for live obligation state.`,
  };
}
