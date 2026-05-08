/**
 * wallet.js — Sui Wallet Connection for TIDE Console
 *
 * - Wallet Standard discovery (no npm dependency)
 * - Modal picker: detected wallets + catalog of known wallets with install links
 * - Message signing for auth
 * - On-chain BTC balance reading via raw JSON-RPC
 */

import { resolveOpsBaseUrl } from "./lib/runtime-config.mjs";
import {
  assertSuiNetworkExplicit,
  getSuiNetwork,
  getSuiRpcUrl,
  getSuiRpcUrlsWithFallback,
  getSuiWalletChain,
  buildSuiExplorerUrl,
  postSuiRpcWithFallback,
} from "./lib/sui-network.mjs";
import {
  getAllowedMoveTargets as deriveAllowedMoveTargets,
  collectMoveCallTargets as collectMoveCallTargetsPure,
  collectPtbCommandKinds,
  checkAllowlist,
} from "./lib/move-allowlist.mjs";
const STORAGE_WALLET_KEY = "tide.shadow-mode.wallet.v1";
const STORAGE_SESSION_KEY = "tide.shadow-mode.session.v1";
const TIDE_PRE_SIGN_VALIDATOR = "__tideValidateBeforeSign";
const BTC_DECIMALS = 8;
const SUI_WBTC_COIN_TYPE = "0xaafb102dd0902f5055cadecd687fb5b71ca82ef0e0285d90afde828ec58ca96b::btc::BTC";
const WBTC_COIN_TYPE = "0x0041f9f9344cac094454cd574e333c4fdb132d7bcc9379bcd4aab485b2a63942::wbtc::WBTC";
const LBTC_COIN_TYPE = "0x3e8e9423d80e1774a7ca128fccd8bf5f1f7753be658c5e645929037f7c819040::lbtc::LBTC";
const XBTC_COIN_TYPE = "0x876a4b7bce8aeaef60464c11f4026903e9afacab79b9b142686158aa86560b50::xbtc::XBTC";
const BTC_TOKEN_LOGO_ROOT = "/assets/logos/tokens";
const BTC_TOKEN_FALLBACK_ICON = `${BTC_TOKEN_LOGO_ROOT}/btc.svg`;

// Single source of truth for every BTC wrapper the composer shows. Adding a
// new wrapper = one entry here. `rails` names live lending markets that quote
// this collateral (pulled from the rail-pack live data — if empty, no live
// lending path). LBTC is intentionally not in this supported-wrapper list:
// it can be observed in connected wallets, but current TIDE Live rehearsal
// rails do not quote it.
const BTC_WRAPPERS = [
  {
    symbol: "wBTC",
    title: "wBTC",
    subtitle: "Sui Bridge · Scallop (sbwBTC market)",
    coinType: SUI_WBTC_COIN_TYPE,
    aliases: [WBTC_COIN_TYPE],
    icon: `${BTC_TOKEN_LOGO_ROOT}/wbtc.svg`,
    fallbackIcon: BTC_TOKEN_FALLBACK_ICON,
    rails: ["scallop", "suilend", "alphalend"],
    manual: false,
  },
  {
    symbol: "xBTC",
    title: "xBTC",
    subtitle: "OKX Wrapped BTC · NAVI",
    coinType: XBTC_COIN_TYPE,
    aliases: [],
    icon: `${BTC_TOKEN_LOGO_ROOT}/xbtc.svg`,
    fallbackIcon: BTC_TOKEN_FALLBACK_ICON,
    rails: ["navi"],
    manual: false,
  },
  {
    symbol: "BTC",
    title: "Bitcoin",
    subtitle: "Manual simulation asset · Bucket",
    coinType: "",
    aliases: [],
    icon: BTC_TOKEN_FALLBACK_ICON,
    fallbackIcon: BTC_TOKEN_FALLBACK_ICON,
    rails: ["bucket"],
    manual: true,
  },
];

function getWrapperEntry(symbol) {
  const key = String(symbol || "").toUpperCase();
  return BTC_WRAPPERS.find((entry) => entry.symbol.toUpperCase() === key);
}

const COLLATERAL_ASSET_PRESETS = BTC_WRAPPERS
  .filter((entry) => !entry.manual)
  .map((entry) => ({ symbol: entry.symbol, coinType: entry.coinType }));

const COLLATERAL_ASSET_META = BTC_WRAPPERS.reduce((acc, entry) => {
  acc[entry.symbol.toUpperCase()] = {
    title: entry.title,
    subtitle: entry.subtitle,
    icon: entry.icon,
    fallbackIcon: entry.fallbackIcon,
  };
  return acc;
}, {
  LBTC: {
    title: "LBTC",
    subtitle: "Observed wallet asset · no active TIDE rail",
    icon: `${BTC_TOKEN_LOGO_ROOT}/lbtc.svg`,
    fallbackIcon: BTC_TOKEN_FALLBACK_ICON,
  },
});

// Per-wrapper price. In Live mode, prefers the rail-pack rate for that
// wrapper (Navi for xBTC, Suilend/Alphalend for WBTC, Scallop's sbwBTC
// market for wBTC, Bucket for BTC). In Simulation mode, honors the user's
// spot override — the whole point of simulation is to test with custom
// assumptions, so ignoring the override there made the "≈ $" echo next
// to the amount input lie. Falls back to basePrice when the resolver
// isn't published yet (early boot) or the wrapper has no rail.
function getLiveWrapperPriceUsd(symbol, basePrice = 0, options = {}) {
  const preferOverride = options && options.preferOverride === true;
  if (!preferOverride) {
    const resolver = typeof window !== "undefined" ? window.__tideLiveWrapperPriceUsd : null;
    if (typeof resolver === "function") {
      const resolved = Number(resolver(symbol) || 0);
      if (Number.isFinite(resolved) && resolved > 0) return resolved;
    }
  }
  return Math.max(0, Number(basePrice) || 0);
}

// Wallet balance normalizer: match BTC-ish token symbols in the connected
// wallet to our canonical wrapper labels. Order matters — longest/most
// specific matches first so "sbwBTC" doesn't get swallowed by "wBTC".
const BTC_SYMBOL_PATTERNS = [
  ["sbwbtc", "sbwBTC"],
  ["stbtc", "stBTC"],
  ["lbtc", "LBTC"],
  ["xbtc", "xBTC"],
  ["nbtc", "nBTC"],
  ["mbtc", "mBTC"],
  ["wbtc", "wBTC"],
  ["btc", "BTC"],
];

// Build the coin-type lookup from the registry. The 0x02779…::coin::COIN
// entry is a legacy bridge variant that pre-dates the current Sui Bridge
// coin type — still held by some wallets, treated as wBTC.
const KNOWN_BTC_COIN_TYPES = new Map([
  ["0x027792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242d896881::coin::COIN", "wBTC"],
  [LBTC_COIN_TYPE.toLowerCase(), "LBTC"],
]);
for (const entry of BTC_WRAPPERS) {
  if (entry.coinType) KNOWN_BTC_COIN_TYPES.set(entry.coinType.toLowerCase(), entry.symbol);
  for (const alias of entry.aliases || []) {
    if (alias) KNOWN_BTC_COIN_TYPES.set(alias.toLowerCase(), entry.symbol);
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return char;
    }
  });
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function sanitizeExternalUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, window.location.href);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.href;
    }
  } catch (_) {}
  return "";
}

function sanitizeAssetUrl(value, fallback = "") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  if (/^(?:\.{1,2}\/|\/)/.test(raw)) {
    return raw;
  }
  return sanitizeExternalUrl(raw) || fallback;
}

function getSafeSessionStorage() {
  try {
    return window.sessionStorage;
  } catch (_) {
    return null;
  }
}

function getSafeLocalStorage() {
  try {
    return window.localStorage;
  } catch (_) {
    return null;
  }
}

function parseStoredSession(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.address || !parsed.token || !parsed.expiresAt) return null;
    if (Date.parse(parsed.expiresAt) <= Date.now() + 15_000) return null;
    return parsed;
  } catch {
    return null;
  }
}

function bindWalletImages(root) {
  if (!(root instanceof Element || root instanceof DocumentFragment)) return;
  root.querySelectorAll(".wm-wallet-icon, .wallet-icon").forEach((img) => {
    if (!(img instanceof HTMLImageElement) || img.dataset.fallbackBound === "1") return;
    img.dataset.fallbackBound = "1";
    img.addEventListener("error", () => {
      const fallback = img.getAttribute("data-fallback-src");
      if (fallback && img.getAttribute("src") !== fallback) {
        img.setAttribute("src", fallback);
        return;
      }
      img.style.display = "none";
    });
  });
}

/* ------------------------------------------------------------------ */
/*  Known Sui wallets catalog                                         */
/* ------------------------------------------------------------------ */

