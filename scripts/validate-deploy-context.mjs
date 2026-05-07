import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseBoolean(value) {
  const normalized = normalizeString(value).toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function hasEnvValue(env, name) {
  return Object.prototype.hasOwnProperty.call(env, name) && normalizeString(env[name]) !== "";
}

function tryParseUrl(value, label, errors) {
  const raw = normalizeString(value);
  if (!raw) {
    errors.push(`${label} is required.`);
    return null;
  }
  try {
    return new URL(raw);
  } catch {
    errors.push(`${label} is not a valid URL: ${raw}`);
    return null;
  }
}

function expect(condition, message, errors) {
  if (!condition) errors.push(message);
}

export function validateDeployContext(env = process.env) {
  const errors = [];
  const channel = normalizeString(env.TIDE_DEPLOY_CHANNEL);
  const target = normalizeString(env.TIDE_DEPLOY_TARGET);
  const eventName = normalizeString(env.GITHUB_EVENT_NAME);
  const refName = normalizeString(env.GITHUB_REF_NAME || env.GITHUB_HEAD_REF);
  const landingUrl = tryParseUrl(env.TIDE_LANDING_URL, "TIDE_LANDING_URL", errors);
  const workspaceUrl = tryParseUrl(env.TIDE_WORKSPACE_URL, "TIDE_WORKSPACE_URL", errors);
  const envName = normalizeString(env.TIDE_ENV);
  const suiNetwork = normalizeString(env.TIDE_SUI_NETWORK || "mainnet");
  const liveEnabled = parseBoolean(env.TIDE_LIVE_ENABLED);
  const executionProofEnabled = parseBoolean(env.TIDE_EXECUTION_PROOF_ENABLED);
  const allowSigning = parseBoolean(env.TIDE_EXECUTION_PROOF_ALLOW_SIGNING);
  const confirmRef = normalizeString(env.TIDE_DEPLOY_CONFIRM_REF);
  const deployUser = normalizeString(env.PROD_USER);

  expect(["dev", "testnet", "production"].includes(channel), `Unsupported TIDE_DEPLOY_CHANNEL: ${channel || "(empty)"}.`, errors);

  if (landingUrl) {
    expect(landingUrl.hostname === "tidesui.pro", `Landing host must stay tidesui.pro, got ${landingUrl.hostname}.`, errors);
  }

  if (channel === "dev") {
    expect(refName !== "main", "Dev/Testnet deploy must never run from main.", errors);
    if (eventName === "push") {
      expect(
        refName.startsWith("dev/"),
        `Dev workflow push ref must be dev/**, got ${refName || "(empty)"}.`,
        errors,
      );
    }

    if (target === "dev") {
      expect(workspaceUrl?.hostname === "dev.tidesui.pro", `Dev target must deploy to dev.tidesui.pro, got ${workspaceUrl?.hostname || "(empty)"}.`, errors);
      expect(suiNetwork === "mainnet", `Dev target must stay on mainnet read-only, got ${suiNetwork}.`, errors);
      expect(liveEnabled === false, "Dev target must keep Live disabled.", errors);
      expect(executionProofEnabled === false, "Dev target must keep execution proof disabled.", errors);
      expect(allowSigning === false, "Dev target must keep signing disabled.", errors);
    } else if (target !== "testnet") {
      errors.push(`Unsupported dev deploy target: ${target || "(empty)"}.`);
    }
  }

  if (channel === "testnet" || (channel === "dev" && target === "testnet")) {
    expect(target === "testnet", `Testnet deploy target must be testnet, got ${target || "(empty)"}.`, errors);
    expect(workspaceUrl?.hostname === "testnet.tidesui.pro", `Testnet target must deploy to testnet.tidesui.pro, got ${workspaceUrl?.hostname || "(empty)"}.`, errors);
    expect(suiNetwork === "testnet", `Testnet target must stay on testnet, got ${suiNetwork}.`, errors);
    expect(liveEnabled === true, "Testnet target must keep Live enabled for proof flows.", errors);
    expect(executionProofEnabled === true, "Testnet target must keep execution proof enabled.", errors);
    expect(allowSigning === true, "Testnet target must keep signing enabled.", errors);

    if (channel === "testnet" && eventName === "push") {
      expect(refName === "main", `Public testnet push deploy must come from main, got ${refName || "(empty)"}.`, errors);
      expect(deployUser !== "", "Public testnet deploy must set PROD_USER to the non-root deploy account.", errors);
      expect(deployUser !== "root", "Public testnet deploy must use a non-root PROD_USER such as tide-deploy.", errors);
    }
  }

  if (channel === "production") {
    expect(target === "prod", `Production deploy target must be prod, got ${target || "(empty)"}.`, errors);
    expect(envName === "production", `Production workflow must set TIDE_ENV=production, got ${envName || "(empty)"}.`, errors);
    expect(workspaceUrl?.hostname === "app.tidesui.pro", `Production workspace host must stay app.tidesui.pro, got ${workspaceUrl?.hostname || "(empty)"}.`, errors);
    expect(suiNetwork === "mainnet", `Production must stay on mainnet, got ${suiNetwork}.`, errors);
    expect(hasEnvValue(env, "TIDE_LIVE_ENABLED"), "Production workflow must explicitly set TIDE_LIVE_ENABLED=false.", errors);
    expect(liveEnabled === false, "Production must keep Live disabled for soft-launch posture.", errors);
    expect(executionProofEnabled === false, "Production must keep execution proof disabled for soft-launch posture.", errors);
    expect(allowSigning === false, "Production must keep signing disabled for soft-launch posture.", errors);
    expect(deployUser !== "", "Production must set PROD_USER to the non-root deploy account.", errors);
    expect(deployUser !== "root", "Production deploy must use a non-root PROD_USER such as tide-deploy.", errors);

    if (eventName === "push") {
      expect(refName === "main", `Production push deploy must come from main, got ${refName || "(empty)"}.`, errors);
    }
    if (eventName === "workflow_dispatch") {
      expect(confirmRef === "main", 'Manual production deploy requires TIDE_DEPLOY_CONFIRM_REF="main".', errors);
      expect(refName === "main", `Manual production deploy must run on main, got ${refName || "(empty)"}.`, errors);
    }
  }

  return errors;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const errors = validateDeployContext(process.env);
  if (errors.length) {
    console.error("Deploy context validation failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
  console.log("Deploy context is valid.");
}
