module tide::policy_registry;

use std::string::{Self as string, String};
use sui::clock::{Self as clock, Clock};
use sui::event;
use sui::package;
use sui::vec_set::{Self as vec_set, VecSet};

const E_NOT_OWNER: u64 = 1;
const E_WRONG_VERSION: u64 = 2;
const E_RAIL_NOT_ALLOWED: u64 = 4;
const E_INVALID_LTV: u64 = 5;
const E_INVALID_PAYOUT: u64 = 6;
const E_INVALID_INPUT: u64 = 7;
const E_ADMIN_TRANSFER_TOO_EARLY: u64 = 8;
const E_ADMIN_TRANSFER_NOT_REQUESTER: u64 = 9;
// Aborts when `delete_policy` is called on a Policy whose
// `receipts_minted` counter is non-zero. Receipts are the immutable proof
// trail; deleting the Policy they reference would orphan that trail.
// A Policy with receipts is append-only — it can be updated or migrated,
// but not deleted.
const E_POLICY_HAS_RECEIPTS: u64 = 10;

// Bump when on-chain schema / invariants change. Entry points assert the
// policy's recorded version matches, so stale objects cannot silently be
// used against new logic after an upgrade. `migrate_policy` is the only
// path that rewrites it, gated by the policy owner (V1: no delegated caps).
const VERSION_WITH_RECEIPT_COUNTER: u64 = 2;
const VERSION_WITH_NONZERO_MIN_BUFFER: u64 = 3;
const CURRENT_VERSION: u64 = VERSION_WITH_NONZERO_MIN_BUFFER;

// Event payload schema. Independent of CURRENT_VERSION so we can extend
// event shapes without forcing a full policy migration.
//
// v2 (Day-7): `PolicyUpdated` carries the new mutable values (mode,
// priority, payout_target_usd, min_buffer_usd, the full LTV ladder).
// v3 (security runway): `RailRevoked` carries `revocation_seq`.
// v1 off-chain indexers must gate on `schema_version` before decoding —
// they will see the extra fields and should widen their parser rather
// than silently drop them.
const EVENT_SCHEMA_VERSION: u16 = 3;

// Input bounds. Kept intentionally generous — the goal is to reject
// unbounded / adversarial input, not to trim legitimate values.
const MAX_STRING_LEN: u64 = 128;
const MAX_RAIL_LEN: u64 = 64;
const MAX_COIN_TYPE_LEN: u64 = 256;
const BPS_DENOM: u64 = 10_000;
const ADMIN_TRANSFER_DELAY_MS: u64 = 86_400_000; // 24 hours

public struct POLICY_REGISTRY has drop {}

/// Held by the publisher. Retained for rail-allowlist administration and
/// future admin surfaces. Not used for policy migration in V1 (owners
/// migrate their own policies).
///
/// Soul-bound: `key` only, no `store`. The cap must not be stashable in
/// arbitrary containers or re-transferable via `public_transfer`;
/// delayed admin-transfer execution is the only ops-authored path that
/// moves it.
public struct AdminCap has key {
    id: UID,
}

/// Shared allowlist of rail identifiers that are permitted as
/// `selected_rail` on any Policy. Keeping it shared makes the set
/// readable by every caller while edits are gated by `AdminCap`.
/// Off-chain collectors surface a wider catalog; this set is the
/// on-chain source of truth for what a user can actually commit to.
public struct RailAllowlist has key {
    id: UID,
    rails: VecSet<String>,
    revocation_seq: u64,
}

/// Owned by the current admin after `request_admin_transfer`. The admin can
/// cancel it or execute the transfer after the delay. We avoid wrapping
/// `AdminCap` in escrow because the cap is intentionally `key` only; the
/// delay still removes the dangerous one-click admin transfer path.
public struct AdminTransferRequest has key {
    id: UID,
    admin: address,
    recipient: address,
    created_at_ms: u64,
    execute_after_ms: u64,
}

public struct RailAllowed has copy, drop {
    rail: String,
    schema_version: u16,
}

public struct RailRevoked has copy, drop {
    rail: String,
    revocation_seq: u64,
    schema_version: u16,
}

public struct AdminTransferRequested has copy, drop {
    request_id: ID,
    admin: address,
    recipient: address,
    created_at_ms: u64,
    execute_after_ms: u64,
    schema_version: u16,
}

