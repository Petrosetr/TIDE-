# @tide/copy-lint

Sui-treasury-style regulatory copy canon enforcer.

It scans HTML, JavaScript, Markdown, and TXT files for claims that counsel,
audit firms, or technical reviewers would flag:

- bare `Autopilot` without nearby `Rehearsal`, `testnet`, `gated`, roadmap,
  audit, or wallet-signing language
- yield/lending/investment-product framing
- guaranteed return, cashflow, income, yield, or outcome language
- mainnet-capital-managed claims
- auto-repay execution claims
- liquidation-avoidance promises
- audited-live-autopilot claims before external audit
- advisor/recommendation language such as `recommend` or `advises`

Pure JS, zero dependencies, ESM-first. Works in Node 18+.

## Usage

```sh
npx @tide/copy-lint README.md docs/
```

Exit codes:

- `0` — every supplied file passes the canon.
- `1` — at least one finding.
- `2` — usage error.

## Library

```js
import { CLAIMS, scanContent, scanFile, walkFilePaths } from "@tide/copy-lint";

const findings = scanContent("Our autopilot manages your BTC.");
const fileFindings = scanFile("./README.md");
const docs = walkFilePaths("docs/");
```

`CLAIMS` is an array of `{ id, pattern, message, validator? }`. A
`validator(content, match)` returns `true` when a regex match should be
suppressed, for example because the copy is explicitly negated or qualified.

## CI

```yaml
- name: Lint regulatory copy
  run: npx @tide/copy-lint README.md docs/ src/landing/
```

## Canon

Eight rules ship today.

| id | Forbidden pattern | Suppression | Notes |
|---|---|---|---|
| `bare-autopilot` | `autopilot` | Rehearsal / testnet / gated / roadmap / audit / wallet-signing qualifier nearby | Keeps Autopilot as a strong word without implying live custody or execution. |
| `yield-or-investment-product` | `TIDE … yield/lending/investment product` | Nearby negation | TIDE is software and action-receipt infrastructure, not an investment product. |
| `guaranteed-return` | `guarantee/ensure … return/cashflow/yield/income/outcome` | Nearby negation | No guaranteed financial outcomes. |
| `mainnet-capital-managed` | mainnet capital managed / movement claims | Nearby negation | Mainnet execution is not live today. |
| `auto-repay-executed` | auto-repay execution claims | None | Use modeled repay threshold or wallet-signed action. |
| `liquidation-avoided` | avoids / prevents liquidation | None | Never promise liquidation avoidance. |
| `audited-live-autopilot` | audited live/mainnet Autopilot claims | None | Reserved for post-audit live releases. |
| `advisor-recommendation-language` | recommends / advises | None | Use models, flags, shows, or operator review. |

## Versioning

- `0.1.0` — initial extracted package. Eight rules. ESM-first.

Rule compatibility:

- Renaming a `CLAIMS[i].id` is breaking.
- Adding a rule is minor.
- Tightening a regex is patch or minor depending on how much new copy it flags.

## License

MIT.
