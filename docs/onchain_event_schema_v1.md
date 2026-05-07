# TIDE On-Chain Event Schema v1

This document is the source of truth for indexers and submission proof tooling
that consume TIDE testnet events.

## Versioning

- `policy_registry::current_version()` returns the policy package schema
  compatibility version stored on each policy object. Current value: `2`.
- `policy_registry::event_schema_version()` returns the policy event payload
  version. Current value: `3`.
- `execution_receipts::event_schema_version()` returns the action-receipt event
  payload version. Current value: `3`.
- `policy_version` is not a user-edit revision counter. It gates whether a
  policy object has been migrated to the package schema expected by the live
  receipt module.
- Consumers must reject unknown `schema_version` values instead of silently
  dropping fields.
- `freshness_label` is intentionally not part of the current v3 ABI. v3 covers
  `revocation_seq` plus the receipt proof-boundary fields below; a
  human-readable freshness label is deferred to V1.5 so indexers do not gate on
  a field the current package does not emit.

## Package Modules

The package id is environment-specific. The module names are stable:

- `policy_registry`
- `execution_receipts`

## Policy Events

### `PolicyCreated`

Emitted by `create_policy`.

| Field | Type | Semantics |
| --- | --- | --- |
| `policy_id` | `ID` | Created policy object id |
| `owner` | `address` | Wallet that owns the policy |
| `policy_version` | `u64` | Policy object version at creation |
| `selected_rail` | `String` | Canonical rail id accepted by the allowlist |
| `mode` | `String` | Policy mode label |
| `priority` | `String` | Policy priority label |
| `created_at_ms` | `u64` | Sui clock timestamp |
| `schema_version` | `u16` | Policy event schema version |

### `PolicyUpdated`

Emitted by `update_policy`. The current schema includes every mutable value
rewritten by the entry point so an indexer can reconstruct the current policy
envelope from events plus the object id.

| Field | Type | Semantics |
| --- | --- | --- |
| `policy_id` | `ID` | Updated policy object id |
| `owner` | `address` | Policy owner |
| `policy_version` | `u64` | Policy object version after update |
| `selected_rail` | `String` | Current canonical rail id |
| `mode` | `String` | Updated policy mode |
| `priority` | `String` | Updated policy priority |
| `payout_target_usd` | `u64` | Monthly payout target, whole USD |
| `min_buffer_usd` | `u64` | Minimum stable buffer, whole USD |
| `max_ltv_bps` | `u64` | Liquidation ceiling in basis points |
| `target_ltv_low_bps` | `u64` | Lower target band in basis points |
| `target_ltv_high_bps` | `u64` | Upper target band in basis points |
| `repay_ltv_bps` | `u64` | Managed repay threshold in basis points |
| `emergency_ltv_bps` | `u64` | Emergency freeze threshold in basis points |
| `updated_at_ms` | `u64` | Sui clock timestamp |
| `schema_version` | `u16` | Policy event schema version |

### `RailSelected`

Emitted when `select_rail` changes the policy rail.

| Field | Type | Semantics |
| --- | --- | --- |
| `policy_id` | `ID` | Policy object id |
| `owner` | `address` | Policy owner |
| `policy_version` | `u64` | Policy object version |
| `previous_rail` | `String` | Previous canonical rail id |
| `next_rail` | `String` | New canonical rail id |
| `updated_at_ms` | `u64` | Sui clock timestamp |
| `schema_version` | `u16` | Policy event schema version |

### `PolicyDeleted`

Emitted by `delete_policy`.

| Field | Type | Semantics |
| --- | --- | --- |
| `policy_id` | `ID` | Deleted policy object id |
| `owner` | `address` | Policy owner |
| `schema_version` | `u16` | Policy event schema version |

### `PolicyMigrated`

Emitted by `migrate_policy`.

| Field | Type | Semantics |
| --- | --- | --- |
| `policy_id` | `ID` | Migrated policy object id |
| `owner` | `address` | Policy owner |
| `from_version` | `u64` | Previous policy object version |
| `to_version` | `u64` | New policy object version |
| `schema_version` | `u16` | Policy event schema version |

### Rail Admin Events

`RailAllowed` and `RailRevoked` are admin allowlist events.

| Event | Fields |
| --- | --- |
| `RailAllowed` | `rail: String`, `schema_version: u16` |
| `RailRevoked` | `rail: String`, `revocation_seq: u64`, `schema_version: u16` |

### Admin Transfer Events

Admin transfer is delayed. The request object stays with the current admin
until cancellation or execution.

| Event | Fields |
| --- | --- |
| `AdminTransferRequested` | `request_id: ID`, `admin: address`, `recipient: address`, `created_at_ms: u64`, `execute_after_ms: u64`, `schema_version: u16` |
| `AdminTransferCanceled` | `request_id: ID`, `admin: address`, `recipient: address`, `schema_version: u16` |
| `AdminTransferred` | `request_id: ID`, `admin: address`, `recipient: address`, `executed_at_ms: u64`, `schema_version: u16` |

## Action Receipt Events

### `ReceiptMinted`

Emitted by `execution_receipts::mint_receipt`.

| Field | Type | Semantics |
| --- | --- | --- |
| `receipt_id` | `ID` | Minted `ExecutionReceipt` object id |
| `policy_id` | `ID` | Policy object id the receipt anchors |
| `policy_version` | `u64` | Policy version asserted at mint time |
| `owner` | `address` | Wallet that owns the receipt |
| `action` | `String` | Action label, for example `harbor.rebalance` |
| `decision_type` | `String` | Canonical receipt decision label from RFC-0001 §2.3; not an operating-state label |
| `limitations` | `String` | `shadow-only` or `testnet-rehearsal`; `mainnet-execution` is reserved for a future audited release and requires republish before it is treated as an on-chain package guarantee |
| `state_before_digest` | `vector<u8>` | 32-byte SHA-256 digest of the pre-action state sub-shape, including `stressLabel`; this is separate from `decision_type` |
| `selected_rail` | `String` | Canonical rail id on the policy at mint time |
| `walrus_blob_id` | `String` | Durable blob id or explicit `tide-stub://...` boundary |
| `rail_pack_digest` | `vector<u8>` | 32-byte SHA-256 digest of the rail pack |
| `content_digest` | `vector<u8>` | 32-byte SHA-256 digest of the proof bundle |
| `created_at_ms` | `u64` | Sui clock timestamp |
| `revocation_seq` | `u64` | Rail allowlist revocation generation observed at mint time |
| `schema_version` | `u16` | Receipt event schema version |

## Consumer Rules

1. Verify package id and module name before parsing an event.
2. Reject missing or unsupported `schema_version`.
3. Treat object fields and events as independent evidence. Events are useful
   for indexing; object read-back is the canonical receipt payload.
4. Verify 32-byte digest fields before displaying a receipt as verified.
5. Treat `tide-stub://...` Walrus ids as explicit testnet proof boundaries,
   not durable storage claims.
