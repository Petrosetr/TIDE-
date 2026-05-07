// Verifies the `x-tide-signature` header served with signed rail-pack
// and market-forecast responses. The server signs raw response bytes
// with an Ed25519 private key; this module checks that signature
// against the bundled public key (runtime-config.liveRailPack.verifyKey,
// base64 raw 32-byte SPKI or raw public key).
//
// Design:
//   * Local/relative bundle URLs are trusted (no verification) — those
//     are shipped with the build.
//   * Remote (http/https) URLs are verified when a public key is
//     configured. If verification fails or sig is missing, the caller
//     must reject the payload.
//   * Missing public key is treated as a failed verification for any
//     caller that reaches this helper. Relative/bundled assets should
//     avoid calling verifyPackResponse in the first place.

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

let cachedKey = null;
let cachedKeyMaterial = "";

async function importEd25519PublicKey(b64) {
  if (!b64) return null;
  if (cachedKey && cachedKeyMaterial === b64) return cachedKey;
  const raw = b64ToBytes(b64);
  // Accept raw 32-byte key; wrap it in a minimal SPKI prefix for
  // Web Crypto's `spki` import.
  let spki;
  if (raw.length === 32) {
    const spkiPrefix = new Uint8Array([
      0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
    ]);
    spki = new Uint8Array(spkiPrefix.length + raw.length);
    spki.set(spkiPrefix, 0);
    spki.set(raw, spkiPrefix.length);
  } else {
    spki = raw;
  }
  cachedKey = await crypto.subtle.importKey(
    "spki",
    spki,
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  cachedKeyMaterial = b64;
  return cachedKey;
}

export function isRemoteUrl(url) {
  return /^https?:\/\//i.test(String(url || ""));
}

export async function verifyPackResponse({ bodyText, signatureB64, verifyKeyB64 }) {
  if (!verifyKeyB64) return { verified: false, reason: "no-verify-key" };
  if (!signatureB64) return { verified: false, reason: "missing-signature" };
  try {
    const key = await importEd25519PublicKey(verifyKeyB64);
    if (!key) return { verified: false, reason: "bad-public-key" };
    const sig = b64ToBytes(signatureB64);
    const data = new TextEncoder().encode(bodyText);
    const ok = await crypto.subtle.verify({ name: "Ed25519" }, key, sig, data);
    return { verified: Boolean(ok), reason: ok ? "ok" : "bad-signature" };
  } catch (err) {
    return { verified: false, reason: `verify-error:${err?.message || err}` };
  }
}
