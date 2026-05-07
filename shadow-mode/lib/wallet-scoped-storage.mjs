function getStorage() {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  if (typeof globalThis !== "undefined" && globalThis.localStorage) {
    return globalThis.localStorage;
  }
  return null;
}

function toKeySet(keys) {
  if (keys instanceof Set) {
    return keys;
  }
  return new Set(Array.isArray(keys) ? keys : []);
}

export function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeWalletAddress(address = "") {
  const value = typeof address === "string" ? address.trim() : "";
  return value || "";
}

export function buildWalletStorageKey(key, address = "") {
  const scopedAddress = normalizeWalletAddress(address);
  return scopedAddress ? `${key}:${scopedAddress}` : key;
}

export function createWalletScopedStorage({
  getAddress = () => "",
  accountScopedKeys = [],
  clearGlobalKeyOnScopedWrite = "",
} = {}) {
  const scopedKeys = toKeySet(accountScopedKeys);

  function resolveAddress(address) {
    return normalizeWalletAddress(address === undefined ? getAddress() : address);
  }

  function storageKey(key, address) {
    return buildWalletStorageKey(key, resolveAddress(address));
  }

  function requiresAddress(key, global) {
    return !global && scopedKeys.has(key);
  }

  function read(key, { global = false, address } = {}) {
    try {
      const storage = getStorage();
      if (!storage) {
        return undefined;
      }

      const scopedAddress = resolveAddress(address);
      if (requiresAddress(key, global) && !scopedAddress) {
        return undefined;
      }

      const raw = storage.getItem(global ? key : buildWalletStorageKey(key, scopedAddress));
      return raw ? JSON.parse(raw) : undefined;
    } catch {
      return undefined;
    }
  }

  function load(key, fallback, options = {}) {
    const value = read(key, options);
    return value === undefined ? fallback : value;
  }

  function save(key, value, {
    global = false,
    address,
    mirrorGlobal = false,
  } = {}) {
    try {
      const storage = getStorage();
      if (!storage) {
        return false;
      }

      const scopedAddress = resolveAddress(address);
      if (requiresAddress(key, global) && !scopedAddress) {
        return false;
      }

      const serialized = JSON.stringify(value);
      storage.setItem(global ? key : buildWalletStorageKey(key, scopedAddress), serialized);

      if (!global && mirrorGlobal) {
        storage.setItem(key, serialized);
      } else if (!global && scopedAddress && clearGlobalKeyOnScopedWrite === key) {
        storage.removeItem(key);
      }

      return true;
    } catch {
      return false;
    }
  }

  function remove(key, { global = false, address } = {}) {
    try {
      const storage = getStorage();
      if (!storage) {
        return false;
      }

      const scopedAddress = resolveAddress(address);
      if (requiresAddress(key, global) && !scopedAddress) {
        return false;
      }

      storage.removeItem(global ? key : buildWalletStorageKey(key, scopedAddress));
      return true;
    } catch {
      return false;
    }
  }

  function migrateArrayKey({ fromKey, toKey, address, requireNonEmpty = true } = {}) {
    const legacy = load(fromKey, null, { address });
    if (!Array.isArray(legacy) || (requireNonEmpty && legacy.length === 0)) {
      return null;
    }

    if (!save(toKey, legacy, { address })) {
      return null;
    }

    remove(fromKey, { address });
    return legacy;
  }

  return {
    normalizeAddress: resolveAddress,
    storageKey,
    read,
    load,
    save,
    remove,
    migrateArrayKey,
  };
}
