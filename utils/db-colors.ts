import type { ExternalArchive } from "./accessionLinks";

export type DbSource = "geo" | "sra" | "ena" | "arrayexpress";

export const DB_ORDER: DbSource[] = ["geo", "sra", "ena", "arrayexpress"];

type RadixColor = "blue" | "violet" | "jade" | "amber";

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
    // @ts-expect-error This is a type problem from radix
    radix: "brown",
    og: { primary: "#8b5cf6", secondary: "#6d28d9", accent: "#c4b5fd" },
  },
  ena: {
    hex: "#10b981",
    radix: "jade",
    og: { primary: "#10b981", secondary: "#059669", accent: "#6ee7b7" },
  },
  arrayexpress: {
    hex: "#f59e0b",
    radix: "amber",
    og: { primary: "#f59e0b", secondary: "#d97706", accent: "#fcd34d" },
  },
};

/** Consistent colors for database sources across all stats charts. */
export const DB_COLORS: Record<string, string> = {
  geo: DB_COLOR_MAP.geo.hex,
  sra: DB_COLOR_MAP.sra.hex,
  arrayexpress: DB_COLOR_MAP.arrayexpress.hex,
  ena: DB_COLOR_MAP.ena.hex,
  sra_fastq_bytes: DB_COLOR_MAP.sra.hex,
  sra_sra_bytes: "#6366f1",
};

/** Human-readable labels for database keys. */
export const DB_LABELS: Record<string, string> = {
  geo: "GEO",
  sra: "SRA",
  arrayexpress: "ArrayExpress",
  ena: "ENA",
  sra_fastq_bytes: "SRA (FASTQ)",
  sra_sra_bytes: "SRA (SRA archive)",
};

export function dbForAccession(accession: string): DbSource | null {
  const a = accession.toUpperCase();
  if (/^(GSE|GSM|GPL)\d+$/.test(a)) return "geo";
  if (/^E-[A-Z]{4}-\d+$/.test(a)) return "arrayexpress";
  if (/^ER[PXRS]\d+$/.test(a) || /^PRJEB\d+$/.test(a)) return "ena";
  if (/^[SD]R[PXRS]\d+$/.test(a) || /^PRJ(NA|DB)\d+$/.test(a)) return "sra";
  return null;
}

const ARCHIVE_DB: Record<string, DbSource | undefined> = {
  GEO: "geo",
  SRA: "sra",
  DDBJ: "sra",
  ENA: "ena",
  ArrayExpress: "arrayexpress",
};

export function dbColorForArchive(
  archive: ExternalArchive["archive"],
): RadixColor | undefined {
  const db = ARCHIVE_DB[archive];
  return db ? DB_COLOR_MAP[db].radix : undefined;
}
