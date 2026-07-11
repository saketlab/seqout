import type { ExternalArchive } from "./accessionLinks";

export type DbSource = "geo" | "sra" | "ena" | "arrayexpress" | "gsa";

export const DB_ORDER: DbSource[] = ["geo", "sra", "ena", "arrayexpress", "gsa"];

type RadixColor = "blue" | "brown" | "jade" | "gold" | "tomato";

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
};

/** Consistent colors for database sources across all stats charts. */
export const DB_COLORS: Record<string, string> = {
  geo: DB_COLOR_MAP.geo.hex,
  sra: DB_COLOR_MAP.sra.hex,
  arrayexpress: DB_COLOR_MAP.arrayexpress.hex,
  ena: DB_COLOR_MAP.ena.hex,
  gsa: DB_COLOR_MAP.gsa.hex,
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
  sra_fastq_bytes: "SRA (FASTQ)",
  sra_sra_bytes: "SRA (SRA archive)",
};

export function dbForAccession(accession: string): DbSource | null {
  const a = accession.toUpperCase();
  if (/^(GSE|GSM|GPL)\d+$/.test(a)) return "geo";
  if (/^E-[A-Z]{4}-\d+$/.test(a)) return "arrayexpress";
  if (/^ER[PXRS]\d+$/.test(a) || /^PRJEB\d+$/.test(a)) return "ena";
  if (/^[SD]R[PXRS]\d+$/.test(a) || /^PRJ(NA|DB)\d+$/.test(a)) return "sra";
  // GSA (CNCB-NGDC): open CRA + human HRA, plus PRJCA / SAMC biosample.
  if (/^(CRA|CRX|CRR|HRA|HRX|HRR|HRS|HRI)\d+$/.test(a) || /^(PRJCA|SAMC)\d+$/.test(a))
    return "gsa";
  return null;
}

const ARCHIVE_DB: Record<string, DbSource | undefined> = {
  GEO: "geo",
  SRA: "sra",
  DDBJ: "sra",
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
