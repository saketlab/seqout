import type { ExternalArchive } from "./accessionLinks";
import type { Archive } from "./constants";

export type DbSource =
  | "geo"
  | "sra"
  | "ena"
  | "arrayexpress"
  | "gsa"
  | "dra"
  | "gea";

export const DB_ORDER: DbSource[] = [
  "geo",
  "sra",
  "ena",
  "arrayexpress",
  "gsa",
  "dra",
  "gea",
];

type DbColor = {
  hex: string;
  og: { primary: string; secondary: string; accent: string };
};

/**
 * Seaborn's `muted` palette (tab10 at muted luminance), except geo: tab10's blue
 * is worn by the "Visit BioProject page" button, so GEO takes a brighter one.
 * `og.secondary` is the hex darkened, `og.accent` the hex over white.
 */
export const DB_COLOR_MAP: Record<DbSource, DbColor> = {
  geo: {
    hex: "#0090ff",
    og: { primary: "#0090ff", secondary: "#0070c7", accent: "#73c2ff" },
  },
  sra: {
    hex: "#d65f5f",
    og: { primary: "#d65f5f", secondary: "#a74a4a", accent: "#e8a7a7" },
  },
  ena: {
    hex: "#6acc64",
    og: { primary: "#6acc64", secondary: "#539f4e", accent: "#ade3aa" },
  },
  arrayexpress: {
    hex: "#956cb4",
    og: { primary: "#956cb4", secondary: "#74548c", accent: "#c5aed6" },
  },
  gsa: {
    hex: "#8c613c",
    og: { primary: "#8c613c", secondary: "#6d4c2f", accent: "#c0a894" },
  },
  dra: {
    hex: "#82c6e2",
    og: { primary: "#82c6e2", secondary: "#659ab0", accent: "#bae0ef" },
  },
  gea: {
    hex: "#ee854a",
    og: { primary: "#ee854a", secondary: "#ba683a", accent: "#f6bc9b" },
  },
};

/** Badge text: the lightest shade that still clears 4.5:1 on its tinted background. */
export const DB_BADGE_FG: Record<DbSource, { light: string; dark: string }> = {
  geo: { light: "#006bbd", dark: "#0a94ff" },
  sra: { light: "#c33232", dark: "#db7171" },
  ena: { light: "#2f7f2a", dark: "#42b43b" },
  arrayexpress: { light: "#8556a9", dark: "#a582bf" },
  gsa: { light: "#885e3a", dark: "#b68154" },
  dra: { light: "#247799", dark: "#45aad4" },
  gea: { light: "#b64c11", dark: "#ec7837" },
};

export const PLATFORM_DBS: DbSource[] = DB_ORDER.filter(
  (db) => db !== "arrayexpress",
);

export const DB_COLORS: Record<string, string> = {
  ...(Object.fromEntries(
    DB_ORDER.map((db) => [db, DB_COLOR_MAP[db].hex]),
  ) as Record<DbSource, string>),
  sra_fastq_bytes: DB_COLOR_MAP.sra.hex,
  sra_sra_bytes: "#8a1f3d",
};

export const DB_DASH: Record<string, number> = {
  geo: 0,
  sra: 0,
  arrayexpress: 0,
  dra: 0,
  ena: 3,
  gsa: 6,
  gea: 6,
};

/** Human-readable labels for database keys. */
export const DB_LABELS: Record<string, string> = {
  geo: "GEO",
  sra: "SRA",
  arrayexpress: "ArrayExpress",
  ena: "ENA",
  gsa: "GSA",
  dra: "DRA",
  gea: "GEA",
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
  "dra",
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
  if (/^DR[PXRS]\d+$/.test(a) || /^PRJDB\d+$/.test(a)) return "dra";
  if (/^SR[PXRS]\d+$/.test(a) || /^PRJNA\d+$/.test(a)) return "sra";
  // GSA (CNCB-NGDC): open CRA + human HRA, plus PRJCA / SAMC biosample.
  if (/^(CRA|CRX|CRR|HRA|HRX|HRR|HRS|HRI)\d+$/.test(a) || /^(PRJCA|SAMC)\d+$/.test(a))
    return "gsa";
  return null;
}

const ARCHIVE_DB: Record<Archive, DbSource> = {
  GEO: "geo",
  SRA: "sra",
  DRA: "dra",
  GEA: "gea",
  ENA: "ena",
  ArrayExpress: "arrayexpress",
  GSA: "gsa",
};

export const ARCHIVE_BY_DB = Object.fromEntries(
  Object.entries(ARCHIVE_DB).map(([archive, db]) => [db, archive]),
) as Record<DbSource, Archive>;

export function dbForArchive(
  archive: ExternalArchive["archive"],
): DbSource | undefined {
  return ARCHIVE_DB[archive as Archive];
}
