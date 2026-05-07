# Cap Placement Attestation

Snapshot date: 2026-05-05; proof-pack verifier recheck: 2026-05-06 06:51:57 UTC

This file records the current testnet capability placement for the Overflow
proof package. Public proof bundles keep operator addresses redacted; this
attestation carries the object-level custody posture needed for audit review.

| Field | Value |
| --- | --- |
| Network | `testnet` |
| Package ID | `0x999c34ce039388017838a5da6670195affa55c4dfbd466612494058963d502f0` |
| AdminCap object | `0xb8154fa47f85240174d387cc231a2132c97db81d91cbcf2665040018c5cc2427` |
| AdminCap holder | `0xd80060324a6c13c114c9a4c2f43571b31b48869b513a354af5232292e6e6e569` |
| UpgradeCap object | `0xb36e3dc489d39af7e09dc9e6cb5d578b823c797794b5855cfa91f54c35e582d5` |
| UpgradeCap holder | `0xb73e1c8026403d95c627ee41005f5fb751a8facbd1ed3018bac28bd2a6f19999` |
| Publisher object | `0xd5940933be3cdca56fdf9e4e82c25244333dd2bd7476655c2ed329ed1ac9c1cd` |
| Publisher holder | `0xd80060324a6c13c114c9a4c2f43571b31b48869b513a354af5232292e6e6e569` |
| Demo wallet | `0xc41c7c26be987af23f16950cee2548008f734600c10cce2e374eb0d51b47f13a` |

Invariant:

- AdminCap and UpgradeCap are held by different addresses.
- The demo wallet is not the AdminCap or UpgradeCap holder.
- `npm run verify:onchain:hardened` is the automated gate for this posture.

Evidence source: Sui testnet object owner readback (`sui_multiGetObjects`) and
the current `scripts/verify-onchain-testnet.mjs` hardened verifier.
