# Security Policy

TIDE is currently a rehearsal and testnet proof system. Public surfaces must not claim mainnet signing, custody, or capital movement until external audit and legal review are complete.

## Scope

- Web app and static receipt viewer.
- Sui Move packages under `move/`.
- Receipt resolver, verifier, and proof-bundle tooling.
- Ops endpoints under `/v1/*`.

## Reporting

Send vulnerability reports to `security@tidesui.pro`.

Please include affected URL or module, reproduction steps, expected impact, and whether any wallet or receipt data was exposed. Do not disclose publicly until we have confirmed and fixed the issue.

## Out Of Scope

- Social engineering.
- Volumetric denial of service.
- Spam against public forms.
- Third-party wallet, RPC, oracle, or protocol bugs unless TIDE makes them exploitable through its own code.

## Response Posture

Security fixes take priority over feature work. Mainnet signing remains disabled by default and must fail closed when package ids, allowlists, signatures, or trust inputs are missing.