public struct AdminTransferCanceled has copy, drop {
    request_id: ID,
    admin: address,
    recipient: address,
    schema_version: u16,
}

public struct AdminTransferred has copy, drop {
    request_id: ID,
    admin: address,
    recipient: address,
    executed_at_ms: u64,
    schema_version: u16,
}

public struct PolicyDeleted has copy, drop {
    policy_id: ID,
    owner: address,
    schema_version: u16,
}

fun init(otw: POLICY_REGISTRY, ctx: &mut TxContext) {
    // Claim the one-time `Publisher` so downstream ecosystem tooling
    // (display, kiosk rules) can be wired in later without a republish.
    let publisher = package::claim(otw, ctx);
    let sender = tx_context::sender(ctx);
    transfer::public_transfer(publisher, sender);
    transfer::transfer(AdminCap { id: object::new(ctx) }, sender);
    transfer::share_object(RailAllowlist {
        id: object::new(ctx),
        rails: vec_set::empty<String>(),
        revocation_seq: 0,
    });
    // NOTE: The `UpgradeCap` is produced by the `sui move publish` flow
    // and sent to the publisher. Keep it in cold storage; transferring
    // it to a multisig or timelock is the recommended ops posture.
}

/// Soul-bound: `key` only, no `store`. Prevents a Policy from being
/// stashed inside arbitrary containers or transferred via
/// `public_transfer`. The only paths that move a Policy are the entry
/// points in this module.
public struct Policy has key {
    id: UID,
    version: u64,
    owner: address,
    receipts_minted: u64,
    name: String,
    mode: String,
    priority: String,
    collateral_symbol: String,
    collateral_coin_type: String,
    selected_rail: String,
    payout_target_usd: u64,
    min_buffer_usd: u64,
    max_ltv_bps: u64,
    target_ltv_low_bps: u64,
    target_ltv_high_bps: u64,
    repay_ltv_bps: u64,
    emergency_ltv_bps: u64,
    created_at_ms: u64,
    updated_at_ms: u64,
}

public struct PolicyCreated has copy, drop {
    policy_id: ID,
    owner: address,
    policy_version: u64,
    selected_rail: String,
    mode: String,
    priority: String,
    created_at_ms: u64,
    schema_version: u16,
}

public struct PolicyUpdated has copy, drop {
    policy_id: ID,
    owner: address,
    policy_version: u64,
    selected_rail: String,
    // The full set of mutable fields rewritten by `update_policy`, so
    // off-chain indexers can reconstruct policy evolution from the event
    // stream alone without having to re-fetch the object every time.
    mode: String,
    priority: String,
    payout_target_usd: u64,
    min_buffer_usd: u64,
    max_ltv_bps: u64,
    target_ltv_low_bps: u64,
    target_ltv_high_bps: u64,
    repay_ltv_bps: u64,
    emergency_ltv_bps: u64,
    updated_at_ms: u64,
    schema_version: u16,
}

public struct RailSelected has copy, drop {
    policy_id: ID,
    owner: address,
    policy_version: u64,
    previous_rail: String,
    next_rail: String,
    updated_at_ms: u64,
    schema_version: u16,
}

public struct PolicyMigrated has copy, drop {
    policy_id: ID,
    owner: address,
    from_version: u64,
    to_version: u64,
    schema_version: u16,
}