const KNOWN_WALLETS = [
  { name: "Slush",              installUrl: "https://slush.app",                        icon: "https://slush.app/favicon.ico",       aliases: ["Slush Wallet", "Slush (Sui)"] },
  { name: "Phantom",            installUrl: "https://phantom.app/download",             icon: "https://phantom.app/favicon.ico" },
  { name: "OKX Wallet",         installUrl: "https://www.okx.com/web3",                 icon: "https://static.okx.com/cdn/assets/imgs/247/58E63FEA47A2B7A7.png", aliases: ["OKX", "OKX Web3"] },
  { name: "Backpack",           installUrl: "https://backpack.app/downloads",           icon: "https://backpack.app/favicon.ico" },
  { name: "Sui Wallet",         installUrl: "https://chrome.google.com/webstore/detail/sui-wallet/opcgpfmipidbgpenhmajoajpbobppdil", icon: "https://sui.io/favicon.ico" },
  { name: "Suiet",              installUrl: "https://suiet.app",                        icon: "https://suiet.app/favicon.ico" },
  { name: "Martian Sui Wallet", installUrl: "https://martianwallet.xyz",                icon: "https://martianwallet.xyz/favicon.ico" },
  { name: "Binance Web3 Wallet",installUrl: "https://www.binance.com/en/web3wallet",    icon: "https://bin.bnbstatic.com/static/images/common/favicon.ico" },
  { name: "Bitget Wallet",      installUrl: "https://web3.bitget.com",                  icon: "https://web3.bitget.com/favicon.ico" },
  { name: "Bybit Wallet",       installUrl: "https://www.bybit.com/web3",               icon: "https://www.bybit.com/favicon.ico" },
  { name: "Gate Wallet",        installUrl: "https://www.gate.io/web3",                 icon: "https://www.gate.io/favicon.ico" },
  { name: "Coin98",             installUrl: "https://coin98.com/wallet",                icon: "https://coin98.com/favicon.ico" },
  { name: "SafePal",            installUrl: "https://www.safepal.com",                  icon: "https://www.safepal.com/favicon.ico" },
  { name: "Nightly",            installUrl: "https://nightly.app",                      icon: "https://nightly.app/favicon.ico" },
  { name: "WalletConnect",      installUrl: "https://walletconnect.com",                icon: "https://walletconnect.com/favicon.ico" },
];

/* ------------------------------------------------------------------ */
/*  Wallet Standard discovery                                         */
/* ------------------------------------------------------------------ */

const WALLET_DISCOVERY_FALLBACK_DELAYS_MS = [250, 500, 1000, 2000, 4000, 8000];
const WALLET_DISCOVERY_FALLBACK_MAX_ATTEMPTS = 12;

function shouldLogWalletDiscovery() {
  try {
    return Boolean(
      window.TIDE_DEBUG_WALLET_DISCOVERY ||
      window.localStorage?.getItem("tide.debug.wallets") === "1"
    );
  } catch (_) {
    return Boolean(window.TIDE_DEBUG_WALLET_DISCOVERY);
  }
}

