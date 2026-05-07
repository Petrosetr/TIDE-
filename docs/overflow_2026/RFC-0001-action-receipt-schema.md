# RFC-0001 — TIDE Action Receipt schema (DRAFT v0.1)

**Status:** DRAFT — not a Sui standard. Not adopted. Not endorsed by
Sui Foundation. Submitted as a public design proposal for review.

**Audience:** treasury teams, BTCfi protocols, audit firms, Move
developers building receipt-as-attestation flows on Sui.

**Authors:** TIDE contributors, 2026-04-29.

**Reference implementation:**

- Move source: [`move/sources/execution_receipts.move`](../../move/sources/execution_receipts.move)
- JS resolver: [`shadow-mode/lib/receipt-resolver.mjs`](../../shadow-mode/lib/receipt-resolver.mjs)
- CLI verifier: [`scripts/tide-verify.mjs`](../../scripts/tide-verify.mjs)
  (`node scripts/tide-verify.mjs <id> --allow-pending` for resolver-only
  smoke; add `--bundle-file` or `--bundle-from-walrus` for proof verification)
- ABI verifier: [`scripts/verify-onchain-testnet.mjs`](../../scripts/verify-onchain-testnet.mjs)
  (`validateMintReceiptAbiV3` + canonical struct shape pinning)

---

## 0. Status of this RFC

This document specifies the **TIDE Action Receipt v3 schema** as
deployed on Sui testnet. It is a design proposal under review. It
does **not** claim:

- adoption by other Sui protocols;
- endorsement by Sui Foundation;
- compatibility with future Sui standards work that may supersede this;
- audit-firm acceptance of the receipt as primary evidence (counsel
  review pending; auditor acceptance is the V2-V3 work).

Reviewers are invited to comment via GitHub issues against this
repository. Breaking changes ship with `EVENT_SCHEMA_VERSION` bumps
and corresponding migration notes.

---

## 1. Motivation

A treasury operator running a Bitcoin-on-Sui borrow position needs an
**auditable trail of decisions**, not just an auditable trail of
transfers. The transfer trail is already on-chain (Suilend / NAVI /
Scallop balances are visible to any indexer). What is missing is the
**policy + decision context** that produced each transfer:

- which package schema version the policy object had been migrated to when
  the operator acted;
- which rail was selected and why;
- which off-chain inputs (market regime, oracle price, rail-pack
  freshness) drove the decision;
- which constraints were respected (testnet-rehearsal limitations,
  shadow-only mode, etc.).

A naive "log line" approach (operator writes a memo per action) fails
audit because it is post-hoc and unverifiable. A naive "every input as
a struct field" approach (try to encode the planner's full state on
chain) fails Move byte costs and exposes PII.

The TIDE Action Receipt schema takes a third path: **commit a small
soul-bound Move object that pins (a) the policy schema version, (b) the
selected rail, (c) digests of the canonicalized off-chain bundle, and
(d) controlled labels for receipt decision type and execution
limitations.** Off-chain verifiers can fetch the receipt, fetch the
bundle from Walrus (or a stub URI), and prove the bundle bytes match
the on-chain digest. The receipt becomes the audit primitive; the
bundle is the readable payload.

---

## 2. Move struct specification

The on-chain `ExecutionReceipt` struct is soul-bound (`key` only, no
`store`). Receipts are non-transferable. The owner field is part of the
attestation; receipts are deliberately stuck to the wallet that signed
the mint.

### 2.1 ExecutionReceipt

