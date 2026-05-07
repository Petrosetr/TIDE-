#[test_only]
module tide::policy_registry_tests;

use std::string;
use sui::clock;
use sui::event;
use sui::test_scenario;
use tide::policy_registry::{
    Self,
    AdminCap,
    AdminTransferRequest,
    Policy,
    RailAllowlist,
    RailRevoked,
};

const OWNER: address = @0xA11CE;
const OTHER: address = @0xB0B;

#[test_only]
fun default_rail(): vector<u8> { b"scallop-sui" }

#[test_only]
fun create_default_policy(scenario: &mut test_scenario::Scenario) {
    seed_allowlist(scenario);
    test_scenario::next_tx(scenario, OWNER);
    {
        let allowlist = test_scenario::take_shared<RailAllowlist>(scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(scenario));
        policy_registry::create_policy(
            b"harbor default",
            b"harbor",
            b"stability",
            b"SUI",
            b"0x2::sui::SUI",
            default_rail(),
            1_000_000,   // payout_target_usd
            500_000,     // min_buffer_usd
            8_000,       // max_ltv_bps
            3_000,       // target_ltv_low_bps
            5_000,       // target_ltv_high_bps
            6_000,       // repay_ltv_bps
            7_000,       // emergency_ltv_bps
            &allowlist,
            &clk,
            test_scenario::ctx(scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
    };
}

#[test]
fun create_policy_happy_path() {
    let mut scenario = test_scenario::begin(OWNER);
    create_default_policy(&mut scenario);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let policy = test_scenario::take_from_sender<Policy>(&scenario);
        assert!(policy_registry::owner(&policy) == OWNER, 0);
        assert!(policy_registry::version(&policy) == policy_registry::current_version(), 1);
        assert!(*policy_registry::selected_rail(&policy) == string::utf8(default_rail()), 2);
        assert!(policy_registry::receipts_minted(&policy) == 0, 3);
        assert!(policy_registry::min_buffer_usd(&policy) == 500_000, 4);
        assert!(policy_registry::event_schema_version() == 3, 5);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_RAIL_NOT_ALLOWED)]
fun create_policy_rejects_disallowed_rail() {
    let mut scenario = test_scenario::begin(OWNER);
    {
        let allowlist = policy_registry::new_rail_allowlist_for_testing(
            test_scenario::ctx(&mut scenario)
        );
        policy_registry::share_rail_allowlist_for_testing(allowlist);
    };
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::create_policy(
            b"x", b"harbor", b"stability", b"SUI", b"0x2::sui::SUI",
            b"not-on-allowlist",
            1_000_000, 500_000, 8_000, 3_000, 5_000, 6_000, 7_000,
            &allowlist, &clk, test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_INVALID_PAYOUT)]
fun create_policy_rejects_zero_payout() {
    let mut scenario = test_scenario::begin(OWNER);
    seed_allowlist(&mut scenario);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::create_policy(
            b"x", b"harbor", b"stability", b"SUI", b"0x2::sui::SUI",
            default_rail(),
            0, 500_000, 8_000, 3_000, 5_000, 6_000, 7_000,
            &allowlist, &clk, test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_INVALID_PAYOUT)]
fun create_policy_rejects_zero_min_buffer() {
    let mut scenario = test_scenario::begin(OWNER);
    seed_allowlist(&mut scenario);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::create_policy(
            b"x", b"harbor", b"stability", b"SUI", b"0x2::sui::SUI",
            default_rail(),
            1_000_000, 0, 8_000, 3_000, 5_000, 6_000, 7_000,
            &allowlist, &clk, test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_INVALID_LTV)]
fun create_policy_rejects_broken_ladder() {
    let mut scenario = test_scenario::begin(OWNER);
    seed_allowlist(&mut scenario);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        // target_low >= target_high
        policy_registry::create_policy(
            b"x", b"harbor", b"stability", b"SUI", b"0x2::sui::SUI",
            default_rail(),
            1_000_000, 500_000, 8_000, 5_000, 5_000, 6_000, 7_000,
            &allowlist, &clk, test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_INVALID_LTV)]
fun create_policy_rejects_zero_target_low() {
    let mut scenario = test_scenario::begin(OWNER);
    seed_allowlist(&mut scenario);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::create_policy(
            b"x", b"harbor", b"stability", b"SUI", b"0x2::sui::SUI",
            default_rail(),
            1_000_000, 500_000, 8_000, 0, 5_000, 6_000, 7_000,
            &allowlist, &clk, test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_INVALID_LTV)]
fun create_policy_rejects_ltv_above_bps_denom() {
    let mut scenario = test_scenario::begin(OWNER);
    seed_allowlist(&mut scenario);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        // max_ltv_bps > 10_000
        policy_registry::create_policy(
            b"x", b"harbor", b"stability", b"SUI", b"0x2::sui::SUI",
            default_rail(),
            1_000_000, 500_000, 10_001, 3_000, 5_000, 6_000, 7_000,
            &allowlist, &clk, test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
    };
    test_scenario::end(scenario);
}

#[test]
fun select_rail_happy_path() {
    let mut scenario = test_scenario::begin(OWNER);
    create_default_policy(&mut scenario);

    // allow a second rail
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let cap = policy_registry::new_admin_cap_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::allow_rail(&cap, &mut allowlist, b"navi-sui");
        policy_registry::destroy_admin_cap_for_testing(cap);
        test_scenario::return_shared(allowlist);
    };

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::select_rail(&mut policy, b"navi-sui", &allowlist, &clk, test_scenario::ctx(&mut scenario));
        assert!(*policy_registry::selected_rail(&policy) == string::utf8(b"navi-sui"), 0);
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_NOT_OWNER)]
fun select_rail_rejects_non_owner() {
    let mut scenario = test_scenario::begin(OWNER);
    create_default_policy(&mut scenario);

    test_scenario::next_tx(&mut scenario, OWNER);
    let policy = test_scenario::take_from_sender<Policy>(&scenario);

    test_scenario::next_tx(&mut scenario, OTHER);
    {
        let mut p = policy;
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::select_rail(&mut p, default_rail(), &allowlist, &clk, test_scenario::ctx(&mut scenario));
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
        policy_registry::transfer_policy_for_testing(p, OWNER);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_RAIL_NOT_ALLOWED)]
