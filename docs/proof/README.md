# Proof Assets

Canonical machine-readable artifacts live in this directory:

- `latest-proof-loop.json` — current aggregate proof-loop summary.
- `wallet-rehearsal-2026-05-02.json` — wallet rehearsal record.
- `cap-placement-attestation.md` — public cap-placement attestation.
- `proof_ref_disclosure.md` — build/proof reference disclosure.
- `mainnet_attestation_disclosure.md` — boundary for founder-manual mainnet
  observation plus Sui testnet decision attestation.
- `run-01.json` ... `run-05.json` — machine-written proof summaries for the refreshed loop.

Evidence hierarchy:

```text
docs/onchain_mvp_proof_pack.md
  -> docs/proof/latest-proof-loop.json
  -> SuiVision receipt object
  -> Walrus bundle bytes
  -> scripts/tide-verify.mjs digest check
```

The public `run-XX.json` files are redacted summaries. They are useful as an
index of what happened, but they are not the canonical proof bundle. For
Walrus-backed receipts, the canonical proof check fetches the Walrus blob bytes
and compares `sha256(bundleBytes)` with the `content_digest` pinned in the Sui
testnet receipt object.

Quick verifier example:

```bash
node scripts/tide-verify.mjs 0x66c93faaea12c3d4098ac8f3035ee08aa0b214c0ba92485b6f3384e2941ef07d \
  --network testnet \
  --bundle-from-walrus \
  --json
```

Manual Walrus fetch shape:

```text
https://aggregator.walrus-testnet.walrus.space/v1/blobs/<blob-id>
```

Founder-manual mainnet-observed evidence, when present, has a separate
boundary: the founder executes any mainnet protocol action manually through the
protocol UI; TIDE only reads public mainnet state/events and anchors a
testnet decision receipt.

Screenshots, video, and raw founder-manual mainnet observation bundles are
submitted through the hackathon form when needed. They are not bundled into
this public source snapshot.