| Field                  | Type             | Description |
|------------------------|------------------|-------------|
| `id`                   | `UID`            | Sui object id |
| `policy_id`            | `ID`             | The `tide::policy_registry::Policy` this receipt anchors against |
| `policy_version`       | `u64`            | Policy schema version at mint time; mint aborts if it differs from `policy_registry::current_version()` (code `E_POLICY_VERSION_STALE`) |
| `owner`                | `address`        | Sender of the mint transaction; receipt is soul-bound here |
| `action`               | `String`         | Operator-supplied action label (e.g. `"harbor.rebalance"`); ≤ 64 bytes |
| `decision_type`        | `String`         | Controlled vocabulary; see §2.3 |
| `limitations`          | `String`         | Controlled vocabulary; see §2.4 |
| `state_before_digest`  | `vector<u8>`     | SHA-256 of `{ ltvBps, bufferUsd, stressLabel }` sub-shape; exactly 32 bytes |
| `selected_rail`        | `String`         | Stable rail id (e.g. `"scallop-sui"`); pinned to whatever the policy's `select_rail` returned |
| `walrus_blob_id`       | `String`         | Walrus blob id of the off-chain bundle, OR a `tide-stub://<network>/sha256/<digest>` URI; ≤ 512 bytes |
| `rail_pack_digest`     | `vector<u8>`     | SHA-256 of the rail profile pack (fixture or signed read-only pack); exactly 32 bytes |
| `content_digest`       | `vector<u8>`     | SHA-256 of the canonical proof bundle; exactly 32 bytes |
| `created_at_ms`        | `u64`            | `clock::timestamp_ms` at mint |

Field order matters. The `validateExecutionReceiptsModule` verifier in
`scripts/verify-onchain-testnet.mjs` compares the
deployed struct field order against this canonical layout; a reorder
without a schema bump fails CI.

### 2.2 ReceiptMinted event

Emitted by `mint_receipt` for indexers. Same body as `ExecutionReceipt`
minus `id`, plus:

| Field             | Type   | Description |
|-------------------|--------|-------------|
| `receipt_id`      | `ID`   | The `ExecutionReceipt` object id just created |
| `revocation_seq`  | `u64`  | Rail allowlist revocation generation observed at mint time |
| `schema_version`  | `u16`  | `EVENT_SCHEMA_VERSION` constant; v3 = `3` |

Indexers MUST fail-closed when `schema_version` is not in the supported
set (`{1, 2, 3}` today; v1 receipts continue to render but new mints reject
unsupported versions per `requireSupportedReceiptSchemaVersion` in
`shadow-mode/lib/execution-receipts.mjs`).

The full policy + receipt event contract for indexers is maintained in
[`docs/onchain_event_schema_v1.md`](../onchain_event_schema_v1.md).

Schema v3 is live on testnet. It adds `revocation_seq` to
`ReceiptMinted` so a verifier can prove which rail-allowlist generation
the receipt was anchored against. The stale-input gate remains enforced
by the browser and proof-builder before any `mint_receipt` transaction is
composed; a future schema can add an explicit freshness label after a
separate release gate.

### 2.3 `decision_type` controlled vocabulary

Exactly one of:

- `Hold` — position inside the policy band; no action required.
- `BuildBuffer` — buffer below floor; rebuild before next action.
- `BorrowForBuffer` — buffer needs borrow draw; planner authorised.
- `PartialRepay` — LTV crossed auto-repay threshold.
- `EmergencyDeRisk` — crisis state; reduce debt + protect BTC core.
- `ReducePayout` — sustainable monthly payout dropped below target.
- `PausePayout` — payout paused under stress lockdown.
- `RotateVenue` — backup rail more attractive; rotate.

Any other value aborts mint with `E_INVALID_DECISION_TYPE`. The
vocabulary is intentionally small. New entries require an RFC update
+ a corresponding Move release.

These are receipt decision/action labels. They are distinct from the
five operating-state labels: `Observe`, `Maintain`, `BuildBuffer`,
`DeRisk`, and `StressLockdown`.

### 2.4 `limitations` controlled vocabulary

Exactly one of:

- `shadow-only` — Shadow Mode simulator output; not a testnet action.
- `testnet-rehearsal` — Sui testnet `mint_receipt` rehearsal; this is
  what the Overflow demo emits. **Never claims mainnet execution.**

`mainnet-execution` is reserved for a future, post-audit Live Autopilot
release gated behind external audit, counsel sign-off, and a ratified release
gate. The current submitted proof receipts use `testnet-rehearsal`; source-level
enforcement for the reserved value must be republished before this statement is
treated as an on-chain package guarantee.

