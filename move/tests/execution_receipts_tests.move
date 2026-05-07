#[test_only]
module tide::execution_receipts_tests;

use std::string;
use sui::clock;
use sui::event;
use sui::test_scenario;
use tide::policy_registry::{Self, Policy, RailAllowlist};
use tide::execution_receipts::{Self, ExecutionReceipt, ReceiptMinted};

const OWNER: address = @0xA11CE;
const OTHER: address = @0xB0B;

#[test_only]
fun default_rail(): vector<u8> { b"scallop-sui" }

#[test_only]
fun decision_type(): vector<u8> { b"Hold" }

#[test_only]
fun limitations(): vector<u8> { b"testnet-rehearsal" }

#[test_only]
fun digest_bytes(): vector<u8> {
    let mut v = vector::empty<u8>();
    let mut i = 0u64;
    while (i < 32) {
        vector::push_back(&mut v, (((i * 73 + 41) % 251) as u8));
        i = i + 1;
    };
    v
}

#[test_only]
fun seed_policy(scenario: &mut test_scenario::Scenario) {
    test_scenario::next_tx(scenario, OWNER);
    {
        let mut allowlist = policy_registry::new_rail_allowlist_for_testing(
            test_scenario::ctx(scenario)
        );
        let cap = policy_registry::new_admin_cap_for_testing(test_scenario::ctx(scenario));
        policy_registry::allow_rail(&cap, &mut allowlist, default_rail());
        policy_registry::destroy_admin_cap_for_testing(cap);
        policy_registry::share_rail_allowlist_for_testing(allowlist);
    };

    test_scenario::next_tx(scenario, OWNER);
    {
        let allowlist = test_scenario::take_shared<RailAllowlist>(scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(scenario));
        policy_registry::create_policy(
            b"harbor", b"harbor", b"stability", b"SUI", b"0x2::sui::SUI",
            default_rail(),
            1_000_000, 500_000, 8_000, 3_000, 5_000, 6_000, 7_000,
            &allowlist, &clk, test_scenario::ctx(scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
    };
}

#[test]
fun mint_receipt_happy_path() {
    let mut scenario = test_scenario::begin(OWNER);
    seed_policy(&mut scenario);

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        execution_receipts::mint_receipt_for_testing(
            &mut policy,
            &allowlist,
            b"harbor.rebalance",
            decision_type(),
            limitations(),
            digest_bytes(),
            b"walrus:testnet:stub-blob-id",
            digest_bytes(),
            digest_bytes(),
            default_rail(),
            &clk,
            test_scenario::ctx(&mut scenario),
        );
        let minted_events = event::events_by_type<ReceiptMinted>();
        assert!(vector::length(&minted_events) == 1, 4);
        assert!(
            execution_receipts::receipt_minted_revocation_seq_for_testing(&minted_events[0]) ==
                policy_registry::revocation_seq(&allowlist),
            5,
        );
        assert!(policy_registry::receipts_minted(&policy) == 1, 6);
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
        test_scenario::return_to_sender(&scenario, policy);
    };

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let receipt = test_scenario::take_from_sender<ExecutionReceipt>(&scenario);
        assert!(execution_receipts::owner(&receipt) == OWNER, 0);
        assert!(vector::length(execution_receipts::content_digest(&receipt)) == execution_receipts::digest_len(), 1);
        assert!(vector::length(execution_receipts::rail_pack_digest(&receipt)) == execution_receipts::digest_len(), 2);
        assert!(vector::length(execution_receipts::state_before_digest(&receipt)) == execution_receipts::digest_len(), 3);
        assert!(execution_receipts::event_schema_version() == 3, 4);
        assert!(*execution_receipts::selected_rail(&receipt) == string::utf8(default_rail()), 5);
        test_scenario::return_to_sender(&scenario, receipt);
    };
    test_scenario::end(scenario);
}

