# TIDE

TIDE is a Sui-native Bitcoin treasury policy cockpit for the **DeFi & Payments**
track. It turns BTC-backed cashflow intent into explicit operating rules,
stress-tested decisions, and verifiable action receipts.

It lets an operator define a treasury policy, rehearse that policy against BTC
stress paths, anchor the policy on Sui testnet, and mint a verifiable
ExecutionReceipt that explains what the engine decided and what evidence was
reviewed.

TIDE V1 is intentionally scoped as decision attestation and proof
infrastructure. It does not custody assets, does not claim audited mainnet
automation, and does not sign mainnet protocol actions.

Testnet only proof boundary: all TIDE-signed proof actions in this submission
happen on Sui testnet. No mainnet capital moved through TIDE.

Mainnet-observed boundary: a founder-manual Suilend mainnet action may be used
as read-only evidence. TIDE can observe public mainnet state/events, compute the
policy decision, and anchor the evidence as a Sui testnet decision attestation.
TIDE does not sign mainnet transactions or present that lane as audited live
automation.

## Problem

BTC treasury operations on lending rails are still mostly manual:

- monitor LTV and liquidation distance;
- decide whether to hold, build buffer, repay, or pause payout;
- document which policy was active;
- prove later what data and rules supported the decision.

The rail may provide liquidity, but it does not provide a replayable operating
policy or an auditable receipt trail above multiple venues.

## Solution

TIDE turns a treasury policy into a verifiable decision trail:

1. A browser simulator models BTC price stress, debt, buffer, payout, and
   liquidation thresholds.
2. A five-state operating-state classifier labels the current posture:
   `Observe`, `Maintain`, `BuildBuffer`, `DeRisk`, or `StressLockdown`.
   Separately, the on-chain receipt `decision_type` uses the canonical
   eight-value receipt decision vocabulary from RFC-0001:
   `Hold`, `BuildBuffer`, `BorrowForBuffer`, `PartialRepay`,
   `EmergencyDeRisk`, `ReducePayout`, `PausePayout`, or `RotateVenue`.
3. `tide::policy_registry` anchors the selected policy and rail on Sui testnet.
4. `tide::execution_receipts` mints a soul-bound ExecutionReceipt tied to:
   `policy_id`, `policy_version`, `selected_rail`, `rail_pack_digest`,
   `state_before_digest`, and `content_digest`.
5. A canonical proof bundle is pinned by digest and can be stored through
   Walrus when the publisher endpoint is configured.

## What Was Built

- Shadow Mode simulator for BTC treasury policy rehearsal.
- Sui Move policy registry and execution receipt package.
- Rail allowlist guard checked again at receipt mint time.
- Proof loop with positive runs across Scallop, NAVI, Suilend, and Bucket rail
  profiles.
- Negative proof guards: N1 rail-mismatch, N2 revoked-rail fail-close, N6
  content-digest tampering, and N7 stale proof-bundle rejection.
- Standalone verifier path.
- Wallet rehearsal artifact for policy anchor and receipt mint.
- Founder mainnet-observed Suilend lane: founder manually used Suilend on
  mainnet; TIDE observed public state read-only and anchored the evidence as a
  Sui testnet decision attestation. Raw position evidence is kept as submission
  media, not bundled into the public source snapshot.

## Sui Integration

- **Object model:** policies and receipts are first-class Sui objects.
- **Move safety:** policy version, rail allowlist, digest length, decision type,
  and limitations are checked on-chain.
- **PTB-ready architecture:** future audited versions can compose policy update,
  rail action, and receipt mint into one transaction block.
- **Testnet proof:** all TIDE-signed proof actions in V1 happen on Sui testnet.

## Walrus Integration

TIDE proof bundles are canonical JSON documents with SHA-256 digests. The
receipt stores the digest on-chain. When Walrus publishing is configured, the
bundle also receives a Walrus blob ID so a reviewer can retrieve the evidence
document and verify it against the on-chain digest.

If the publisher path is unavailable in a future run, the receipt discloses the
`tide-stub://testnet/sha256/<digest>` stub mode instead of claiming durable
storage.

## Pyth Integration

The product can read a configured Pyth BTC/USD `PriceInfoObject` from Sui RPC
and surface price, confidence, freshness, and stale-state checks beside the
policy readout. Pyth data is read-only input to the decision layer in V1.

## Proof Artifacts

- `docs/onchain_mvp_proof_pack.md` - current proof pack.
- `docs/onchain_event_schema_v1.md` - indexer/event contract.
- `docs/overflow_2026/RFC-0001-action-receipt-schema.md` - receipt schema RFC.
- `docs/proof/latest-proof-loop.json` - latest proof-loop summary.
- `docs/proof/run-01.json` through `docs/proof/run-05.json` - individual runs.
- `docs/proof/wallet-rehearsal-2026-05-02.json` - wallet rehearsal record.
- `docs/proof/cap-placement-attestation.md` - public cap-placement disclosure
  for AdminCap / UpgradeCap separation.
- `docs/proof/mainnet_attestation_disclosure.md` - boundary for founder-manual
  mainnet observation plus testnet attestation.

## Limitations

- V1 is a rehearsal and proof layer, not an audited execution bot.
- Rail coverage is profile/read-only evidence unless a separately submitted
  artifact explicitly labels a founder-manual mainnet observation.
- TIDE does not sign mainnet protocol actions in this submission.
- External Move/security audit is required before any mainnet capital path.

## Repository Layout

- `move/` - Sui Move package.
- `shadow-mode/` - simulator, readout, workspace, and UI.
- `scripts/` - proof-loop, verifier, and public deploy tooling.
- `docs/proof/` - public proof artifacts.

## Running Locally

```bash
npm install
npm run verify:overflow
npm run test:judge-demo
npm test
```

Move tests:

```bash
sui move test --path move
```

## Status

TIDE is built for Sui Overflow 2026 as a testnet proof system with a clear
mainnet boundary: decisions and evidence are verifiable now; live mainnet
execution is deferred until future audited controls.