Any other value aborts mint with `E_INVALID_LIMITATIONS`. The
limitations field is the audit contract: a verifier can refuse a
receipt whose limitations do not match the surrounding integration
agreement, for example a pilot that allows `testnet-rehearsal` only.

### 2.5 Off-chain proof bundle fields

The on-chain receipt stores only digests and labels. The readable proof
payload lives in the canonical off-chain bundle whose SHA-256 is pinned by
`content_digest`. Bundle v2 MUST include:

| Field | Description |
|-------|-------------|
| `version` | Proof bundle schema version (`2` today) |
| `createdAtMs` | Browser/runner wall-clock used for freshness checks |
| `correlationId` | 32-byte lowercase hex id derived from `policyId`, `policyVersion`, `action`, `createdAtMs`, and an optional local nonce. It is for verifier logs, retries, and future keeper idempotency; it is not a wallet/session identifier. |
| `action`, `decisionType`, `limitations` | Same controlled labels as the receipt |
| `stateBefore` | Strict `{ ltvBps, bufferUsd, stressLabel }` sub-shape; `stressLabel` is an operating-state label, not the receipt `decisionType` |
| `policy` | Allowlisted policy fields only |
| `report.summary` | Allowlisted public simulator/rail summary fields only |
| `railPack` | Rail-pack digest and signing metadata |

`report.inputs`, scenario names, contact metadata, arbitrary wallet
metadata, and raw notes are not valid bundle fields. The reference builder
(`shadow-mode/lib/execution-proof.mjs`) rejects unsupported public fields
before canonicalization so published bundles remain safe to share.

### 2.6 mint_receipt function signature

Canonical 12-parameter form:

```move
entry fun mint_receipt(
    policy: &mut Policy,
    allowlist: &RailAllowlist,
    action: vector<u8>,
    decision_type: vector<u8>,
    limitations: vector<u8>,
    state_before_digest: vector<u8>,
    walrus_blob_id: vector<u8>,
    rail_pack_digest: vector<u8>,
    content_digest: vector<u8>,
    expected_rail: vector<u8>,
    clock_ref: &Clock,
    ctx: &mut TxContext,
);
```

The function must be a non-public `entry fun`: PTBs may call it directly,
but third-party Move modules cannot compose it as a public helper. Parameter
order is part of the schema. The strict ABI verifier
(`validateMintReceiptAbiV3` in `scripts/verify-onchain-testnet.mjs`)
fails CI on parameter reorder, type substitution, reference vs
mutable-reference drift, public/non-entry visibility, or wrong package on
`Policy` / `RailAllowlist`.

---

## 3. Mint-time invariants

`mint_receipt` enforces eight invariants on chain. Each has a specific
abort code so off-chain consumers can branch cleanly:

| Code | Constant | When it fires |
|------|----------|---------------|
| `1`  | `E_NOT_POLICY_OWNER` | tx sender ≠ policy.owner |
| `2`  | `E_POLICY_VERSION_STALE` | policy.version ≠ policy_registry.current_version |
| `3`  | `E_INVALID_DIGEST` | any digest ≠ 32 bytes |
| `4`  | `E_INVALID_INPUT` | string field exceeds its byte cap |
| `5`  | `E_RAIL_MISMATCH` | `expected_rail` ≠ policy.selected_rail (caller's bundle pinned a different rail) |
| `6`  | `E_RAIL_NOT_ALLOWED` | policy.selected_rail not in the live allowlist (revoke-then-mint race) |
| `7`  | `E_INVALID_DECISION_TYPE` | decision_type outside controlled vocabulary |
| `8`  | `E_INVALID_LIMITATIONS` | limitations outside controlled vocabulary |

Codes `5` and `6` are the load-bearing guards (N1 + N2 in the proof
pack). The combination ensures that a receipt cannot anchor against:
- a rail the simulator did not actually evaluate (N1);
- a rail that was admin-revoked between simulation and mint (N2).

Off-chain verifiers MUST surface the abort code; ambiguous "transaction
failed" UX is non-compliant.

---

## 4. Verification protocol

A third party (auditor, integrator, judge) verifies a receipt without
running the TIDE frontend by:

### 4.1 Receipt resolution

1. Fetch the receipt object via Sui RPC `sui_getObject`:
   ```sh
   curl -X POST https://fullnode.testnet.sui.io:443 \
     -H "content-type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"sui_getObject",
          "params":["<receipt-id>", {"showContent":true,"showOwner":true,"showType":true}]}'
   ```
2. Confirm `data.type` matches
   `<package>::execution_receipts::ExecutionReceipt`. A wrong-type
   object is a forgery attempt.
3. Extract the field set per §2.1.

The reference JS implementation is
[`shadow-mode/lib/receipt-resolver.mjs::resolveReceiptFromRpc`](../../shadow-mode/lib/receipt-resolver.mjs).

### 4.2 Bundle resolution

The receipt's `walrus_blob_id` falls into one of two modes (classifier:
`shadow-mode/lib/walrus-storage.mjs::classifyBlobId`):