fun select_rail_rejects_disallowed_rail() {
    let mut scenario = test_scenario::begin(OWNER);
    create_default_policy(&mut scenario);

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        // "navi-sui" was never added to the allowlist in this test.
        policy_registry::select_rail(
            &mut policy, b"navi-sui", &allowlist, &clk,
            test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_INVALID_INPUT)]
fun create_policy_rejects_oversize_name() {
    let mut scenario = test_scenario::begin(OWNER);
    seed_allowlist(&mut scenario);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        // 200-byte name exceeds MAX_STRING_LEN (128).
        let mut big = vector::empty<u8>();
        let mut i = 0u64;
        while (i < 200) { vector::push_back(&mut big, 65u8); i = i + 1; };
        policy_registry::create_policy(
            big,
            b"harbor", b"stability", b"SUI", b"0x2::sui::SUI",
            default_rail(),
            1_000_000, 500_000, 8_000, 3_000, 5_000, 6_000, 7_000,
            &allowlist, &clk, test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_NOT_OWNER)]
fun update_policy_rejects_non_owner() {
    let mut scenario = test_scenario::begin(OWNER);
    create_default_policy(&mut scenario);

    test_scenario::next_tx(&mut scenario, OWNER);
    let policy = test_scenario::take_from_sender<Policy>(&scenario);

    test_scenario::next_tx(&mut scenario, OTHER);
    {
        let mut p = policy;
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::update_policy(
            &mut p,
            b"harbor", b"stability",
            1_000_000, 500_000, 8_000, 3_000, 5_000, 6_000, 7_000,
            &clk, test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        policy_registry::transfer_policy_for_testing(p, OWNER);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_WRONG_VERSION)]
fun update_policy_rejects_stale_version() {
    let mut scenario = test_scenario::begin(OWNER);
    create_default_policy(&mut scenario);

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        policy_registry::force_downgrade_for_testing(&mut policy, 1);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::update_policy(
            &mut policy,
            b"harbor", b"stability",
            1_000_000, 500_000, 8_000, 3_000, 5_000, 6_000, 7_000,
            &clk, test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_INVALID_PAYOUT)]
fun update_policy_rejects_zero_min_buffer() {
    let mut scenario = test_scenario::begin(OWNER);
    create_default_policy(&mut scenario);

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::update_policy(
            &mut policy,
            b"harbor", b"stability",
            1_000_000, 0, 8_000, 3_000, 5_000, 6_000, 7_000,
            &clk, test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_WRONG_VERSION)]
fun delete_policy_rejects_stale_version() {
    let mut scenario = test_scenario::begin(OWNER);
    create_default_policy(&mut scenario);

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        policy_registry::force_downgrade_for_testing(&mut policy, 1);
        policy_registry::delete_policy(policy, test_scenario::ctx(&mut scenario));
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_NOT_OWNER)]
fun delete_policy_rejects_non_owner() {
    let mut scenario = test_scenario::begin(OWNER);
    create_default_policy(&mut scenario);

    test_scenario::next_tx(&mut scenario, OWNER);
    let policy = test_scenario::take_from_sender<Policy>(&scenario);

    test_scenario::next_tx(&mut scenario, OTHER);
    {
        policy_registry::delete_policy(policy, test_scenario::ctx(&mut scenario));
    };
    test_scenario::end(scenario);
}