public fun create_policy(
    name: vector<u8>,
    mode: vector<u8>,
    priority: vector<u8>,
    collateral_symbol: vector<u8>,
    collateral_coin_type: vector<u8>,
    selected_rail: vector<u8>,
    payout_target_usd: u64,
    min_buffer_usd: u64,
    max_ltv_bps: u64,
    target_ltv_low_bps: u64,
    target_ltv_high_bps: u64,
    repay_ltv_bps: u64,
    emergency_ltv_bps: u64,
    allowlist: &RailAllowlist,
    clock_ref: &Clock,
    ctx: &mut TxContext,
) {
    assert_bytes_len(&name, MAX_STRING_LEN);
    assert_bytes_len(&mode, MAX_STRING_LEN);
    assert_bytes_len(&priority, MAX_STRING_LEN);
    assert_bytes_len(&collateral_symbol, MAX_STRING_LEN);
    assert_bytes_len(&collateral_coin_type, MAX_COIN_TYPE_LEN);
    assert_bytes_len(&selected_rail, MAX_RAIL_LEN);

    let owner = tx_context::sender(ctx);
    let now_ms = clock::timestamp_ms(clock_ref);
    let rail_str = string::utf8(selected_rail);
    assert_rail_allowed(allowlist, &rail_str);
    assert_thresholds(
        payout_target_usd,
        min_buffer_usd,
        max_ltv_bps,
        target_ltv_low_bps,
        target_ltv_high_bps,
        repay_ltv_bps,
        emergency_ltv_bps,
    );

    let policy = Policy {
        id: object::new(ctx),
        version: CURRENT_VERSION,
        owner,
        receipts_minted: 0,
        name: string::utf8(name),
        mode: string::utf8(mode),
        priority: string::utf8(priority),
        collateral_symbol: string::utf8(collateral_symbol),
        collateral_coin_type: string::utf8(collateral_coin_type),
        selected_rail: rail_str,
        payout_target_usd,
        min_buffer_usd,
        max_ltv_bps,
        target_ltv_low_bps,
        target_ltv_high_bps,
        repay_ltv_bps,
        emergency_ltv_bps,
        created_at_ms: now_ms,
        updated_at_ms: now_ms,
    };

    let policy_id = object::id(&policy);
    event::emit(PolicyCreated {
        policy_id,
        owner,
        policy_version: CURRENT_VERSION,
        selected_rail: copy policy.selected_rail,
        mode: copy policy.mode,
        priority: copy policy.priority,
        created_at_ms: now_ms,
        schema_version: EVENT_SCHEMA_VERSION,
    });

    transfer::transfer(policy, owner);
}

public fun update_policy(
    policy: &mut Policy,
    mode: vector<u8>,
    priority: vector<u8>,
    payout_target_usd: u64,
    min_buffer_usd: u64,
    max_ltv_bps: u64,
    target_ltv_low_bps: u64,
    target_ltv_high_bps: u64,
    repay_ltv_bps: u64,
    emergency_ltv_bps: u64,
    clock_ref: &Clock,
    ctx: &TxContext,
) {
    assert_owner(policy, ctx);
    assert_version(policy);
    assert_bytes_len(&mode, MAX_STRING_LEN);
    assert_bytes_len(&priority, MAX_STRING_LEN);
    assert_thresholds(
        payout_target_usd,
        min_buffer_usd,
        max_ltv_bps,
        target_ltv_low_bps,
        target_ltv_high_bps,
        repay_ltv_bps,
        emergency_ltv_bps,
    );

    policy.mode = string::utf8(mode);
    policy.priority = string::utf8(priority);
    policy.payout_target_usd = payout_target_usd;
    policy.min_buffer_usd = min_buffer_usd;
    policy.max_ltv_bps = max_ltv_bps;
    policy.target_ltv_low_bps = target_ltv_low_bps;
    policy.target_ltv_high_bps = target_ltv_high_bps;
    policy.repay_ltv_bps = repay_ltv_bps;
    policy.emergency_ltv_bps = emergency_ltv_bps;
    policy.updated_at_ms = clock::timestamp_ms(clock_ref);

    event::emit(PolicyUpdated {
        policy_id: object::id(policy),
        owner: policy.owner,
        policy_version: policy.version,
        selected_rail: copy policy.selected_rail,
        mode: copy policy.mode,
        priority: copy policy.priority,
        payout_target_usd: policy.payout_target_usd,
        min_buffer_usd: policy.min_buffer_usd,
        max_ltv_bps: policy.max_ltv_bps,
        target_ltv_low_bps: policy.target_ltv_low_bps,
        target_ltv_high_bps: policy.target_ltv_high_bps,
        repay_ltv_bps: policy.repay_ltv_bps,
        emergency_ltv_bps: policy.emergency_ltv_bps,
        updated_at_ms: policy.updated_at_ms,
        schema_version: EVENT_SCHEMA_VERSION,
    });
}

