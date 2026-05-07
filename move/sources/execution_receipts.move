module tide::execution_receipts;

use std::string::{Self as string, String};
use sui::clock::{Self as clock, Clock};
use sui::event;
use tide::policy_registry::{Self as policy_registry, Policy, RailAllowlist};

const E_NOT_POLICY_OWNER: u64 = 1;
const E_POLICY_VERSION_STALE: u64 = 2;
const E_INVALID_DIGEST: u64 = 3;
const E_INVALID_INPUT: u64 = 4;
// Aborts when the caller's expected rail disagrees with the policy's
// currently selected rail. Pins the off-chain bundle to the rail the
// simulator actually evaluated — a policy that was re-targeted between
// simulation and mint would otherwise anchor against a different rail.
const E_RAIL_MISMATCH: u64 = 5;
// Aborts when the policy's currently selected rail has been revoked
// from the shared RailAllowlist between `select_rail` and `mint_receipt`.
// The allowlist check at `select_rail` is a point-in-time admission —
// an admin that revokes a rail afterwards must not silently permit
// receipts anchored against it.
const E_RAIL_NOT_ALLOWED: u64 = 6;
// Aborts when `decision_type` is not one of the eight canonical values
// enforced by `assert_valid_decision_type`. The allowed set is:
//   Hold | BuildBuffer | BorrowForBuffer | PartialRepay |
//   EmergencyDeRisk | ReducePayout | PausePayout | RotateVenue
// This is an on-chain enum gate — the off-chain simulator must always
// emit one of these values; unrecognised strings are rejected at mint
// time so the receipt's `decision_type` is trustworthy.
const E_INVALID_DECISION_TYPE: u64 = 7;
// Aborts when `limitations` is not one of the two canonical V1 values
// enforced by `assert_valid_limitations`:
//   shadow-only | testnet-rehearsal
// `limitations` is the mode declaration of the receipt — it explicitly
// records the execution context at anchor time. Rejecting unrecognised
// values, including reserved future mainnet-execution labels, prevents a
// receipt from being anchored with an ambiguous or spoofed limitations label.
const E_INVALID_LIMITATIONS: u64 = 8;

// Event payload schema. Bump alongside any new field in `ReceiptMinted`
// so off-chain indexers can gate decoding.
//
// v3 mirrors `RailAllowlist.revocation_seq` so indexers can prove which
// allowlist generation a receipt was anchored against.
const EVENT_SCHEMA_VERSION: u16 = 3;

// SHA-256 digest length. Both `rail_pack_digest` and `content_digest`
// must be exactly this long — the off-chain canonicalizer always emits
// 32-byte digests, and accepting a shorter digest would let a caller
// weaken the anchor.
const DIGEST_LEN: u64 = 32;
const MAX_ACTION_LEN: u64 = 64;
const MAX_DECISION_TYPE_LEN: u64 = 64;
const MAX_LIMITATIONS_LEN: u64 = 64;
const MAX_EXPECTED_RAIL_LEN: u64 = 64;
const MAX_BLOB_ID_LEN: u64 = 512;

/// Anchors an off-chain execution bundle (the signed rail-pack, simulator
/// report, and the action that was actually run) to a Walrus blob. The
/// `walrus_blob_id` is opaque to Move — verifiers resolve it off-chain —
/// but the on-chain digests pin both the rail-pack input and the full
/// content bundle, so a later fetch can be re-hashed and compared.
/// Soul-bound proof object: `key` only, no `store`. Receipts should not be
/// transferable or stashable through generic containers; the receipt's
/// `owner` field is part of the attestation.
public struct ExecutionReceipt has key {
    id: UID,
    policy_id: ID,
    policy_version: u64,
    owner: address,
    action: String,
    decision_type: String,
    limitations: String,
    state_before_digest: vector<u8>,
    selected_rail: String,
    walrus_blob_id: String,
    rail_pack_digest: vector<u8>,
    content_digest: vector<u8>,
    created_at_ms: u64,
}