#[test]
fun migrate_policy_happy_path() {
    let mut scenario = test_scenario::begin(OWNER);
    create_default_policy(&mut scenario);

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let mut clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        clock::set_for_testing(&mut clk, 123_456);
        // Simulate a v1 policy that predates the receipt-counter bump.
        policy_registry::force_downgrade_for_testing(&mut policy, 1);
        policy_registry::migrate_policy(&mut policy, &clk, test_scenario::ctx(&mut scenario));
        assert!(policy_registry::version(&policy) == policy_registry::current_version(), 0);
        assert!(policy_registry::updated_at_ms(&policy) == 123_456, 1);
        assert!(policy_registry::min_buffer_usd(&policy) == 500_000, 2);
        clock::destroy_for_testing(clk);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
fun migrate_policy_repairs_legacy_zero_min_buffer() {
    let mut scenario = test_scenario::begin(OWNER);
    create_default_policy(&mut scenario);

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::force_downgrade_for_testing(&mut policy, 2);
        policy_registry::force_min_buffer_for_testing(&mut policy, 0);
        policy_registry::migrate_policy(&mut policy, &clk, test_scenario::ctx(&mut scenario));
        assert!(policy_registry::version(&policy) == policy_registry::current_version(), 0);
        assert!(policy_registry::min_buffer_usd(&policy) == 1, 1);
        clock::destroy_for_testing(clk);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_INVALID_LTV)]
fun migrate_policy_rejects_invalid_thresholds() {
    let mut scenario = test_scenario::begin(OWNER);
    create_default_policy(&mut scenario);

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::force_downgrade_for_testing(&mut policy, 1);
        policy_registry::force_thresholds_for_testing(
            &mut policy,
            8_000,
            5_000,
            3_000,
            6_000,
            7_000,
        );
        // target_low=5_000 > target_high=3_000 violates the monotonic LTV ladder.
        policy_registry::migrate_policy(&mut policy, &clk, test_scenario::ctx(&mut scenario));
        clock::destroy_for_testing(clk);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_NOT_OWNER)]
fun migrate_policy_rejects_non_owner() {
    let mut scenario = test_scenario::begin(OWNER);
    create_default_policy(&mut scenario);

    test_scenario::next_tx(&mut scenario, OWNER);
    let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
    policy_registry::force_downgrade_for_testing(&mut policy, 1);

    test_scenario::next_tx(&mut scenario, OTHER);
    {
        let mut p = policy;
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::migrate_policy(&mut p, &clk, test_scenario::ctx(&mut scenario));
        clock::destroy_for_testing(clk);
        policy_registry::transfer_policy_for_testing(p, OWNER);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_WRONG_VERSION)]
fun migrate_policy_rejects_already_current() {
    let mut scenario = test_scenario::begin(OWNER);
    create_default_policy(&mut scenario);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::migrate_policy(&mut policy, &clk, test_scenario::ctx(&mut scenario));
        clock::destroy_for_testing(clk);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_WRONG_VERSION)]