public fun select_rail(
    policy: &mut Policy,
    selected_rail: vector<u8>,
    allowlist: &RailAllowlist,
    clock_ref: &Clock,
    ctx: &TxContext,
) {
    assert_owner(policy, ctx);
    assert_version(policy);
    assert_bytes_len(&selected_rail, MAX_RAIL_LEN);

    let previous_rail = copy policy.selected_rail;
    let next_rail = string::utf8(selected_rail);
    assert_rail_allowed(allowlist, &next_rail);
    policy.selected_rail = next_rail;
    policy.updated_at_ms = clock::timestamp_ms(clock_ref);

    event::emit(RailSelected {
        policy_id: object::id(policy),
        owner: policy.owner,
        policy_version: policy.version,
        previous_rail,
        next_rail: copy policy.selected_rail,
        updated_at_ms: policy.updated_at_ms,
        schema_version: EVENT_SCHEMA_VERSION,
    });
}

public fun delete_policy(policy: Policy, ctx: &TxContext) {
    assert_owner(&policy, ctx);
    assert_version(&policy);
    assert!(policy.receipts_minted == 0, E_POLICY_HAS_RECEIPTS);
    let policy_id = object::id(&policy);
    let policy_owner = policy.owner;
    let Policy {
        id,
        version: _,
        owner: _,
        receipts_minted: _,
        name: _,
        mode: _,
        priority: _,
        collateral_symbol: _,
        collateral_coin_type: _,
        selected_rail: _,
        payout_target_usd: _,
        min_buffer_usd: _,
        max_ltv_bps: _,
        target_ltv_low_bps: _,
        target_ltv_high_bps: _,
        repay_ltv_bps: _,
        emergency_ltv_bps: _,
        created_at_ms: _,
        updated_at_ms: _,
    } = policy;

    event::emit(PolicyDeleted {
        policy_id,
        owner: policy_owner,
        schema_version: EVENT_SCHEMA_VERSION,
    });
    object::delete(id);
}

public fun owner(policy: &Policy): address {
    policy.owner
}

public fun selected_rail(policy: &Policy): &String {
    &policy.selected_rail
}

public fun payout_target_usd(policy: &Policy): u64 {
    policy.payout_target_usd
}

public fun min_buffer_usd(policy: &Policy): u64 {
    policy.min_buffer_usd
}

public fun receipts_minted(policy: &Policy): u64 {
    policy.receipts_minted
}

public fun updated_at_ms(policy: &Policy): u64 {
    policy.updated_at_ms
}

fun assert_owner(policy: &Policy, ctx: &TxContext) {
    // Policies are user-owned objects, so owner auth is intentionally
    // address-bound to the object owner rather than a protocol admin cap.
    assert!(policy.owner == tx_context::sender(ctx), E_NOT_OWNER);
}

/// Invariants on the policy's numeric thresholds. Enforced on every
/// create/update so the ladder is always monotonic and bounded:
///
///   0 < target_low < target_high <= repay <= emergency <= max_ltv <= BPS_DENOM
///
/// Zero payout or buffer values create policy shells that cannot produce a
/// meaningful treasury workflow. Zero target_low would silently disable the
/// lower band of the harbor policy; an LTV above 100% is not meaningful.
fun assert_thresholds(
    payout_target_usd: u64,
    min_buffer_usd: u64,
    max_ltv_bps: u64,
    target_ltv_low_bps: u64,
    target_ltv_high_bps: u64,
    repay_ltv_bps: u64,
    emergency_ltv_bps: u64,
) {
    assert!(payout_target_usd > 0, E_INVALID_PAYOUT);
    assert!(min_buffer_usd > 0, E_INVALID_PAYOUT);
    assert!(target_ltv_low_bps > 0, E_INVALID_LTV);
    assert!(target_ltv_low_bps < target_ltv_high_bps, E_INVALID_LTV);
    assert!(target_ltv_high_bps <= repay_ltv_bps, E_INVALID_LTV);
    assert!(repay_ltv_bps <= emergency_ltv_bps, E_INVALID_LTV);
    assert!(emergency_ltv_bps <= max_ltv_bps, E_INVALID_LTV);
    assert!(max_ltv_bps <= BPS_DENOM, E_INVALID_LTV);
}

fun assert_bytes_len(bytes: &vector<u8>, max_len: u64) {
    assert!(vector::length(bytes) <= max_len, E_INVALID_INPUT);
}

fun assert_version(policy: &Policy) {
    assert!(policy.version == CURRENT_VERSION, E_WRONG_VERSION);
}

public fun version(policy: &Policy): u64 {
    policy.version
}

public fun current_version(): u64 {
    CURRENT_VERSION
}

public fun event_schema_version(): u16 {
    EVENT_SCHEMA_VERSION
}

