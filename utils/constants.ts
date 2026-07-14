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

export const ARCHIVES = [
  "GEO",
  "SRA",
  "ENA",
  "DRA",
  "GEA",
  "GSA",
  "ArrayExpress",
] as const;

export type Archive = (typeof ARCHIVES)[number];

export const BRAND_BG = "#0e1015";

export const BRAND = {
  light: "#5BB8F5",
  lighter: "#89d4f7",
  dark: "#2E86D0",
  wordmark: "#236598",
} as const;

// Satori rasterises the OG cards to PNG, so they cannot read Radix theme tokens.
export const OG = {
  dark: {
    fg: "#ffffff",
    muted: "#94a3b8",
    subtle: "#cbd5e1",
    // Same shape as DB_COLOR_MAP[db].og; the search card has no archive of its own.
    search: { primary: "#0ea5e9", secondary: "#0c4a6e", accent: "#7dd3fc" },
  },
  light: {
    bg: "#ffffff",
    ink: "#1a1a1a",
    inkMuted: "#666666",
    inkFaint: "#999999",
    chipBg: "#f5f5f7",
    glowWarm:
      "radial-gradient(circle at center, #6366f140 0%, #8b5cf620 40%, transparent 70%)",
    glowCool:
      "radial-gradient(circle at center, #0ea5e930 0%, #10b98120 40%, transparent 70%)",
  },
} as const;

export const ogBackground = (accent: string): string =>
  `linear-gradient(135deg, ${accent} 0%, #0f172a 50%, #1e293b 100%)`;

export const ogGlow = (accent: string): string =>
  `radial-gradient(circle, ${accent} 0%, transparent 70%)`;

export const ARCHIVE_LIST_TEXT = `${ARCHIVES.slice(0, -1).join(", ")}, and ${
  ARCHIVES[ARCHIVES.length - 1]
}`;

export const ARCHIVE_CATALOG_URLS: Record<Archive, string> = {
  GEO: "https://www.ncbi.nlm.nih.gov/geo/",
  SRA: "https://www.ncbi.nlm.nih.gov/sra",
  ENA: "https://www.ebi.ac.uk/ena/browser/home",
  ArrayExpress: "https://www.ebi.ac.uk/biostudies/arrayexpress",
  GSA: "https://ngdc.cncb.ac.cn/gsa/",
  DRA: "https://www.ddbj.nig.ac.jp/dra/index-e.html",
  GEA: "https://www.ddbj.nig.ac.jp/gea/index-e.html",
};

/** Spelled-out archive names, for link titles and screen readers. */
export const ARCHIVE_FULL_NAMES: Record<Archive, string> = {
  GEO: "NCBI Gene Expression Omnibus",
  SRA: "NCBI Sequence Read Archive",
  ENA: "EBI European Nucleotide Archive",
  ArrayExpress: "EBI ArrayExpress",
  GSA: "CNCB-NGDC Genome Sequence Archive",
  DRA: "DDBJ Sequence Read Archive",
  GEA: "DDBJ Genomic Expression Archive",
};

export const ARCHIVE_LICENSE_URLS: Record<Archive, string> = {
  GEO: "https://www.ncbi.nlm.nih.gov/geo/info/disclaimer.html",
  SRA: "https://www.ncbi.nlm.nih.gov/home/about/policies/",
  ENA: "https://www.ebi.ac.uk/licencing",
  ArrayExpress: "https://www.ebi.ac.uk/licencing",
  GSA: "https://ngdc.cncb.ac.cn/about/policy",
  DRA: "https://www.ddbj.nig.ac.jp/policies-e.html",
  GEA: "https://www.ddbj.nig.ac.jp/policies-e.html",
};