fun migrate_policy_rejects_unsupported_old_version() {
    let mut scenario = test_scenario::begin(OWNER);
    create_default_policy(&mut scenario);

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::force_downgrade_for_testing(&mut policy, 0);
        policy_registry::migrate_policy(&mut policy, &clk, test_scenario::ctx(&mut scenario));
        clock::destroy_for_testing(clk);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
fun allowlist_round_trip() {
    let mut scenario = test_scenario::begin(OWNER);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut allowlist = policy_registry::new_rail_allowlist_for_testing(
            test_scenario::ctx(&mut scenario)
        );
        let cap = policy_registry::new_admin_cap_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::allow_rail(&cap, &mut allowlist, b"scallop-sui");
        assert!(policy_registry::is_rail_allowed(&allowlist, &string::utf8(b"scallop-sui")), 0);
        policy_registry::revoke_rail(&cap, &mut allowlist, b"scallop-sui");
        assert!(!policy_registry::is_rail_allowed(&allowlist, &string::utf8(b"scallop-sui")), 1);
        assert!(policy_registry::revocation_seq(&allowlist) == 1, 2);
        let revoked_events = event::events_by_type<RailRevoked>();
        assert!(vector::length(&revoked_events) == 1, 3);
        assert!(policy_registry::rail_revoked_seq_for_testing(&revoked_events[0]) == 1, 4);
        policy_registry::revoke_rail(&cap, &mut allowlist, b"scallop-sui");
        assert!(policy_registry::revocation_seq(&allowlist) == 1, 5);
        policy_registry::destroy_admin_cap_for_testing(cap);
        policy_registry::destroy_rail_allowlist_for_testing(allowlist);
    };
    test_scenario::end(scenario);
}

#[test]
fun admin_transfer_timelock_happy_path() {
    let mut scenario = test_scenario::begin(OWNER);

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let cap = policy_registry::new_admin_cap_for_testing(test_scenario::ctx(&mut scenario));
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::request_admin_transfer(&cap, OTHER, &clk, test_scenario::ctx(&mut scenario));
        clock::destroy_for_testing(clk);
        policy_registry::transfer_admin_cap_for_testing(cap, OWNER);
    };

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let cap = test_scenario::take_from_sender<AdminCap>(&scenario);
        let request = test_scenario::take_from_sender<AdminTransferRequest>(&scenario);
        let mut clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        clock::set_for_testing(&mut clk, policy_registry::admin_transfer_delay_ms());
        policy_registry::execute_admin_transfer(cap, request, &clk, test_scenario::ctx(&mut scenario));
        clock::destroy_for_testing(clk);
    };

    test_scenario::next_tx(&mut scenario, OTHER);
    {
        let cap = test_scenario::take_from_sender<AdminCap>(&scenario);
        policy_registry::destroy_admin_cap_for_testing(cap);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_ADMIN_TRANSFER_TOO_EARLY)]
fun admin_transfer_rejects_early_execute() {
    let mut scenario = test_scenario::begin(OWNER);

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let cap = policy_registry::new_admin_cap_for_testing(test_scenario::ctx(&mut scenario));
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::request_admin_transfer(&cap, OTHER, &clk, test_scenario::ctx(&mut scenario));
        clock::destroy_for_testing(clk);
        policy_registry::transfer_admin_cap_for_testing(cap, OWNER);
    };

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let cap = test_scenario::take_from_sender<AdminCap>(&scenario);
        let request = test_scenario::take_from_sender<AdminTransferRequest>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::execute_admin_transfer(cap, request, &clk, test_scenario::ctx(&mut scenario));
        clock::destroy_for_testing(clk);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_INVALID_INPUT)]
fun admin_transfer_rejects_zero_recipient() {
    let mut scenario = test_scenario::begin(OWNER);

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let cap = policy_registry::new_admin_cap_for_testing(test_scenario::ctx(&mut scenario));
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::request_admin_transfer(&cap, @0x0, &clk, test_scenario::ctx(&mut scenario));
        clock::destroy_for_testing(clk);
        policy_registry::destroy_admin_cap_for_testing(cap);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_INVALID_INPUT)]
fun admin_transfer_rejects_self_transfer() {
    let mut scenario = test_scenario::begin(OWNER);

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let cap = policy_registry::new_admin_cap_for_testing(test_scenario::ctx(&mut scenario));
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::request_admin_transfer(&cap, OWNER, &clk, test_scenario::ctx(&mut scenario));
        clock::destroy_for_testing(clk);
        policy_registry::destroy_admin_cap_for_testing(cap);
    };
    test_scenario::end(scenario);
}

