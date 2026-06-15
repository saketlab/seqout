export const SITE_URL = "https://seqout.org";

/** Date of the last full metadata index refresh. Update this when re-indexing. */
export const LAST_INDEX_REFRESH = "January 17, 2026";

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