- **stub mode**: URI `tide-stub://<network>/sha256/<digest>`. The
  digest IS the bundle; no off-chain bytes exist. Verifier confirms
  the URI shape and notes the receipt is anchor-only.
- **walrus mode**: Walrus base64url blob id. Verifier fetches the
  bundle from `<aggregator>/v1/blobs/<blob-id>` and proceeds to §4.3.

### 4.3 Digest verification

For a Walrus-mode receipt:

1. Fetch the bundle bytes from the Walrus aggregator.
2. Compute `sha256(bundleBytes)`.
3. Compare the digest hex to `receipt.content_digest`. Match → bundle
   is the authentic anchor; mismatch → bundle has been tampered.

The reference CLI for Walrus-mode proof verification is
`node scripts/tide-verify.mjs <receipt-id> --bundle-from-walrus`. A bare
command without bundle flags resolves the object but exits non-zero unless
`--allow-pending` or `--resolve-only` is supplied; use those only for
resolver-only evidence.

### 4.4 Optional: ABI verification

A high-stakes verifier additionally runs
`validateMintReceiptAbiV3(module, packageId)` against the deployed
package to confirm the `mint_receipt` function signature has not drifted
since this RFC was published. Drift fails the verifier even if the
receipt object itself looks valid.

---

## 5. Trust model

What the receipt **does** attest:

1. The on-chain mint succeeded under the documented invariants (§3).
2. The policy object was current for the package schema at mint time. This is
   not a user-edit revision freshness check.
3. The bundle bytes — when retrievable — hash to the on-chain content
   digest.
4. The selected rail at mint time was in the on-chain allowlist
   (revoke-then-mint races are blocked by N2).

What the receipt **does NOT** attest:

1. **Mainnet capital movement.** Schema v3 exists in `testnet-rehearsal`
   and `shadow-only` modes only. `mainnet-execution` is reserved for a
   future post-audit release.
2. **Rail SDK execution.** The receipt anchors a planner decision. It
   does not claim that the rail SDK actually executed the action; that
   step is a separate signed transaction outside this schema.
3. **Counterparty solvency.** The rail's underlying lending market may
   be insolvent or paused; the receipt does not opine on rail health.
4. **Future policy compliance.** A receipt records a moment in time. A
   subsequent policy upgrade does not invalidate prior receipts.

---

## 6. Stable-shape JS contracts

For ecosystem integrators:

| Module | Purpose | Schema version |
|--------|---------|----------------|
| `receipt-share.mjs` (`buildReceiptCanonicalPayload`) | Canonical share payload for copy/download flows and the CLI verifier | `tide-receipt/v2` |
| `receipt-resolver.mjs` (`buildResolvedReceiptView`) | Render-ready view: canonical + SuiVision + verification block | (consumes above) |
| `walrus-storage.mjs` (`classifyBlobId`) | Stub-vs-walrus classification | n/a |
| `suilend-readback.mjs` (`SUILEND_READBACK_SHAPE_VERSION = 1`) | One-rail live read-back | `1` |
| `pyth-readback.mjs` (`PYTH_READBACK_SHAPE_VERSION = 1`) | Oracle read-back | `1` |
| `judge-fixtures.mjs` | Demo / test fixtures | `1` |