#[test]
fun mint_receipt_mirrors_nonzero_revocation_seq() {
    let mut scenario = test_scenario::begin(OWNER);
    seed_policy(&mut scenario);

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let cap = policy_registry::new_admin_cap_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::allow_rail(&cap, &mut allowlist, b"navi-sui");
        policy_registry::revoke_rail(&cap, &mut allowlist, b"navi-sui");
        assert!(policy_registry::revocation_seq(&allowlist) == 1, 0);
        policy_registry::destroy_admin_cap_for_testing(cap);
        test_scenario::return_shared(allowlist);
    };

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        execution_receipts::mint_receipt_for_testing(
            &mut policy,
            &allowlist,
            b"harbor.rebalance",
            decision_type(),
            limitations(),
            digest_bytes(),
            b"walrus:testnet:stub-blob-id",
            digest_bytes(),
            digest_bytes(),
            default_rail(),
            &clk,
            test_scenario::ctx(&mut scenario),
        );
        let minted_events = event::events_by_type<ReceiptMinted>();
        assert!(vector::length(&minted_events) == 1, 1);
        assert!(execution_receipts::receipt_minted_revocation_seq_for_testing(&minted_events[0]) == 1, 2);
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_POLICY_HAS_RECEIPTS)]
fun delete_policy_with_outstanding_receipts_aborts() {
    let mut scenario = test_scenario::begin(OWNER);
    seed_policy(&mut scenario);

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        execution_receipts::mint_receipt_for_testing(
            &mut policy,
            &allowlist,
            b"harbor.rebalance",
            decision_type(),
            limitations(),
            digest_bytes(),
            b"walrus:testnet:stub-blob-id",
            digest_bytes(),
            digest_bytes(),
            default_rail(),
            &clk,
            test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
        test_scenario::return_to_sender(&scenario, policy);
    };

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let policy = test_scenario::take_from_sender<Policy>(&scenario);
        policy_registry::delete_policy(policy, test_scenario::ctx(&mut scenario));
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::execution_receipts::E_RAIL_MISMATCH)]
fun mint_receipt_rejects_rail_mismatch() {
    let mut scenario = test_scenario::begin(OWNER);
    seed_policy(&mut scenario);

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        // Policy's selected_rail is `scallop-sui`; caller pinned `navi-sui`.
        execution_receipts::mint_receipt_for_testing(
            &mut policy,
            &allowlist,
            b"harbor.rebalance",
            decision_type(),
            limitations(),
            digest_bytes(),
            b"walrus:testnet:stub",
            digest_bytes(),
            digest_bytes(),
            b"navi-sui",
            &clk,
            test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::execution_receipts::E_NOT_POLICY_OWNER)]
fun mint_receipt_rejects_non_owner() {
    let mut scenario = test_scenario::begin(OWNER);
    seed_policy(&mut scenario);

    test_scenario::next_tx(&mut scenario, OWNER);
    let mut policy = test_scenario::take_from_sender<Policy>(&scenario);

    test_scenario::next_tx(&mut scenario, OTHER);
    {
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        execution_receipts::mint_receipt_for_testing(
            &mut policy,
            &allowlist,
            b"harbor.rebalance",
            decision_type(),
            limitations(),
            digest_bytes(),
            b"walrus:testnet:stub",
            digest_bytes(),
            digest_bytes(),
            default_rail(),
            &clk,
            test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
    };
    policy_registry::transfer_policy_for_testing(policy, OWNER);
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::execution_receipts::E_INVALID_DIGEST)]
fun mint_receipt_rejects_short_content_digest() {
    let mut scenario = test_scenario::begin(OWNER);
    seed_policy(&mut scenario);

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        // Truncated content digest (16 bytes instead of 32).
        let mut short = vector::empty<u8>();
        let mut i = 0u64;
        while (i < 16) { vector::push_back(&mut short, (i as u8)); i = i + 1; };
        execution_receipts::mint_receipt_for_testing(
            &mut policy,
            &allowlist,
            b"harbor.rebalance",
            decision_type(),
            limitations(),
            digest_bytes(),
            b"walrus:testnet:stub",
            digest_bytes(),
            short,
            default_rail(),
            &clk,
            test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::execution_receipts::E_INVALID_DIGEST)]
fun mint_receipt_rejects_short_rail_pack_digest() {
    let mut scenario = test_scenario::begin(OWNER);
    seed_policy(&mut scenario);

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        let mut short = vector::empty<u8>();
        vector::push_back(&mut short, 1u8);
        execution_receipts::mint_receipt_for_testing(
            &mut policy,
            &allowlist,
            b"harbor.rebalance",
            decision_type(),
            limitations(),
            digest_bytes(),
            b"walrus:testnet:stub",
            short,
            digest_bytes(),
            default_rail(),
            &clk,
            test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::execution_receipts::E_INVALID_INPUT)]