public fun admin_transfer_delay_ms(): u64 {
    ADMIN_TRANSFER_DELAY_MS
}

/// Owner-authed migration. In V1 we deliberately avoid delegated caps
/// Policy-owner invariant:
/// after a package upgrade that bumps `CURRENT_VERSION`, the policy's
/// owner submits `migrate_policy` themselves. Add any per-field
/// migration logic here before bumping `policy.version`.
///
/// Always re-validates thresholds after any per-field migration. Migration
/// steps must repair backwards-compatible defaults before this check; fields
/// that cannot be repaired safely should keep refusing here.
public fun migrate_policy(policy: &mut Policy, clock_ref: &Clock, ctx: &TxContext) {
    assert_owner(policy, ctx);
    let from_version = policy.version;
    assert!(from_version < CURRENT_VERSION, E_WRONG_VERSION);
    migrate_step(policy, from_version);
    assert_thresholds(
        policy.payout_target_usd,
        policy.min_buffer_usd,
        policy.max_ltv_bps,
        policy.target_ltv_low_bps,
        policy.target_ltv_high_bps,
        policy.repay_ltv_bps,
        policy.emergency_ltv_bps,
    );
    policy.version = CURRENT_VERSION;
    policy.updated_at_ms = clock::timestamp_ms(clock_ref);
    event::emit(PolicyMigrated {
        policy_id: object::id(policy),
        owner: policy.owner,
        from_version,
        to_version: CURRENT_VERSION,
        schema_version: EVENT_SCHEMA_VERSION,
    });
}

fun migrate_step(policy: &mut Policy, from_version: u64) {
    if (from_version == 1) {
        migrate_v1_to_v2(policy);
        migrate_v2_to_v3(policy);
    } else if (from_version == VERSION_WITH_RECEIPT_COUNTER) {
        migrate_v2_to_v3(policy);
    } else {
        abort E_WRONG_VERSION
    }
}

fun migrate_v1_to_v2(_policy: &mut Policy) {
    // V2 introduced `receipts_minted` as an append-only deletion guard.
    // There is no derived rewrite for in-repo V1 test fixtures; future
    // version bumps must add an explicit next-step function instead of
    // setting `policy.version = CURRENT_VERSION` directly.
}

fun migrate_v2_to_v3(policy: &mut Policy) {
    // V3 tightened the policy shape so new policies and updates must carry
    // a non-zero buffer target. Legacy V1/V2 policies may have stored zero;
    // migrate them to the smallest representable non-zero value so owners are
    // not stranded by the new invariant and can immediately update to their
    // desired buffer.
    if (policy.min_buffer_usd == 0) {
        policy.min_buffer_usd = 1;
    }
}

/// Start a delayed admin transfer. The request object remains with the
/// current admin, so they can cancel before `execute_after_ms`.
public fun request_admin_transfer(
    _: &AdminCap,
    to: address,
    clock_ref: &Clock,
    ctx: &mut TxContext,
) {
    let admin = tx_context::sender(ctx);
    assert!(to != @0x0, E_INVALID_INPUT);
    assert!(to != admin, E_INVALID_INPUT);
    let created_at_ms = clock::timestamp_ms(clock_ref);
    let execute_after_ms = created_at_ms + ADMIN_TRANSFER_DELAY_MS;
    let request = AdminTransferRequest {
        id: object::new(ctx),
        admin,
        recipient: to,
        created_at_ms,
        execute_after_ms,
    };
    let request_id = object::id(&request);
    event::emit(AdminTransferRequested {
        request_id,
        admin,
        recipient: to,
        created_at_ms,
        execute_after_ms,
        schema_version: EVENT_SCHEMA_VERSION,
    });
    transfer::transfer(request, admin);
}