Schema versions bump with breaking field changes. Indexers and
integrators MUST gate on the version; mismatched versions render
fail-closed in the reference UIs.

---

## 7. Non-goals

This RFC does not propose:

- a token-gated registry of approved receipt formats;
- a centrally-operated receipt-verifier-as-a-service (there is one
  free CLI; everyone runs their own);
- a fee on receipt mints;
- mainnet execution semantics (those need post-audit work);
- multi-chain receipt portability (a Solidity port + an Aptos port are
  longer-term explorations, not part of v0.1);
- a regulator-approved attestation status.

---

## 8. Open questions

Reviewers may comment on:

1. **Decision-type vocabulary completeness.** Are the 8 documented
   decision types sufficient for cross-protocol use, or does a generic
   "Annotation" or "Custom" entry serve a real workflow?
2. **State-before digest scope.** Today the digest covers
   `{ ltvBps, bufferUsd, stressLabel }`. Should it expand to include
   oracle price + rail liquidity score? The trade-off is auditability
   (more inputs ⇒ stronger anchor) vs. PII surface (more inputs ⇒ more
   opportunities for accidental free-form data leakage).
3. **Walrus epoch policy.** Bundles published with `epochs=5` (default)
   expire after ~5 weeks on Walrus testnet. Should the receipt schema
   pin an `epochs` field so verifiers can detect "bundle no longer
   retrievable" without an extra round-trip?
4. **Multi-rail receipts.** A single policy may eventually span
   multiple rails simultaneously. Schema v3 anchors one
   `selected_rail`. A future multi-rail variant would need `selected_rails:
   vector<String>` plus per-rail digests. Worth reviewing before the
   first integrator demand.

---

## 9. Reference proof artifacts

- Live testnet package: `0x999c34ce039388017838a5da6670195affa55c4dfbd466612494058963d502f0`
- Sample receipt: `0x65c16de19f97d56bd948a6a0453ac5558927a640560e67277bfa3eae158b8940`
  ```sh
  node scripts/tide-verify.mjs 0x65c16de19f97d56bd948a6a0453ac5558927a640560e67277bfa3eae158b8940 --allow-pending
  ```
  This historical sample is a resolver-only smoke for a stub receipt; use
  `--bundle-from-walrus` or `--bundle-file` when proof bytes are available.
- Proof pack with live positive runs and documented guard coverage:
  [`docs/onchain_mvp_proof_pack.md`](../onchain_mvp_proof_pack.md)
- Deployed ABI / cap verifier output:
  `npm run verify:onchain:hardened`; public cap placement is disclosed in
  [`docs/proof/cap-placement-attestation.md`](../proof/cap-placement-attestation.md).

---

## 10. Versioning policy

- `EVENT_SCHEMA_VERSION` is the on-chain version constant; bumped in
  the same Move release that adds / renames / removes a struct field.
- This RFC bumps in lockstep: v0.1 ↔ schema v3; v0.2 will track
  schema v4 if a multi-rail variant ratifies.
- v1 receipts (the pre-Overflow schema) continue to render in the
  reference UIs but new mints emit v3 only.

A reviewer in 2027 reading this RFC should be able to point at a
specific schema version, trace it to a specific Move release, fetch a
receipt minted under that schema, and verify it via `tide-verify`
without contacting the TIDE team. That is the design goal.

---

## 11. Acknowledgements

Schema layout draws on:

- Sui's existing `Coin<T>` + `TreasuryCap` pattern for soul-bound
  capability-style objects.
- Walrus's `tide-stub://` URI scheme as a deterministic placeholder
  while durable storage finalises.
- Pyth's PriceInfoObject layout for the oracle read-back shape.
- V1.5 receipt schema scope decisions from the April 2026 public proof cycle.

Reviewers welcome.
