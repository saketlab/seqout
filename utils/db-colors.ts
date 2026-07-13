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

type RadixColor =
  | "blue"
  | "brown"
  | "jade"
  | "gold"
  | "tomato"
  | "purple"
  | "cyan";

type DbColor = {
  hex: string;
  radix: RadixColor;
  og: { primary: string; secondary: string; accent: string };
};

export const DB_COLOR_MAP: Record<DbSource, DbColor> = {
  geo: {
    hex: "#3b82f6",
    radix: "blue",
    og: { primary: "#3b82f6", secondary: "#1d4ed8", accent: "#93c5fd" },
  },
  sra: {
    hex: "#8b5cf6",
    radix: "brown",
    og: { primary: "#8b5cf6", secondary: "#6d28d9", accent: "#c4b5fd" },
  },
  ena: {
    hex: "#10b981",
    radix: "jade",
    og: { primary: "#10b981", secondary: "#059669", accent: "#6ee7b7" },
  },
  arrayexpress: {
    hex: "#978365", // radix gold 9 (solid) — matches the gold Badge
    radix: "gold",
    og: { primary: "#f59e0b", secondary: "#d97706", accent: "#fcd34d" },
  },
  gsa: {
    hex: "#e54d2e", // radix tomato 9 (solid) — matches the tomato Badge
    radix: "tomato",
    og: { primary: "#e54d2e", secondary: "#d13415", accent: "#f5a390" },
  },
  ddbj: {
    hex: "#8e4ec6", // radix purple 9 (solid) — matches the purple Badge
    radix: "purple",
    og: { primary: "#8e4ec6", secondary: "#8347b9", accent: "#be93e4" },
  },
  gea: {
    hex: "#00a2c7", // radix cyan 9 (solid) — matches the cyan Badge
    radix: "cyan",
    og: { primary: "#00a2c7", secondary: "#0797b9", accent: "#4ccce6" },
  },
};

/** Consistent colors for database sources across all stats charts. */
export const DB_COLORS: Record<string, string> = {
  geo: DB_COLOR_MAP.geo.hex,
  sra: DB_COLOR_MAP.sra.hex,
  arrayexpress: DB_COLOR_MAP.arrayexpress.hex,
  ena: DB_COLOR_MAP.ena.hex,
  gsa: DB_COLOR_MAP.gsa.hex,
  ddbj: DB_COLOR_MAP.ddbj.hex,
  gea: DB_COLOR_MAP.gea.hex,
  sra_fastq_bytes: DB_COLOR_MAP.sra.hex,
  sra_sra_bytes: "#6366f1",
};

/** Human-readable labels for database keys. */
export const DB_LABELS: Record<string, string> = {
  geo: "GEO",
  sra: "SRA",
  arrayexpress: "ArrayExpress",
  ena: "ENA",
  gsa: "GSA",
  ddbj: "DDBJ",
  gea: "DDBJ GEA",
  sra_fastq_bytes: "SRA (FASTQ)",
  sra_sra_bytes: "SRA (SRA archive)",
};

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

export function dbColorForArchive(
  archive: ExternalArchive["archive"],
): RadixColor | undefined {
  const db = ARCHIVE_DB[archive];
  return db ? DB_COLOR_MAP[db].radix : undefined;
}
