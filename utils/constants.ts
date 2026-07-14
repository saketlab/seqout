export const SITE_URL = "https://seqout.org";

/** Date of the last full metadata index refresh. Update this when re-indexing. */
export const LAST_INDEX_REFRESH = "April 26, 2026";

/**
 * Placeholder shown in every search input. Teaches by example — each
 * comma-separated entry demonstrates one accepted input mode:
 *   GSE196830     → accession (direct project lookup)
 *   BRCA1         → gene symbol
 *   breast cancer → free-text phrase
 *   scRNA-seq     → method / library strategy
 *
 * Single source of truth so the hero search bar (homepage) and the
 * sticky search bar (every other page) stay in sync.
 */
export const SEARCH_PLACEHOLDER = "GSE196830, BRCA1, breast cancer, scRNA-seq…";

const SERVER_URL = `${SITE_URL}/api`;

export { SERVER_URL };

export const SERVER_API_BASE =
  process.env.PYSRAWEB_API_BASE ?? `${SITE_URL}/api`;

export const ARCHIVE_CATALOG_URLS: Record<string, string> = {
  GEO: "https://www.ncbi.nlm.nih.gov/geo/",
  SRA: "https://www.ncbi.nlm.nih.gov/sra",
  ENA: "https://www.ebi.ac.uk/ena/browser/home",
  ArrayExpress: "https://www.ebi.ac.uk/biostudies/arrayexpress",
  GSA: "https://ngdc.cncb.ac.cn/gsa/",
  DRA: "https://www.ddbj.nig.ac.jp/dra/index-e.html",
  GEA: "https://www.ddbj.nig.ac.jp/gea/index-e.html",
};

export const ARCHIVE_LICENSE_URLS: Record<string, string> = {
  GEO: "https://www.ncbi.nlm.nih.gov/geo/info/disclaimer.html",
  SRA: "https://www.ncbi.nlm.nih.gov/home/about/policies/",
  ENA: "https://www.ebi.ac.uk/licencing",
  ArrayExpress: "https://www.ebi.ac.uk/licencing",
  GSA: "https://ngdc.cncb.ac.cn/about/policy",
  DRA: "https://www.ddbj.nig.ac.jp/policies-e.html",
  GEA: "https://www.ddbj.nig.ac.jp/policies-e.html",
};