public struct ReceiptMinted has copy, drop {
    receipt_id: ID,
    policy_id: ID,
    policy_version: u64,
    owner: address,
    action: String,
    decision_type: String,
    limitations: String,
    state_before_digest: vector<u8>,
    selected_rail: String,
    walrus_blob_id: String,
    rail_pack_digest: vector<u8>,
    content_digest: vector<u8>,
    created_at_ms: u64,
    revocation_seq: u64,
    schema_version: u16,
}

// Transaction boundary only. `entry` lets wallets/PTBs call this function,
// while the non-public visibility prevents other Move modules from minting
// through it as a library helper. The test-only wrapper below exercises the
// same byte path from Move unit tests; a direct third-party-module negative
// test would be a compile-time visibility failure, not a runtime abort.
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
) {
    let sender = tx_context::sender(ctx);
    assert!(policy_registry::owner(policy) == sender, E_NOT_POLICY_OWNER);

    // Refuse to anchor against a stale policy: the off-chain bundle
    // was computed against a specific schema, and an upgraded policy
    // may have different invariants. Owner must migrate first.
    let policy_version = policy_registry::version(policy);
    assert!(policy_version == policy_registry::current_version(), E_POLICY_VERSION_STALE);

    assert!(vector::length(&rail_pack_digest) == DIGEST_LEN, E_INVALID_DIGEST);
    assert!(vector::length(&content_digest) == DIGEST_LEN, E_INVALID_DIGEST);
    assert!(vector::length(&state_before_digest) == DIGEST_LEN, E_INVALID_DIGEST);
    assert!(vector::length(&action) <= MAX_ACTION_LEN, E_INVALID_INPUT);
    // An empty action label is meaningless to indexers and cannot anchor correctly.
    assert!(vector::length(&action) > 0, E_INVALID_INPUT);
    assert!(vector::length(&decision_type) <= MAX_DECISION_TYPE_LEN, E_INVALID_INPUT);
    assert!(vector::length(&limitations) <= MAX_LIMITATIONS_LEN, E_INVALID_INPUT);
    assert!(vector::length(&expected_rail) <= MAX_EXPECTED_RAIL_LEN, E_INVALID_INPUT);
    // An empty expected_rail would bypass the rail-match comparison below.
    assert!(vector::length(&expected_rail) > 0, E_INVALID_INPUT);
    assert!(vector::length(&walrus_blob_id) <= MAX_BLOB_ID_LEN, E_INVALID_INPUT);
    // An empty walrus_blob_id is indistinguishable from "no anchor configured"
    // and cannot be resolved by the off-chain verifier.
    assert!(vector::length(&walrus_blob_id) > 0, E_INVALID_INPUT);
    assert_valid_decision_type(&decision_type);
    assert_valid_limitations(&limitations);

    // INVARIANT-ORDER: validate digest sizes and bounded public strings
    // before any policy-vs-bundle semantic comparison. That keeps malformed
    // payloads from surfacing as rail/policy failures in verifier UX.
    // Byte-for-byte compare of the caller's expected rail against the
    // policy's current selection. Both sides are UTF-8 strings — if they
    // disagree, the off-chain bundle pinned a different rail than the
    // one on-chain right now, and we refuse to anchor.
    assert!(
        *string::as_bytes(policy_registry::selected_rail(policy)) == expected_rail,
        E_RAIL_MISMATCH,
    );

    // Revalidate the policy's selected rail against the live allowlist.
    // `select_rail` admitted it at the time, but an admin revocation
    // afterwards must not permit a receipt to be anchored against a
    // now-disallowed rail. This is the guard against a race between
    // `revoke_rail` and an in-flight mint.
    assert!(
        policy_registry::is_rail_allowed(allowlist, policy_registry::selected_rail(policy)),
        E_RAIL_NOT_ALLOWED,
    );

    policy_registry::record_receipt_minted(policy);
    let revocation_seq = policy_registry::revocation_seq(allowlist);
    let owner = sender;
    let policy_id = object::id(policy);
    let now_ms = clock::timestamp_ms(clock_ref);
    let selected_rail = *policy_registry::selected_rail(policy);
    let receipt = ExecutionReceipt {
        id: object::new(ctx),
        policy_id,
        policy_version,
        owner,
        action: string::utf8(action),
        decision_type: string::utf8(decision_type),
        limitations: string::utf8(limitations),
        state_before_digest,
        selected_rail,
        walrus_blob_id: string::utf8(walrus_blob_id),
        rail_pack_digest,
        content_digest,
        created_at_ms: now_ms,
    };
    let receipt_id = object::id(&receipt);
    event::emit(ReceiptMinted {
        receipt_id,
        policy_id,
        policy_version,
        owner,
        action: copy receipt.action,
        decision_type: copy receipt.decision_type,
        limitations: copy receipt.limitations,
        state_before_digest: copy receipt.state_before_digest,
        selected_rail: copy receipt.selected_rail,
        walrus_blob_id: copy receipt.walrus_blob_id,
        rail_pack_digest: copy receipt.rail_pack_digest,
        content_digest: copy receipt.content_digest,
        created_at_ms: now_ms,
        revocation_seq,
        schema_version: EVENT_SCHEMA_VERSION,
    });
    transfer::transfer(receipt, owner);
}

