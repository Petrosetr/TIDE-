import { renderShadowModeDisclaimerHtml } from "./regulatory-disclaimers.mjs";

export const CUSTODY_FOOTER_COPY = Object.freeze({
  custody:
    "Current Overflow receipts are testnet policy/proof artifacts: TIDE does not hold funds or move mainnet funds. Future live deployments keep protocol positions directly under your wallet. Your wallet signs every on-chain action while TIDE prepares policy and proof payloads.",
  shadowMode:
    "Shadow Mode simulation is fully local. You'll be asked to connect a Sui wallet only when you choose to publish a policy on-chain.",
  posture: renderShadowModeDisclaimerHtml(),
});

export function renderCustodyFooterHtml() {
  return `
    <p class="app-footer__line"><strong>Custody:</strong> ${CUSTODY_FOOTER_COPY.custody}</p>
    <p class="app-footer__line"><strong>No wallet needed for Shadow Mode:</strong> ${CUSTODY_FOOTER_COPY.shadowMode}</p>
    <p class="app-footer__line"><strong>Posture:</strong> ${CUSTODY_FOOTER_COPY.posture}</p>
    <p class="app-footer__line"><strong>Legal:</strong> <a href="../terms.html">Terms</a> · <a href="../privacy.html">Privacy</a> · <a href="../risk.html">Risk disclosure</a></p>
  `;
}