fun mint_receipt_rejects_oversize_action() {
    let mut scenario = test_scenario::begin(OWNER);
    seed_policy(&mut scenario);

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        // MAX_ACTION_LEN = 64; build a 65-byte action to trip the assert.
        let mut big = vector::empty<u8>();
        let mut i = 0u64;
        while (i < 65) { vector::push_back(&mut big, 0x61u8); i = i + 1; };
        execution_receipts::mint_receipt_for_testing(
            &mut policy,
            &allowlist,
            big,
            decision_type(),
            limitations(),
            digest_bytes(),
            b"walrus:testnet:stub",
            digest_bytes(),
            digest_bytes(),
            default_rail(),
            &clk,
            test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::execution_receipts::E_INVALID_INPUT)]
fun mint_receipt_rejects_oversize_decision_type() {
    let mut scenario = test_scenario::begin(OWNER);
    seed_policy(&mut scenario);

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        let mut big = vector::empty<u8>();
        let mut i = 0u64;
        while (i < 65) { vector::push_back(&mut big, 0x44u8); i = i + 1; };
        execution_receipts::mint_receipt_for_testing(
            &mut policy,
            &allowlist,
            b"harbor.rebalance",
            big,
            limitations(),
            digest_bytes(),
            b"walrus:testnet:stub",
            digest_bytes(),
            digest_bytes(),
            default_rail(),
            &clk,
            test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::execution_receipts::E_INVALID_INPUT)]
fun mint_receipt_rejects_oversize_limitations() {
    let mut scenario = test_scenario::begin(OWNER);
    seed_policy(&mut scenario);

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        let mut big = vector::empty<u8>();
        let mut i = 0u64;
        while (i < 65) { vector::push_back(&mut big, 0x4cu8); i = i + 1; };
        execution_receipts::mint_receipt_for_testing(
            &mut policy,
            &allowlist,
            b"harbor.rebalance",
            decision_type(),
            big,
            digest_bytes(),
            b"walrus:testnet:stub",
            digest_bytes(),
            digest_bytes(),
            default_rail(),
            &clk,
            test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::execution_receipts::E_INVALID_INPUT)]
fun mint_receipt_rejects_oversize_walrus_blob_id() {
    let mut scenario = test_scenario::begin(OWNER);
    seed_policy(&mut scenario);

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        // MAX_BLOB_ID_LEN = 512; build a 513-byte blob id to trip the assert.
        let mut big = vector::empty<u8>();
        let mut i = 0u64;
        while (i < 513) { vector::push_back(&mut big, 0x62u8); i = i + 1; };
        execution_receipts::mint_receipt_for_testing(
            &mut policy,
            &allowlist,
            b"harbor.rebalance",
            decision_type(),
            limitations(),
            digest_bytes(),
            big,
            digest_bytes(),
            digest_bytes(),
            default_rail(),
            &clk,
            test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::execution_receipts::E_INVALID_INPUT)]
fun mint_receipt_rejects_oversize_expected_rail() {
    let mut scenario = test_scenario::begin(OWNER);
    seed_policy(&mut scenario);

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        let mut big = vector::empty<u8>();
        let mut i = 0u64;
        while (i < 65) { vector::push_back(&mut big, 0x72u8); i = i + 1; };
        execution_receipts::mint_receipt_for_testing(
            &mut policy,
            &allowlist,
            b"harbor.rebalance",
            decision_type(),
            limitations(),
            digest_bytes(),
            b"walrus:testnet:stub",
            digest_bytes(),
            digest_bytes(),
            big,
            &clk,
            test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::execution_receipts::E_INVALID_DECISION_TYPE)]
fun mint_receipt_rejects_unknown_decision_type() {
    let mut scenario = test_scenario::begin(OWNER);
    seed_policy(&mut scenario);

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        execution_receipts::mint_receipt_for_testing(
            &mut policy,
            &allowlist,
            b"harbor.rebalance",
            b"MadeUpDecision",
            limitations(),
            digest_bytes(),
            b"walrus:testnet:stub",
            digest_bytes(),
            digest_bytes(),
            default_rail(),
            &clk,
            test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::execution_receipts::E_INVALID_LIMITATIONS)]
fun mint_receipt_rejects_unknown_limitations() {
    let mut scenario = test_scenario::begin(OWNER);
    seed_policy(&mut scenario);

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        execution_receipts::mint_receipt_for_testing(
            &mut policy,
            &allowlist,
            b"harbor.rebalance",
            decision_type(),
            b"real-money-auto-exec",
            digest_bytes(),
            b"walrus:testnet:stub",
            digest_bytes(),
            digest_bytes(),
            default_rail(),
            &clk,
            test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::execution_receipts::E_INVALID_LIMITATIONS)]