#[test_only]
public fun mint_receipt_for_testing(
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
) {
    mint_receipt(
        policy,
        allowlist,
        action,
        decision_type,
        limitations,
        state_before_digest,
        walrus_blob_id,
        rail_pack_digest,
        content_digest,
        expected_rail,
        clock_ref,
        ctx,
    );
}

fun assert_valid_decision_type(decision_type: &vector<u8>) {
    assert!(
        *decision_type == b"Hold" ||
        *decision_type == b"BuildBuffer" ||
        *decision_type == b"BorrowForBuffer" ||
        *decision_type == b"PartialRepay" ||
        *decision_type == b"EmergencyDeRisk" ||
        *decision_type == b"ReducePayout" ||
        *decision_type == b"PausePayout" ||
        *decision_type == b"RotateVenue",
        E_INVALID_DECISION_TYPE,
    );
}

fun assert_valid_limitations(limitations: &vector<u8>) {
    assert!(
        *limitations == b"shadow-only" ||
        *limitations == b"testnet-rehearsal",
        E_INVALID_LIMITATIONS,
    );
}

public fun policy_id(r: &ExecutionReceipt): ID { r.policy_id }
public fun policy_version(r: &ExecutionReceipt): u64 { r.policy_version }
public fun owner(r: &ExecutionReceipt): address { r.owner }
public fun action(r: &ExecutionReceipt): &String { &r.action }
public fun decision_type(r: &ExecutionReceipt): &String { &r.decision_type }
public fun limitations(r: &ExecutionReceipt): &String { &r.limitations }
public fun state_before_digest(r: &ExecutionReceipt): &vector<u8> { &r.state_before_digest }
public fun selected_rail(r: &ExecutionReceipt): &String { &r.selected_rail }
public fun walrus_blob_id(r: &ExecutionReceipt): &String { &r.walrus_blob_id }
public fun rail_pack_digest(r: &ExecutionReceipt): &vector<u8> { &r.rail_pack_digest }
public fun content_digest(r: &ExecutionReceipt): &vector<u8> { &r.content_digest }
public fun created_at_ms(r: &ExecutionReceipt): u64 { r.created_at_ms }

public fun digest_len(): u64 { DIGEST_LEN }
public fun event_schema_version(): u16 { EVENT_SCHEMA_VERSION }

#[test_only]
public fun receipt_minted_revocation_seq_for_testing(e: &ReceiptMinted): u64 {
    e.revocation_seq
}