function discoverWallets() {
  const wallets = new Map();
  const listeners = new Set();
  const wrappedProviders = new WeakMap();

  function register(wallet) {
    if (!wallet?.name || wallets.has(wallet.name)) return false;
    // Accept wallets that explicitly support Sui or don't declare chains yet
    const hasSui = !wallet.chains || wallet.chains.length === 0 || wallet.chains.some((c) => c.startsWith("sui:"));
    if (!hasSui) {
      if (shouldLogWalletDiscovery()) {
        console.debug(`[wallet] ignored: "${wallet.name}" chains=${JSON.stringify(wallet.chains || [])} sui=false`);
      }
      return false;
    }
    if (shouldLogWalletDiscovery()) {
      console.debug(`[wallet] discovered: "${wallet.name}" chains=${JSON.stringify(wallet.chains || [])} sui=true`);
    }
    wallets.set(wallet.name, wallet);
    listeners.forEach((fn) => fn(wallet));
    return true;
  }

  function isWalletStandardLike(candidate) {
    return Boolean(
      candidate &&
      typeof candidate === "object" &&
      typeof candidate.name === "string" &&
      candidate.name.trim() &&
      candidate.features &&
      typeof candidate.features === "object"
    );
  }

  function isLegacySuiProviderLike(candidate) {
    return Boolean(
      candidate &&
      typeof candidate === "object" &&
      (
        typeof candidate.connect === "function" ||
        typeof candidate.request === "function" ||
        typeof candidate.getAccounts === "function" ||
        typeof candidate.signAndExecuteTransaction === "function" ||
        typeof candidate.signAndExecuteTransactionBlock === "function" ||
        typeof candidate.signTransaction === "function" ||
        typeof candidate.signTransactionBlock === "function" ||
        typeof candidate.signPersonalMessage === "function" ||
        typeof candidate.signMessage === "function"
      )
    );
  }

  function normalizeLegacyAccount(raw, wallet) {
    if (!raw) {
      return null;
    }

    const features = Object.keys(wallet.features || {});
    const chains = Array.isArray(wallet.chains) && wallet.chains.length ? wallet.chains : [getSuiWalletChain(window.TIDE_CONFIG || {})];

    if (typeof raw === "string") {
      return {
        address: raw,
        chains,
        features,
      };
    }

    if (typeof raw !== "object") {
      return null;
    }

    const address =
      raw.address ||
      raw.accountAddress ||
      raw.userAddress ||
      raw.publicAddress ||
      raw.addr ||
      "";

    if (!address || typeof address !== "string") {
      return null;
    }

    return {
      ...raw,
      address,
      chains: Array.isArray(raw.chains) && raw.chains.length ? raw.chains : chains,
      features: Array.isArray(raw.features) && raw.features.length ? raw.features : features,
    };
  }

  function extractLegacyAccounts(result, provider) {
    const candidates = [
      result?.accounts,
      result?.account ? [result.account] : null,
      result?.addresses,
      Array.isArray(result) ? result : null,
      provider?.accounts,
      provider?.connectedAccounts,
      provider?.selectedAccounts,
      provider?.selectedAddress ? [provider.selectedAddress] : null,
      provider?.address ? [provider.address] : null,
    ];

    for (const candidate of candidates) {
      if (Array.isArray(candidate) && candidate.length) {
        return candidate;
      }
    }

    return [];
  }

  async function requestLegacyAccounts(provider) {
    if (typeof provider.getAccounts === "function") {
      const accounts = await provider.getAccounts();
      if (Array.isArray(accounts) && accounts.length) {
        return accounts;
      }
    }

    if (typeof provider.request !== "function") {
      return [];
    }

    const methods = [
      "sui_requestAccounts",
      "sui_getAccounts",
      "getAccounts",
      "requestAccounts",
    ];

    for (const method of methods) {
      try {
        const result = await provider.request({ method });
        if (Array.isArray(result) && result.length) {
          return result;
        }
        if (Array.isArray(result?.accounts) && result.accounts.length) {
          return result.accounts;
        }
      } catch (_) {
        // try next legacy method
      }
    }

    return [];
  }

  function createLegacyWalletAdapter(provider, meta = {}) {
    if (wrappedProviders.has(provider)) {
      return wrappedProviders.get(provider);
    }

    let wallet = null;
    let connectedAccounts = [];

    function syncAccounts(rawAccounts) {
      const next = (Array.isArray(rawAccounts) ? rawAccounts : [])
        .map((entry) => normalizeLegacyAccount(entry, wallet))
        .filter(Boolean);
      connectedAccounts = next;
      return next;
    }

    async function connectLegacy() {
      let result = null;

      if (typeof provider.connect === "function") {
        result = await provider.connect();
      } else if (typeof provider.requestPermissions === "function") {
        await provider.requestPermissions();
      }

      let accounts = extractLegacyAccounts(result, provider);
      if (!accounts.length) {
        accounts = await requestLegacyAccounts(provider);
      }

      if (!accounts.length) {
        throw new Error(`${meta.name || provider.name || "Wallet"} did not return any Sui accounts.`);
      }

      return { accounts: syncAccounts(accounts) };
    }

    async function disconnectLegacy() {
      if (typeof provider.disconnect === "function") {
        await provider.disconnect();
      }
      connectedAccounts = [];
    }

    async function signPersonalMessageLegacy(input) {
      if (typeof provider.signPersonalMessage === "function") {
        return provider.signPersonalMessage(input);
      }
      if (typeof provider.signMessage === "function") {
        return provider.signMessage(input);
      }
      if (typeof provider.request === "function") {
        return provider.request({
          method: "sui_signPersonalMessage",
          params: [input],
        });
      }
      throw new Error("Wallet does not support personal message signing");
    }

    async function signTransactionLegacy(input) {
      if (typeof provider.signTransaction === "function") {
        return provider.signTransaction(input);
      }
      if (typeof provider.signTransactionBlock === "function") {
        return provider.signTransactionBlock({
          ...input,
          transactionBlock: input.transaction,
        });
      }
      if (typeof provider.request === "function") {
        return provider.request({
          method: "sui_signTransaction",
          params: [input],
        });
      }
      throw new Error("Wallet does not support transaction signing");
    }

    async function signAndExecuteLegacy(input) {
      if (typeof provider.signAndExecuteTransaction === "function") {
        return provider.signAndExecuteTransaction(input);
      }
      if (typeof provider.signAndExecuteTransactionBlock === "function") {
        return provider.signAndExecuteTransactionBlock({
          ...input,
          transactionBlock: input.transaction,
        });
      }
      if (typeof provider.request === "function") {
        return provider.request({
          method: "sui_signAndExecuteTransaction",
          params: [input],
        });
      }
      throw new Error("Wallet does not support transaction execution");
    }

    const features = {
      "standard:connect": {
        version: "1.0.0",
        connect: connectLegacy,
      },
    };

    if (typeof provider.disconnect === "function") {
      features["standard:disconnect"] = {
        version: "1.0.0",
        disconnect: disconnectLegacy,
      };
    }

    if (
      typeof provider.signPersonalMessage === "function" ||
      typeof provider.signMessage === "function" ||
      typeof provider.request === "function"
    ) {
      features["sui:signPersonalMessage"] = {
        version: "2.0.0",
        signPersonalMessage: signPersonalMessageLegacy,
      };
    }

    if (
      typeof provider.signTransaction === "function" ||
      typeof provider.signTransactionBlock === "function" ||
      typeof provider.request === "function"
    ) {
      features["sui:signTransaction"] = {
        version: "2.0.0",
        signTransaction: signTransactionLegacy,
      };
    }

    if (
      typeof provider.signAndExecuteTransaction === "function" ||
      typeof provider.signAndExecuteTransactionBlock === "function" ||
      typeof provider.request === "function"
    ) {
      features["sui:signAndExecuteTransaction"] = {
        version: "2.0.0",
        signAndExecuteTransaction: signAndExecuteLegacy,
      };
    }

    wallet = {
      version: String(provider.version || "legacy"),
      name: provider.name || meta.name || "Injected Sui Wallet",
      icon: provider.icon || meta.icon || "",
      chains: Array.isArray(provider.chains) && provider.chains.length ? provider.chains : [getSuiWalletChain(window.TIDE_CONFIG || {})],
      features,
      get accounts() {
        return connectedAccounts;
      },
    };

    syncAccounts(extractLegacyAccounts(null, provider));
    wrappedProviders.set(provider, wallet);
    return wallet;
  }

  function adaptCandidate(candidate, meta = {}) {
    if (isWalletStandardLike(candidate)) {
      return candidate;
    }

    if (isLegacySuiProviderLike(candidate)) {
      return createLegacyWalletAdapter(candidate, meta);
    }

    return null;
  }

  function registerInjectedFallbacks() {
    const before = wallets.size;
    const candidates = [
      { wallet: window.okxwallet?.suiMainnet, name: "OKX Wallet", icon: KNOWN_WALLETS.find((wallet) => wallet.name === "OKX Wallet")?.icon || "" },
      { wallet: window.okxwallet?.sui, name: "OKX Wallet", icon: KNOWN_WALLETS.find((wallet) => wallet.name === "OKX Wallet")?.icon || "" },
      { wallet: window.okxwallet?.wallet, name: "OKX Wallet", icon: KNOWN_WALLETS.find((wallet) => wallet.name === "OKX Wallet")?.icon || "" },
      { wallet: window.okxwallet, name: "OKX Wallet", icon: KNOWN_WALLETS.find((wallet) => wallet.name === "OKX Wallet")?.icon || "" },
      { wallet: window.slush?.suiMainnet, name: "Slush", icon: KNOWN_WALLETS.find((wallet) => wallet.name === "Slush")?.icon || "" },
      { wallet: window.slush?.sui, name: "Slush", icon: KNOWN_WALLETS.find((wallet) => wallet.name === "Slush")?.icon || "" },
      { wallet: window.slush?.wallet, name: "Slush", icon: KNOWN_WALLETS.find((wallet) => wallet.name === "Slush")?.icon || "" },
      { wallet: window.slush?.suiWallet, name: "Slush", icon: KNOWN_WALLETS.find((wallet) => wallet.name === "Slush")?.icon || "" },
      { wallet: window.slush, name: "Slush", icon: KNOWN_WALLETS.find((wallet) => wallet.name === "Slush")?.icon || "" },
    ];

    candidates
      .map(({ wallet, ...meta }) => adaptCandidate(wallet, meta))
      .filter(Boolean)
      .forEach((wallet) => register(wallet));
    return wallets.size > before;
  }

  window.addEventListener("wallet-standard:register-wallet", (event) => {
    if (typeof event.detail === "function") {
      event.detail(register);
      return;
    }

    if (typeof event.detail?.register === "function") {
      event.detail.register(register);
      return;
    }

    const directWallets = [
      event.detail?.wallet,
      ...(Array.isArray(event.detail?.wallets) ? event.detail.wallets : []),
      ...(Array.isArray(event.detail) ? event.detail : []),
    ];

    directWallets
      .map((wallet) => adaptCandidate(wallet))
      .filter(Boolean)
      .forEach((wallet) => register(wallet));
  });

  try {
    const appReadyDetail = {
      register: (...ws) => {
        ws.flat()
          .map((wallet) => adaptCandidate(wallet))
          .filter(Boolean)
          .forEach((wallet) => {
            if (wallet.chainName) {
              appReadyDetail[wallet.chainName] = wallet;
            }
            if (wallet.name) {
              appReadyDetail[wallet.name] = wallet;
            }
            register(wallet);
          });
      },
    };

    window.dispatchEvent(
      new CustomEvent("wallet-standard:app-ready", {
        detail: appReadyDetail,
      })
    );
  } catch (_) {}

  registerInjectedFallbacks();

  let fallbackAttempts = 0;
  let fallbackTimer = null;

  function scheduleFallbackDiscovery(delayMs = WALLET_DISCOVERY_FALLBACK_DELAYS_MS[0]) {
    if (fallbackTimer || fallbackAttempts >= WALLET_DISCOVERY_FALLBACK_MAX_ATTEMPTS) {
      return;
    }
    fallbackTimer = window.setTimeout(() => {
      fallbackTimer = null;
      fallbackAttempts += 1;
      const discovered = registerInjectedFallbacks();
      const delayIndex = Math.min(
        fallbackAttempts + (discovered ? 1 : 0),
        WALLET_DISCOVERY_FALLBACK_DELAYS_MS.length - 1
      );
      scheduleFallbackDiscovery(WALLET_DISCOVERY_FALLBACK_DELAYS_MS[delayIndex]);
    }, delayMs);
  }

  function probeInjectedFallbacks() {
    registerInjectedFallbacks();
    fallbackAttempts = Math.min(fallbackAttempts, WALLET_DISCOVERY_FALLBACK_DELAYS_MS.length - 1);
    scheduleFallbackDiscovery();
  }

  scheduleFallbackDiscovery();

  window.addEventListener("load", probeInjectedFallbacks, { once: true });
  window.addEventListener("focus", probeInjectedFallbacks);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      probeInjectedFallbacks();
    }
  });

  return {
    get: () => [...wallets.values()],
    on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

/* ------------------------------------------------------------------ */
/*  JSON-RPC                                                          */
/* ------------------------------------------------------------------ */

let _rpcId = 0;

async function rpc(method, params) {
  const config = window.TIDE_CONFIG || {};
  const res = await postSuiRpcWithFallback({
    urls: getSuiRpcUrlsWithFallback(config),
    body: JSON.stringify({ jsonrpc: "2.0", id: ++_rpcId, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "RPC error");
  return json.result;
}

async function getAllBalances(address) {
  return rpc("suix_getAllBalances", [address]);
}

function filterBtcBalances(balances) {
  return balances.filter((b) => isBtcCoinType(b.coinType));
}

function normalizeCoinType(coinType) {
  return String(coinType || "").trim().toLowerCase();
}

function isBtcCoinType(coinType) {
  const normalized = normalizeCoinType(coinType);
  if (KNOWN_BTC_COIN_TYPES.has(normalized)) {
    return true;
  }
  return BTC_SYMBOL_PATTERNS.some(([pattern]) => normalized.includes(pattern));
}

function inferBtcSymbol(coinType) {
  const normalized = normalizeCoinType(coinType);
  if (KNOWN_BTC_COIN_TYPES.has(normalized)) {
    return KNOWN_BTC_COIN_TYPES.get(normalized);
  }
  for (const [pattern, symbol] of BTC_SYMBOL_PATTERNS) {
    if (normalized.includes(pattern)) {
      return symbol;
    }
  }
  return "BTC";
}

function toBtcUnits(rawBalance, decimals = BTC_DECIMALS) {
  const n = BigInt(rawBalance || "0");
  const divisor = BigInt(10 ** decimals);
  const whole = n / divisor;
  const frac = n % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}

/* ------------------------------------------------------------------ */
/*  Wallet state                                                      */
/* ------------------------------------------------------------------ */

const _registry = discoverWallets();
let _connectedWallet = null;
let _account = null;
let _btcBalances = null;
let _apiSession = null;
let _apiSessionInflight = null;
const _subscribers = new Set();

function _notify() {
  const state = getWalletState();
  _subscribers.forEach((fn) => fn(state));
}

function subscribe(fn) {
  _subscribers.add(fn);
  return () => _subscribers.delete(fn);
}

function getWalletState() {
  return {
    connected: !!_account,
    address: _account?.address || null,
    chain: _account?.chains?.[0] || _connectedWallet?.chains?.[0] || null,
    chains: _account?.chains || _connectedWallet?.chains || [],
    walletName: _connectedWallet?.name || null,
    walletIcon: _connectedWallet?.icon || null,
    btcBalances: _btcBalances,
  };
}

/* ------------------------------------------------------------------ */
/*  Connect / Disconnect / Sign                                       */
/* ------------------------------------------------------------------ */

async function connect(wallet, options = {}) {
  const {
    notify = true,
    persist = true,
    refresh = true,
    closeModalOnConnect = true,
  } = options;
  const connectFeature = wallet.features?.["standard:connect"];
  if (!connectFeature) throw new Error("Wallet does not support connect");

  const result = await connectFeature.connect();
  const accounts = result.accounts || wallet.accounts || [];
  if (!accounts.length) throw new Error("No accounts returned");

  _connectedWallet = wallet;
  _account = accounts[0];

  if (persist) {
    try {
      localStorage.setItem(
        STORAGE_WALLET_KEY,
        JSON.stringify({ walletName: wallet.name, address: _account.address })
      );
    } catch (_) {}
  }

  if (closeModalOnConnect) closeWalletModal();
  if (notify) _notify();
  if (refresh) refreshBalances().catch(() => {});
  return _account;
}

async function disconnect() {
  if (_connectedWallet?.features?.["standard:disconnect"]) {
    try {
      await _connectedWallet.features["standard:disconnect"].disconnect();
    } catch (_) {}
  }
  _connectedWallet = null;
  _account = null;
  _btcBalances = null;
  _apiSession = null;
  _apiSessionInflight = null;
  try { localStorage.removeItem(STORAGE_WALLET_KEY); } catch (_) {}
  try { localStorage.removeItem(STORAGE_SESSION_KEY); } catch (_) {}
  try { sessionStorage.removeItem(STORAGE_SESSION_KEY); } catch (_) {}
  _notify();
}

function _loadStoredSession() {
  const sessionStorageRef = getSafeSessionStorage();
  const localStorageRef = getSafeLocalStorage();
  const sessionValue = parseStoredSession(sessionStorageRef?.getItem(STORAGE_SESSION_KEY));
  if (sessionValue) {
    return sessionValue;
  }

  const legacyValue = parseStoredSession(localStorageRef?.getItem(STORAGE_SESSION_KEY));
  if (!legacyValue) {
    return null;
  }

  try {
    sessionStorageRef?.setItem(STORAGE_SESSION_KEY, JSON.stringify(legacyValue));
  } catch (_) {}
  try {
    localStorageRef?.removeItem(STORAGE_SESSION_KEY);
  } catch (_) {}
  return legacyValue;
}

function _persistSession(session) {
  _apiSession = session || null;
  const sessionStorageRef = getSafeSessionStorage();
  const localStorageRef = getSafeLocalStorage();
  try {
    if (!session) {
      sessionStorageRef?.removeItem(STORAGE_SESSION_KEY);
      localStorageRef?.removeItem(STORAGE_SESSION_KEY);
      return;
    }
    sessionStorageRef?.setItem(STORAGE_SESSION_KEY, JSON.stringify(session));
    localStorageRef?.removeItem(STORAGE_SESSION_KEY);
  } catch (_) {}
}

function _extractMessageSignature(result) {
  const candidates = [
    result?.signature,
    result?.result?.signature,
    result?.data?.signature,
    result?.signedMessage?.signature,
    typeof result === "string" ? result : null,
  ].filter((value) => typeof value === "string" && value.trim());

  if (!candidates.length) {
    throw new Error("Wallet did not return a personal message signature.");
  }

  return candidates[0];
}

async function _ensureApiSession({ forceRefresh = false } = {}) {
  if (!_account?.address) {
    throw new Error("Wallet not connected");
  }

  const address = _account.address;

  if (!forceRefresh) {
    const cached = _apiSession || _loadStoredSession();
    if (cached?.address === address && Date.parse(cached.expiresAt) > Date.now() + 15_000) {
      _apiSession = cached;
      return cached;
    }
    // Coalesce concurrent callers onto a single sign-and-exchange promise —
    // otherwise two parallel _apiFetch calls both miss the cache and trigger
    // two wallet signature prompts.
    if (_apiSessionInflight) {
      return _apiSessionInflight;
    }
  }

  const promise = _performApiSessionHandshake(address);
  _apiSessionInflight = promise;
  try {
    return await promise;
  } finally {
    if (_apiSessionInflight === promise) {
      _apiSessionInflight = null;
    }
  }
}

async function _performApiSessionHandshake(address) {
  const base = _apiBase();
  if (!base) {
    throw new Error("API base URL is not configured.");
  }
  const runtime = window.TIDE_CONFIG || {};
  assertSuiNetworkExplicit({
    config: runtime,
    tideEnv: typeof window?.TIDE_ENV === "string" ? window.TIDE_ENV : "",
  });
  const chain = getSuiWalletChain(runtime);

  const nonceRes = await fetch(`${base}/v1/auth/nonce`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      address,
      chain,
      origin: typeof window !== "undefined" ? window.location.origin : "",
    }),
  });
  const nonceData = await nonceRes.json();
  if (!nonceRes.ok) {
    throw new Error(nonceData.error || `HTTP ${nonceRes.status}`);
  }

  const signFeature = _connectedWallet.features?.["sui:signPersonalMessage"];
  if (!signFeature?.signPersonalMessage) {
    throw new Error("Wallet does not support message signing");
  }

  const signed = await signFeature.signPersonalMessage({
    message: new TextEncoder().encode(nonceData.message),
    account: _account,
  });

  const signature = _extractMessageSignature(signed);

  const sessionRes = await fetch(`${base}/v1/auth/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      address,
      nonce: nonceData.nonce,
      signature,
      chain,
      origin: typeof window !== "undefined" ? window.location.origin : "",
    }),
  });
  const sessionData = await sessionRes.json();
  if (!sessionRes.ok) {
    throw new Error(sessionData.error || `HTTP ${sessionRes.status}`);
  }

  const session = {
    address,
    token: sessionData.session.token,
    expiresAt: sessionData.session.expiresAt,
  };
  _persistSession(session);
  return session;
}

/**
 * Sign and execute a wallet-signable Sui transaction via the connected wallet.
 * Accepts a transaction-like object that implements toJSON().
 */
async function validateMoveCallAllowlist(transaction) {
  let txJson = await transaction.toJSON();
  if (typeof txJson === "string") {
    txJson = JSON.parse(txJson);
  }

  const observed = collectMoveCallTargetsPure(txJson);
  const commandKinds = collectPtbCommandKinds(txJson);
  const allowed = deriveAllowedMoveTargets(window.TIDE_CONFIG || {});
  const verdict = checkAllowlist(observed, allowed, { commandKinds });
  if (verdict.ok) return;

  if (verdict.reason === "unsupported-command-kind") {
    throw new Error(
      `Wallet refuses to sign: transaction contains unsupported PTB command kind(s): ${verdict.blockedKinds.join(", ")}. ` +
      "TIDE proof signing only allows allowlisted MoveCall commands."
    );
  }
  if (verdict.reason === "no-move-calls") {
    throw new Error(
      "Wallet refuses to sign: transaction does not contain a MoveCall. " +
      "TIDE proof signing only allows allowlisted MoveCall commands."
    );
  }
  if (verdict.reason === "empty-allowlist") {
    throw new Error(
      "Wallet refuses to sign: Move target allowlist is empty. " +
      "Set execution.allowedMoveTargets in runtime config (or TIDE_POLICY_PACKAGE_ID at build time)."
    );
  }
  throw new Error(
    `Wallet refuses to sign: Move target not on allowlist: ${verdict.blocked.join(", ")}. ` +
    `Allowlisted: ${verdict.allowed.join(", ")}.`
  );
}

async function validateLocalPreSignChecks(transaction) {
  if (
    !transaction ||
    typeof transaction !== "object" ||
    !Object.prototype.hasOwnProperty.call(transaction, TIDE_PRE_SIGN_VALIDATOR)
  ) {
    return;
  }
  const validator = transaction[TIDE_PRE_SIGN_VALIDATOR];
  if (typeof validator !== "function") {
    throw new Error("Wallet refuses to sign: local pre-sign validator is not callable.");
  }
  try {
    await validator.call(transaction, {
      account: _account,
      wallet: _connectedWallet,
      config: window.TIDE_CONFIG || {},
    });
  } catch (error) {
    const message = error?.message || String(error || "unknown error");
    if (message.startsWith("Wallet refuses to sign:")) throw error;
    throw new Error(`Wallet refuses to sign: local pre-sign validation failed: ${message}`);
  }
}

async function signAndExecuteTransaction(transaction) {
  if (!_connectedWallet || !_account) throw new Error("Wallet not connected");
  if (!transaction || typeof transaction.toJSON !== "function") {
    throw new Error("Execution preview only. A real Sui transaction object is required before the wallet can sign.");
  }

  // Wallet-layer mainnet guard. The build-time guard in
  // write-runtime-config.mjs blocks production signing, but the wallet
  // adapter is the last line before a real signature. Mainnet signing must
  // fail closed here regardless of runtime flags.
  const tideEnv = typeof window?.TIDE_ENV === "string" ? window.TIDE_ENV.trim().toLowerCase() : "";
  const runtime = window.TIDE_CONFIG || {};
  assertSuiNetworkExplicit({ config: runtime, tideEnv });
  const network = getSuiNetwork(runtime);
  if (network === "mainnet") {
    throw new Error(
      "Wallet refuses to sign: Mainnet signing is disabled in this build. Use testnet action-receipt signing only."
    );
  }
  if (tideEnv === "production" && network !== "mainnet") {
    throw new Error(
      `Wallet refuses to sign: production build cannot target "${network}" (mainnet-only).`
    );
  }

  await validateMoveCallAllowlist(transaction);
  await validateLocalPreSignChecks(transaction);

  const runtimeConfig = window.TIDE_CONFIG || {};
  const walletChain = getSuiWalletChain(runtimeConfig);

  const signExecFeature = _connectedWallet.features?.["sui:signAndExecuteTransaction"];
  if (signExecFeature?.signAndExecuteTransaction) {
    return signExecFeature.signAndExecuteTransaction({
      transaction,
      account: _account,
      chain: walletChain,
      options: {
        showEffects: true,
        showEvents: true,
        showObjectChanges: true,
      },
    });
  }

  const legacySignExecFeature = _connectedWallet.features?.["sui:signAndExecuteTransactionBlock"];
  if (legacySignExecFeature?.signAndExecuteTransactionBlock) {
    return legacySignExecFeature.signAndExecuteTransactionBlock({
      transactionBlock: transaction,
      account: _account,
      chain: walletChain,
      options: {
        showEffects: true,
        showEvents: true,
        showObjectChanges: true,
      },
    });
  }

  let signed = null;
  const signFeature = _connectedWallet.features?.["sui:signTransaction"];
  if (signFeature?.signTransaction) {
    signed = await signFeature.signTransaction({
      transaction,
      account: _account,
      chain: walletChain,
    });
  } else {
    const legacySignFeature = _connectedWallet.features?.["sui:signTransactionBlock"];
    if (!legacySignFeature?.signTransactionBlock) {
      throw new Error("Wallet does not support transaction signing");
    }

    signed = await legacySignFeature.signTransactionBlock({
      transactionBlock: transaction,
      account: _account,
      chain: walletChain,
    });
  }

  const bytes = signed?.bytes || signed?.transactionBlockBytes;
  const signature = signed?.signature;
  if (!bytes || !signature) {
    throw new Error("Wallet returned an incomplete signed transaction payload.");
  }

  const config = window.TIDE_CONFIG || {};
  const res = await postSuiRpcWithFallback({
    urls: getSuiRpcUrlsWithFallback(config),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "sui_executeTransactionBlock",
      params: [
        bytes,
        [signature],
        { showEffects: true, showEvents: true, showObjectChanges: true },
        "WaitForLocalExecution",
      ],
    }),
  });

  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "Transaction execution failed");
  return json.result;
}

async function refreshBalances() {
  if (!_account) return null;
  try {
    const all = await getAllBalances(_account.address);
    _btcBalances = filterBtcBalances(all).map((b) => ({
      coinType: b.coinType,
      symbol: inferBtcSymbol(b.coinType),
      raw: b.totalBalance,
      display: toBtcUnits(b.totalBalance),
      count: b.coinObjectCount,
    }));
    _notify();
    return _btcBalances;
  } catch (err) {
    console.warn("[wallet] balance fetch failed:", err.message);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Auto-reconnect                                                    */
/* ------------------------------------------------------------------ */

async function tryAutoReconnect() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(STORAGE_WALLET_KEY)); } catch (_) { return; }
  if (!saved?.walletName) return;

  await new Promise((r) => setTimeout(r, 300));

  const match = _registry.get().find((w) => w.name === saved.walletName);
  if (match) {
    try {
      const account = await connect(match, {
        notify: false,
        persist: false,
        refresh: false,
        closeModalOnConnect: false,
      });
      if (saved.address && account?.address && saved.address !== account.address) {
        console.warn("[wallet] auto-reconnect aborted: stored address mismatch.");
        await disconnect();
        return;
      }
      try {
        localStorage.setItem(
          STORAGE_WALLET_KEY,
          JSON.stringify({ walletName: match.name, address: account.address })
        );
      } catch (_) {}
      _notify();
      refreshBalances().catch(() => {});
    } catch (err) {
      console.warn("[wallet] auto-reconnect failed:", err.message);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Modal                                                             */
/* ------------------------------------------------------------------ */

let _modalEl = null;
let _modalRestoreFocusEl = null;
let _modalBackgroundState = [];
const WALLET_MODAL_TITLE_ID = "wallet-modal-title";
const WALLET_MODAL_DESCRIPTION_ID = "wallet-modal-description";
const WALLET_MODAL_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "details > summary:first-of-type",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function isWalletModalFocusable(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.hidden || el.getAttribute("aria-hidden") === "true") return false;
  if (el instanceof HTMLInputElement && el.type === "hidden") return false;
  if (el.hasAttribute("disabled")) return false;
  const style = window.getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden";
}

function getWalletModalFocusableElements(root) {
  if (!(root instanceof Element || root instanceof DocumentFragment)) return [];
  return Array.from(root.querySelectorAll(WALLET_MODAL_FOCUSABLE_SELECTOR))
    .filter(isWalletModalFocusable);
}

function getWalletModalDialog() {
  return _modalEl?.querySelector(".wm-modal") || null;
}

function getWalletModalInitialFocus(modal) {
  return modal.querySelector(".wm-wallet-btn[data-wallet-index]")
    || modal.querySelector(".wm-wallet-install")
    || modal.querySelector(".wm-close")
    || getWalletModalFocusableElements(modal)[0]
    || modal;
}

function focusWalletModal(modal = getWalletModalDialog()) {
  if (!modal) return;
  const target = getWalletModalInitialFocus(modal);
  if (target instanceof HTMLElement) {
    target.focus({ preventScroll: true });
  }
}

function restoreWalletModalBackground() {
  for (const entry of _modalBackgroundState) {
    const { element, focusables, hadAriaHidden, ariaHidden, hadInert, inert } = entry;
    if (hadInert) {
      element.inert = inert;
    }
    if (hadAriaHidden) {
      element.setAttribute("aria-hidden", ariaHidden);
    } else {
      element.removeAttribute("aria-hidden");
    }
    for (const focusable of focusables) {
      if (focusable.hadTabindex) {
        focusable.element.setAttribute("tabindex", focusable.tabindex);
      } else {
        focusable.element.removeAttribute("tabindex");
      }
    }
  }
  _modalBackgroundState = [];
}

function disableWalletModalBackground(overlay) {
  restoreWalletModalBackground();
  for (const element of Array.from(document.body.children)) {
    if (!(element instanceof HTMLElement) || element === overlay) continue;
    const hadInert = "inert" in element;
    const entry = {
      element,
      hadInert,
      inert: hadInert ? element.inert : false,
      hadAriaHidden: element.hasAttribute("aria-hidden"),
      ariaHidden: element.getAttribute("aria-hidden") || "",
      focusables: [],
    };

    if (hadInert) {
      element.inert = true;
    } else {
      for (const focusable of getWalletModalFocusableElements(element)) {
        entry.focusables.push({
          element: focusable,
          hadTabindex: focusable.hasAttribute("tabindex"),
          tabindex: focusable.getAttribute("tabindex") || "",
        });
        focusable.setAttribute("tabindex", "-1");
      }
    }
    element.setAttribute("aria-hidden", "true");
    _modalBackgroundState.push(entry);
  }
}

function _escHandler(e) {
  if (e.key === "Escape") {
    closeWalletModal();
    return;
  }
  if (e.key !== "Tab") return;

  const modal = getWalletModalDialog();
  if (!modal) return;

  const focusable = getWalletModalFocusableElements(modal);
  if (!focusable.length) {
    e.preventDefault();
    modal.focus({ preventScroll: true });
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;

  if (!(active instanceof Node) || !modal.contains(active)) {
    e.preventDefault();
    first.focus({ preventScroll: true });
    return;
  }

  if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus({ preventScroll: true });
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus({ preventScroll: true });
  }
}

function _focusInHandler(e) {
  const modal = getWalletModalDialog();
  if (!modal || !(e.target instanceof Node) || modal.contains(e.target)) return;
  focusWalletModal(modal);
}

function openWalletModal(triggerEl = null) {
  if (_modalEl) {
    focusWalletModal();
    return;
  }

  _modalRestoreFocusEl = triggerEl instanceof HTMLElement
    ? triggerEl
    : document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

  const detected = _registry.get();
  const detectedNames = new Set(detected.map((w) => w.name));

  // Fuzzy match: wallet name vs catalog name + aliases
  function matchesCatalog(walletName, catalogEntry) {
    const wn = walletName.toLowerCase();
    const cn = catalogEntry.name.toLowerCase();
    if (wn.includes(cn) || cn.includes(wn)) return true;
    if (catalogEntry.aliases) {
      return catalogEntry.aliases.some((a) => {
        const al = a.toLowerCase();
        return wn.includes(al) || al.includes(wn);
      });
    }
    return false;
  }

  // Merge: use real wallet object icon when available, fall back to catalog
  const installedItems = detected.map((w) => {
    const catalog = KNOWN_WALLETS.find((k) => matchesCatalog(w.name, k));
    return { wallet: w, name: w.name, icon: w.icon || catalog?.icon || "", installed: true };
  });

  const availableItems = KNOWN_WALLETS
    .filter((k) => !detected.some((w) => matchesCatalog(w.name, k)))
    .map((k) => ({ wallet: null, name: k.name, icon: k.icon, installed: false, installUrl: k.installUrl }));

  const overlay = document.createElement("div");
  overlay.className = "wm-overlay";
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeWalletModal(); });

  const modal = document.createElement("div");
  modal.className = "wm-modal";
  modal.tabIndex = -1;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", WALLET_MODAL_TITLE_ID);
  modal.setAttribute("aria-describedby", WALLET_MODAL_DESCRIPTION_ID);

  let html = `
    <div class="wm-header">
      <h2 class="wm-title" id="${WALLET_MODAL_TITLE_ID}">Connect a Wallet</h2>
      <button type="button" class="wm-close" aria-label="Close">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 5l10 10M15 5L5 15"/></svg>
      </button>
    </div>
    <p class="sr-only" id="${WALLET_MODAL_DESCRIPTION_ID}">Choose an installed Sui wallet to connect. Available wallets open installation pages in a new tab.</p>
    <div class="wm-body">`;

  if (installedItems.length) {
    html += `<div class="wm-grid">`;
    for (const [index, item] of installedItems.entries()) {
      const walletIcon = sanitizeAssetUrl(item.icon);
      html += `
        <button type="button" class="wm-wallet-btn" data-wallet-index="${index}">
          ${walletIcon ? `<img class="wm-wallet-icon" src="${escapeAttr(walletIcon)}" alt="" />` : ""}
          <span class="wm-wallet-name">${escapeHtml(item.name)}</span>
        </button>`;
    }
    html += `</div>`;
  }

  if (availableItems.length) {
    html += `<div class="wm-divider"><span>Available Wallets</span></div>`;
    html += `<div class="wm-grid wm-grid-available">`;
    for (const item of availableItems) {
      const walletIcon = sanitizeAssetUrl(item.icon);
      const installUrl = sanitizeExternalUrl(item.installUrl);
      html += `
        <a class="wm-wallet-btn wm-wallet-install" href="${escapeAttr(installUrl || "#")}" target="_blank" rel="noopener">
          ${walletIcon ? `<img class="wm-wallet-icon" src="${escapeAttr(walletIcon)}" alt="" />` : ""}
          <span class="wm-wallet-name">${escapeHtml(item.name)}</span>
          <span class="wm-install-tag">Install</span>
        </a>`;
    }
    html += `</div>`;
  }

  if (!installedItems.length && !availableItems.length) {
    html += `<p class="wm-empty">No Sui wallets found. Install a wallet extension to continue.</p>`;
  }

  html += `</div>`;
  modal.innerHTML = html;
  bindWalletImages(modal);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  _modalEl = overlay;
  focusWalletModal(modal);
  disableWalletModalBackground(overlay);

  // Wire close
  modal.querySelector(".wm-close")?.addEventListener("click", closeWalletModal);

  // Wire installed wallet clicks
  modal.querySelectorAll(".wm-wallet-btn[data-wallet-index]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const walletIndex = Number.parseInt(btn.dataset.walletIndex || "", 10);
      const w = Number.isInteger(walletIndex) ? installedItems[walletIndex]?.wallet : null;
      if (w) connect(w);
    });
  });

  document.addEventListener("keydown", _escHandler);
  document.addEventListener("focusin", _focusInHandler);

  // Re-render modal when new wallets are discovered
  const unsubDiscovery = _registry.on(() => {
    if (_modalEl) {
      const restoreFocusEl = _modalRestoreFocusEl;
      closeWalletModal({ restoreFocus: false });
      setTimeout(() => openWalletModal(restoreFocusEl), 50);
    }
    unsubDiscovery();
  });

  // Animate in
  requestAnimationFrame(() => overlay.classList.add("wm-visible"));
}

function closeWalletModal({ restoreFocus = true } = {}) {
  if (!_modalEl) return;
  const el = _modalEl;
  const restoreTarget = _modalRestoreFocusEl;
  _modalEl = null;
  _modalRestoreFocusEl = null;
  document.removeEventListener("keydown", _escHandler);
  document.removeEventListener("focusin", _focusInHandler);
  restoreWalletModalBackground();
  el.classList.remove("wm-visible");
  el.addEventListener("transitionend", () => el.remove(), { once: true });
  setTimeout(() => el.remove(), 300);
  if (restoreFocus && restoreTarget?.isConnected) {
    restoreTarget.focus({ preventScroll: true });
  }
}

/* ------------------------------------------------------------------ */
/*  Sidebar UI                                                        */
/* ------------------------------------------------------------------ */

function truncateAddress(addr) {
  if (!addr || addr.length < 12) return addr || "";
  return addr.slice(0, 6) + "\u2026" + addr.slice(-4);
}

function formatBtcAmount(value, maxDecimals = 6) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  return numeric
    .toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: maxDecimals,
    })
    .replace(/\.0+$/, "");
}

function floorBtcAmount(value, maxDecimals = 6) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  const factor = 10 ** maxDecimals;
  return Math.floor(numeric * factor) / factor;
}

function getCollateralAssetMeta(symbol) {
  const normalized = String(symbol || "BTC").trim().toUpperCase() || "BTC";
  return COLLATERAL_ASSET_META[normalized] || {
    title: symbol || "BTC",
    subtitle: "Supported BTC wrapper",
    icon: BTC_TOKEN_FALLBACK_ICON,
    fallbackIcon: BTC_TOKEN_FALLBACK_ICON,
  };
}

function renderCollateralAssetMark(symbol) {
  const meta = getCollateralAssetMeta(symbol);
  const title = meta.title || symbol || "BTC";
  const icon = sanitizeAssetUrl(meta.icon, BTC_TOKEN_FALLBACK_ICON);
  const fallback = sanitizeAssetUrl(meta.fallbackIcon || "", BTC_TOKEN_FALLBACK_ICON);
  return `
    <span class="collateral-asset-mark">
      <img
        class="collateral-asset-mark-image"
        src="${escapeAttr(icon)}"
        alt="${escapeAttr(`${title} logo`)}"
        data-fallback-src="${escapeAttr(fallback)}"
        loading="eager"
        decoding="async"
      />
    </span>
  `;
}

function formatCoinTypePill(coinType, symbol) {
  const match = String(coinType).match(/^(0x[0-9a-fA-F]+)/);
  const prefix = match ? `${match[1].slice(0, 12)}…` : "0x";
  return `${prefix}${String(symbol || "BTC").toUpperCase()}`;
}

function getSelectableAssetSubtitle(asset) {
  const meta = getCollateralAssetMeta(asset.symbol);
  if (asset.manual) {
    return "Enter any amount for simulation";
  }
  if (asset.source === "wallet") {
    return meta.subtitle;
  }
  return `${meta.subtitle} · supported`;
}

function positionCollateralMenu() {
  const picker = document.querySelector("[data-collateral-picker]");
  const trigger = document.querySelector("[data-collateral-trigger]");
  const menu = document.querySelector("[data-collateral-menu]");
  if (!picker || !trigger || !menu || !picker.open) {
    return;
  }

  const widthAnchor = picker.closest(".create-scope-panel") || picker.closest(".create-composer__row") || trigger;
  const rowAnchor = picker.closest(".create-composer__row") || widthAnchor;
  const viewportPadding = 16;
  const overlap = 1;
  const widthRect = widthAnchor.getBoundingClientRect();
  const rowRect = rowAnchor.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  // Shift 1px left so the menu's border-left overlaps the tabs' border-right
  // (composer has border-left:0 and uses the tabs' right border as its visible left edge).
  const leftExtend = 1;
  const width = Math.min(Math.round(widthRect.width) + leftExtend, viewportWidth - viewportPadding * 2);
  const left = Math.max(viewportPadding, Math.min(Math.round(widthRect.left) - leftExtend, viewportWidth - viewportPadding - width));
  const availableBelow = Math.max(160, window.innerHeight - rowRect.bottom - viewportPadding);
  const availableAbove = Math.max(160, rowRect.top - viewportPadding);
  const openAbove = availableBelow < 260 && availableAbove > availableBelow;
  const maxHeight = Math.max(220, openAbove ? availableAbove : availableBelow);
  const top = openAbove
    ? Math.max(viewportPadding, Math.round(rowRect.top) - maxHeight + overlap)
    : Math.round(rowRect.bottom) - overlap;

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.width = `${width}px`;
  menu.style.maxHeight = `${maxHeight}px`;
  menu.style.zIndex = "2147483000";
  menu.dataset.placement = openAbove ? "top" : "bottom";
}

function syncFallbackImages(root) {
  if (!(root instanceof Element || root instanceof DocumentFragment)) return;
  root.querySelectorAll("img[data-fallback-src]").forEach((img) => {
    if (img.dataset.fallbackBound === "1") return;
    img.dataset.fallbackBound = "1";
    img.addEventListener("error", () => {
      const fallback = img.getAttribute("data-fallback-src");
      if (!fallback || img.getAttribute("src") === fallback) return;
      img.setAttribute("src", fallback);
    });
  });
}

function renderWalletUI() {
  const container = document.getElementById("header-wallet") || document.getElementById("sidebar-wallet");
  if (!container) return;

  const state = getWalletState();

  if (container._walletUiAbortController) {
    container._walletUiAbortController.abort();
    container._walletUiAbortController = null;
  }

  if (state.connected) {
    const walletIcon = sanitizeAssetUrl(state.walletIcon);
    const explorerHref = state.address
      ? buildSuiExplorerUrl("address", state.address, window.TIDE_CONFIG || {})
      : buildSuiExplorerUrl("address", "", window.TIDE_CONFIG || {}) || "https://suivision.xyz/";

    container.innerHTML = `
      <div class="wallet-pill" data-wallet-pill data-connected="true">
        <button type="button" class="wallet-pill__trigger" data-wallet-trigger data-connected="true" aria-haspopup="menu" aria-expanded="false">
          <span class="wallet-pill__main">
            ${walletIcon ? `<img class="wallet-icon wallet-pill__icon" src="${escapeAttr(walletIcon)}" alt="" />` : '<span class="wallet-pill__icon wallet-pill__icon--fallback" aria-hidden="true">S</span>'}
            <span class="wallet-address">${escapeHtml(truncateAddress(state.address))}</span>
          </span>
          <svg class="wallet-pill__chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
        </button>
        <div class="wallet-popover" data-wallet-popover hidden>
          <button type="button" class="wallet-popover__action" data-wallet-copy>Copy address</button>
          <a class="wallet-popover__action" href="${escapeAttr(explorerHref)}" target="_blank" rel="noopener noreferrer">View on SuiVision</a>
          <button type="button" class="wallet-popover__action wallet-popover__action--danger" data-wallet-disconnect>Disconnect</button>
        </div>
      </div>`;
    bindWalletImages(container);
    const trigger = container.querySelector("[data-wallet-trigger]");
    const popover = container.querySelector("[data-wallet-popover]");
    const copyBtn = container.querySelector("[data-wallet-copy]");
    const disconnectBtn = container.querySelector("[data-wallet-disconnect]");
    const controller = new AbortController();
    const { signal } = controller;
    container._walletUiAbortController = controller;

    const closePopover = () => {
      if (!trigger || !popover) return;
      trigger.setAttribute("aria-expanded", "false");
      popover.hidden = true;
    };

    const openPopover = () => {
      if (!trigger || !popover) return;
      trigger.setAttribute("aria-expanded", "true");
      popover.hidden = false;
    };

    trigger?.addEventListener("click", (event) => {
      event.preventDefault();
      if (!popover) return;
      if (popover.hidden) {
        openPopover();
      } else {
        closePopover();
      }
    }, { signal });

    document.addEventListener("click", (event) => {
      if (!container.contains(event.target)) {
        closePopover();
      }
    }, { signal, capture: true });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePopover();
      }
    }, { signal });

    copyBtn?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(state.address || "");
        copyBtn.textContent = "Copied";
        window.setTimeout(() => {
          if (copyBtn.isConnected) {
            copyBtn.textContent = "Copy address";
          }
        }, 1200);
      } catch (_) {
        copyBtn.textContent = "Copy failed";
        window.setTimeout(() => {
          if (copyBtn.isConnected) {
            copyBtn.textContent = "Copy address";
          }
        }, 1200);
      }
    }, { signal });

    disconnectBtn?.addEventListener("click", async () => {
      closePopover();
      await disconnect();
    }, { signal });
  } else {
    container.innerHTML = `
      <button type="button" class="wallet-connect-btn" id="open-wallet-modal" data-connected="false">
        <svg class="wallet-connect-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="16" height="12" rx="2"/><path d="M14 10h.01"/><path d="M2 8h16"/></svg>
        <span>Connect Wallet</span>
      </button>`;
    container.querySelector("#open-wallet-modal")?.addEventListener("click", openWalletModal);
  }
}

/* ------------------------------------------------------------------ */
/*  Setup page integration                                            */
/* ------------------------------------------------------------------ */

function updateSetupBalance() {
  const btcInput = document.querySelector('input[name="btcUnits"]');
  if (!btcInput) return;
  const coinTypeInput = document.querySelector('input[name="collateralCoinType"]');
  const assetSymbolInput = document.querySelector('input[name="collateralAssetSymbol"]');
  const picker = document.querySelector("[data-collateral-picker]");
  const triggerSymbol = document.querySelector("[data-collateral-trigger-symbol]");
  const triggerMark = document.querySelector("[data-collateral-trigger-mark]");
  const useMax = document.querySelector("[data-collateral-use-max]");
  const presetButtons = Array.from(document.querySelectorAll('[data-amount-preset]:not([data-collateral-use-max])'));
  const menu = document.querySelector("[data-collateral-menu]");
  const usdEcho = document.querySelector("[data-collateral-usd-echo]");
  const scopeInput = document.querySelector('input[name="createScope"]:checked');
  const isLiveScope = (scopeInput?.value || "shadow") === "live";
  if (!coinTypeInput || !assetSymbolInput || !picker || !triggerSymbol || !triggerMark || !useMax || !menu) {
    return;
  }

  const state = getWalletState();
  menu.textContent = "";

  const setBalanceUi = ({
    showUseMax = false,
    showPresets = false,
    useMaxLabel = "Use max",
    useMaxDisabled = false,
  } = {}) => {
    useMax.hidden = !showUseMax;
    useMax.textContent = useMaxLabel;
    useMax.disabled = useMaxDisabled;
    presetButtons.forEach((button) => {
      button.hidden = !showPresets;
      button.disabled = !showPresets;
    });
  };

    const buildSelectableAssets = () => {
      const merged = new Map(
        COLLATERAL_ASSET_PRESETS.map((entry, index) => [
        `${entry.symbol.toUpperCase()}::${entry.coinType || "manual"}::${entry.variant || "default"}`,
        {
          symbol: entry.symbol,
          coinType: entry.coinType,
          manual: Boolean(entry.manual),
          variant: entry.variant || "",
          value: 0,
          source: "preset",
          order: index,
        },
      ])
    );

    if (Array.isArray(state.btcBalances)) {
      for (const entry of state.btcBalances) {
        const symbol = String(entry.symbol || "BTC").trim() || "BTC";
        const coinType = entry.coinType || "";
        const overrideEntry = [...merged.entries()].find(([, candidate]) =>
          candidate.source === "preset"
          && candidate.symbol.toUpperCase() === symbol.toUpperCase()
          && candidate.value === 0
        );
        const current = overrideEntry?.[1]
          || [...merged.values()].find((candidate) => candidate.coinType === coinType);
        const key = overrideEntry?.[0] || `${symbol.toUpperCase()}::${coinType || "wallet"}::wallet`;
        merged.set(key, {
          symbol,
          coinType: coinType || current?.coinType || "",
          manual: false,
          variant: current?.variant || "",
          value: Number.parseFloat(entry.display || "0") || 0,
          source: "wallet",
          order: current?.order ?? merged.size,
        });
      }
    }

    return [...merged.values()].sort((left, right) => {
      if (right.value !== left.value) {
        return right.value - left.value;
      }
      if (left.manual !== right.manual) {
        return left.manual ? 1 : -1;
      }
      return left.order - right.order;
    });
  };

  const setSelection = (asset) => {
    coinTypeInput.value = asset?.coinType || "";
    assetSymbolInput.value = asset?.symbol || assetSymbolInput.value || "BTC";
    triggerSymbol.textContent = asset?.symbol || assetSymbolInput.value || "BTC";
    triggerMark.innerHTML = renderCollateralAssetMark(asset?.symbol || assetSymbolInput.value || "BTC");
    syncFallbackImages(triggerMark);
  };

  const assets = buildSelectableAssets();
  const manualAsset = assets.find((entry) => entry.manual) || null;
  picker.classList.remove("is-disabled");

  let selected =
    assets.find((entry) => entry.coinType && entry.coinType === coinTypeInput.value)
    || assets.find((entry) => entry.symbol === assetSymbolInput.value)
    || assets[0]
    || { symbol: assetSymbolInput.value || "BTC", coinType: "", value: 0, source: "preset", order: 0 };

  const positiveAssets = assets.filter((entry) => entry.value > 0);
  const supportedAssets = assets.filter((entry) => !entry.manual && entry.value <= 0);
  const manualAssets = assets.filter((entry) => entry.manual);
  const total = positiveAssets.reduce((sum, entry) => sum + entry.value, 0);
  const hasWalletBalance = positiveAssets.length > 0;

  if (
    hasWalletBalance
    && picker.dataset.userSelectedAsset !== "true"
    && selected.source === "preset"
    && Number(selected.value || 0) <= 0
  ) {
    selected = positiveAssets[0];
  }

  if (!hasWalletBalance && !selected.manual && manualAsset && !isLiveScope) {
    selected = manualAsset;
  }

  setSelection(selected);

  if (!state.connected) {
    setBalanceUi({
      showPresets: !isLiveScope,
      showUseMax: !isLiveScope,
      useMaxLabel: "Max",
    });
  } else if (!Array.isArray(state.btcBalances)) {
    setBalanceUi({
      showPresets: !isLiveScope,
      showUseMax: !isLiveScope,
      useMaxLabel: "Max",
    });
  } else if (!hasWalletBalance) {
    setBalanceUi({
      showPresets: !isLiveScope,
      showUseMax: !isLiveScope,
      useMaxLabel: "Max",
    });
  } else {
    if (selected.value > 0) {
      setBalanceUi({
        showUseMax: true,
        showPresets: true,
        useMaxLabel: "Max",
      });
      const lastAsset = btcInput.dataset.autofilledFor || "";
      const currentAsset = selected.coinType || selected.symbol || "";
      if (lastAsset !== currentAsset) {
        btcInput.dataset.autofilledFor = currentAsset;
        btcInput.value = formatBtcAmount(floorBtcAmount(selected.value));
        btcInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
    } else {
      setBalanceUi({
        showPresets: !isLiveScope,
        showUseMax: !isLiveScope,
        useMaxLabel: "Max",
      });
    }
  }

  const chosenSym = assetSymbolInput.value || selected.symbol || "BTC";

  if (usdEcho) {
    const priceInput = document.querySelector('input[name="btcPriceUsd"]');
    const basePrice = Math.max(0, Number.parseFloat(priceInput?.value || "0") || 0);
    // On simulation, the composer spot is a user assumption — the echo
    // must follow it. On live, the real wrapper price wins.
    const wrapperPrice = getLiveWrapperPriceUsd(chosenSym, basePrice, { preferOverride: !isLiveScope });
    const units = Math.max(0, Number.parseFloat(btcInput.value || "0") || 0);
    if (units > 0 && wrapperPrice > 0) {
      const usd = units * wrapperPrice;
      usdEcho.textContent = usd >= 1000
        ? `≈ $${Math.round(usd).toLocaleString("en-US")}`
        : `≈ $${usd.toFixed(2)}`;
    } else {
      usdEcho.textContent = "";
    }
  }

  const spotLabel = document.querySelector(".create-composer__spot > span");
  if (spotLabel) {
    spotLabel.textContent = chosenSym === "BTC" ? "Reference price" : `${chosenSym} reference`;
  }

  useMax.onclick = () => {
    if (selected.value <= 0) return;
    btcInput.value = formatBtcAmount(floorBtcAmount(selected.value));
    btcInput.dispatchEvent(new Event("input", { bubbles: true }));
    btcInput.dispatchEvent(new Event("change", { bubbles: true }));
    btcInput.focus();
    updateSetupBalance();
  };

  const btcPriceInput = document.querySelector('input[name="btcPriceUsd"]');
  const btcPriceUsd = Math.max(0, Number.parseFloat(btcPriceInput?.value || "0") || 0);
  const formatUsdApprox = (btc, sym) => {
    if (!(btc > 0)) return "";
    const wrapperPrice = getLiveWrapperPriceUsd(sym || "BTC", btcPriceUsd, { preferOverride: !isLiveScope });
    if (!(wrapperPrice > 0)) return "";
    const usd = btc * wrapperPrice;
    if (usd >= 1000) return `≈ $${Math.round(usd).toLocaleString("en-US")}`;
    return `≈ $${usd.toFixed(2)}`;
  };

  const appendSection = (title, items) => {
    if (!items.length) {
      return;
    }

    for (const asset of items) {
      const isSelected = (asset.coinType && asset.coinType === selected.coinType)
        || (!asset.coinType && asset.symbol === selected.symbol);
      if (isSelected) continue;
      const option = document.createElement("button");
      option.type = "button";
      option.className = "collateral-asset-option";
      const leading = document.createElement("span");
      leading.className = "collateral-asset-option-leading";
      leading.innerHTML = renderCollateralAssetMark(asset.symbol);

      const copy = document.createElement("span");
      copy.className = "collateral-asset-option-copy";

      const symbolRow = document.createElement("span");
      symbolRow.className = "collateral-asset-option-symbol-row";

      const symbol = document.createElement("span");
      symbol.className = "collateral-asset-option-symbol";
      symbol.textContent = asset.symbol;

      const meta = getCollateralAssetMeta(asset.symbol);

      const subtitle = document.createElement("span");
      subtitle.className = "collateral-asset-option-type";
      subtitle.textContent = asset.manual
        ? "Any amount · simulation only"
        : asset.variant
          ? `${getSelectableAssetSubtitle(asset)} · ${asset.variant}`
          : getSelectableAssetSubtitle(asset);

      symbolRow.appendChild(symbol);
      copy.append(symbolRow, subtitle);

      const trailing = document.createElement("span");
      trailing.className = "collateral-asset-option-trailing";

      const value = document.createElement("span");
      value.className = "collateral-asset-option-value";
      if (asset.manual) {
        value.textContent = "Manual";
        value.classList.add("is-manual");
      } else if (asset.value > 0) {
        value.textContent = formatBtcAmount(asset.value);
      } else {
        value.textContent = "0";
        value.classList.add("is-zero");
      }

      const valueEqv = document.createElement("span");
      valueEqv.className = "collateral-asset-option-value-usd is-eqv";
      if (!asset.manual && btcPriceUsd > 0) {
        const wrapperPrice = getLiveWrapperPriceUsd(asset.symbol, btcPriceUsd, { preferOverride: false });
        const eqv = (asset.value || 0) * wrapperPrice;
        valueEqv.textContent = eqv >= 1000
          ? `≈ $${Math.round(eqv).toLocaleString("en-US")}`
          : `≈ $${eqv.toFixed(2)}`;
      }

      const metaRow = document.createElement("span");
      metaRow.className = "collateral-asset-option-meta-row";

      const coinAddr = asset.coinType || "";

      const addressPill = document.createElement("span");
      addressPill.className = "collateral-asset-option-meta";
      addressPill.textContent = asset.manual
        ? "Simulation only"
        : formatCoinTypePill(coinAddr, asset.symbol);
      if (coinAddr) addressPill.title = coinAddr;
      metaRow.appendChild(addressPill);

      if (!asset.manual && coinAddr) {
        const copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.className = "collateral-asset-option-copy-btn";
        copyBtn.title = "Copy address";
        copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M5 11H3.5A1.5 1.5 0 012 9.5v-7A1.5 1.5 0 013.5 1h7A1.5 1.5 0 0112 2.5V5"/></svg>`;
        copyBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(coinAddr).catch(() => {});
          copyBtn.classList.add("is-copied");
          setTimeout(() => copyBtn.classList.remove("is-copied"), 1200);
        });

        const viewBtn = document.createElement("a");
        viewBtn.className = "collateral-asset-option-view-btn";
        viewBtn.title = "View on SuiVision";
        viewBtn.href = buildSuiExplorerUrl("coin", coinAddr, window.TIDE_CONFIG || {}) || `https://suivision.xyz/coin/${encodeURIComponent(coinAddr)}`;
        viewBtn.target = "_blank";
        viewBtn.rel = "noopener noreferrer";
        viewBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3H3.5A1.5 1.5 0 002 4.5v8A1.5 1.5 0 003.5 14h8a1.5 1.5 0 001.5-1.5V9"/><path d="M10 2h4v4"/><path d="M14 2L7 9"/></svg>`;
        viewBtn.addEventListener("click", (e) => e.stopPropagation());

        metaRow.append(copyBtn, viewBtn);
      }

      if (!asset.manual && btcPriceUsd > 0) {
        const assetPrice = getLiveWrapperPriceUsd(asset.symbol, btcPriceUsd, { preferOverride: false });
        const rate = document.createElement("span");
        rate.className = "collateral-asset-option-rate";
        rate.textContent = assetPrice >= 1000
          ? `$${Math.round(assetPrice).toLocaleString("en-US")} / ${asset.symbol}`
          : `$${assetPrice.toFixed(2)} / ${asset.symbol}`;
        metaRow.appendChild(rate);
      }

      trailing.append(value, valueEqv);
      option.append(leading, copy, trailing, metaRow);
      option.title = asset.manual
        ? "Manual simulation input"
        : `${asset.symbol} (${meta.title || asset.symbol}) · ${asset.value > 0 ? `${formatBtcAmount(asset.value)} available` : "0 available"}`;
      option.addEventListener("click", () => {
        picker.dataset.userSelectedAsset = "true";
        coinTypeInput.value = asset.coinType;
        assetSymbolInput.value = asset.symbol;
        const priceInput = document.querySelector('input[name="btcPriceUsd"]');
        const liveWrapperPrice = getLiveWrapperPriceUsd(asset.symbol, 0, { preferOverride: false });
        if (!asset.manual && priceInput && liveWrapperPrice > 1_000) {
          const rounded = Math.round(liveWrapperPrice);
          priceInput.value = String(rounded);
          priceInput.dataset.liveAutoFilled = String(rounded);
          priceInput.dataset.wrapperSymbol = asset.symbol;
          delete priceInput.dataset.userEditedPrice;
        }
        picker.open = false;
        coinTypeInput.dispatchEvent(new Event("change", { bubbles: true }));
        assetSymbolInput.dispatchEvent(new Event("change", { bubbles: true }));
        priceInput?.dispatchEvent(new Event("input", { bubbles: true }));
        priceInput?.dispatchEvent(new Event("change", { bubbles: true }));
        updateSetupBalance();
      });
      menu.appendChild(option);
      syncFallbackImages(option);
    }
  };

  appendSection("Detected in wallet", positiveAssets);
  appendSection("Supported BTC wrappers", supportedAssets);
  appendSection("Manual simulation", manualAssets);
  if (picker.open) {
    positionCollateralMenu();
  }
}

