import type { ExternalArchive } from "./accessionLinks";

export type DbSource =
  | "geo"
  | "sra"
  | "ena"
  | "arrayexpress"
  | "gsa"
  | "ddbj"
  | "gea";

export const DB_ORDER: DbSource[] = [
  "geo",
  "sra",
  "ena",
  "arrayexpress",
  "gsa",
  "ddbj",
  "gea",
];

type DbColor = {
  hex: string;
  og: { primary: string; secondary: string; accent: string };
};

/**
 * One colour per source: badges, charts and OG images all read from here.
 *
 * Not Radix scales -- no seven Radix hues stay distinct under colour blindness.
 * Chosen by docs/cvd_score.py; worst pair 18.4. Regenerate before changing one.
 */
export const DB_COLOR_MAP: Record<DbSource, DbColor> = {
  geo: {
    hex: "#a69dff",
    og: { primary: "#a69dff", secondary: "#7b6ff0", accent: "#cdc7ff" },
  },
  sra: {
    hex: "#a100fc",
    og: { primary: "#a100fc", secondary: "#8400cf", accent: "#c976ff" },
  },
  ena: {
    hex: "#0e825c",
    og: { primary: "#0e825c", secondary: "#0a6146", accent: "#4fbc95" },
  },
  arrayexpress: {
    hex: "#bab400",
    og: { primary: "#bab400", secondary: "#8f8a00", accent: "#dcd64d" },
  },
  gsa: {
    hex: "#d80000",
    og: { primary: "#d80000", secondary: "#a80000", accent: "#f56b6b" },
  },
  ddbj: {
    hex: "#ff558a",
    og: { primary: "#ff558a", secondary: "#e0336c", accent: "#ffa3c0" },
  },
  gea: {
    hex: "#30c0b1",
    og: { primary: "#30c0b1", secondary: "#219287", accent: "#7fdad0" },
  },
};

/** Badge text: the lightest shade that still clears 4.5:1 on its tinted background. */
export const DB_BADGE_FG: Record<DbSource, { light: string; dark: string }> = {
  geo: { light: "#6a64a3", dark: "#a69dff" },
  sra: { light: "#9600ea", dark: "#c157fd" },
  ena: { light: "#0d7553", dark: "#459f81" },
  arrayexpress: { light: "#737000", dark: "#bab400" },
  gsa: { light: "#c70000", dark: "#e65959" },
  ddbj: { light: "#b53c62", dark: "#ff588c" },
  gea: { light: "#1e7970", dark: "#30c0b1" },
};

/**
 * Chart colours, derived so a line always matches its badge.
 *
 * sra_sra_bytes is SRA's other volume series, so it stays in SRA's violet family
 * rather than taking a hue of its own. Its old #6366f1 sat dE 2.7 from SRA itself.
 */
export const DB_COLORS: Record<string, string> = {
  ...(Object.fromEntries(
    DB_ORDER.map((db) => [db, DB_COLOR_MAP[db].hex]),
  ) as Record<DbSource, string>),
  sra_fastq_bytes: DB_COLOR_MAP.sra.hex,
  sra_sra_bytes: "#ae4484",
};

/**
 * Growth-chart dashes, in px (0 = solid). Seven hues are never fully colour-blind
 * safe, so the three closest pairs are separated by shape as well as colour.
 */
export const DB_DASH: Record<string, number> = {
  geo: 0,
  sra: 0,
  arrayexpress: 0,
  gsa: 0,
  ena: 6,
  ddbj: 3,
  gea: 10,
};

/** Human-readable labels for database keys. */
export const DB_LABELS: Record<string, string> = {
  geo: "GEO",
  sra: "SRA",
  arrayexpress: "ArrayExpress",
  ena: "ENA",
  gsa: "GSA",
  ddbj: "DDBJ DRA",
  gea: "DDBJ GEA",
  sra_fastq_bytes: "SRA (FASTQ)",
  sra_sra_bytes: "SRA (SRA archive)",
};

/** The sources `/search?db=` dispatches to. Order is the order the picker lists them. */
export const SEARCH_DBS = [
  "geo",
  "sra",
  "ena",
  "arrayexpress",
  "gsa",
  "ddbj",
  "gea",
] as const;
export type SearchDb = (typeof SEARCH_DBS)[number];

export function dbForAccession(accession: string): DbSource | null {
  const a = accession.toUpperCase();
  if (/^(GSE|GSM|GPL)\d+$/.test(a)) return "geo";
  // E-GEAD-N also matches the ArrayExpress E-XXXX-N shape: always test GEA first.
  if (/^E-GEAD-\d+$/.test(a)) return "gea";
  if (/^E-[A-Z]{4}-\d+$/.test(a)) return "arrayexpress";
  if (/^ER[PXRS]\d+$/.test(a) || /^PRJEB\d+$/.test(a)) return "ena";
  if (/^DR[PXRS]\d+$/.test(a) || /^PRJDB\d+$/.test(a)) return "ddbj";
  if (/^SR[PXRS]\d+$/.test(a) || /^PRJNA\d+$/.test(a)) return "sra";
  // GSA (CNCB-NGDC): open CRA + human HRA, plus PRJCA / SAMC biosample.
  if (/^(CRA|CRX|CRR|HRA|HRX|HRR|HRS|HRI)\d+$/.test(a) || /^(PRJCA|SAMC)\d+$/.test(a))
    return "gsa";
  return null;
}

const ARCHIVE_DB: Record<string, DbSource | undefined> = {
  GEO: "geo",
  SRA: "sra",
  DDBJ: "ddbj",
  ENA: "ena",
  ArrayExpress: "arrayexpress",
  GSA: "gsa",
};

export function dbForArchive(
  archive: ExternalArchive["archive"],
): DbSource | undefined {
  return ARCHIVE_DB[archive];
}
