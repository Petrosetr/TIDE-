# Move Known Issues

Pre-MoveBit tracking notes for the current testnet package.

- No critical/high open findings are known in the testnet policy/receipt path.
- `freshness_label` is deferred to V1.5. Current receipt schema v3 binds
  `revocation_seq`, `state_before_digest`, `rail_pack_digest`, `content_digest`,
  and `walrus_blob_id`; UI freshness copy is derived off-chain.
- Abort code slots are intentionally not contiguous. Earlier package drafts
  used lower-numbered codes for validation paths; the current source keeps
  stable public codes for owner/version/rail/LTV/payout/input/admin/receipt
  guards rather than renumbering after each internal edit.
- Mainnet live-capital execution remains out of V1 scope. The Move package is
  testnet proof infrastructure until external review and live read-back gates
  are complete.
