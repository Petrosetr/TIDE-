// Regulatory disclaimer canon — single source of truth for the surfaces
// where users see TIDE's MiCA / EU posture. Renderers import these strings
// instead of reproducing them inline; a regression test checks matching
// posture prose when the private source doc is present in the working repo.
//
// Three surfaces today:
//   - SHADOW_MODE_FOOTER — every public Shadow Mode surface (landing
//     hero footer + /design-system page footer + simulator footer).
//   - HARBOR_INVITE_NOTICE — present on Harbor surfaces once Harbor
//     ships under invite-only.
//   - ENTERPRISE_EMBED_NOTICE — used by enterprise-facing pilot copy.
//
// Editing any string here requires:
//   1. matching the posture prose in the private working repo when present;
//      AND
//   2. flagging the change to counsel before public deploy.

export const REGULATORY_DISCLAIMERS = Object.freeze({
  SHADOW_MODE_FOOTER:
    "TIDE Shadow Mode is an educational simulator. Results are modeled, not guaranteed. TIDE does not take custody of your assets and does not provide investment advice. Not available as a commercial product in restricted jurisdictions.",
  HARBOR_INVITE_NOTICE:
    "Harbor is available on an invite-only, design-partner basis. Harbor is not authorized under Regulation (EU) 2023/1114 (MiCA) at this time and is not offered to residents of [list]. Participation requires a separate agreement.",
  ENTERPRISE_EMBED_NOTICE:
    "TIDE provides software to partners operating under their own regulated permissions. TIDE is not a Crypto-Asset Service Provider under Regulation (EU) 2023/1114 and does not hold authorization to provide crypto-asset services directly to EU retail users. Partner deployments operate within the partner's regulatory perimeter.",
});

export const POSTURE_DOC_PATH = "";

export function renderShadowModeDisclaimerHtml() {
  // Plain paragraph; renderer wraps it in whatever footer container it
  // uses (e.g. <p class="app-footer__line"><strong>Posture:</strong> ...</p>).
  return REGULATORY_DISCLAIMERS.SHADOW_MODE_FOOTER;
}

export function renderHarborInviteNoticeHtml() {
  return REGULATORY_DISCLAIMERS.HARBOR_INVITE_NOTICE;
}

export function renderEnterpriseEmbedNoticeHtml() {
  return REGULATORY_DISCLAIMERS.ENTERPRISE_EMBED_NOTICE;
}

export const REGULATORY_DISCLAIMER_IDS = Object.freeze(Object.keys(REGULATORY_DISCLAIMERS));