fun mint_receipt_rejects_reserved_mainnet_execution_limitations() {
    let mut scenario = test_scenario::begin(OWNER);
    seed_policy(&mut scenario);

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        execution_receipts::mint_receipt_for_testing(
            &mut policy,
            &allowlist,
            b"harbor.rebalance",
            decision_type(),
            b"mainnet-execution",
            digest_bytes(),
            b"walrus:testnet:stub",
            digest_bytes(),
            digest_bytes(),
            default_rail(),
            &clk,
            test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::execution_receipts::E_INVALID_DIGEST)]
fun mint_receipt_rejects_short_state_before_digest() {
    let mut scenario = test_scenario::begin(OWNER);
    seed_policy(&mut scenario);

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        let mut short = vector::empty<u8>();
        vector::push_back(&mut short, 1u8);
        execution_receipts::mint_receipt_for_testing(
            &mut policy,
            &allowlist,
            b"harbor.rebalance",
            decision_type(),
            limitations(),
            short,
            b"walrus:testnet:stub",
            digest_bytes(),
            digest_bytes(),
            default_rail(),
            &clk,
            test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::execution_receipts::E_POLICY_VERSION_STALE)]
fun mint_receipt_rejects_stale_policy_version() {
    let mut scenario = test_scenario::begin(OWNER);
    seed_policy(&mut scenario);

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        policy_registry::force_downgrade_for_testing(&mut policy, 0);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        execution_receipts::mint_receipt_for_testing(
            &mut policy,
            &allowlist,
            b"harbor.rebalance",
            decision_type(),
            limitations(),
            digest_bytes(),
            b"walrus:testnet:stub",
            digest_bytes(),
            digest_bytes(),
            default_rail(),
            &clk,
            test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

// ---------------------------------------------------------------------------
// SEC-19: Long digest tests (33 bytes = 1 over DIGEST_LEN = 32)
// Each test oversizes exactly one digest field. Expect E_INVALID_DIGEST (3).
// ---------------------------------------------------------------------------

#[test_only]
fun long_digest(): vector<u8> {
    // 33 bytes — one byte over DIGEST_LEN.
    let mut v = vector::empty<u8>();
    let mut i = 0u64;
    while (i < 33) {
        vector::push_back(&mut v, (((i * 73 + 41) % 251) as u8));
        i = i + 1;
    };
    v
}

#[test]
#[expected_failure(abort_code = tide::execution_receipts::E_INVALID_DIGEST)]
fun mint_receipt_rejects_long_content_digest() {
    // content_digest is 33 bytes; must abort with E_INVALID_DIGEST.
    let mut scenario = test_scenario::begin(OWNER);
    seed_policy(&mut scenario);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        execution_receipts::mint_receipt_for_testing(
            &mut policy,
            &allowlist,
            b"harbor.rebalance",
            decision_type(),
            limitations(),
            digest_bytes(),
            b"walrus:testnet:stub",
            digest_bytes(),
            long_digest(),
            default_rail(),
            &clk,
            test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::execution_receipts::E_INVALID_DIGEST)]
fun mint_receipt_rejects_long_rail_pack_digest() {
    // rail_pack_digest is 33 bytes; must abort with E_INVALID_DIGEST.
    let mut scenario = test_scenario::begin(OWNER);
    seed_policy(&mut scenario);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        execution_receipts::mint_receipt_for_testing(
            &mut policy,
            &allowlist,
            b"harbor.rebalance",
            decision_type(),
            limitations(),
            digest_bytes(),
            b"walrus:testnet:stub",
            long_digest(),
            digest_bytes(),
            default_rail(),
            &clk,
            test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::execution_receipts::E_INVALID_DIGEST)]
fun mint_receipt_rejects_long_state_before_digest() {
    // state_before_digest is 33 bytes; must abort with E_INVALID_DIGEST.
    let mut scenario = test_scenario::begin(OWNER);
    seed_policy(&mut scenario);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        execution_receipts::mint_receipt_for_testing(
            &mut policy,
            &allowlist,
            b"harbor.rebalance",
            decision_type(),
            limitations(),
            long_digest(),
            b"walrus:testnet:stub",
            digest_bytes(),
            digest_bytes(),
            default_rail(),
            &clk,
            test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

// ---------------------------------------------------------------------------
// SEC-24: mint_receipt rejects a future policy version
// Use force_downgrade_for_testing with version 999 (greater than
// current_version()); attempt mint must abort with E_POLICY_VERSION_STALE (2).
// ---------------------------------------------------------------------------

#[test]
#[expected_failure(abort_code = tide::execution_receipts::E_POLICY_VERSION_STALE)]
fun mint_receipt_rejects_future_policy_version() {
    // Version 999 > current_version(); the receipt module sees the policy
    // as out-of-step with the current schema and refuses to anchor.
    let mut scenario = test_scenario::begin(OWNER);
    seed_policy(&mut scenario);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        policy_registry::force_downgrade_for_testing(&mut policy, 999);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        execution_receipts::mint_receipt_for_testing(
            &mut policy,
            &allowlist,
            b"harbor.rebalance",
            decision_type(),
            limitations(),
            digest_bytes(),
            b"walrus:testnet:stub",
            digest_bytes(),
            digest_bytes(),
            default_rail(),
            &clk,
            test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::execution_receipts::E_RAIL_NOT_ALLOWED)]
fun mint_receipt_rejects_revoked_rail() {
    // The Day-7 revoke-after-select guard. Admin revokes the policy's
    // selected rail between `select_rail` (already done in seed_policy)
    // and `mint_receipt`; minting must abort instead of anchoring a
    // receipt against a now-disallowed rail.
    let mut scenario = test_scenario::begin(OWNER);
    seed_policy(&mut scenario);

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let cap = policy_registry::new_admin_cap_for_testing(
            test_scenario::ctx(&mut scenario)
        );
        policy_registry::revoke_rail(&cap, &mut allowlist, default_rail());
        policy_registry::destroy_admin_cap_for_testing(cap);
        test_scenario::return_shared(allowlist);
    };

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        execution_receipts::mint_receipt_for_testing(
            &mut policy,
            &allowlist,
            b"harbor.rebalance",
            decision_type(),
            limitations(),
            digest_bytes(),
            b"walrus:testnet:stub",
            digest_bytes(),
            digest_bytes(),
            default_rail(),
            &clk,
            test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

// ---------------------------------------------------------------------------
// B12: non-empty guards on action / expected_rail / walrus_blob_id
//
// An empty anchor field produces an ambiguous receipt that the off-chain
// verifier cannot distinguish from "field omitted" vs "tampered receipt".
// Each test passes b"" for the field under test and expects E_INVALID_INPUT.
// decision_type and limitations are already gated by their closed-enum
// validators (assert_valid_decision_type / assert_valid_limitations), so
// they don't need a separate empty-string guard here.
// ---------------------------------------------------------------------------

#[test]
#[expected_failure(abort_code = tide::execution_receipts::E_INVALID_INPUT)]
fun mint_receipt_rejects_empty_walrus_blob_id() {
    // walrus_blob_id = b"" must abort with E_INVALID_INPUT (4).
    // An empty blob id is indistinguishable from "no Walrus anchor configured"
    // and cannot be resolved off-chain.
    let mut scenario = test_scenario::begin(OWNER);
    seed_policy(&mut scenario);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        execution_receipts::mint_receipt_for_testing(
            &mut policy,
            &allowlist,
            b"harbor.rebalance",
            decision_type(),
            limitations(),
            digest_bytes(),
            b"",            // empty walrus_blob_id — must be rejected
            digest_bytes(),
            digest_bytes(),
            default_rail(),
            &clk,
            test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::execution_receipts::E_INVALID_INPUT)]
fun mint_receipt_rejects_empty_action() {
    // action = b"" must abort with E_INVALID_INPUT (4).
    // An empty action label makes the receipt uninterpretable by indexers.
    let mut scenario = test_scenario::begin(OWNER);
    seed_policy(&mut scenario);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        execution_receipts::mint_receipt_for_testing(
            &mut policy,
            &allowlist,
            b"",            // empty action — must be rejected
            decision_type(),
            limitations(),
            digest_bytes(),
            b"walrus:testnet:stub-blob-id",
            digest_bytes(),
            digest_bytes(),
            default_rail(),
            &clk,
            test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::execution_receipts::E_INVALID_INPUT)]
fun mint_receipt_rejects_empty_expected_rail() {
    // expected_rail = b"" must abort with E_INVALID_INPUT (4).
    // An empty expected_rail would bypass the rail-match check and let a
    // receipt anchor without pinning the rail the bundle was computed against.
    let mut scenario = test_scenario::begin(OWNER);
    seed_policy(&mut scenario);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        execution_receipts::mint_receipt_for_testing(
            &mut policy,
            &allowlist,
            b"harbor.rebalance",
            decision_type(),
            limitations(),
            digest_bytes(),
            b"walrus:testnet:stub-blob-id",
            digest_bytes(),
            digest_bytes(),
            b"",            // empty expected_rail — must be rejected
            &clk,
            test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}