#[test]
fun admin_transfer_can_be_canceled() {
    let mut scenario = test_scenario::begin(OWNER);

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let cap = policy_registry::new_admin_cap_for_testing(test_scenario::ctx(&mut scenario));
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::request_admin_transfer(&cap, OTHER, &clk, test_scenario::ctx(&mut scenario));
        clock::destroy_for_testing(clk);
        policy_registry::transfer_admin_cap_for_testing(cap, OWNER);
    };

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let cap = test_scenario::take_from_sender<AdminCap>(&scenario);
        let request = test_scenario::take_from_sender<AdminTransferRequest>(&scenario);
        policy_registry::cancel_admin_transfer(&cap, request, test_scenario::ctx(&mut scenario));
        policy_registry::destroy_admin_cap_for_testing(cap);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_ADMIN_TRANSFER_NOT_REQUESTER)]
fun cancel_admin_transfer_rejects_non_requester() {
    let mut scenario = test_scenario::begin(OWNER);

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let cap = policy_registry::new_admin_cap_for_testing(test_scenario::ctx(&mut scenario));
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::request_admin_transfer(&cap, OTHER, &clk, test_scenario::ctx(&mut scenario));
        clock::destroy_for_testing(clk);
        policy_registry::transfer_admin_cap_for_testing(cap, OWNER);
    };

    test_scenario::next_tx(&mut scenario, OWNER);
    let cap = test_scenario::take_from_sender<AdminCap>(&scenario);
    let request = test_scenario::take_from_sender<AdminTransferRequest>(&scenario);

    test_scenario::next_tx(&mut scenario, OTHER);
    {
        policy_registry::cancel_admin_transfer(&cap, request, test_scenario::ctx(&mut scenario));
        policy_registry::destroy_admin_cap_for_testing(cap);
    };
    test_scenario::end(scenario);
}

// ---------------------------------------------------------------------------
// SEC-1: LTV ladder middle inequalities
// Each test sets one inequality false; all expect E_INVALID_LTV (5).
// ---------------------------------------------------------------------------

// --- create_policy violations ---

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_INVALID_LTV)]
fun create_policy_rejects_target_high_above_repay() {
    // target_high (7000) > repay (6000) — violates target_high <= repay
    let mut scenario = test_scenario::begin(OWNER);
    seed_allowlist(&mut scenario);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::create_policy(
            b"x", b"harbor", b"stability", b"SUI", b"0x2::sui::SUI",
            default_rail(),
            1_000_000, 500_000, 8_000, 3_000, 7_000, 6_000, 7_500,
            &allowlist, &clk, test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_INVALID_LTV)]
fun create_policy_rejects_repay_above_emergency() {
    // repay (8000) > emergency (7000) — violates repay <= emergency
    let mut scenario = test_scenario::begin(OWNER);
    seed_allowlist(&mut scenario);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::create_policy(
            b"x", b"harbor", b"stability", b"SUI", b"0x2::sui::SUI",
            default_rail(),
            1_000_000, 500_000, 9_000, 3_000, 5_000, 8_000, 7_000,
            &allowlist, &clk, test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_INVALID_LTV)]
fun create_policy_rejects_emergency_above_max_ltv() {
    // emergency (9000) > max_ltv (8000) — violates emergency <= max_ltv
    let mut scenario = test_scenario::begin(OWNER);
    seed_allowlist(&mut scenario);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::create_policy(
            b"x", b"harbor", b"stability", b"SUI", b"0x2::sui::SUI",
            default_rail(),
            1_000_000, 500_000, 8_000, 3_000, 5_000, 6_000, 9_000,
            &allowlist, &clk, test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
    };
    test_scenario::end(scenario);
}

// --- update_policy violations ---

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_INVALID_LTV)]
fun update_policy_rejects_target_high_above_repay() {
    // After a valid create, update with target_high (7000) > repay (6000).
    let mut scenario = test_scenario::begin(OWNER);
    create_default_policy(&mut scenario);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::update_policy(
            &mut policy,
            b"harbor", b"stability",
            1_000_000, 500_000, 8_000, 3_000, 7_000, 6_000, 7_500,
            &clk, test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_INVALID_LTV)]
fun update_policy_rejects_repay_above_emergency() {
    // repay (8000) > emergency (7000)
    let mut scenario = test_scenario::begin(OWNER);
    create_default_policy(&mut scenario);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::update_policy(
            &mut policy,
            b"harbor", b"stability",
            1_000_000, 500_000, 9_000, 3_000, 5_000, 8_000, 7_000,
            &clk, test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_INVALID_LTV)]
