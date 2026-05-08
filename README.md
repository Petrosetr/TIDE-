# TIDE

[![Built on Sui](https://img.shields.io/badge/Built_on-Sui-4da3ff)](https://sui.io)
[![Walrus proofs](https://img.shields.io/badge/Proofs-Walrus-21c7b7)](https://www.walrus.xyz/)
[![Sui Overflow 2026](https://img.shields.io/badge/Hackathon-Sui_Overflow_2026-7c3aed)](docs/overflow_2026/submission.md)
[![Overflow track](https://img.shields.io/badge/Track-DeFi_%26_Payments-21c7b7)](docs/overflow_2026/submission.md)
[![Testnet package](https://img.shields.io/badge/Sui_testnet-package-6aa6ff)](https://testnet.suivision.xyz/object/0x999c34ce039388017838a5da6670195affa55c4dfbd466612494058963d502f0)

**Bitcoin treasury policy and proof layer for the Sui DeFi & Payments track.**

TIDE lets a BTC holder define a cashflow and risk policy, rehearse that
policy against BTC stress paths, anchor the policy on Sui, and mint an
Action Receipt that explains what the engine decided and which evidence was
reviewed.

> Keep BTC. Stay Liquid.

Current Sui Overflow scope: **testnet decision attestation and read-only rail
intelligence**. TIDE does not custody assets, does not claim vendor
partnerships, does not sign mainnet protocol actions, and does not present
unaudited automation as live.

A narrow mainnet-attested lane is disclosed separately: the founder manually
acts through a protocol UI, TIDE observes public mainnet state read-only, and
the decision is anchored as a Sui testnet receipt.

The goal is to make Sui BTCfi decisions more legible: not "highest APY," but
**what should this BTC treasury policy do, and can a reviewer verify why?**

## Judge TL;DR

- **Novelty:** TIDE is a policy + proof system for BTC-backed liquidity
  operations, not another pool dashboard or black-box yield bot.
- **Built now:** 5 Sui testnet policy/receipt runs, real Walrus testnet blob
  IDs, Move guardrails, cap-placement attestation, wallet rehearsal, and local
  verifier scripts.
- **Sui fit:** Sui objects make policy ownership and receipt objects explicit;
  Move guards enforce rail allowlists, policy versions, and digest boundaries;
  future PTBs can compose policy update + protocol action + receipt mint only
  after audit gates.
- **Walrus fit:** proof bundles are stored as durable, content-addressed bytes;
  the on-chain receipt pins the digest, so reviewers can compare Sui object
  fields against Walrus bundle bytes.
- **Standardization path:** RFC-0001 is a public draft receipt-as-attestation
  schema and reference implementation, positioned for ecosystem review as a
  possible future Sui Application SIP candidate. It is not an accepted Sui
  standard today.
- **Boundary:** current receipts prove decisions and evidence. They do not
  prove unaudited mainnet borrow/swap/repay execution by TIDE.

## Table of Contents

1. [The Problem](#the-problem)
2. [The Solution](#the-solution)
3. [Live Demo](#live-demo)
4. [Verify The Proof In 5 Minutes](#verify-the-proof-in-5-minutes)
5. [Key Features](#key-features)
6. [TIDE Risk / LTV Model](#tide-risk--ltv-model)
7. [Build Status](#build-status)
8. [Vendor / Rail Coverage](#vendor--rail-coverage)
9. [How It Works](#how-it-works)
10. [Architecture](#architecture)
11. [Sui, Walrus, and Pyth](#sui-walrus-and-pyth)
12. [Smart Contract Design](#smart-contract-design)
13. [Proof Pack](#proof-pack)
14. [Security Model](#security-model)
15. [User Flows](#user-flows)
16. [Dashboard and Analytics](#dashboard-and-analytics)
17. [Whitepaper Summary](#whitepaper-summary)
18. [Tokenomics](#tokenomics)
19. [Roadmap](#roadmap)
20. [Ecosystem Feedback Ask](#ecosystem-feedback-ask)
21. [Team](#team)
22. [Local Verification](#local-verification)

## The Problem

BTC treasury operations are still mostly manual. A holder who borrows
against BTC has to watch LTV, buffer runway, price shocks, venue health,
oracle freshness, and repayment timing across fragmented rail interfaces.

Most tools expose pools and APY. They do not give the operator a replayable
policy, a clear decision trail, or a receipt that later proves which data and
rules were used.

## The Solution

TIDE turns treasury intent into constrained operating behavior:

- define payout, buffer, LTV, and risk limits;
- rehearse BTC drawdowns before capital moves;
- classify the policy state as `Observe`, `Maintain`, `BuildBuffer`,
  `DeRisk`, or `StressLockdown`;
- anchor policy parameters as Sui testnet objects;
- mint Action Receipts with digest-bound proof bundles;
- keep the boundary visible: V1 proves decisions and evidence, not audited
  mainnet execution.

Those five operating states are UI/readout labels. Receipts use the
RFC-0001 decision vocabulary: `Hold`, `BuildBuffer`, `BorrowForBuffer`,
`PartialRepay`, `EmergencyDeRisk`, `ReducePayout`, `PausePayout`, and
`RotateVenue`.

## Live Demo

- Landing: https://tidesui.pro
- Mainnet read-only app: https://app.tidesui.pro
- Testnet proof surface: https://testnet.tidesui.pro/setup?judge=1
- Public repository: https://github.com/Petrosetr/TIDE-

Review path: open the testnet proof surface, create or load a
policy, inspect the stress chart and decision readout, then compare the
result against the proof pack links below.

## Verify The Proof In 5 Minutes

The fastest review path is:

```bash
npm install
npm run verify:overflow
node scripts/tide-verify.mjs 0x66c93faaea12c3d4098ac8f3035ee08aa0b214c0ba92485b6f3384e2941ef07d \
  --network testnet \
  --bundle-from-walrus \
  --json
```

Optional, if `.env.testnet.local` is configured with the package/cap IDs:

```bash
npm run verify:onchain:hardened
```

Evidence hierarchy:

```text
README
  -> docs/onchain_mvp_proof_pack.md
  -> docs/proof/latest-proof-loop.json
  -> SuiVision receipt object
  -> hosted /r/<receipt-id> public verifier page
  -> Walrus bundle bytes
  -> tide-verify digest check
  -> optional mainnet-attested Suilend evidence bundle
```

The public `run-XX.json` files are redacted summaries for review. Canonical
content verification uses the on-chain receipt fields plus the Walrus bundle
bytes or original evidence bundle bytes.

## Key Features

- **Shadow Mode simulator** for BTC-backed cashflow policies.
- **Harbor** as the conservative income-focused profile.
- **Breakwater** as the defensive risk-control layer.
- **Policy-native LTV engine** that tracks target bands, repay thresholds,
  emergency limits, buffer runway, and liquidation distance as first-class
  policy inputs.
- **Stress workbench** with current BTC path, historical replay, Polymarket,
  and Kalshi public-model views.
- **Sui policy registry** for selected policy parameters and rail selection.
- **Action Receipts** for policy decisions with digest-bound evidence.
- **Mainnet-attested disclosure** for wallet-owner manual Suilend evidence without
  TIDE mainnet signing.
- **Vendor / rail coverage** across Sui BTCfi lending, CDP, vault, and route
  surfaces, separated into read-only collectors, preview builders, and
  post-audit signing candidates.
- **Verifier tooling** for proof-pack, wallet rehearsal, and Move object checks.

## TIDE Risk / LTV Model

TIDE's core product is its own policy and LTV abstraction, not a wrapper around
one lending market's dashboard. The engine normalizes a BTC treasury position
into the same decision vocabulary across rails:

- **Collateral value:** BTC-denominated collateral translated into USD with
  oracle confidence and freshness attached.
- **Debt value:** stablecoin liability and monthly draw target.
- **Current LTV:** debt divided by collateral value.
- **Target band:** the operator's preferred operating range.
- **Managed repay threshold:** the point where the policy begins reducing
  debt before the position is in emergency territory.
- **Emergency threshold:** the point where payout/new-borrow behavior is frozen
  and defensive actions dominate.
- **Buffer runway:** how many months the stablecoin reserve can fund the target
  draw before more liquidity is needed.
- **Stress survivability:** whether the policy survives modeled BTC drawdowns,
  historical replay paths, and public forecast paths without crossing its
  own guardrails.

This lets TIDE answer a higher-level question than a venue UI: *what should my
treasury policy do now, and can someone verify why it decided that?*

Current receipts pin the decision state as evidence. Future audited releases
can extend the same model toward live protocol actions, but the policy layer
comes first.

## Build Status

| Surface | Current status | Why it matters |
| --- | --- | --- |
| Shadow Mode / stress workbench | Shipped | Operator can model BTC drawdown, runway, and LTV guardrails before signing anything |
| Sui testnet policy + receipt package | Shipped | Policies and action receipts are visible on Sui testnet |
| Walrus proof bundles | Shipped for the latest proof pack | Proof artifacts have real Walrus testnet blob IDs instead of a stub-only story |
| RFC-0001 Action Receipt schema | Shipped as public draft | Gives reviewers a stable verifier contract |
| Judge entry points | Shipped for stress/revoke/oracle-style flows | Lets reviewers test different failure modes quickly |
| Sui BTCfi technical rail surfaces | Shipped as adapters, collectors, or preview builders | Shows where policy decisions can be normalized before any live-capital release |
| Live Pyth readback in proof loop | Near-term unlock | Converts the oracle story from configured feed to live price/confidence/freshness evidence |
| Hosted public `/r/<id>` receipt viewer | Built | Makes receipt inspection one-click for non-technical reviewers |
| `node scripts/tide-verify.mjs <receipt-id>` verifier | Built | Lets reviewers resolve a receipt and verify Walrus bundle digests from the repo |
| `npx tide-verify <receipt-id>` package | Roadmap | Turns the verifier into a reusable ecosystem dev-tool |
| Live Suilend read-only position evidence | In progress / operator-gated | Demonstrates real rail readback while keeping TIDE out of mainnet signing |
| Mainnet execution | Post-audit roadmap | Requires external audit, legal review, upgraded controls, and explicit user signing gates |

## Vendor / Rail Coverage

TIDE is not ending at a generic MVP. The product direction is a policy layer
that can normalize BTC treasury behavior across multiple Sui venues. The
current codebase already carries technical coverage for several vendor and
route surfaces, but those surfaces are intentionally labelled by capability:

- **read-only collector** means TIDE can observe market or position context;
- **preview builder** means TIDE can model a transaction path without treating
  it as live execution;
- **signing candidate** means protocol-specific builder work exists, but live
  signing remains gated until audit, legal review, and explicit release gates.

This is technical coverage, not a claim of vendor endorsement, production
partnership, or audited live protocol execution.

| Surface | Current TIDE coverage | Current boundary |
| --- | --- | --- |
| Suilend | SDK adapter, main-market readback, obligation discovery/readback path | Read-only / founder-gated evidence first; TIDE does not sign mainnet Suilend actions in V1 |
| NAVI | SDK adapter and public-pool live context | Borrow/repay signing stays gated until audit and rail-specific release checks |
| Scallop | SDK adapter and live indexer context | Borrow/repay signing stays gated until audit and rail-specific release checks |
| Bucket Protocol | SDK adapter and live BTC-vault / USDB context | Manage-position signing stays gated; current receipts prove policy decisions |
| AlphaLend | Isolated official-SDK live surface collector | Monitor-only in the current public proof story |
| Kai Finance | Official-SDK isolated runtime and vault surface collector | Vault/supply context and preview research, not a current BTC-borrow execution rail |
| 7k / route venues | Route-context dependency surface through Sui routing stacks and aggregator packages | Route preview / liquidity context, not live swap execution in V1 |
| Ferra / Cetus Aggregator | Quote, swap-preview, DLMM / rebalance-route preview builders | Preview only until a concrete audited signed intent is released |
| Supplemental surfaces | Astros, Volo, Haedal, AlphaFi, Metastable, Native, Nemo, Typus, Magma, and related Sui yield/route surfaces | Monitoring, risk context, or roadmap candidates depending on the venue shape |

The practical goal is to let a BTC treasury operator ask the same question
across venues: *given my cashflow target and LTV boundaries, what should the
policy do now, and can that decision be verified later?*

## How It Works

1. The user sets BTC amount, payout target, buffer floor, LTV thresholds,
   and a policy profile.
2. TIDE models the policy under BTC stress paths and rail-profile inputs.
3. The engine produces a decision and a human-readable reason.
4. The policy can be anchored as a Sui testnet `Policy` object.
5. A receipt mint re-checks rail allowlist, policy version, digest sizes,
   decision type, and limitations on-chain.
6. The receipt stores the digest of the canonical proof bundle so a reviewer
   can verify the decision trail independently.

Public `run-XX.json` files are redacted summaries. Digest verification uses
the on-chain receipt fields plus the canonical Walrus/original bundle bytes;
see RFC-0001 for the verifier path.

## Architecture

```text
Policy draft
  -> BTC stress / rail-profile readout
  -> decision engine
  -> Sui testnet Policy object
  -> canonical proof bundle
  -> SHA-256 digest
  -> Sui testnet Action Receipt / Decision Receipt
  -> workspace ledger / proof pack
```

Architecture document: [docs/overflow_2026/architecture.md](docs/overflow_2026/architecture.md)

Architecture diagram: [docs/overflow_2026/architecture.svg](docs/overflow_2026/architecture.svg)

## Sui, Walrus, and Pyth

- **Sui Move:** `policy_registry` and `execution_receipts` modules define
  the policy object, rail allowlist, and soul-bound receipt object.
- **Walrus:** proof bundles are content-addressed; the latest proof pack
  records real Walrus testnet blob IDs for the five positive runs.
- **Pyth:** BTC/USD PriceInfoObject wiring is configured as read-only input
  for price, confidence, and freshness checks when live feed data is
  available. Live oracle readback is a near-term proof upgrade, not claimed as
  completed for every current receipt.
- **SuiVision:** every proof run links to public Sui testnet transactions
  and objects.

## Smart Contract Design

The Move package is intentionally narrow:

- `policy_registry::create_policy` anchors user policy parameters.
- `policy_registry::select_rail` updates the selected rail with owner,
  allowlist, and policy-version checks.
- `execution_receipts::mint_receipt` creates a non-transferable receipt
  pinned to the selected policy version and digest bundle.
- Admin and upgrade capabilities are separated and publicly attested.

Package: [`0x999c34ce...02f0`](https://testnet.suivision.xyz/object/0x999c34ce039388017838a5da6670195affa55c4dfbd466612494058963d502f0)

Cap placement: [docs/proof/cap-placement-attestation.md](docs/proof/cap-placement-attestation.md)

## Proof Pack

The current proof pack records five Sui testnet proof runs:

| Run | Rail | Decision | Policy tx | Receipt object | Receipt tx | Walrus blob | Content digest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 01 | `scallop-sui` | `BuildBuffer` | [3SZkQAhNqh...](https://testnet.suivision.xyz/txblock/3SZkQAhNqhG8jGCTVqcuJLtja85X1Z5oExygcpwVofep) | [0x66c93faa...](https://testnet.suivision.xyz/object/0x66c93faaea12c3d4098ac8f3035ee08aa0b214c0ba92485b6f3384e2941ef07d) | [BUyCXAnc5C...](https://testnet.suivision.xyz/txblock/BUyCXAnc5CVZ8mvQPKNjzPQcL7K7GHP1sWhyCMB2CizA) | `tFFVYmeqbvv7h8...` | `0x2557d2bd66...` |
| 02 | `navi-sui` | `PartialRepay` | [7AdLt1q7Qd...](https://testnet.suivision.xyz/txblock/7AdLt1q7Qd4ATd3dCyb1THuRiM4XYXVJ4YmAAfFX4y5P) | [0x61911c95...](https://testnet.suivision.xyz/object/0x61911c959d7abc587980a0cc7afc6af08a25a1e0ecbd4261441dc18d4d45c166) | [8GDvb5VZ3W...](https://testnet.suivision.xyz/txblock/8GDvb5VZ3Wj7iKcbzDTKBFWVc9WJvq8EtmfRRgquzFTQ) | `0I5eACF_3M-CBl...` | `0x787fb95f41...` |
| 03 | `suilend-sui` | `EmergencyDeRisk` | [3oWvxqbpLu...](https://testnet.suivision.xyz/txblock/3oWvxqbpLuwVaQczTM8PeFtm2fc1ez4rBAzxYhymftkG) | [0xa936e56b...](https://testnet.suivision.xyz/object/0xa936e56b3d8c0d4036eefd0faee31ea9b216ece9b496d463232fe0cc8b632903) | [BSpohEXxX7...](https://testnet.suivision.xyz/txblock/BSpohEXxX7YMhd8BfqcNhLytnHEZngztzZJufjpQC3yz) | `fegImycRn4mUJ1...` | `0x805f88255d...` |
| 04 | `bucket-sui` | `Hold` | [73VoQiYSoK...](https://testnet.suivision.xyz/txblock/73VoQiYSoK2oVc4jc4HF9MaAGStgc3wnw28WG19SZ8sC) | [0x7134bf4d...](https://testnet.suivision.xyz/object/0x7134bf4d27dfd28d9482b16ba4cffeda6bb36d752e9d4ad608319cf614173f43) | [5CPDVuhJpb...](https://testnet.suivision.xyz/txblock/5CPDVuhJpbyZQae9GWeXSh5P5u37L5dMSnSoC4RTytQu) | `SOIw-GylndaBjC...` | `0x36930ba028...` |
| 05 | `scallop-sui` | `Hold` | [C2eyvjSeKE...](https://testnet.suivision.xyz/txblock/C2eyvjSeKEbEh8BBqp4qQrfivfbpHGnPQLnqt5GhTUuk) | [0x501970ff...](https://testnet.suivision.xyz/object/0x501970ff4b98d2a08c54dcbed67e3f67fffb197b99d5adc2522041df4c7016bd) | [B7wAWwoW5X...](https://testnet.suivision.xyz/txblock/B7wAWwoW5XG3G3AbjyeQTrALM9fDvBZzXZ3dMjzSsTiN) | `JGyzZozdoWoiHf...` | `0x2677fbea79...` |

Core evidence links:

- [Proof pack](docs/onchain_mvp_proof_pack.md)
- [Latest proof loop summary](docs/proof/latest-proof-loop.json)
- [Receipt event schema](docs/onchain_event_schema_v1.md)
- [Action Receipt RFC-0001](docs/overflow_2026/RFC-0001-action-receipt-schema.md)
- [Wallet rehearsal JSON](docs/proof/wallet-rehearsal-2026-05-02.json)
- [Mainnet-observed boundary disclosure](docs/proof/mainnet_attestation_disclosure.md)
- [Mainnet-observed Suilend evidence bundle](docs/proof/mainnet-attested/suilend-sui-ab586a6c59b6.bundle.json)

Negative guards in the proof loop cover rail mismatch, revoked rails,
content-digest tampering, and stale proof bundles.

### Mainnet-Observed Suilend Evidence

For the hackathon, TIDE includes one narrow mainnet evidence lane without
claiming mainnet signing. A founder-owned Suilend position was observed
read-only before and after a manual protocol action. The public bundle records
the mainnet tx digest, obligation id, pre/post debt pressure, and the claim
boundary. The receipt lane remains testnet: TIDE observes, computes, and
attests; it does not sign the mainnet Suilend transaction.

## Security Model

- In V1, the wallet signs Sui testnet policy and receipt transactions; TIDE
  does not sign mainnet protocol actions.
- TIDE V1 does not custody assets.
- Mainnet signing is out of scope until external audit and future controls.
- Receipt minting re-checks rail allowlist and policy version on-chain.
- The proof bundle digest is pinned to the receipt.
- `mainnet-execution` is reserved for a future audited release. The
  submitted proof receipts use `testnet-rehearsal`; source-level enforcement
  for the reserved value must be republished before it is treated as an
  on-chain package guarantee. See
  [proof ref disclosure](docs/proof/proof_ref_disclosure.md) for package
  ref boundaries until the next package republish.

Security policy: [SECURITY.md](SECURITY.md)

## User Flows

- **Founder / operator:** create a policy, model BTC stress, inspect the
  decision, anchor on testnet, mint a receipt.
- **Judge / reviewer:** use the hosted testnet proof surface, then verify
  the receipt objects and proof pack links.
- **Future B2B operator:** embed the rehearsal layer for client treasury
  policy review before any live-capital product is enabled.

## Dashboard and Analytics

The workspace surfaces aggregate treasury value, policy counts, receipts
minted, wallet state, latest activity, read-only mainnet context, and saved
simulation runs. The readout focuses on the current decision, stress-path
survivability, LTV thresholds, buffer runway, and proof status.

## Whitepaper Summary

TIDE is not a BTC yield optimizer, vault marketplace, or black-box finance
bot. It is a behavior layer for BTC-backed treasury management: users state
cashflow intent and hard risk boundaries, then the system models how that
policy behaves as market conditions change.

The long-term thesis is that BTC holders should be able to keep exposure,
access liquidity, and stay inside explicit risk limits without becoming
full-time position managers.

The protocol direction is broader than the hackathon proof pack: TIDE aims to
make treasury behavior reviewable, replayable, and portable across venues.
Action Receipts are the primitive; the app, verifier, PDF exports, APIs, and
eventual integrations are distribution layers around that primitive.

## Tokenomics

`$TIDE` is not part of V1 and is not used by the current proof system.

If launched later, it is planned as a coordination primitive for governance,
risk-pool staking, and premium access. Launch is gated on concrete business
and safety milestones: revenue traction, B2B distribution, drawdown-tested
Breakwater behavior, external audit, and legal framework completion.

Potential token utility, if those gates are met:

- governance over public receipt schema versions and verifier registries;
- staking for future risk-pool / insurance-aligned modules;
- access coordination for premium analytics, hosted APIs, and enterprise
  policy templates;
- incentives for independent verifier, bug bounty, and schema-review work.

No token is required to review the current Sui Overflow submission.

## Roadmap

| Stage | Focus | Target outcome |
| --- | --- | --- |
| S0 Signal | Public Shadow Mode and testnet receipts | Prove demand and verifiable decision trails |
| S1 Prove | Closed beta and first B2B rehearsal pilot | Validate live-readback and paid embed demand |
| S2 Ship | Audited Harbor / Breakwater beta gates | Enable controlled fee-bearing pilots only after audit gates |
| S3 Scale | Enterprise SaaS and policy marketplace | Grow B2B revenue and risk reporting surfaces |
| S4 Compound | Governance and risk-pool readiness | Consider `$TIDE` only if launch gates are met |
| S5 Standardize | Receipt schema, pre-SIP / candidate Sui Application SIP discussion, verifier ecosystem, and cross-chain research | Make TIDE-style receipts reusable beyond one app |
| S6 Institutionalize | Auditor, insurance, and governance channels | Turn receipts into diligence and underwriting inputs |

MVP is not the end state. It is the evidence wedge: prove that treasury
behavior can be rehearsed, anchored, and verified first, then graduate one
rail at a time toward audited live-capital workflows.

Near-term post-hackathon work:

### Hackathon-to-Memorable Layer

These upgrades are designed to make the proof story easier to understand in
minutes, while staying inside the no-unaudited-mainnet-execution boundary:

- public `/r/<id>` receipt viewer with copyable digests and verifier-friendly
  evidence panels;
- live Pyth BTC/USD readback in proof runs: price, confidence, publish time,
  and freshness pinned into the proof bundle;
- durable Walrus upload path as the default, with explicit disclosure if a
  future run falls back to a stub source;
- one live read-only Suilend evidence path: founder-owned mainnet action
  observed by TIDE, receipt anchored on testnet, and no TIDE mainnet signing;
- `npx tide-verify <receipt-id>` as a standalone CLI package for developers;
- multiple judge entry points: stress, audit/export, migration/version drift,
  revoke-then-mint guard, and stale-oracle guard;
- mobile-perfect demo flow and live testnet mint in the demo video;
- subtitles and localized demo notes for English, Chinese, and Korean Sui
  reviewers;
- side-by-side frame: manual spreadsheet workflow versus TIDE receipt +
  SuiVision proof;
- venue-specific proof paragraphs with screenshots and integration tests
  where a sponsor rail is actually read or verified.

### Product / Audit-Prep Layer

- multi-tenant SaaS dashboard with organizations, roles, and audit exports;
- hosted verifier API: `api.tidesui.pro/verify/<receipt-id>`;
- regulator-grade PDF report generated from policy + receipt sets;
- issuer-controlled read-only auditor workspace where a treasury team can
  invite its auditor to review policies, receipts, and evidence without giving
  custody or signing access;
- "embed in 5 minutes" widget for treasury portals and partner dashboards;
- protocol-branded receipt programs where BTCfi venues can expose TIDE-style
  policy receipts under their own user flow while preserving the open schema;
- webhook system for real-time receipt notifications;
- replay/backtest tool: "what would TIDE have decided last quarter?";
- multi-rail aggregation under one policy, with venue concentration limits;
- per-rail graduation from monitor-only to read-only, preview, audited
  signing candidate, and finally controlled live-capital release;
- policy-level liquidity budget, slippage budget, concentration budget, and
  per-venue emergency disable switches;
- formal threat model, dependency-audit CI, incident-response runbook, and
  external Move/security review before any live execution product.

### Protocol / Standard Layer

- TIDE Receipt pre-SIP / candidate Application SIP discussion for Sui action
  attestations: publish the schema as an open proposal, before adoption, so
  the ecosystem can review the receipt format independently of the TIDE app;
- schema-as-standard positioning: TIDE should be the best implementation of
  an open receipt model, not a closed attestation silo;
- standalone `npx tide-verify` / hosted verifier surfaces for third-party
  developers and auditors;
- reference receipt implementations for other ecosystems as research tracks,
  starting with EVM and Move-family chains;
- co-authored paper: "On-chain attestation for treasury policy";
- auditor partner channel where TIDE receipts become review artifacts;
- insurance / underwriting partner LOIs where receipts become risk inputs;
- TIDE Academy: treasury policy hygiene education independent of the software;
- open-source copy/verifier tooling, including `@tide/copy-lint`, for other
  Sui treasury teams;
- eventual UpgradeCap / governance structure that reduces founder bus-factor
  before any live-capital release.

### Growth / Social Layer

- public build log with screenshots, diff stats, and release notes;
- public office hours for code/proof review;
- independent "BTC Treasury Lab" content stream with weekly receipt packs;
- co-marketed first external attestation when a non-founder signs a receipt;
- bounty board for schema feedback, verifier bugs, and copy/canon issues.

Throughout all roadmap stages, V1 remains honest: current receipts prove
decisions and evidence, not unaudited live execution.

## Ecosystem Feedback Ask

TIDE is looking for Sui ecosystem feedback on three questions:

1. Is the Action Receipt schema useful as a reusable attestation pattern for
   Sui DeFi and BTCfi applications?
2. Which BTCfi venue teams should review the read-only rail/profile boundary
   before any audited signing path is proposed?
3. Does this fit best as a Sui Application SIP discussion, developer-tooling
   conversation, Moonshots candidate, or venue-branded receipt program?

The ask is feedback and routing, not a grant entitlement, partner
announcement, or claim of Sui Foundation endorsement.

## Team

TIDE is built by Petr Osetr, solo founder/operator, bringing systems and
business analysis, product-building, and team-leadership experience into
Sui BTCfi treasury tooling.

## Repository Layout

- `move/` - Sui Move package for policy and receipt objects.
- `shadow-mode/` - browser app, simulator, readout, workspace, and proof UI.
- `scripts/` - public build, proof-loop, and verifier utilities.
- `docs/proof/` - public proof artifacts.

This snapshot contains source, public proof artifacts, and public disclosures
needed to review the Overflow submission.

## Local Verification

These commands are optional for reviewers who want to reproduce the checks
from a local checkout:

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

## License

Hackathon public snapshot. See repository files for notices and dependency licenses.
