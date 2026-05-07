#!/usr/bin/env node
// @tide/copy-lint — bin entry. Thin wrapper that forwards CLI args to
// runCli() from the package's index module.
//
// Usage:
//   tide-copy-lint <path> [more-paths…]
//   tide-copy-lint README.md docs/
//
// Exit codes:
//   0 — every supplied file passes the canon
//   1 — at least one finding (errors printed to stderr)
//   2 — usage error (no paths supplied)

import { runCli } from "./index.mjs";

runCli(process.argv.slice(2));