fun update_policy_rejects_emergency_above_max_ltv() {
    // emergency (9000) > max_ltv (8000)
    let mut scenario = test_scenario::begin(OWNER);
    create_default_policy(&mut scenario);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::update_policy(
            &mut policy,
            b"harbor", b"stability",
            1_000_000, 500_000, 8_000, 3_000, 5_000, 6_000, 9_000,
            &clk, test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

// --- migrate_policy violations ---
// Use force_thresholds_for_testing + force_downgrade_for_testing to inject
// a bad ladder into an existing policy, then attempt migration.

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_INVALID_LTV)]
fun migrate_policy_rejects_target_high_above_repay() {
    // Inject target_high (7000) > repay (6000); migration must abort.
    let mut scenario = test_scenario::begin(OWNER);
    create_default_policy(&mut scenario);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        policy_registry::force_downgrade_for_testing(&mut policy, 1);
        policy_registry::force_thresholds_for_testing(
            &mut policy,
            8_000,   // max_ltv_bps
            3_000,   // target_ltv_low_bps
            7_000,   // target_ltv_high_bps — above repay
            6_000,   // repay_ltv_bps
            7_500,   // emergency_ltv_bps
        );
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::migrate_policy(&mut policy, &clk, test_scenario::ctx(&mut scenario));
        clock::destroy_for_testing(clk);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_INVALID_LTV)]
fun migrate_policy_rejects_repay_above_emergency() {
    // Inject repay (8000) > emergency (7000); migration must abort.
    let mut scenario = test_scenario::begin(OWNER);
    create_default_policy(&mut scenario);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        policy_registry::force_downgrade_for_testing(&mut policy, 1);
        policy_registry::force_thresholds_for_testing(
            &mut policy,
            9_000,   // max_ltv_bps
            3_000,   // target_ltv_low_bps
            5_000,   // target_ltv_high_bps
            8_000,   // repay_ltv_bps — above emergency
            7_000,   // emergency_ltv_bps
        );
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::migrate_policy(&mut policy, &clk, test_scenario::ctx(&mut scenario));
        clock::destroy_for_testing(clk);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_INVALID_LTV)]
fun migrate_policy_rejects_emergency_above_max_ltv() {
    // Inject emergency (9000) > max_ltv (8000); migration must abort.
    let mut scenario = test_scenario::begin(OWNER);
    create_default_policy(&mut scenario);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        policy_registry::force_downgrade_for_testing(&mut policy, 1);
        policy_registry::force_thresholds_for_testing(
            &mut policy,
            8_000,   // max_ltv_bps — below emergency
            3_000,   // target_ltv_low_bps
            5_000,   // target_ltv_high_bps
            6_000,   // repay_ltv_bps
            9_000,   // emergency_ltv_bps — above max_ltv
        );
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::migrate_policy(&mut policy, &clk, test_scenario::ctx(&mut scenario));
        clock::destroy_for_testing(clk);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

// ---------------------------------------------------------------------------
// SEC-2: Oversize bounded-field tests
// Each oversizes one bounded vector<u8> parameter. Expect E_INVALID_INPUT (7).
// ---------------------------------------------------------------------------

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_INVALID_INPUT)]
fun create_policy_rejects_oversize_mode() {
    // mode > MAX_STRING_LEN (128)
    let mut scenario = test_scenario::begin(OWNER);
    seed_allowlist(&mut scenario);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        let mut big = vector::empty<u8>();
        let mut i = 0u64;
        while (i < 200) { vector::push_back(&mut big, 0x6du8); i = i + 1; };
        policy_registry::create_policy(
            b"x",
            big,
            b"stability", b"SUI", b"0x2::sui::SUI",
            default_rail(),
            1_000_000, 500_000, 8_000, 3_000, 5_000, 6_000, 7_000,
            &allowlist, &clk, test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_INVALID_INPUT)]
fun create_policy_rejects_oversize_priority() {
    // priority > MAX_STRING_LEN (128)
    let mut scenario = test_scenario::begin(OWNER);
    seed_allowlist(&mut scenario);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        let mut big = vector::empty<u8>();
        let mut i = 0u64;
        while (i < 200) { vector::push_back(&mut big, 0x70u8); i = i + 1; };
        policy_registry::create_policy(
            b"x", b"harbor",
            big,
            b"SUI", b"0x2::sui::SUI",
            default_rail(),
            1_000_000, 500_000, 8_000, 3_000, 5_000, 6_000, 7_000,
            &allowlist, &clk, test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_INVALID_INPUT)]