/// SECURITY: dual-gate on two independent axes.
///
/// Gate 1 — `_: &AdminCap` parameter. The Move runtime enforces that the
/// caller's transaction must reference an AdminCap object they own. No
/// address check is needed here; capability possession is the proof.
///
/// Gate 2 — `request.admin == sender` runtime assertion (enforced inside
/// `assert_admin_request`). The AdminTransferRequest carries the address
/// of the admin at the time the request was created. If the cap has
/// since rotated to a new holder via `execute_admin_transfer`, the new
/// holder cannot cancel an older request that was not theirs to create.
///
/// Each gate defends a different threat. Gate 1 prevents non-admins from
/// touching the request. Gate 2 prevents a freshly-rotated admin from
/// silently invalidating a predecessor's pending transfer.
///
/// Do NOT collapse these into one check. Removing Gate 1 would allow any
/// address to spoof the sender match. Removing Gate 2 would let a
/// successor admin invalidate a predecessor's pending transfer.
public fun cancel_admin_transfer(
    _: &AdminCap,
    request: AdminTransferRequest,
    ctx: &TxContext,
) {
    let sender = tx_context::sender(ctx);
    // The request stays owned by the admin in normal Sui execution, but
    // keep this explicit check so tests and future custody flows cannot
    // cancel a request merely by obtaining the object value.
    assert!(request.admin == sender, E_ADMIN_TRANSFER_NOT_REQUESTER);
    let AdminTransferRequest { id, admin, recipient, created_at_ms: _, execute_after_ms: _ } = request;
    let request_id = object::uid_to_inner(&id);
    object::delete(id);
    event::emit(AdminTransferCanceled {
        request_id,
        admin,
        recipient,
        schema_version: EVENT_SCHEMA_VERSION,
    });
}

public fun execute_admin_transfer(
    cap: AdminCap,
    request: AdminTransferRequest,
    clock_ref: &Clock,
    ctx: &TxContext,
) {
    let sender = tx_context::sender(ctx);
    assert!(request.admin == sender, E_ADMIN_TRANSFER_NOT_REQUESTER);
    let now_ms = clock::timestamp_ms(clock_ref);
    assert!(now_ms >= request.execute_after_ms, E_ADMIN_TRANSFER_TOO_EARLY);
    let AdminTransferRequest { id, admin, recipient, created_at_ms: _, execute_after_ms: _ } = request;
    let request_id = object::uid_to_inner(&id);
    object::delete(id);
    event::emit(AdminTransferred {
        request_id,
        admin,
        recipient,
        executed_at_ms: now_ms,
        schema_version: EVENT_SCHEMA_VERSION,
    });
    transfer::transfer(cap, recipient);
}

/* ---- Rail allowlist admin ops ---- */
// Authorization on admin ops below is enforced by `_: &AdminCap` in the
// function signature: callers cannot invoke these entry points without a
// transaction that references an AdminCap they own. No explicit assert is
// needed (and a no-op helper is misleading).

public fun allow_rail(
    _: &AdminCap,
    allowlist: &mut RailAllowlist,
    rail: vector<u8>,
) {
    assert_bytes_len(&rail, MAX_RAIL_LEN);
    let rail_str = string::utf8(rail);
    if (!vec_set::contains(&allowlist.rails, &rail_str)) {
        vec_set::insert(&mut allowlist.rails, copy rail_str);
        event::emit(RailAllowed { rail: rail_str, schema_version: EVENT_SCHEMA_VERSION });
    }
}

public fun revoke_rail(
    _: &AdminCap,
    allowlist: &mut RailAllowlist,
    rail: vector<u8>,
) {
    assert_bytes_len(&rail, MAX_RAIL_LEN);
    let rail_str = string::utf8(rail);
    if (vec_set::contains(&allowlist.rails, &rail_str)) {
        vec_set::remove(&mut allowlist.rails, &rail_str);
        allowlist.revocation_seq = allowlist.revocation_seq + 1;
        event::emit(RailRevoked {
            rail: rail_str,
            revocation_seq: allowlist.revocation_seq,
            schema_version: EVENT_SCHEMA_VERSION,
        });
    }
}

public fun is_rail_allowed(allowlist: &RailAllowlist, rail: &String): bool {
    vec_set::contains(&allowlist.rails, rail)
}

public fun revocation_seq(allowlist: &RailAllowlist): u64 {
    allowlist.revocation_seq
}

fun assert_rail_allowed(allowlist: &RailAllowlist, rail: &String) {
    assert!(vec_set::contains(&allowlist.rails, rail), E_RAIL_NOT_ALLOWED);
}