/* ------------------------------------------------------------------ */
/*  Scenario sync API                                                 */
/* ------------------------------------------------------------------ */

function _apiBase() {
  return resolveOpsBaseUrl(window.TIDE_CONFIG, window.location.origin);
}

async function _apiFetch(path, options = {}) {
  const { _retried = false, ...fetchOptions } = options;
  const state = getWalletState();
  if (!state.address) throw new Error("Wallet not connected");

  const session = await _ensureApiSession();
  const base = _apiBase();
  const res = await fetch(`${base}${path}`, {
    ...fetchOptions,
    headers: {
      ...(fetchOptions.body !== undefined ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${session.token}`,
      ...(fetchOptions.headers || {}),
    },
  });

  const data = await res.json();
  if (res.status === 401 && !_retried) {
    await _ensureApiSession({ forceRefresh: true });
    return _apiFetch(path, { ...options, _retried: true });
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/**
 * Fetch all scenarios for the connected wallet from the backend.
 */
async function fetchRemoteScenarios() {
  return _apiFetch("/v1/scenarios");
}

/**
 * Push a scenario to the backend.
 */
async function pushScenario(scenario) {
  const id = scenario.id || crypto.randomUUID();
  return _apiFetch(`/v1/scenarios/${id}`, {
    method: "PUT",
    body: JSON.stringify({
      type: scenario._syncType || "saved",
      name: scenario.name || "",
      data: scenario,
    }),
  });
}

/**
 * Delete a scenario from the backend.
 */
async function deleteRemoteScenario(id) {
  return _apiFetch(`/v1/scenarios/${id}`, { method: "DELETE" });
}

/* ------------------------------------------------------------------ */
/*  Init                                                              */
/* ------------------------------------------------------------------ */

function initWallet() {
  subscribe(() => { renderWalletUI(); updateSetupBalance(); });
  _registry.on(() => renderWalletUI());
  renderWalletUI();
  updateSetupBalance();
  document.addEventListener("toggle", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLDetailsElement) || !target.matches("[data-collateral-picker]")) {
      return;
    }
    const menu = target.querySelector("[data-collateral-menu]")
      || document.querySelector("[data-collateral-menu][data-portaled='1']");
    if (!menu) return;
    if (target.open) {
      // Portal the menu to <body> so it escapes .surface's stacking context
      // (otherwise sibling surfaces below this one render on top of it).
      if (menu.parentElement !== document.body) {
        menu.dataset.portaled = "1";
        document.body.appendChild(menu);
      }
      positionCollateralMenu();
    } else if (menu.dataset.portaled === "1") {
      // Put the menu back inside the details so markup stays consistent.
      target.appendChild(menu);
      delete menu.dataset.portaled;
    }
  }, true);
  document.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    // btcPriceUsd drives the composer echo on simulation; without this the
    // "≈ $…" next to the amount input ignored live-scope spot overrides.
    if (target.name === "btcUnits" || target.name === "btcPriceUsd") {
      updateSetupBalance();
    }
  });
  window.addEventListener("resize", positionCollateralMenu, { passive: true });
  window.addEventListener("scroll", positionCollateralMenu, { passive: true });
  document.addEventListener("mousedown", (event) => {
    const picker = document.querySelector("[data-collateral-picker][open]");
    if (!picker) return;
    const menu = picker.querySelector("[data-collateral-menu]")
      || document.querySelector("[data-collateral-menu][data-portaled='1']");
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (picker.contains(target)) return;
    if (menu && menu.contains(target)) return;
    picker.open = false;
  });
  tryAutoReconnect();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initWallet);
} else {
  initWallet();
}

export {
  getWalletState,
  subscribe,
  connect,
  disconnect,
  signAndExecuteTransaction,
  refreshBalances,
  fetchRemoteScenarios,
  pushScenario,
  deleteRemoteScenario,
  updateSetupBalance as refreshSetupCollateralSelector,
};
