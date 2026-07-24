import { getJson, getJsonOrNull } from "@/utils/api";
import { buildSupplementaryItems } from "@/utils/supplementary";

/**
 * Combined metadata export: one CSV joining every source a project touches —
 * sample/experiment metadata, the FASTQ side, and both levels of supplementary
 * file.
 *
 * The join key across sources is the GEO sample accession: a GEO-submitted SRA
 * sample carries its GSM in `sample_alias`, which is what links a GSM row to
 * its runs. Studies with no GEO side just skip that step.
 *
 * Granularity is one row per run, matching what /metadata/rows already returns
 * for SRA studies. A sample with no runs still gets its row, with the run
 * columns blank — dropping it would lose samples from the export.
 */

type Row = Record<string, unknown>;

type MetadataRowsResponse = {
  source: string;
  rows: Row[];
  next_cursor: number | null;
  truncated?: boolean;
};

type SupplementaryFile = { accession?: string; url?: string; filename?: string };

/** Page through /metadata/rows until the server stops handing out cursors. */
const fetchAllMetadataRows = async (
  accession: string,
  signal?: AbortSignal,
): Promise<{ rows: Row[]; source: string; truncated: boolean }> => {
  const rows: Row[] = [];
  let cursor: number | null = 0;
  let source = "";
  let truncated = false;
  // The endpoint caps total rows server-side; the cursor walk ends there too.
  while (cursor !== null) {
    const page: MetadataRowsResponse = await getJson<MetadataRowsResponse>(
      `/project/${encodeURIComponent(accession)}/metadata/rows?limit=1000&cursor=${cursor}`,
      signal,
    );
    rows.push(...(page.rows ?? []));
    source = page.source || source;
    truncated = truncated || !!page.truncated;
    cursor = page.next_cursor ?? null;
  }
  return { rows, source, truncated };
};

const joinUrls = (urls: string[]): string => urls.join(";");

/** Series- or study-level supplementary files, one list for the whole project. */
const fetchProjectSupplementary = async (
  accession: string | null,
  signal?: AbortSignal,
): Promise<string[]> => {
  if (!accession) return [];
  const data = await getJsonOrNull<{ files?: SupplementaryFile[] }>(
    `/project/${encodeURIComponent(accession)}/supplementary`,
    signal,
  );
  return (data?.files ?? []).map((f) => f.url ?? "").filter(Boolean);
};

/** GSM -> its own supplementary files, read off the samples payload. */
const fetchSampleSupplementary = async (
  geoAccession: string | null,
  signal?: AbortSignal,
): Promise<Map<string, string[]>> => {
  const map = new Map<string, string[]>();
  if (!geoAccession) return map;
  const samples = await getJsonOrNull<
    { accession?: string; supplementary_data?: unknown }[]
  >(`/geo/series/${encodeURIComponent(geoAccession)}/samples`, signal);
  for (const sample of samples ?? []) {
    const accession = sample.accession?.toUpperCase();
    if (!accession) continue;
    const urls = buildSupplementaryItems({
      rawValue: sample.supplementary_data,
      idPrefix: accession,
      sourceSampleAccession: accession,
    }).map((item) => item.browserDownloadUrl);
    if (urls.length > 0) map.set(accession, urls);
  }
  return map;
};

/** Prefix SRA columns so they can't collide with GEO's display-cased headers. */
const prefixSraRow = (row: Row): Row =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [`sra:${k}`, v]));

export type CombinedCsvResult = {
  rows: Row[];
  /** True when a source hit its server-side row cap — the export is partial. */
  truncated: boolean;
};

export const buildCombinedRows = async (
  {
    accession,
    sraAccessions,
    geoAccession,
  }: {
    /** The project the page is showing. */
    accession: string;
    /** SRA studies to pull runs/FASTQ from — the page's own, or its linked ones. */
    sraAccessions: string[];
    /** GEO series supplying supplementary files, if any. */
    geoAccession: string | null;
  },
  signal?: AbortSignal,
): Promise<CombinedCsvResult> => {
  const isGeoBase = !sraAccessions.includes(accession);

  const [base, projectFiles, sampleFiles] = await Promise.all([
    fetchAllMetadataRows(accession, signal),
    fetchProjectSupplementary(geoAccession, signal),
    fetchSampleSupplementary(geoAccession, signal),
  ]);

  let truncated = base.truncated;
  const projectFilesCell = joinUrls(projectFiles);

  // A GEO page's own rows carry no FASTQ, so the linked SRA studies are pulled
  // in and indexed by the GSM each run's sample is aliased to.
  const runsByGsm = new Map<string, Row[]>();
  if (isGeoBase && sraAccessions.length > 0) {
    const linked = await Promise.all(
      sraAccessions.map((sra) => fetchAllMetadataRows(sra, signal)),
    );
    for (const { rows, truncated: cut } of linked) {
      truncated = truncated || cut;
      for (const row of rows) {
        const gsm = String(row.sample_alias ?? "")
          .trim()
          .toUpperCase();
        if (!gsm) continue;
        const bucket = runsByGsm.get(gsm);
        if (bucket) bucket.push(row);
        else runsByGsm.set(gsm, [row]);
      }
    }
  }

  return {
    rows: combineRows({
      baseRows: base.rows,
      runsByGsm,
      projectFilesCell,
      sampleFiles,
    }),
    truncated,
  };
};

/** Sample accession as a join key: GEO rows spell it "Sample", SRA rows alias it. */
const sampleKey = (row: Row): string =>
  String(row.Sample ?? row.sample_alias ?? "")
    .trim()
    .toUpperCase();

/** The pure half of the export: fan base rows out over their runs. */
export const combineRows = ({
  baseRows,
  runsByGsm,
  projectFilesCell,
  sampleFiles,
}: {
  baseRows: Row[];
  runsByGsm: Map<string, Row[]>;
  projectFilesCell: string;
  sampleFiles: Map<string, string[]>;
}): Row[] => {
  const rows: Row[] = [];
  for (const row of baseRows) {
    const gsm = sampleKey(row);
    const extras: Row = {
      supplementary_files: projectFilesCell,
      sample_supplementary_files: joinUrls(sampleFiles.get(gsm) ?? []),
    };
    const runs = runsByGsm.get(gsm);
    if (!runs || runs.length === 0) {
      // Keep the sample: dropping it would silently shrink the export.
      rows.push({ ...row, ...extras });
      continue;
    }
    // One row per run: the run columns are what differ, everything else repeats.
    for (const run of runs) {
      rows.push({ ...row, ...prefixSraRow(run), ...extras });
    }
  }
  return rows;
};

/** Union of every key across rows — sources contribute different columns. */
export const combinedHeaders = (rows: Row[]): string[] => {
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }
  return headers;
};