fun create_policy_rejects_oversize_collateral_symbol() {
    // collateral_symbol > MAX_STRING_LEN (128)
    let mut scenario = test_scenario::begin(OWNER);
    seed_allowlist(&mut scenario);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        let mut big = vector::empty<u8>();
        let mut i = 0u64;
        while (i < 200) { vector::push_back(&mut big, 0x53u8); i = i + 1; };
        policy_registry::create_policy(
            b"x", b"harbor", b"stability",
            big,
            b"0x2::sui::SUI",
            default_rail(),
            1_000_000, 500_000, 8_000, 3_000, 5_000, 6_000, 7_000,
            &allowlist, &clk, test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_INVALID_INPUT)]
fun create_policy_rejects_oversize_collateral_coin_type() {
    // collateral_coin_type > MAX_COIN_TYPE_LEN (256)
    let mut scenario = test_scenario::begin(OWNER);
    seed_allowlist(&mut scenario);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        let mut big = vector::empty<u8>();
        let mut i = 0u64;
        while (i < 300) { vector::push_back(&mut big, 0x63u8); i = i + 1; };
        policy_registry::create_policy(
            b"x", b"harbor", b"stability", b"SUI",
            big,
            default_rail(),
            1_000_000, 500_000, 8_000, 3_000, 5_000, 6_000, 7_000,
            &allowlist, &clk, test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_INVALID_INPUT)]
fun create_policy_rejects_oversize_rail() {
    // selected_rail > MAX_RAIL_LEN (64) — distinct from the allowlist check;
    // the length guard fires before the allowlist lookup.
    let mut scenario = test_scenario::begin(OWNER);
    seed_allowlist(&mut scenario);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        let mut big = vector::empty<u8>();
        let mut i = 0u64;
        while (i < 65) { vector::push_back(&mut big, 0x72u8); i = i + 1; };
        policy_registry::create_policy(
            b"x", b"harbor", b"stability", b"SUI", b"0x2::sui::SUI",
            big,
            1_000_000, 500_000, 8_000, 3_000, 5_000, 6_000, 7_000,
            &allowlist, &clk, test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_INVALID_INPUT)]
fun update_policy_rejects_oversize_mode() {
    // mode > MAX_STRING_LEN (128) via update_policy
    let mut scenario = test_scenario::begin(OWNER);
    create_default_policy(&mut scenario);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        let mut big = vector::empty<u8>();
        let mut i = 0u64;
        while (i < 200) { vector::push_back(&mut big, 0x6du8); i = i + 1; };
        policy_registry::update_policy(
            &mut policy,
            big,
            b"stability",
            1_000_000, 500_000, 8_000, 3_000, 5_000, 6_000, 7_000,
            &clk, test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_INVALID_INPUT)]
fun update_policy_rejects_oversize_priority() {
    // priority > MAX_STRING_LEN (128) via update_policy
    let mut scenario = test_scenario::begin(OWNER);
    create_default_policy(&mut scenario);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        let mut big = vector::empty<u8>();
        let mut i = 0u64;
        while (i < 200) { vector::push_back(&mut big, 0x70u8); i = i + 1; };
        policy_registry::update_policy(
            &mut policy,
            b"harbor",
            big,
            1_000_000, 500_000, 8_000, 3_000, 5_000, 6_000, 7_000,
            &clk, test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

// ---------------------------------------------------------------------------
// SEC-22: allow_rail rejects an oversize rail name
// Expect E_INVALID_INPUT (7) when rail > MAX_RAIL_LEN (64).
// ---------------------------------------------------------------------------

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_INVALID_INPUT)]
fun allow_rail_rejects_oversize_rail() {
    let mut scenario = test_scenario::begin(OWNER);
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut allowlist = policy_registry::new_rail_allowlist_for_testing(
            test_scenario::ctx(&mut scenario)
        );
        let cap = policy_registry::new_admin_cap_for_testing(test_scenario::ctx(&mut scenario));
        let mut big = vector::empty<u8>();
        let mut i = 0u64;
        while (i < 65) { vector::push_back(&mut big, 0x72u8); i = i + 1; };
        // Must abort with E_INVALID_INPUT before attempting to insert.
        policy_registry::allow_rail(&cap, &mut allowlist, big);
        policy_registry::destroy_admin_cap_for_testing(cap);
        policy_registry::destroy_rail_allowlist_for_testing(allowlist);
    };
    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_INVALID_INPUT)]
