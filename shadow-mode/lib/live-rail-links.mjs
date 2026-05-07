const RAIL_LINKS = Object.freeze({
  "scallop-sui": Object.freeze({
    siteUrl: "https://www.scallop.io",
    docsUrl: "https://docs.scallop.io/",
    siteLabel: "Open Scallop",
    docsLabel: "Scallop docs",
  }),
  "navi-sui": Object.freeze({
    siteUrl: "https://naviprotocol.io",
    docsUrl: "https://docs.naviprotocol.io/",
    siteLabel: "Open NAVI",
    docsLabel: "NAVI docs",
  }),
  "suilend-sui": Object.freeze({
    siteUrl: "https://suilend.fi",
    docsUrl: "https://docs.suilend.fi/",
    siteLabel: "Open Suilend",
    docsLabel: "Suilend docs",
  }),
  "bucket-sui": Object.freeze({
    siteUrl: "https://bucketprotocol.io",
    docsUrl: "https://docs.bucketprotocol.io/",
    siteLabel: "Open Bucket",
    docsLabel: "Bucket docs",
  }),
  "alphalend-sui": Object.freeze({
    siteUrl: "https://alphafi.xyz",
    docsUrl: "https://docs.alphafi.xyz/alphalend/introduction/",
    siteLabel: "Open AlphaLend",
    docsLabel: "AlphaLend docs",
  }),
});

function normalizeRailId(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function getLiveRailLinks(railId) {
  const pinned = normalizeRailId(railId);
  return RAIL_LINKS[pinned] || null;
}