/// DEFENSE-IN-DEPTH: `assert_version` is called here even though
/// `mint_receipt` in `execution_receipts` already checks
/// `policy_version == policy_registry::current_version()` before calling
/// this function.
///
/// The double check is intentional. `record_receipt_minted` is
/// `public(package)`, meaning any future module added to the `tide`
/// package can call it directly — bypassing `mint_receipt`'s outer
/// version guard. Without this inner guard, a new package-internal
/// caller introduced during an upgrade could increment the receipts
/// counter against a stale policy and corrupt the deletion guard
/// `E_POLICY_HAS_RECEIPTS`.
///
/// Auditors: this is not dead code. It is the guard that keeps the
/// receipts counter trustworthy if the package's call graph ever
/// changes.
public(package) fun record_receipt_minted(policy: &mut Policy): u64 {
    assert_version(policy);
    policy.receipts_minted = policy.receipts_minted + 1;
    policy.receipts_minted
}

/* ---- test-only helpers ---- */

#[test_only]
public fun new_admin_cap_for_testing(ctx: &mut TxContext): AdminCap {
    AdminCap { id: object::new(ctx) }
}

#[test_only]
public fun destroy_admin_cap_for_testing(cap: AdminCap) {
    let AdminCap { id } = cap;
    object::delete(id);
}

#[test_only]
public fun transfer_admin_cap_for_testing(cap: AdminCap, to: address) {
    transfer::transfer(cap, to);
}

#[test_only]
public fun new_rail_allowlist_for_testing(ctx: &mut TxContext): RailAllowlist {
    RailAllowlist {
        id: object::new(ctx),
        rails: vec_set::empty<String>(),
        revocation_seq: 0,
    }
}

#[test_only]
public fun share_rail_allowlist_for_testing(a: RailAllowlist) {
    // RailAllowlist has `key` only; external test code cannot call
    // `public_share_object`, so expose sharing from inside the module.
    transfer::share_object(a);
}

#[test_only]
public fun destroy_rail_allowlist_for_testing(a: RailAllowlist) {
    let RailAllowlist { id, rails: _, revocation_seq: _ } = a;
    object::delete(id);
}

#[test_only]
public fun force_downgrade_for_testing(policy: &mut Policy, new_version: u64) {
    policy.version = new_version;
}

#[test_only]
public fun force_thresholds_for_testing(
    policy: &mut Policy,
    max_ltv_bps: u64,
    target_ltv_low_bps: u64,
    target_ltv_high_bps: u64,
    repay_ltv_bps: u64,
    emergency_ltv_bps: u64,
) {
    policy.max_ltv_bps = max_ltv_bps;
    policy.target_ltv_low_bps = target_ltv_low_bps;
    policy.target_ltv_high_bps = target_ltv_high_bps;
    policy.repay_ltv_bps = repay_ltv_bps;
    policy.emergency_ltv_bps = emergency_ltv_bps;
}

#[test_only]
public fun force_min_buffer_for_testing(policy: &mut Policy, min_buffer_usd: u64) {
    policy.min_buffer_usd = min_buffer_usd;
}

/// TEST-ONLY. Production code must never call this function.
///
/// `Policy` has `key` only (no `store`), so it cannot be moved via
/// `transfer::public_transfer`. This helper exposes single-owner
/// transfer solely so test scenarios can hand a Policy between test
/// addresses inside `test_scenario`. The `#[test_only]` attribute
/// causes the Move compiler to strip this function from non-test
/// builds, so there is no way for production code to reach it.
///
/// If you are reading this during an audit and see a production call
/// site that reaches `transfer_policy_for_testing`: that is a critical
/// bug — `Policy` must remain soul-bound (invariant I-1).
#[test_only]
public fun transfer_policy_for_testing(policy: Policy, to: address) {
    // Policy has `key` only; external test code cannot call
    // `public_transfer`, so expose single-owner transfer from inside.
    transfer::transfer(policy, to);
}

#[test_only]
public fun destroy_policy_for_testing(policy: Policy) {
    let Policy {
        id,
        version: _,
        owner: _,
        receipts_minted: _,
        name: _,
        mode: _,
        priority: _,
        collateral_symbol: _,
        collateral_coin_type: _,
        selected_rail: _,
        payout_target_usd: _,
        min_buffer_usd: _,
        max_ltv_bps: _,
        target_ltv_low_bps: _,
        target_ltv_high_bps: _,
        repay_ltv_bps: _,
        emergency_ltv_bps: _,
        created_at_ms: _,
        updated_at_ms: _,
    } = policy;
    object::delete(id);
}

#[test_only]
public fun rail_revoked_seq_for_testing(e: &RailRevoked): u64 {
    e.revocation_seq
}