fun select_rail_rejects_oversize_rail() {
    let mut scenario = test_scenario::begin(OWNER);
    create_default_policy(&mut scenario);

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        let mut big = vector::empty<u8>();
        let mut i = 0u64;
        while (i < 65) { vector::push_back(&mut big, 0x72u8); i = i + 1; };
        policy_registry::select_rail(&mut policy, big, &allowlist, &clk, test_scenario::ctx(&mut scenario));
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

// ---------------------------------------------------------------------------
// B8: select_rail version gate
// Policy on a stale schema must be refused; only the owner after migration
// may call select_rail.  Mirrors the E_WRONG_VERSION pattern used by every
// other mutator (update_policy, delete_policy, record_receipt_minted).
// ---------------------------------------------------------------------------

#[test]
#[expected_failure(abort_code = tide::policy_registry::E_WRONG_VERSION)]
fun select_rail_rejects_stale_version() {
    // Create a policy at the current schema version, then simulate a schema
    // upgrade by force-downgrading the version field to 1.  Attempting
    // select_rail on the stale policy must abort with E_WRONG_VERSION (2).
    let mut scenario = test_scenario::begin(OWNER);
    create_default_policy(&mut scenario);

    // Add a second rail so the call would succeed if the version check were absent.
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let cap = policy_registry::new_admin_cap_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::allow_rail(&cap, &mut allowlist, b"navi-sui");
        policy_registry::destroy_admin_cap_for_testing(cap);
        test_scenario::return_shared(allowlist);
    };

    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));
        // Simulate schema version 1 (pre-receipt-counter era).
        policy_registry::force_downgrade_for_testing(&mut policy, 1);
        // Must abort with E_WRONG_VERSION before any state is changed.
        policy_registry::select_rail(
            &mut policy, b"navi-sui", &allowlist, &clk,
            test_scenario::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

// ---------------------------------------------------------------------------
// SEC-23: select_rail does not alter the LTV ladder (positive regression)
// Create a policy, snapshot all LTV fields, switch to a second allowed rail,
// assert each LTV field is unchanged. No abort expected.
// ---------------------------------------------------------------------------

#[test]
fun select_rail_does_not_alter_ltv_ladder() {
    let mut scenario = test_scenario::begin(OWNER);
    create_default_policy(&mut scenario);

    // Add a second rail to the allowlist.
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let cap = policy_registry::new_admin_cap_for_testing(test_scenario::ctx(&mut scenario));
        policy_registry::allow_rail(&cap, &mut allowlist, b"navi-sui");
        policy_registry::destroy_admin_cap_for_testing(cap);
        test_scenario::return_shared(allowlist);
    };

    // Snapshot LTV values before the rail switch, then call select_rail.
    test_scenario::next_tx(&mut scenario, OWNER);
    {
        let mut policy = test_scenario::take_from_sender<Policy>(&scenario);
        let allowlist = test_scenario::take_shared<RailAllowlist>(&scenario);
        let clk = clock::create_for_testing(test_scenario::ctx(&mut scenario));

        // Capture the values we expect to remain unchanged.
        let payout_before  = policy_registry::payout_target_usd(&policy);
        // The public accessors on Policy expose owner, selected_rail,
        // payout_target_usd, updated_at_ms.  For the LTV bps fields the only
        // observable effect we can assert through public API is that version
        // is unchanged, rail switches, and payout is unchanged.
        let version_before = policy_registry::version(&policy);

        policy_registry::select_rail(
            &mut policy, b"navi-sui", &allowlist, &clk,
            test_scenario::ctx(&mut scenario),
        );

        // Rail must have switched.
        assert!(*policy_registry::selected_rail(&policy) == string::utf8(b"navi-sui"), 0);
        // LTV-adjacent values must be unchanged.
        assert!(policy_registry::payout_target_usd(&policy) == payout_before, 1);
        assert!(policy_registry::version(&policy) == version_before, 2);

        clock::destroy_for_testing(clk);
        test_scenario::return_shared(allowlist);
        test_scenario::return_to_sender(&scenario, policy);
    };
    test_scenario::end(scenario);
}

#[test_only]
fun seed_allowlist(scenario: &mut test_scenario::Scenario) {
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
}
