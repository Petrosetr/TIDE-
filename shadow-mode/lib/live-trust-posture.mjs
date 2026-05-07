import { isRemoteUrl } from "./pack-signature.mjs";
import { allowsUnsignedForecast } from "./runtime-config.mjs";

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isLocalOrigin(origin = "") {
  try {
    const hostname = new URL(origin || "https://example.invalid").hostname.toLowerCase();
    return hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]" ||
      hostname.endsWith(".localhost");
  } catch {
    return false;
  }
}

function getNetwork(config = {}) {
  const value = text(config?.sui?.network).toLowerCase();
  return ["mainnet", "testnet", "devnet"].includes(value) ? value : "mainnet";
}

function getRailMode({ current = null, railPack = null } = {}) {
  const summaryMode = text(current?.report?.summary?.railDataMode).toLowerCase();
  if (summaryMode) return summaryMode;
  return railPack ? "live" : "fixture";
}

function formatNetworkLabel(network = "mainnet") {
  if (network === "testnet") return "Testnet";
  if (network === "devnet") return "Devnet";
  return "Mainnet";
}

function buildSignatureFact({ railPack, verifyKeyConfigured }) {
  if (!railPack) {
    return {
      label: "Rail pack signature",
      value: "No read-back pack",
      copy: "Workspace is using starter fixtures until a signed read-only rail pack is loaded.",
      tone: "neutral",
    };
  }

  const remote = isRemoteUrl(railPack.remoteUrl || railPack.url || "");
  if (!remote) {
    return {
      label: "Rail pack signature",
      value: "Bundled pack",
      copy: "The loaded rail pack came from the static build or a local import, not a remote signed feed.",
      tone: "neutral",
    };
  }

  if (railPack.signatureVerified === true) {
    return {
      label: "Rail pack signature",
      value: "Verified",
      copy: "The remote rail pack signature matched the configured verification key.",
      tone: "success",
    };
  }

  return {
    label: "Rail pack signature",
    value: verifyKeyConfigured ? "Rejected" : "Unsigned",
    copy: verifyKeyConfigured
      ? "A verification key is configured, but the active remote pack is not marked as verified."
      : "Remote rail packs need a verification key before they can be treated as trusted inputs.",
    tone: "warn",
  };
}

export function buildLiveTrustPosture({
  config = {},
  railPack = null,
  current = null,
  origin = "",
} = {}) {
  const network = getNetwork(config);
  const networkLabel = formatNetworkLabel(network);
  const allowSigning = config?.executionProof?.allowSigning === true;
  const liveEnabled = config?.liveEnabled === true;
  const railPackConfig = config?.liveRailPack && typeof config.liveRailPack === "object"
    ? config.liveRailPack
    : {};
  const verifyKeyConfigured = Boolean(text(railPackConfig.verifyKey));
  const unsignedForecastAllowed = allowsUnsignedForecast(config, origin);
  const localOrigin = isLocalOrigin(origin);
  const activePack = railPack && Array.isArray(railPack.rails) && railPack.rails.length > 0
    ? railPack
    : null;
  const railMode = getRailMode({ current, railPack: activePack });
  const remotePack = activePack && isRemoteUrl(activePack.remoteUrl || activePack.url || "");
  const signedRemotePack = Boolean(remotePack && activePack.signatureVerified === true);
  const bundledPack = Boolean(activePack && !remotePack);

  const blockers = [];
  const warnings = [];

  if (network === "mainnet" && allowSigning) {
    blockers.push("Mainnet signing is enabled. This violates the MVP safety invariant.");
  }
  if (remotePack && !signedRemotePack) {
    blockers.push("Active remote rail pack is not signature-verified.");
  }
  if (!activePack && railMode === "live") {
    warnings.push("Run claims live rail mode, but no active rail pack is loaded.");
  }
  if (unsignedForecastAllowed && !localOrigin) {
    blockers.push("Unsigned market forecasts are allowed on a non-local origin.");
  } else if (unsignedForecastAllowed) {
    warnings.push("Unsigned market forecasts are allowed only because this is a local development origin.");
  }

  let badge = "Fixture mode";
  let status = "fixture";
  let tone = "neutral";
  let copy = "Workspace is using modeled fixtures. This is safe for simulation, but it is not live rail evidence.";

  if (activePack) {
    badge = bundledPack ? "Bundled pack" : signedRemotePack ? "Signed read-only pack" : "Unsigned rail pack";
    status = bundledPack ? "bundled" : signedRemotePack ? "signed" : "unsigned";
    tone = signedRemotePack ? "success" : bundledPack ? "neutral" : "warn";
    copy = signedRemotePack
      ? "Remote rail inputs are signature-verified read-backs. Forecast and execution still obey their own fail-closed gates."
      : bundledPack
        ? "Rail data is present, but it came from a bundled or local pack. Treat it as read-only context, not a signed ops feed."
        : "Rail data is present but not trusted as a signed remote feed. Keep execution blocked until this is fixed.";
  }

  if (blockers.length > 0) {
    badge = "Blocked trust path";
    status = "blocked";
    tone = "danger";
    copy = blockers[0];
  }

  const facts = [
    {
      label: "Data mode",
      value: railMode === "live" ? "Read-only rail data" : railMode === "mixed" ? "Mixed rail context" : "Fixture rails",
      copy: activePack
        ? "Route data can use the active rail pack, but modeled snapshots remain modeled until protocol read-back proves otherwise."
        : "No live rail pack is active, so route data is fixture-backed.",
      tone: activePack ? "neutral" : "warn",
    },
    buildSignatureFact({ railPack: activePack, verifyKeyConfigured }),
    {
      label: "Forecast policy",
      value: unsignedForecastAllowed ? "Unsigned allowed" : "Signed required",
      copy: unsignedForecastAllowed
        ? localOrigin
          ? "Allowed only for local development."
          : "Non-local unsigned forecasts should never reach deployable environments."
        : "Remote forecast inputs must be signed or they are rejected by the client/build gates.",
      tone: unsignedForecastAllowed ? "warn" : "success",
    },
    {
      label: "Signing posture",
      value: allowSigning ? `${networkLabel} receipt mode` : `${networkLabel} read-only`,
      copy: allowSigning
        ? "Wallet signing is limited to receipt/test environments. Mainnet signing is rejected at build time."
        : liveEnabled
          ? "Live surfaces can monitor and explain policy state, but wallet execution remains disabled."
          : "Live surfaces stay in read-only preview mode.",
      tone: allowSigning ? (network === "mainnet" ? "danger" : "success") : "neutral",
    },
  ];

  return {
    badge,
    status,
    tone,
    copy,
    blockers,
    warnings,
    facts,
    signedRemotePack,
    bundledPack,
    unsignedForecastAllowed,
    allowSigning,
    network,
    railMode,
  };
}
