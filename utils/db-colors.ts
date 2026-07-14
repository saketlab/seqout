import type { ExternalArchive } from "./accessionLinks";

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
  deep: string;
  og: { primary: string; secondary: string; accent: string };
};

export const DB_COLOR_MAP: Record<DbSource, DbColor> = {
  geo: {
    hex: "#00468b",
    deep: "#00376c",
    og: { primary: "#00468b", secondary: "#00376c", accent: "#7399bf" },
  },
  sra: {
    hex: "#ed0000",
    deep: "#b90000",
    og: { primary: "#ed0000", secondary: "#b90000", accent: "#f57373" },
  },
  ena: {
    hex: "#42b540",
    deep: "#30852f",
    og: { primary: "#42b540", secondary: "#338d32", accent: "#97d696" },
  },
  arrayexpress: {
    hex: "#925e9f",
    deep: "#72497c",
    og: { primary: "#925e9f", secondary: "#72497c", accent: "#c3a6ca" },
  },
  gsa: {
    hex: "#ad002a",
    deep: "#870021",
    og: { primary: "#ad002a", secondary: "#870021", accent: "#d2738a" },
  },
  dra: {
    hex: "#0099b4",
    deep: "#00778c",
    og: { primary: "#0099b4", secondary: "#00778c", accent: "#73c7d6" },
  },
  gea: {
    hex: "#fdaf91",
    deep: "#936554",
    og: { primary: "#fdaf91", secondary: "#c58871", accent: "#fed3c2" },
  },
};

/** Badge text: the lightest shade that still clears 4.5:1 on its tinted background. */
export const DB_BADGE_FG: Record<DbSource, { light: string; dark: string }> = {
  geo: { light: "#00468b", dark: "#5c89b5" },
  sra: { light: "#cc0000", dark: "#f24c4c" },
  ena: { light: "#2d7b2c", dark: "#42b540" },
  arrayexpress: { light: "#865692", dark: "#a87eb2" },
  gsa: { light: "#ad002a", dark: "#cc617b" },
  dra: { light: "#007489", dark: "#0f9fb8" },
  gea: { light: "#936554", dark: "#fdaf91" },
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

const ARCHIVE_DB: Record<string, DbSource | undefined> = {
  GEO: "geo",
  SRA: "sra",
  DRA: "dra",
  GEA: "gea",
  ENA: "ena",
  ArrayExpress: "arrayexpress",
  GSA: "gsa",
};

export function dbForArchive(
  archive: ExternalArchive["archive"],
): DbSource | undefined {
  return ARCHIVE_DB[archive];
}
