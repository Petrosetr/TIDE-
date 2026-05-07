# Mainnet-Attested Demo Disclosure

This document defines the optional submit-window extension where a founder-owned
mainnet protocol action is observed by TIDE and attested by a Sui testnet
receipt.

## Boundary

TIDE does not sign mainnet transactions in this flow.

Allowed:

- read public mainnet protocol objects and transactions;
- compare pre-state and post-state after the founder manually acts through the
  protocol's own UI;
- run the TIDE planner against the observed state;
- mint a TIDE action receipt on Sui testnet;
- pin the evidence bundle to Walrus and link it from the proof pack.

Forbidden:

- disabling production safety guards;
- building or submitting a mainnet PTB from TIDE;
- presenting founder manual execution as TIDE live execution;
- calling rail profiles partnerships or integrations without external backing.

## Receipt Claim

A mainnet-attested receipt proves this narrower statement:

> TIDE read a public mainnet protocol state or event, computed a policy decision,
> and anchored a testnet receipt that commits to the evidence bundle.

It does not prove that TIDE executed the mainnet transaction.

## Evidence Shape

Each published bundle should include:

- `kind = "tide-mainnet-attested-demo/v1"`;
- `network.mainnetReadback = "mainnet"` and `network.receiptMint = "testnet"`;
- `claimBoundary = "founder-manual-mainnet-execution / TIDE-readonly-observation / testnet-decision-attestation"`;
- top-level `ownerAddress`, `obligationId`, `rail`, and `railId`;
- top-level `action`, `decisionType`, `limitations`, and `selectedRail`,
  matching the testnet receipt fields;
- `mainnetEvidence.digest` as the canonical mainnet transaction digest;
- `mainnetEvidence.sender` and `mainnetEvidence.obligationId`, both matching
  the top-level owner/obligation fields;
- a pre-state digest when deep readback is available;
- a post-state digest when deep readback is available;
- `mainnetEvidence.eventBased = true` only when the rail uses event-only
  evidence rather than parsed obligation state;
- a clear founder-review note before public submission.

If a rail schema cannot be parsed reliably, use event-based evidence only and
say so. Do not infer debt, collateral, LTV, or health factor from incomplete
objects.

## Founder Review Gate

Before a mainnet-attested receipt enters the submission:

1. The founder checks every public number against the protocol UI.
2. The founder checks that wallet/object redaction is intentional.
3. The founder checks both SuiVision links: mainnet protocol tx and testnet
   TIDE receipt.
4. The proof pack says whether the rail is deep-readback or event-only.

If any point fails, that receipt stays out of the public proof pack.
