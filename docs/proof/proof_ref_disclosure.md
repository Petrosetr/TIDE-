# Proof Ref Disclosure

The proof-loop and rehearsal artifacts under `docs/proof/` are minted by
running `scripts/run-testnet-proof-loop.mjs` against the testnet package, and
each artifact records `proofRef` - the `git rev-parse HEAD` captured at the
moment that ceremony was run. The deployable/submitted build has its own ref,
which is the source ref written into `release-manifest.json` at deploy time.
These two refs are not always equal.

This document is the single place that lists the current canonical proof refs
and explains why they may differ from the deployed source ref.
Any rehearsal aggregate (`docs/proof/rehearsal/latest-rehearsal-report.json`)
whose `proofRef` is not listed here will fail
`TIDE_VERIFY_MODE=final npm run verify:overflow`.

## Current canonical refs (2026-05-07)

| Artifact | Ref | Commit subject |
|---|---|---|
| Final 10-cycle rehearsal aggregate (`docs/proof/rehearsal/latest-rehearsal-report.json`) | `3467a12d5312732c0456f04f7feb241227c29a61` | 10-cycle proof-exit gate used by final verifier |
| Latest single proof loop (`docs/proof/latest-proof-loop.json`) | `ebba0404d6252ca23d61af0fe6a09e5566a26e7b` | 2026-05-07 allowlist-seeded proof pack with fresh Walrus-backed testnet receipts |

Public deployed proof docs are valid evidence only when the deployed
`release-manifest.json` reports the expected `gitSha` / `gitBranch` and the
deployed `/docs/onchain_mvp_proof_pack.md` byte-matches this checkout.
`scripts/verify-remote-release.mjs` enforces that after deploy. If a public
host lags this ref, treat its proof doc URL as stale fallback copy, not as the
current proof source.

Deploy and public-export refs are intentionally resolved from the deployed
`release-manifest.json` instead of being hard-coded in this file. Writing a
source commit into the file that contains it makes the document
self-referential and stale on the next commit. The stable audit rule is:
proof refs live here; deployed source refs live in the release manifest.

## Why the refs differ

Rehearsal artifacts are minted on testnet and snapshot the source tree at the
moment each ceremony ran. The 10-cycle rehearsal aggregate is the broad
exit-gate evidence. The 2026-05-07 single proof loop is the current public proof
pack because it was rerun after the rail allowlist was seeded with
`scallop-sui`, `navi-sui`, `suilend-sui`, `bucket-sui`, and `alphalend-sui`.
The deploy commit then updated the public docs/export around that proof pack.

Some post-ceremony source commits do touch Move source, including the
source-level guard that reserves `limitations = "mainnet-execution"` for a
future audited release. That guard is not live in the published testnet
package until the package is republished/upgraded and all package pins are
refreshed. The proofs remain valid because the published package that minted
the receipts is unchanged and the deployed build still points to that same
package. The on-chain receipts, content digests, and `verifyAfter` results are
pinned to the ceremony moment. The deployed build's UI/JS/verifier tooling must
separately prove its own ref via `release-manifest.json`; stale public docs are
not a substitute for that check.

## When to update this file

- A new full rehearsal batch lands: update the rehearsal aggregate row to the
  new `proofRef` from `latest-rehearsal-report.json` and remove old refs that
  are no longer pointed at by any artifact under `docs/proof/`.
- The deployed/source `dev/overflow-2026` ref changes materially (Move package
  republish, signing path change, schema bump): verify the new ref through
  `release-manifest.json` and, if the rehearsal artifacts no longer apply to
  the deployed package, plan a rehearsal regeneration before the submit window
  closes.
- A testnet package id changes: treat the public proof pack as invalid until
  `move/Published.toml`, `.env.testnet.local` / GitHub env pins,
  `docs/proof/latest-proof-loop.json`, `docs/onchain_mvp_proof_pack.md`,
  verifier fixtures, runtime config, and deployed proof docs are refreshed
  together. Do not call N3 policy-version stale behavior "live" until an
  upgrade drill produces transaction evidence.
- The single proof-loop artifact (`docs/proof/latest-proof-loop.json`) is
  refreshed: update its row.

If the deployed build's behavior changes the **shape** of the proof bundle
or the **on-chain package** the rehearsal exercised, regenerate rehearsals
rather than just updating this file. This file is only the audit trail for
ref differences that do not invalidate the proof, and it does not certify
that public hosts have already served the latest proof docs.

## How the verifier uses this file

`scripts/verify-overflow-submission.mjs` requires `proofRef` to appear in
this document verbatim (40-char git sha) when `TIDE_VERIFY_MODE=final` is
set. The check is plain text inclusion; the document's structure is not
parsed, so any prose layout change here is safe as long as the canonical
refs stay listed.

`scripts/verify-remote-release.mjs` separately checks deployed
`release-manifest.json` freshness (`buildId`, `gitShortSha`, `gitSha`, and
`gitBranch`) and checks that the deployed proof pack matches the checkout.
That is the gate that prevents `tidesui.pro` / `app.tidesui.pro` from serving
an older proof doc as current fallback evidence.
