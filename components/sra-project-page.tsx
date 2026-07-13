"use client";
import AccessionLink from "@/components/accession-link";
import DbBadge from "@/components/db-badge";
import type { DbSource } from "@/utils/db-colors";
import CountryFlagIcon from "@/components/country-flag-icon";
import MetadataTableTabs from "@/components/metadata-table-tabs";
import ProjectSummary from "@/components/project-summary";
import PublicationCard, {
  StudyPublication,
} from "@/components/publication-card";
import SearchBar from "@/components/search-bar";
import BioProjectBadge from "@/components/bioproject-badge";
import LazyMount from "@/components/lazy-mount";
import SectionAnchor from "@/components/section-anchor";
import SimilarProjectsGraph, {
  SimilarNeighbor,
} from "@/components/similar-projects-graph";
import SubmittingOrgPanel, {
  CenterInfo,
} from "@/components/submitting-org-panel";
import { SupplementaryDataSection } from "@/components/supplementary-data-section";
import { useToast } from "@/components/toast-provider";
import { useWrapText, WrapTextToggle } from "@/components/wrap-text-toggle";
import {
  ensureAgGridModules,
  infiniteScrollOnBodyScroll,
  TABLE_PAGE_SIZE,
  truncatableColDef,
  wrapColDef,
} from "@/lib/ag-grid";
import { getExternalArchiveUrl } from "@/utils/accessionLinks";
import {
  getJson,
  getJsonOrNull,
  getJsonWithTotal,
  parseProjectStringFields,
} from "@/utils/api";
import { copyToClipboard } from "@/utils/clipboard";
import { SERVER_URL } from "@/utils/constants";
import { DB_COLOR_MAP } from "@/utils/db-colors";
import { fileUrl } from "@/utils/fileUrl";
import { formatBytes, titleCaseCenter } from "@/utils/format";
import {
  makeOrganismPostSort,
  makeOrganismRowStyle,
} from "@/utils/organism-highlight";
import { normalizeAuthors, toDisplayText } from "@/utils/project";
import ProjectAuthors from "@/components/project-authors";
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  EnterIcon,
  ExternalLinkIcon,
  FileTextIcon,
  HomeIcon,
  InfoCircledIcon,
  MagnifyingGlassIcon,
  PersonIcon,
  ReloadIcon,
  SewingPinIcon,
} from "@radix-ui/react-icons";
import {
  Badge,
  Button,
  Callout,
  Dialog,
  Flex,
  Heading,
  Link,
  Select,
  Spinner,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type {
  ColDef,
  GridApi,
  ICellRendererParams,
  ValueGetterParams,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useTheme } from "next-themes";
import { useParams, useSearchParams } from "next/navigation";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

ensureAgGridModules();

type Project = {
  accession: string;
  alias: string | null;
  bioproject_id?: string | null;
  // ENA/DDBJ study hierarchy (child -> parent umbrella BioProject).
  parent_accession?: string | null;
  parent_title?: string | null;
  children?: { accession: string; title: string | null }[] | null;
  children_total?: number | null;
  title: string;
  abstract: string;
  authors?: string[] | string | null;
  organisms?: string[] | string | null;
  coords_2d?: number[] | null;
  coords_3d?: number[] | null;
  neighbors?: SimilarNeighbor[] | null;
  submission: string;
  study_type: string;
  updated_at: Date;
  external_id?: Record<string, string> | string | null;
  links?: unknown;
  supplementary_data?: unknown;
  center?: CenterInfo | null;
  center_name?: string | null;
  country_code?: string | null;
  publications?: StudyPublication[] | null;
  has_enriched?: boolean;
};

type GeoNeighborsPayload = {
  coords_3d?: unknown;
  neighbors?: SimilarNeighbor[] | string | null;
};

const normalizeCoords3d = (value: unknown): number[] | null => {
  if (!Array.isArray(value)) return null;
  const parsed = value
    .map((item) =>
      typeof item === "number"
        ? item
        : typeof item === "string"
          ? Number(item)
          : NaN,
    )
    .filter((item) => Number.isFinite(item));
  return parsed.length > 0 ? parsed : null;
};

type Experiment = {
  accession: string;
  title: string | null;
  design_description: string | null;
  library_layout: string | null;
  library_name: string | null;
  library_selection: string | null;
  library_source: string | null;
  library_strategy: string | null;
  samples: string[];
  platform: string | null;
  instrument_model: string | null;
  submission: string | null;
};

type Sample = {
  accession: string;
  alias: string | null;
  description: string | null;
  title: string | null;
  scientific_name: string | null;
  taxon_id: string | null;
  attributes_json: Record<string, string> | null;
};

type ExperimentGridRow = {
  rowKey: string;
  accession: string;
  designDescription: string | null;
  title: string | null;
  library: string | null;
  strategy: string | null;
  layout: string | null;
  platform: string | null;
  instrument: string | null;
  sample: string | null;
  sampleAlias: string | null;
  sampleTitle: string | null;
  description: string | null;
  scientificName: string | null;
  taxonId: string | null;
  attributes: Record<string, string>;
};

type RunRow = {
  run_accession: string;
  run_alias: string | null;
  experiment_accession: string | null;
  library_layout: string | null;
  fastq_ftp: string | null;
  fastq_bytes: string | null;
  fastq_md5: string | null;
  sra_ftp: string | null;
  sra_bytes: string | null;
  sra_md5: string | null;
  ncbi_sra_url: string | null;
  ncbi_sra_url_aws: string | null;
  ncbi_sra_normalized_url: string | null;
  ncbi_sra_normalized_bytes: string | null;
  ncbi_sra_lite_url: string | null;
  ncbi_sra_lite_bytes: string | null;
  ncbi_sra_lite_s3_url: string | null;
  ncbi_sra_lite_gs_url: string | null;
};

type RunsData = {
  total_runs: number;
  paired_runs: number;
  single_runs: number;
  total_fastq_bytes: number;
  runs: RunRow[];
};

type BamRow = {
  run_accession: string;
  experiment_accession: string | null;
  filename: string;
  url: string;
  size: string | null;
  md5: string | null;
  semantic_name: string | null;
  https_url: string | null;
  s3_url: string | null;
};

type BamsData = {
  total_bams: number;
  total_bam_bytes: string;
  bams: BamRow[];
};

const getBestCloudUrl = (run: RunRow): string =>
  run.ncbi_sra_normalized_url ||
  run.ncbi_sra_lite_url ||
  run.ncbi_sra_url ||
  run.ncbi_sra_url_aws ||
  "";

const formatExperimentCount = (count: number): string =>
  `${count} Experiment${count === 1 ? "" : "s"}`;

const fetchProject = async (
  accession: string | null,
): Promise<Project | null> => {
  if (!accession) return null;

  const data = parseProjectStringFields(
    await getJson<Project & { neighbors?: SimilarNeighbor[] | string | null }>(
      `/project/${accession}`,
    ),
  );

  // alias can be a string OR an array (GEO projects list several aliases);
  // only the string form is a GSE we'd fetch neighbors for.
  const alias =
    typeof data?.alias === "string" ? data.alias.trim().toUpperCase() : null;
  const shouldFetchGeoNeighbors =
    !!alias &&
    alias.startsWith("GSE") &&
    (!Array.isArray(data.neighbors) ||
      data.neighbors.length === 0 ||
      !Array.isArray(data.coords_3d) ||
      data.coords_3d.length === 0);

  if (shouldFetchGeoNeighbors) {
    try {
      const geoRes = await fetch(`${SERVER_URL}/geo/series/${alias}/neighbors`);
      if (geoRes.ok) {
        const geoData = (await geoRes.json()) as GeoNeighborsPayload;
        if (typeof geoData.neighbors === "string") {
          try {
            geoData.neighbors = JSON.parse(
              geoData.neighbors,
            ) as SimilarNeighbor[];
          } catch {
            geoData.neighbors = null;
          }
        }
        const parsedCoords3d = normalizeCoords3d(geoData.coords_3d);
        if (Array.isArray(geoData.neighbors) && geoData.neighbors.length > 0) {
          data.neighbors = geoData.neighbors;
        }
        if (parsedCoords3d) {
          data.coords_3d = parsedCoords3d;
        }
      }
    } catch (error) {
      console.error(`Failed to fetch GEO neighbors for alias ${alias}:`, error);
    }
  }

  return data;
};

const normalizeExternalIds = (
  externalId: unknown,
): { key: string; value: string }[] => {
  if (!externalId) return [];

  let parsed = externalId;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (!parsed || typeof parsed !== "object") return [];

  const entries: { key: string; value: string }[] = [];
  for (const [key, value] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item) entries.push({ key, value: String(item) });
      });
    } else if (value) {
      entries.push({ key, value: String(value) });
    }
  }

  return entries;
};

const fetchExperiments = async (
  accession: string | null,
  offset: number,
): Promise<{ items: Experiment[]; total: number | null }> => {
  if (!accession) return { items: [], total: 0 };
  return getJsonWithTotal<Experiment[]>(
    `/project/${accession}/experiments?limit=${TABLE_PAGE_SIZE}&offset=${offset}`,
  );
};

// Stable empty-map identity so the derived samplesMap doesn't churn effects.
const EMPTY_SAMPLES_MAP: Map<string, Sample> = new Map();

const fetchSample = async (accession: string): Promise<Sample | null> => {
  const s = await getJsonOrNull<Sample | { attributes_json: unknown }>(
    `/sample/${accession}`,
  );
  if (!s) return null;
  if (typeof s.attributes_json === "string") {
    try {
      s.attributes_json = JSON.parse(s.attributes_json);
    } catch {
      s.attributes_json = null;
    }
  }
  return s as Sample;
};

const fetchRuns = async (
  accession: string | null,
): Promise<RunsData | null> => {
  if (!accession) return null;
  return getJsonOrNull<RunsData>(`/project/${accession}/runs`);
};

const fetchBams = async (
  accession: string | null,
): Promise<BamsData | null> => {
  if (!accession) return null;
  return getJsonOrNull<BamsData>(`/project/${accession}/bams`);
};

type DownloadSource = "fastq" | "sra" | "sra_lite" | "s3" | "gcs";

const DOWNLOAD_SOURCE_LABELS: Record<DownloadSource, string> = {
  fastq: "FASTQ files (wget)",
  sra: "SRA format (wget)",
  sra_lite: "SRA Lite (wget)",
  s3: "AWS S3 (aws cli)",
  gcs: "Google Cloud (gsutil)",
};

const ABSTRACT_CHAR_LIMIT = 350;

const WGET_RESUME_FLAGS =
  "-c -q --show-progress --tries=10 --timeout=60 --retry-connrefused";

const toInt = (v: string | null | undefined): number =>
  parseInt(v || "0", 10) || 0;

const DOWNLOAD_HELPER = `# Verify file integrity. 
_is_complete() {
  local f="$1"
  [ -s "$f" ] || return 1
  [ -f "$f.done" ] && [ ! "$f" -nt "$f.done" ] && return 0
  case "$f" in
    *.gz) gzip -t "$f" 2>/dev/null ;;
    *.bam)
      if command -v samtools >/dev/null 2>&1; then
        samtools quickcheck "$f" 2>/dev/null
      else
        return 0
      fi
      ;;
    *) return 0 ;;
  esac
}

_human() { numfmt --to=iec --suffix=B --format='%.1f' "$1" 2>/dev/null || echo "\${1}B"; }

_done_count=0
_total_count=0

# Per-file progress line so re-runs don't look hung during multi-GB gzip -t.
# Expected size (4th arg) shown in the "checking..." line lets the user see
# local vs remote bytes; oversized triggers a from-scratch redownload before
# the slow gzip -t even runs.
download_one() {
  local url="$1" out="$2" method="\${3:-wget}" expected="\${4:-0}"
  _done_count=$((_done_count + 1))
  local prefix="[$_done_count/$_total_count] $out"
  local sz=0
  [ -f "$out" ] && sz=$(stat -c %s "$out" 2>/dev/null || echo 0)
  local sz_msg=""
  [ "$expected" -gt 0 ] && sz_msg=" ($(_human $sz) / $(_human $expected))"
  printf '%s: checking%s... ' "$prefix" "$sz_msg" >&2

  if [ "$expected" -gt 0 ] && [ "$sz" -gt "$expected" ]; then
    echo "oversized, redownloading" >&2
    rm -f "$out" "$out.done"
  elif _is_complete "$out"; then
    : > "$out.done"
    echo "valid, skip" >&2
    return 0
  elif [ "$sz" -gt 0 ] && { [ "$method" = "wget" ] || [ "$method" = "curl" ]; }; then
    echo "partial, resuming" >&2
    rm -f "$out.done"
    case "$method" in
      wget) wget -c -q --show-progress --tries=10 --timeout=60 --retry-connrefused -O "$out" "$url" || true ;;
      curl) curl -L -C - --retry 10 --retry-delay 5 --retry-all-errors --fail -o "$out" "$url" || true ;;
    esac
    if _is_complete "$out"; then
      : > "$out.done"
      echo "$prefix: resumed OK" >&2
      return 0
    fi
    echo "$prefix: WARN integrity check failed after resume; redownloading from scratch" >&2
    rm -f "$out" "$out.done"
  else
    echo "missing, downloading" >&2
    rm -f "$out.done"
  fi

  mkdir -p "\${out%/*}"
  case "$method" in
    wget)   wget -q --show-progress --tries=10 --timeout=60 --retry-connrefused -O "$out" "$url" ;;
    curl)   curl -L --retry 10 --retry-delay 5 --retry-all-errors --fail -o "$out" "$url" ;;
    aws)    aws s3 cp --no-progress "$url" "$out" ;;
    gsutil) gsutil cp "$url" "$out" ;;
    *) echo "ERR: unknown download method '$method'" >&2; return 1 ;;
  esac
  _is_complete "$out" || { echo "$prefix: ERR corrupted after fresh download (re-run script)" >&2; rm -f "$out" "$out.done"; return 1; }
  : > "$out.done"
  echo "$prefix: done" >&2
}
`;

const buildResumeStatusLines = (
  paths: string[],
  sizes?: number[],
): string[] => {
  if (paths.length === 0) return [];
  if (sizes && sizes.length === paths.length && sizes.some((s) => s > 0)) {
    return [
      "# Resume estimate from local file sizes vs known remote sizes.",
      "expected_files=(",
      ...paths.map((p) => `  "${p}"`),
      ")",
      "expected_sizes=(",
      ...sizes.map((s) => `  ${s}`),
      ")",
      "_total_count=${#expected_files[@]}",
      "present=0; local_bytes=0; total_bytes=0",
      'for i in "${!expected_files[@]}"; do',
      "  exp=${expected_sizes[$i]}; total_bytes=$((total_bytes + exp))",
      "  f=${expected_files[$i]}",
      '  if [ -f "$f" ]; then',
      '    sz=$(stat -c %s "$f" 2>/dev/null || echo 0)',
      '    [ "$sz" -gt "$exp" ] && sz=0',
      "    local_bytes=$((local_bytes + sz))",
      '    [ "$sz" -ge "$exp" ] && [ "$exp" -gt 0 ] && present=$((present + 1))',
      "  fi",
      "done",
      "pct=$(( total_bytes > 0 ? local_bytes * 100 / total_bytes : 0 ))",
      'echo "Resume estimate: $present/$_total_count files complete ($(_human $local_bytes) / $(_human $total_bytes) ≈ ${pct}%)."',
      "",
    ];
  }
  return [
    "# Resume estimate (size-only, fast). Per-file integrity check runs in download_one below.",
    "expected_files=(",
    ...paths.map((p) => `  "${p}"`),
    ")",
    'present=0; for f in "${expected_files[@]}"; do [ -s "$f" ] && present=$((present+1)); done',
    "_total_count=${#expected_files[@]}",
    'echo "Resume estimate: $present/$_total_count files present on disk (will integrity-check each below)."',
    "",
  ];
};

export function DownloadFastqSection({
  accession,
  runsData,
  agGridThemeClassName,
  expTitleMap,
}: {
  accession: string;
  runsData: RunsData;
  agGridThemeClassName: string;
  expTitleMap: Map<string, string>;
}) {
  const { showToast } = useToast();
  const wrap = useWrapText("fastq");
  const [copied, setCopied] = useState(false);
  const [scriptCopied, setScriptCopied] = useState(false);
  const [scriptDialogOpen, setScriptDialogOpen] = useState(false);
  const [downloadScriptPreview, setDownloadScriptPreview] = useState("");
  const [selectedSource, setSelectedSource] = useState<DownloadSource>("fastq");
  const [selectedCount, setSelectedCount] = useState(0);
  const gridRef = useRef<GridApi<RunRow> | null>(null);

  /** Which download sources have URLs + whether any run lacks FASTQ. */
  const { availableSources, hasMissingFastq } = React.useMemo(() => {
    const sources = new Set<DownloadSource>();
    let missing = false;
    for (const r of runsData.runs) {
      if (r.fastq_ftp) sources.add("fastq");
      else missing = true;
      if (r.ncbi_sra_normalized_url) sources.add("sra");
      if (r.ncbi_sra_lite_url) sources.add("sra_lite");
      if (r.ncbi_sra_lite_s3_url) sources.add("s3");
      if (r.ncbi_sra_lite_gs_url) sources.add("gcs");
    }
    return { availableSources: sources, hasMissingFastq: missing };
  }, [runsData.runs]);

  // Fall back to the first available source if the selected one disappears (adjust during render).
  if (!availableSources.has(selectedSource)) {
    const first = (
      Object.keys(DOWNLOAD_SOURCE_LABELS) as DownloadSource[]
    ).find((s) => availableSources.has(s));
    if (first) setSelectedSource(first);
  }

  const onGridReady = useCallback((params: { api: GridApi<RunRow> }) => {
    gridRef.current = params.api;
  }, []);

  const getDownloadRows = (): RunRow[] => {
    const selected = gridRef.current?.getSelectedRows() ?? [];
    return selected.length > 0 ? selected : runsData.runs;
  };

  const buildTsvContent = (runs: RunRow[]): string => {
    const header =
      "run_accession\trun_alias\texperiment_accession\tlibrary_layout\t" +
      "fastq_url\tfastq_bytes\tfastq_md5\t" +
      "sra_lite_url\tsra_lite_bytes\t" +
      "sra_url\tsra_bytes\t" +
      "s3_url\tgs_url\t" +
      "filename\tdirectory_path";
    const lines = runs.flatMap((run) => {
      const urls = run.fastq_ftp
        ? run.fastq_ftp.split(";").filter(Boolean)
        : [];
      const bytes = run.fastq_bytes
        ? run.fastq_bytes.split(";").filter(Boolean)
        : [];
      const md5s = run.fastq_md5
        ? run.fastq_md5.split(";").filter(Boolean)
        : [];
      const dirpath = `${accession}/${run.experiment_accession || "unknown"}/${run.run_accession}`;

      // Cloud / SRA URLs (per-run)
      const sraLiteUrl = run.ncbi_sra_lite_url || "";
      const sraLiteBytes = run.ncbi_sra_lite_bytes || "";
      const sraUrl = run.ncbi_sra_normalized_url || "";
      const sraBytes = run.ncbi_sra_normalized_bytes || "";
      const s3Url = run.ncbi_sra_lite_s3_url || "";
      const gsUrl = run.ncbi_sra_lite_gs_url || "";

      if (urls.length > 0) {
        return urls.map((url, i) => {
          const filename = url.split("/").pop() || url;
          return [
            run.run_accession,
            run.run_alias || "",
            run.experiment_accession || "",
            run.library_layout || "",
            fileUrl(url),
            bytes[i] || "",
            md5s[i] || "",
            sraLiteUrl,
            sraLiteBytes,
            sraUrl,
            sraBytes,
            s3Url,
            gsUrl,
            filename,
            dirpath,
          ].join("\t");
        });
      }

      // No FASTQ — emit one row with cloud URLs
      const bestUrl = getBestCloudUrl(run);
      if (!bestUrl && !s3Url && !gsUrl) return [];
      const filename = bestUrl
        ? bestUrl.split("/").pop() || run.run_accession
        : run.run_accession;
      return [
        [
          run.run_accession,
          run.run_alias || "",
          run.experiment_accession || "",
          run.library_layout || "",
          "",
          "",
          "",
          sraLiteUrl,
          sraLiteBytes,
          sraUrl,
          sraBytes,
          s3Url,
          gsUrl,
          filename,
          dirpath,
        ].join("\t"),
      ];
    });
    return [header, ...lines].join("\n") + "\n";
  };

  const downloadTsv = () => {
    const runs = getDownloadRows();
    const tsv = buildTsvContent(runs);
    const blob = new Blob([tsv], { type: "text/tab-separated-values" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${accession}_fastq_links.tsv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  };

  type ResolvedEntry = {
    url: string;
    filename: string;
    dirpath: string;
    md5: string;
    bytes: number;
  };

  const resolveRunUrls = (
    run: RunRow,
    source: DownloadSource,
  ): ResolvedEntry[] => {
    const dirpath = `${accession}/${run.experiment_accession || "unknown"}/${run.run_accession}`;
    const sraMd5 = run.sra_md5 || "";
    const sraBytes = toInt(run.ncbi_sra_normalized_bytes);
    const sraLiteBytes = toInt(run.ncbi_sra_lite_bytes);

    if (source === "fastq") {
      const ftps = run.fastq_ftp
        ? run.fastq_ftp.split(";").filter(Boolean)
        : [];
      if (ftps.length > 0) {
        const md5s = run.fastq_md5
          ? run.fastq_md5.split(";").filter(Boolean)
          : [];
        const sizes = run.fastq_bytes
          ? run.fastq_bytes.split(";").filter(Boolean)
          : [];
        return ftps.map((ftp, i) => ({
          url: fileUrl(ftp),
          filename: ftp.split("/").pop() || ftp,
          dirpath,
          md5: md5s[i] || "",
          bytes: toInt(sizes[i]),
        }));
      }
      const fallback = getBestCloudUrl(run);
      if (fallback) {
        const filename = fallback.split("/").pop() || run.run_accession;
        return [
          {
            url: fallback,
            filename,
            dirpath,
            md5: sraMd5,
            bytes: sraBytes || sraLiteBytes,
          },
        ];
      }
      return [];
    }

    // s3/gcs/sra_lite all serve the SRA-Lite object; only "sra" uses normalized SRA bytes.
    const sourceMap: Record<
      Exclude<DownloadSource, "fastq">,
      { url: string | null; bytes: number }
    > = {
      sra: { url: run.ncbi_sra_normalized_url, bytes: sraBytes },
      sra_lite: { url: run.ncbi_sra_lite_url, bytes: sraLiteBytes },
      s3: { url: run.ncbi_sra_lite_s3_url, bytes: sraLiteBytes },
      gcs: { url: run.ncbi_sra_lite_gs_url, bytes: sraLiteBytes },
    };
    const { url, bytes } = sourceMap[source];
    if (!url) return [];
    const filename = url.split("/").pop() || run.run_accession;
    return [{ url, filename, dirpath, md5: sraMd5, bytes }];
  };

  const buildDownloadScript = (
    runs: RunRow[],
    source: DownloadSource = "fastq",
  ) => {
    const entries = runs.flatMap((run) => resolveRunUrls(run, source));
    if (entries.length === 0) return "";

    const totalBytes = runs.reduce((sum, r) => {
      const bytes = r.fastq_bytes
        ? r.fastq_bytes.split(";").filter(Boolean)
        : [];
      return sum + bytes.reduce((s, b) => s + (parseInt(b, 10) || 0), 0);
    }, 0);

    type Entry = (typeof entries)[0];
    const method =
      source === "s3" ? "aws" : source === "gcs" ? "gsutil" : "wget";
    const downloadCmd = (u: Entry) =>
      `download_one "${u.url}" "${u.dirpath}/${u.filename}" ${method} ${u.bytes}`;

    const sourceLabel = DOWNLOAD_SOURCE_LABELS[source];
    const checksums = entries
      .filter((u) => u.md5)
      .map((u) => `${u.md5}  ${u.dirpath}/${u.filename}`);

    const lines = [
      "#!/usr/bin/env bash",
      `# Download ${sourceLabel.split(" (")[0]} for ${accession}${selectedCount > 0 ? ` (${selectedCount} selected runs)` : ""}`,
      `# ${entries.length} files from ${runs.length} runs${totalBytes > 0 ? ` · ${formatBytes(totalBytes)}` : ""}`,
      "# Generated by seqout.org",
      "# Resumable: re-run this script to skip completed files and continue partial transfers.",
      "# Integrity-checked: corrupted .gz / .bam files are detected and redownloaded automatically.",
      "",
      "set -euo pipefail",
      "",
      DOWNLOAD_HELPER,
      ...buildResumeStatusLines(
        entries.map((u) => `${u.dirpath}/${u.filename}`),
        entries.map((u) => u.bytes),
      ),
      "# Download metadata",
      `curl -sS --retry 10 --retry-delay 5 --retry-all-errors --fail "https://seqout.org/api/project/${accession}/metadata/download" -o "${accession}/metadata.csv" --create-dirs`,
      "",
      ...entries.map(downloadCmd),
      "",
      `echo "Done. Files saved under ./${accession}/"`,
    ];

    // Detect interleaved paired-end runs (PAIRED layout but only 1 FASTQ file)
    const interleavedRuns = runs.filter(
      (r) =>
        r.library_layout === "PAIRED" &&
        r.fastq_ftp &&
        r.fastq_ftp.split(";").filter(Boolean).length === 1,
    );
    if (interleavedRuns.length > 0) {
      const runIds = interleavedRuns.map((r) => r.run_accession);
      lines.push(
        "",
        `# NOTE: ${interleavedRuns.length} paired-end run(s) have interleaved FASTQ files (R1+R2 in one file).`,
        "# To split into separate R1/R2 files, run:",
        ...runIds.map(
          (r) => `#   fasterq-dump --split-3 ${r} -O ${accession}/`,
        ),
      );
    }

    if (checksums.length > 0) {
      lines.push(
        "",
        "# Verify checksums",
        'echo "Verifying MD5 checksums..."',
        "md5sum -c <<'MD5SUMS'",
        ...checksums,
        "MD5SUMS",
      );
    }

    lines.push("");
    return lines.join("\n");
  };

  const updateDownloadScriptPreview = (
    source: DownloadSource = selectedSource,
  ) => {
    if (!scriptDialogOpen) return;
    setDownloadScriptPreview(buildDownloadScript(getDownloadRows(), source));
  };

  const onSelectionChanged = () => {
    const selected = gridRef.current?.getSelectedRows() ?? [];
    setSelectedCount(selected.length);
    if (scriptDialogOpen) {
      const rows = selected.length > 0 ? selected : runsData.runs;
      setDownloadScriptPreview(buildDownloadScript(rows, selectedSource));
    }
  };

  const apiBase = SERVER_URL.startsWith("http")
    ? SERVER_URL
    : typeof window !== "undefined"
      ? `${window.location.origin}${SERVER_URL}`
      : SERVER_URL;
  // TSV columns: 1=run 2=exp 3=layout 4=fastq_url 5=fastq_bytes 6=fastq_md5
  //   7=sra_lite_url 8=sra_lite_bytes 9=sra_url 10=sra_bytes 11=s3_url 12=gs_url 13=filename 14=directory_path
  const wgetCmd = `curl -sS --retry 10 --retry-delay 5 --fail "${apiBase}/project/${accession}/runs/download" | tail -n +2 | awk -F'\\t' '{u=$4; if(u=="") u=$9; if(u=="") u=$7; if(u=="") u=$11; if(u!="") print u}' | xargs -P4 -I{} bash -c 'wget ${WGET_RESUME_FLAGS} -x -nH --cut-dirs=6 "$1" || exit 255' _ "{}"`;

  const copyCommand = () => {
    copyToClipboard(wgetCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    showToast("Download command copied");
  };

  const runColDefs = React.useMemo<ColDef<RunRow>[]>(
    () => [
      {
        headerName: "Run",
        field: "run_accession",
        minWidth: 110,
        maxWidth: 140,
        pinned: "left",
      },
      {
        headerName: "Run Alias",
        field: "run_alias",
        minWidth: 160,
        maxWidth: 280,
        tooltipField: "run_alias",
        valueFormatter: (params) => params.value || "-",
        cellStyle: {
          fontFamily: "var(--code-font-family)",
          fontSize: "0.8rem",
        },
      },
      {
        headerName: "Experiment",
        field: "experiment_accession",
        minWidth: 110,
        maxWidth: 140,
        valueFormatter: (params) => params.value || "-",
      },
      {
        headerName: "Title",
        flex: 1,
        minWidth: 200,
        valueGetter: (params: ValueGetterParams<RunRow>) => {
          const exp = params.data?.experiment_accession;
          return exp ? (expTitleMap.get(exp) ?? "-") : "-";
        },
      },
      {
        headerName: "Layout",
        field: "library_layout",
        minWidth: 80,
        maxWidth: 110,
        cellRenderer: (params: ICellRendererParams<RunRow>) => {
          const layout = params.value;
          if (!layout) return "-";
          return (
            <Badge
              size="1"
              color={layout === "PAIRED" ? "blue" : "gray"}
              variant="soft"
            >
              {layout}
            </Badge>
          );
        },
      },
      {
        headerName: "FASTQ Files",
        field: "fastq_ftp",
        minWidth: 280,
        autoHeight: true,
        wrapText: true,
        cellRenderer: (params: ICellRendererParams<RunRow>) => {
          const row = params.data;
          if (!row) return "-";
          const urls = row.fastq_ftp
            ? row.fastq_ftp.split(";").filter(Boolean)
            : [];
          const bytes = row.fastq_bytes
            ? row.fastq_bytes.split(";").filter(Boolean)
            : [];
          const isInterleavedPaired =
            row.library_layout === "PAIRED" && urls.length === 1;
          if (urls.length > 0) {
            return (
              <Flex direction="column" gap="1" py="1">
                {urls.map((ftp, i) => {
                  const filename = ftp.split("/").pop() || ftp;
                  const size = parseInt(bytes[i], 10) || 0;
                  return (
                    <Flex key={ftp} align="center" gap="2">
                      <Link
                        href={fileUrl(ftp)}
                        target="_blank"
                        rel="noopener noreferrer"
                        size="1"
                        style={{ fontFamily: "var(--code-font-family)" }}
                      >
                        {filename}
                      </Link>
                      {size > 0 && (
                        <Text size="1" color="gray">
                          {formatBytes(size)}
                        </Text>
                      )}
                    </Flex>
                  );
                })}
                {isInterleavedPaired && (
                  <Tooltip content="Paired-end reads are in a single interleaved file. Use fasterq-dump --split-3 to extract R1/R2.">
                    <Badge
                      size="1"
                      color="amber"
                      variant="soft"
                      style={{ cursor: "help", width: "fit-content" }}
                    >
                      <InfoCircledIcon /> Interleaved PE
                    </Badge>
                  </Tooltip>
                )}
              </Flex>
            );
          }
          return (
            <Text size="1" color="gray">
              -
            </Text>
          );
        },
      },
      ...(hasMissingFastq
        ? [
            {
              headerName: "Cloud / SRAlite",
              minWidth: 260,
              autoHeight: true,
              wrapText: true,
              cellRenderer: (params: ICellRendererParams<RunRow>) => {
                const row = params.data;
                if (!row) return "-";

                const entries: {
                  url: string;
                  bytes: string | null;
                  badge: string;
                  color: "orange" | "blue" | "gray" | "violet";
                }[] = [];

                // SRA Normalized (AWS S3 HTTPS — full SRA)
                if (row.ncbi_sra_normalized_url) {
                  entries.push({
                    url: row.ncbi_sra_normalized_url,
                    bytes: row.ncbi_sra_normalized_bytes,
                    badge: "SRA",
                    color: "orange",
                  });
                }

                // SRA Lite (NCBI HTTPS — smaller)
                if (row.ncbi_sra_lite_url) {
                  entries.push({
                    url: row.ncbi_sra_lite_url,
                    bytes: row.ncbi_sra_lite_bytes,
                    badge: "Lite",
                    color: "blue",
                  });
                }

                // SRA Lite S3 (s3:// URI)
                if (row.ncbi_sra_lite_s3_url) {
                  entries.push({
                    url: row.ncbi_sra_lite_s3_url,
                    bytes: null,
                    badge: "S3",
                    color: "violet",
                  });
                }

                // SRA Lite GCS (gs:// URI)
                if (row.ncbi_sra_lite_gs_url) {
                  entries.push({
                    url: row.ncbi_sra_lite_gs_url,
                    bytes: null,
                    badge: "GCS",
                    color: "gray",
                  });
                }

                // Legacy fallback: old ncbi_sra_url / ncbi_sra_url_aws columns
                if (entries.length === 0) {
                  const awsUrl = row.ncbi_sra_url_aws;
                  const ncbiUrl = row.ncbi_sra_url;
                  if (awsUrl)
                    entries.push({
                      url: awsUrl,
                      bytes: null,
                      badge: "AWS",
                      color: "orange",
                    });
                  if (ncbiUrl)
                    entries.push({
                      url: ncbiUrl,
                      bytes: null,
                      badge: "NCBI",
                      color: "blue",
                    });
                }

                // SRA FTP fallback
                if (entries.length === 0 && row.sra_ftp) {
                  entries.push({
                    url: fileUrl(row.sra_ftp),
                    bytes: row.sra_bytes,
                    badge: "SRA",
                    color: "gray",
                  });
                }

                if (entries.length === 0) {
                  return (
                    <Text size="1" color="gray">
                      -
                    </Text>
                  );
                }

                return (
                  <Flex direction="column" gap="1" py="1">
                    {entries.map((e) => {
                      const label = e.url.split("/").pop() || row.run_accession;
                      const size = e.bytes ? parseInt(e.bytes, 10) : 0;
                      return (
                        <Flex key={e.url} align="center" gap="2">
                          <Link
                            href={e.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            size="1"
                            style={{ fontFamily: "var(--code-font-family)" }}
                          >
                            {label}
                          </Link>
                          {size > 0 && (
                            <Text size="1" color="gray">
                              {formatBytes(size)}
                            </Text>
                          )}
                          <Badge size="1" color={e.color} variant="soft">
                            {e.badge}
                          </Badge>
                        </Flex>
                      );
                    })}
                  </Flex>
                );
              },
            } satisfies ColDef<RunRow>,
          ]
        : []),
      {
        headerName: "Size",
        minWidth: 70,
        maxWidth: 100,
        valueGetter: (params: ValueGetterParams<RunRow>) => {
          const bytes = params.data?.fastq_bytes
            ? params.data.fastq_bytes.split(";").filter(Boolean)
            : [];
          return bytes.reduce((sum, b) => sum + (parseInt(b, 10) || 0), 0);
        },
        valueFormatter: (params) =>
          params.value > 0 ? formatBytes(params.value as number) : "-",
      },
    ],
    [expTitleMap, hasMissingFastq],
  );

  const defaultColDef = React.useMemo<ColDef<RunRow>>(
    () => ({
      filter: true,
      resizable: true,
      sortable: true,
      ...wrapColDef<RunRow>(wrap),
    }),
    [wrap],
  );

  const downloadLabel =
    selectedCount > 0 ? `Download ${selectedCount} selected` : "Download all";

  const handleCopyScript = async () => {
    if (!downloadScriptPreview) return;

    let didCopy = false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(downloadScriptPreview);
        didCopy = true;
      } catch {
        didCopy = false;
      }
    }

    if (!didCopy) {
      didCopy = copyToClipboard(downloadScriptPreview);
    }

    setScriptCopied(didCopy);
    window.setTimeout(() => setScriptCopied(false), 1500);
    if (didCopy) showToast("Download script copied");
  };

  return (
    <>
      <Flex id="fastq" justify="between" align="center" wrap="wrap" gap="2">
        <Flex align="center" gap="2">
          <Heading as="h2" weight="medium" size="6">
            FASTQ files
          </Heading>
          <SectionAnchor id="fastq" />
        </Flex>
        <Badge size={{ initial: "2", md: "3" }} color="gray">
          {runsData.total_runs.toLocaleString()} runs
        </Badge>
      </Flex>

      <Flex gap="3" justify={"between"} wrap="wrap">
        <Flex gap={"2"}>
          {/* Runs whose layout is neither PAIRED nor SINGLE (unknown/blank in
              SRA metadata) count toward neither, so both can be 0 while runs
              exist — render the badge only when it would have content. */}
          {(runsData.paired_runs > 0 || runsData.single_runs > 0) && (
            <Badge size={{ initial: "2", md: "3" }} color="blue" variant="soft">
              {runsData.paired_runs > 0 &&
                `${runsData.paired_runs.toLocaleString()} paired-end`}
              {runsData.paired_runs > 0 && runsData.single_runs > 0 && " · "}
              {runsData.single_runs > 0 &&
                `${runsData.single_runs.toLocaleString()} single-end`}
            </Badge>
          )}
          {runsData.total_fastq_bytes > 0 && (
            <Badge size={{ initial: "2", md: "3" }} variant="soft">
              {formatBytes(runsData.total_fastq_bytes)} total
            </Badge>
          )}
          {runsData.total_runs > runsData.runs.length && (
            <Badge size={{ initial: "2", md: "3" }} color="gray" variant="soft">
              Showing first {runsData.runs.length} of{" "}
              {runsData.total_runs.toLocaleString()}
            </Badge>
          )}
        </Flex>

        <Flex gap="2" wrap="wrap" align="center">
          <WrapTextToggle scope="fastq" />
          <Button size="2" variant="surface" onClick={downloadTsv}>
            <DownloadIcon /> {downloadLabel} (TSV)
          </Button>
          <Select.Root
            size="2"
            value={selectedSource}
            onValueChange={(v) => {
              const nextSource = v as DownloadSource;
              setSelectedSource(nextSource);
              updateDownloadScriptPreview(nextSource);
            }}
          >
            <Select.Trigger variant="surface" />
            <Select.Content>
              {(Object.keys(DOWNLOAD_SOURCE_LABELS) as DownloadSource[])
                .filter((src) => availableSources.has(src))
                .map((src) => (
                  <Select.Item key={src} value={src}>
                    {DOWNLOAD_SOURCE_LABELS[src]}
                  </Select.Item>
                ))}
            </Select.Content>
          </Select.Root>
          <Dialog.Root
            open={scriptDialogOpen}
            onOpenChange={(open) => {
              setScriptDialogOpen(open);
              if (open) {
                setDownloadScriptPreview(
                  buildDownloadScript(getDownloadRows(), selectedSource),
                );
                setScriptCopied(false);
              }
            }}
          >
            <Dialog.Trigger>
              <Button size="2" variant="surface">
                <FileTextIcon /> Get download script
              </Button>
            </Dialog.Trigger>
            <Dialog.Content size="3">
              <Flex justify="between" align="center" gap="3" mb="3">
                <Dialog.Title mb="0">Copy download script</Dialog.Title>
                <Button
                  size="2"
                  variant="soft"
                  onClick={() => {
                    void handleCopyScript();
                  }}
                  disabled={!downloadScriptPreview}
                >
                  {scriptCopied ? <CheckIcon /> : <CopyIcon />}
                  {scriptCopied ? "Copied!" : "Copy"}
                </Button>
              </Flex>
              <div
                style={{
                  width: "100%",
                  maxWidth: "100%",
                  overflow: "hidden",
                  background: "var(--gray-3)",
                  border: "1px solid var(--gray-6)",
                  borderRadius: "8px",
                }}
              >
                <pre
                  style={{
                    margin: 0,
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "0.875rem",
                    overflowX: "auto",
                    overflowY: "auto",
                    maxHeight: "24rem",
                    fontSize: "12px",
                    lineHeight: "1.5",
                    fontFamily: "var(--default-mono-font-family)",
                  }}
                >
                  <code>
                    {downloadScriptPreview ||
                      "# No downloadable files available"}
                  </code>
                </pre>
              </div>
            </Dialog.Content>
          </Dialog.Root>
        </Flex>
      </Flex>

      <div
        className={agGridThemeClassName}
        style={{
          width: "100%",
          height: `${Math.min(500, 48 + runsData.runs.length * 42)}px`,
        }}
      >
        <AgGridReact<RunRow>
          columnDefs={runColDefs}
          defaultColDef={defaultColDef}
          enableCellTextSelection
          ensureDomOrder
          rowData={runsData.runs}
          getRowId={(params) => params.data.run_accession}
          rowSelection={{
            mode: "multiRow",
            checkboxes: true,
            headerCheckbox: true,
          }}
          onGridReady={onGridReady}
          onSelectionChanged={onSelectionChanged}
          theme="legacy"
        />
      </div>

      <Flex direction="column" gap="2">
        <Text size="4" weight="medium">
          Download all runs
        </Text>
        <div
          style={{
            width: "100%",
            maxWidth: "100%",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            background: "var(--gray-3)",
            border: "1px solid var(--gray-6)",
            borderRadius: "8px",
          }}
        >
          <pre
            style={{
              margin: 0,
              width: "calc(100% - 2.5rem)",
              maxWidth: "calc(100% - 2.5rem)",
              minWidth: 0,
              boxSizing: "border-box",
              padding: "0.875rem",
              overflowX: "auto",
              overflowY: "hidden",
              fontSize: "12px",
              lineHeight: "1.5",
              fontFamily: "var(--default-mono-font-family)",
            }}
          >
            <code>{wgetCmd}</code>
          </pre>
          <Button
            size="2"
            onClick={copyCommand}
            aria-label="Copy download command"
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Button>
        </div>
      </Flex>
    </>
  );
}

function BamFilesSection({
  accession,
  bamsData,
  agGridThemeClassName,
  expTitleMap,
}: {
  accession: string;
  bamsData: BamsData;
  agGridThemeClassName: string;
  expTitleMap: Map<string, string>;
}) {
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  const [scriptCopied, setScriptCopied] = useState(false);
  const gridRef = useRef<GridApi<BamRow> | null>(null);
  const [selectedCount, setSelectedCount] = useState(0);

  const onGridReady = useCallback((params: { api: GridApi<BamRow> }) => {
    gridRef.current = params.api;
  }, []);

  const onSelectionChanged = useCallback(() => {
    const selected = gridRef.current?.getSelectedRows() ?? [];
    setSelectedCount(selected.length);
  }, []);

  const getDownloadRows = (): BamRow[] => {
    const selected = gridRef.current?.getSelectedRows() ?? [];
    return selected.length > 0 ? selected : bamsData.bams;
  };

  const buildDownloadScript = (bams: BamRow[]) => {
    if (bams.length === 0) return "";

    const isSubset = bams.length < bamsData.bams.length;
    const totalBytes = bams.reduce((sum, b) => sum + toInt(b.size), 0);

    const lines = [
      "#!/usr/bin/env bash",
      `# Download BAM files for ${accession}${isSubset ? ` (${bams.length} selected)` : ""}`,
      `# ${bams.length} files${totalBytes > 0 ? ` · ${formatBytes(totalBytes)}` : ""}`,
      "# Generated by seqout.org",
      "# Resumable: re-run this script to continue any partial/failed transfers.",
      "# Integrity-checked: corrupted .bam files are detected (samtools quickcheck) and redownloaded.",
      "",
      "set -euo pipefail",
      "",
      DOWNLOAD_HELPER,
      ...buildResumeStatusLines(
        bams.map(
          (b) =>
            `${accession}/${b.experiment_accession || "unknown"}/${b.run_accession}/${b.filename}`,
        ),
        bams.map((b) => toInt(b.size)),
      ),
      ...bams.map((b) => {
        const url = b.https_url || b.url;
        const dirpath = `${accession}/${b.experiment_accession || "unknown"}/${b.run_accession}`;
        return `download_one "${url}" "${dirpath}/${b.filename}" wget ${toInt(b.size)}`;
      }),
      "",
      `echo "Done. Files saved under ./${accession}/"`,
    ];

    const checksums = bams
      .filter((b) => b.md5)
      .map((b) => {
        const dirpath = `${accession}/${b.experiment_accession || "unknown"}/${b.run_accession}`;
        return `${b.md5}  ${dirpath}/${b.filename}`;
      });

    if (checksums.length > 0) {
      lines.push(
        "",
        "# Verify checksums",
        'echo "Verifying MD5 checksums..."',
        "md5sum -c <<'MD5SUMS'",
        ...checksums,
        "MD5SUMS",
      );
    }

    lines.push("");
    return lines.join("\n");
  };

  const buildTsvContent = (bams: BamRow[]): string => {
    const header =
      "run_accession\texperiment_accession\t" +
      "filename\turl\thttps_url\ts3_url\t" +
      "size\tmd5\tsemantic_name\tdirectory_path";
    const lines = bams.map((b) => {
      const dirpath = `${accession}/${b.experiment_accession || "unknown"}/${b.run_accession}`;
      return [
        b.run_accession,
        b.experiment_accession || "",
        b.filename,
        b.url,
        b.https_url || "",
        b.s3_url || "",
        b.size || "",
        b.md5 || "",
        b.semantic_name || "",
        dirpath,
      ].join("\t");
    });
    return [header, ...lines].join("\n") + "\n";
  };

  const downloadTsv = () => {
    const bams = getDownloadRows();
    const tsv = buildTsvContent(bams);
    const blob = new Blob([tsv], { type: "text/tab-separated-values" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${accession}_bam_links.tsv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  };

  const apiBase = SERVER_URL.startsWith("http")
    ? SERVER_URL
    : typeof window !== "undefined"
      ? `${window.location.origin}${SERVER_URL}`
      : SERVER_URL;
  // TSV columns: 1=run 2=exp 3=filename 4=url 5=https_url 6=s3_url 7=size 8=md5 9=semantic_name 10=directory_path
  // awk picks best URL: https_url($5) → url($4), then downloads to directory_path/filename
  const wgetCmd = `curl -sS --retry 10 --retry-delay 5 --fail "${apiBase}/project/${accession}/bams/download" | tail -n +2 | awk -F'\\t' '{u=$5; if(u=="") u=$4; d=$10; f=$3; if(u!="") printf "%s\\t%s/%s\\n",u,d,f}' | while IFS=$'\\t' read -r url dest; do mkdir -p "$(dirname "$dest")" && wget ${WGET_RESUME_FLAGS} -O "$dest" "$url"; done`;

  const copyCommand = () => {
    copyToClipboard(wgetCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    showToast("BAM download command copied");
  };

  const bamColDefs = React.useMemo<ColDef<BamRow>[]>(
    () => [
      {
        headerName: "Run",
        field: "run_accession",
        minWidth: 110,
        maxWidth: 140,
        pinned: "left",
      },
      {
        headerName: "Experiment",
        field: "experiment_accession",
        minWidth: 110,
        maxWidth: 140,
        valueFormatter: (params) => params.value || "-",
      },
      {
        headerName: "Title",
        flex: 1,
        minWidth: 200,
        valueGetter: (params: ValueGetterParams<BamRow>) => {
          const exp = params.data?.experiment_accession;
          return exp ? (expTitleMap.get(exp) ?? "-") : "-";
        },
      },
      {
        headerName: "BAM File",
        field: "filename",
        minWidth: 280,
        cellRenderer: (params: ICellRendererParams<BamRow>) => {
          const row = params.data;
          if (!row) return "-";
          const url = row.https_url || row.url;
          return (
            <Flex align="center" gap="2" py="1">
              <Link
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                size="1"
                style={{ fontFamily: "var(--code-font-family)" }}
              >
                {row.filename}
              </Link>
            </Flex>
          );
        },
      },
      {
        headerName: "Type",
        field: "semantic_name",
        minWidth: 140,
        maxWidth: 200,
        cellRenderer: (params: ICellRendererParams<BamRow>) => {
          const val = params.value;
          if (!val) return "-";
          return (
            <Badge size="1" color="orange" variant="soft">
              {val}
            </Badge>
          );
        },
      },
      {
        headerName: "Size",
        field: "size",
        minWidth: 80,
        maxWidth: 110,
        valueGetter: (params: ValueGetterParams<BamRow>) =>
          parseInt(params.data?.size || "0", 10) || 0,
        valueFormatter: (params) =>
          params.value > 0 ? formatBytes(params.value as number) : "-",
      },
      {
        headerName: "S3",
        field: "s3_url",
        minWidth: 80,
        maxWidth: 100,
        cellRenderer: (params: ICellRendererParams<BamRow>) => {
          const url = params.data?.s3_url;
          if (!url) return "-";
          return (
            <Badge size="1" color="violet" variant="soft">
              S3
            </Badge>
          );
        },
      },
    ],
    [expTitleMap],
  );

  const defaultColDef = React.useMemo<ColDef<BamRow>>(
    () => ({ filter: true, resizable: true, sortable: true }),
    [],
  );

  const totalBamBytes = parseInt(bamsData.total_bam_bytes || "0", 10);

  const downloadLabel =
    selectedCount > 0 ? `Download ${selectedCount} selected` : "Download all";

  return (
    <>
      <Flex id="bam" justify="between" align="center">
        <Flex align="center" gap="2">
          <Heading as="h2" weight="medium" size="6">
            BAM files
          </Heading>
          <SectionAnchor id="bam" />
          <Badge size={{ initial: "2", md: "3" }} color="orange">
            {bamsData.total_bams.toLocaleString()} files
          </Badge>
        </Flex>
      </Flex>

      <Flex gap="3" justify="between" wrap="wrap">
        <Flex gap="2">
          {totalBamBytes > 0 && (
            <Badge size={{ initial: "2", md: "3" }} variant="soft">
              {formatBytes(totalBamBytes)} total
            </Badge>
          )}
          <Badge size={{ initial: "2", md: "3" }} color="gray" variant="soft">
            Original submitted files
          </Badge>
        </Flex>

        <Flex gap="2">
          <Button size="1" variant="surface" onClick={downloadTsv}>
            <DownloadIcon /> {downloadLabel} (TSV)
          </Button>
          <Button
            size="1"
            variant="surface"
            onClick={() => {
              const script = buildDownloadScript(getDownloadRows());
              if (!script) return;
              copyToClipboard(script);
              setScriptCopied(true);
              setTimeout(() => setScriptCopied(false), 1500);
              showToast("BAM download script copied");
            }}
          >
            {scriptCopied ? <CheckIcon /> : <CopyIcon />}{" "}
            {scriptCopied ? "Copied!" : "Copy script"}
          </Button>
        </Flex>
      </Flex>

      <div
        className={agGridThemeClassName}
        style={{
          width: "100%",
          height: `${Math.min(500, 48 + bamsData.bams.length * 42)}px`,
        }}
      >
        <AgGridReact<BamRow>
          columnDefs={bamColDefs}
          defaultColDef={defaultColDef}
          enableCellTextSelection
          ensureDomOrder
          rowData={bamsData.bams}
          getRowId={(params) =>
            `${params.data.run_accession}_${params.data.filename}`
          }
          rowSelection={{
            mode: "multiRow",
            checkboxes: true,
            headerCheckbox: true,
          }}
          onGridReady={onGridReady}
          onSelectionChanged={onSelectionChanged}
          theme="legacy"
        />
      </div>

      <Flex direction="column" gap="2">
        <Text size="4" weight="medium">
          Download all BAM files
        </Text>
        <div
          style={{
            width: "100%",
            maxWidth: "100%",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            background: "var(--gray-3)",
            border: "1px solid var(--gray-6)",
            borderRadius: "8px",
          }}
        >
          <pre
            style={{
              margin: 0,
              width: "calc(100% - 2.5rem)",
              maxWidth: "calc(100% - 2.5rem)",
              minWidth: 0,
              boxSizing: "border-box",
              padding: "0.875rem",
              overflowX: "auto",
              overflowY: "hidden",
              fontSize: "12px",
              lineHeight: "1.5",
              fontFamily: "var(--default-mono-font-family)",
            }}
          >
            <code>{wgetCmd}</code>
          </pre>
          <Button
            size="2"
            onClick={copyCommand}
            aria-label="Copy download command"
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Button>
        </div>
      </Flex>
    </>
  );
}

/** A clickable accession badge that links to its project page, with the study
 *  title shown as a Radix tooltip. */
function HierarchyBadge({
  accession,
  title,
}: {
  accession: string;
  title: string | null;
}) {
  const badge = (
    <a href={`/p/${accession}`}>
      <Badge size={{ initial: "1", md: "2" }} style={{ cursor: "pointer" }}>
        {accession}
      </Badge>
    </a>
  );
  return title ? <Tooltip content={title}>{badge}</Tooltip> : badge;
}

/** ENA/DDBJ study hierarchy: parent umbrella + child studies. Ships the first 24
 *  children inline; "+N more" links to the full list on ENA. */
function StudyHierarchy({ project }: { project: Project }) {
  const total = project.children_total ?? 0;
  const inline = project.children ?? [];
  const remaining = total - inline.length;

  if (!project.parent_accession && total === 0) return null;

  return (
    <Flex direction="column" gap="2">
      {project.parent_accession && (
        <Flex align="center" gap="2" wrap="wrap">
          <Text size="2" weight="medium">
            Child of:
          </Text>
          <HierarchyBadge
            accession={project.parent_accession}
            title={project.parent_title ?? null}
          />
        </Flex>
      )}
      {total > 0 && (
        <Flex align="center" gap="2" wrap="wrap">
          <Text size="2" weight="medium">
            {total.toLocaleString()} component{" "}
            {total === 1 ? "project" : "projects"}:
          </Text>
          {inline.map((ch) => (
            <HierarchyBadge
              key={ch.accession}
              accession={ch.accession}
              title={ch.title}
            />
          ))}
          {remaining > 0 && (
            <Button variant="ghost" color="gray" size="1" ml="2" asChild>
              <a
                href={`https://www.ebi.ac.uk/ena/browser/view/${project.accession}?show=component-projects`}
                target="_blank"
                rel="noopener noreferrer"
              >
                + {remaining.toLocaleString()} more
              </a>
            </Button>
          )}
        </Flex>
      )}
    </Flex>
  );
}

export default function ProjectPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const highlightOrganism = searchParams.get("organism")?.toLowerCase() ?? null;
  const wrap = useWrapText();
  const { resolvedTheme } = useTheme();
  const { showToast } = useToast();
  const accession = params.accession as string | undefined;
  const accessionUpper = accession?.toUpperCase();
  const isArrayExpressAccession = accessionUpper?.startsWith("E-") ?? false;
  const isPrjAccession = accessionUpper?.startsWith("PRJ") ?? false;
  // GSA (CNCB-NGDC): CRA = open archive, HRA = human archive.
  const isGsaAccession = /^(CRA|HRA)\d+$/.test(accessionUpper ?? "");
  // DDBJ DRA: D-namespace studies live on ddbj.nig.ac.jp, not NCBI Trace.
  const isDdbjAccession = /^(DR[PXRS]|PRJDB)\d+$/.test(accessionUpper ?? "");
  const gsaStudyUrl = accessionUpper?.startsWith("HRA")
    ? `https://ngdc.cncb.ac.cn/gsa-human/browse/${accession}`
    : `https://ngdc.cncb.ac.cn/gsa/browse/${accession}`;
  const ddbjStudyUrl =
    accession && isDdbjAccession
      ? (getExternalArchiveUrl(accession)?.url ?? null)
      : null;
  const externalStudyUrl = isGsaAccession
    ? gsaStudyUrl
    : (ddbjStudyUrl ??
      (accession && isPrjAccession
        ? `https://www.ebi.ac.uk/ena/browser/view/${accession}`
        : `https://trace.ncbi.nlm.nih.gov/Traces/?view=study&acc=${accession}`));
  const externalStudyLabel = isGsaAccession
    ? "Visit GSA page"
    : isDdbjAccession
      ? "Visit DDBJ page"
      : isPrjAccession
        ? "Visit ENA page"
        : "Visit SRA page";
  const externalStudyDb: DbSource = isGsaAccession
    ? "gsa"
    : isDdbjAccession
      ? "ddbj"
      : isPrjAccession
        ? "ena"
        : "sra";
  const [isAccessionCopied, setIsAccessionCopied] = useState(false);
  const [isBioprojectCopied, setIsBioprojectCopied] = useState(false);
  const isDark = resolvedTheme === "dark";
  const agGridThemeClassName = isDark
    ? "ag-theme-quartz-dark"
    : "ag-theme-quartz";

  const organismRowStyle = useMemo(
    () =>
      makeOrganismRowStyle<ExperimentGridRow>(
        highlightOrganism,
        isDark,
        (d) => d.scientificName ?? null,
      ),
    [highlightOrganism, isDark],
  );
  const organismPostSort = useMemo(
    () =>
      makeOrganismPostSort<ExperimentGridRow>(
        highlightOrganism,
        (d) => d.scientificName ?? null,
      ),
    [highlightOrganism],
  );

  const {
    data: project,
    isLoading,
    isError,
    refetch: refetchProject,
  } = useQuery({
    queryKey: ["project", accession],
    queryFn: () => fetchProject(accession ?? null),
    enabled: !!accession,
  });

  useEffect(() => {
    if (!project || isLoading || isError) return;
    window.dispatchEvent(new Event("seqout:project-ready"));
  }, [project, isLoading, isError]);

  // Paginated: 20 experiments/page, fetch more as the grid scrolls (loaded-only).
  const experimentsQuery = useInfiniteQuery({
    queryKey: ["project-experiments", accession],
    queryFn: ({ pageParam }) => fetchExperiments(accession ?? null, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.items.length === TABLE_PAGE_SIZE
        ? allPages.length * TABLE_PAGE_SIZE
        : undefined,
    enabled: !!accession,
  });
  const experiments = React.useMemo(
    () => experimentsQuery.data?.pages.flatMap((p) => p.items),
    [experimentsQuery.data],
  );
  // Full count from the X-Total-Count header so the badge shows the real total,
  // not just the rows loaded so far.
  const experimentsTotal =
    experimentsQuery.data?.pages[0]?.total ?? experiments?.length ?? 0;
  const isExperimentsLoading = experimentsQuery.isLoading;
  const isExperimentsError = experimentsQuery.isError;

  // Per-sample details accumulate as experiment pages load (one /sample/{acc}
  // request per not-yet-fetched sample). Derived header/attribute summaries
  // therefore reflect the loaded rows and grow on scroll. The accession is
  // stored alongside so a project change auto-resets the map (no stale leak).
  const [samplesState, setSamplesState] = React.useState<{
    accession: string | null;
    map: Map<string, Sample>;
  }>({ accession: null, map: EMPTY_SAMPLES_MAP });
  const samplesMap =
    samplesState.accession === accession ? samplesState.map : EMPTY_SAMPLES_MAP;
  React.useEffect(() => {
    if (!experiments || experiments.length === 0) return;
    const missing = experiments
      .map((exp) => exp.samples[0])
      .filter((acc): acc is string => !!acc && !samplesMap.has(acc));
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(missing.map((acc) => fetchSample(acc))).then((results) => {
      if (cancelled) return;
      const found = results.filter((s): s is Sample => !!s);
      if (found.length === 0) return; // nothing new — avoid state churn / re-run loop
      setSamplesState((prev) => {
        const base =
          prev.accession === accession ? prev.map : new Map<string, Sample>();
        const next = new Map(base);
        found.forEach((s) => next.set(s.accession, s));
        return { accession: accession ?? null, map: next };
      });
    });
    return () => {
      cancelled = true;
    };
  }, [experiments, samplesMap, accession]);

  const { data: runsData } = useQuery({
    queryKey: ["project-runs", accession],
    queryFn: () => fetchRuns(accession ?? null),
    enabled: !!accession,
  });

  const { data: bamsData } = useQuery({
    queryKey: ["project-bams", accession],
    queryFn: () => fetchBams(accession ?? null),
    enabled: !!accession,
  });

  const expTitleMap = React.useMemo(() => {
    const map = new Map<string, string>();
    if (experiments) {
      for (const exp of experiments) {
        if (exp.title) map.set(exp.accession, exp.title);
      }
    }
    return map;
  }, [experiments]);

  const externalIds = React.useMemo(
    () => normalizeExternalIds(project?.external_id),
    [project?.external_id],
  );
  const linkedGeoAliases = React.useMemo(() => {
    const aliases = new Set<string>();
    const addAlias = (value: unknown) => {
      if (typeof value !== "string") return;
      const normalized = value.trim().toUpperCase();
      if (normalized.startsWith("GSE")) aliases.add(normalized);
    };
    addAlias(project?.alias);
    externalIds.forEach((entry) => addAlias(entry.value));
    return Array.from(aliases);
  }, [externalIds, project?.alias]);
  const { data: linkedGeoProjects } = useQuery({
    queryKey: ["linked-geo-projects", linkedGeoAliases],
    queryFn: async () => {
      const projects = await Promise.all(
        linkedGeoAliases.map(async (geoAccession) => ({
          accession: geoAccession,
          project: await fetchProject(geoAccession),
        })),
      );
      return projects.filter((entry) => entry.project);
    },
    enabled: linkedGeoAliases.length > 0,
  });

  const publications = project?.publications ?? null;
  const projectAuthors = React.useMemo(
    () => normalizeAuthors(project?.authors ?? null),
    [project?.authors],
  );

  const projectOrganisms = React.useMemo<string[]>(() => {
    if (!samplesMap) return [];
    const set = new Set<string>();
    samplesMap.forEach((sample) => {
      const name = sample.scientific_name?.trim();
      if (name) set.add(name);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [samplesMap]);

  // Prefer top-level center_name/country_code; fall back to nested center.
  const headerCenter = React.useMemo<{
    label: string;
    countryCode: string | null;
  } | null>(() => {
    if (!project) return null;

    if (project.center_name && project.center_name !== "GEO") {
      return {
        label: titleCaseCenter(project.center_name),
        countryCode: project.country_code ?? null,
      };
    }

    const c = project.center;
    if (!c || !c.organization || c.organization === "GEO") return null;
    return {
      label: titleCaseCenter(c.organization),
      countryCode: c.country_code ?? null,
    };
  }, [project]);

  const handleCopyAccession = () => {
    if (!accession) return;
    copyToClipboard(accession);
    setIsAccessionCopied(true);
    window.setTimeout(() => setIsAccessionCopied(false), 1500);
    showToast(
      <>
        Copied <span className="seqout-accession">{accession}</span>
      </>,
    );
  };

  const handleCopyBioproject = () => {
    const prj = project?.bioproject_id;
    if (!prj) return;
    copyToClipboard(prj);
    setIsBioprojectCopied(true);
    window.setTimeout(() => setIsBioprojectCopied(false), 1500);
    showToast(
      <>
        Copied <span className="seqout-accession">{prj}</span>
      </>,
    );
  };

  const attributeKeys = React.useMemo(() => {
    if (!samplesMap) return [];
    const keys = new Set<string>();
    samplesMap.forEach((s) => {
      if (s.attributes_json) {
        Object.keys(s.attributes_json).forEach((k) => keys.add(k));
      }
    });
    return Array.from(keys);
  }, [samplesMap]);

  const experimentRows = React.useMemo<ExperimentGridRow[]>(() => {
    if (!experiments) return [];

    return experiments.map((experiment) => {
      const sampleAccession = experiment.samples[0] ?? null;
      const sample =
        sampleAccession && samplesMap ? samplesMap.get(sampleAccession) : null;

      return {
        rowKey: experiment.accession,
        accession: experiment.accession,
        designDescription: experiment.design_description,
        title: experiment.title,
        library: experiment.library_name,
        strategy: experiment.library_strategy,
        layout: experiment.library_layout,
        platform: experiment.platform,
        instrument: experiment.instrument_model,
        sample: sampleAccession,
        sampleAlias: sample?.alias ?? null,
        sampleTitle: sample?.title ?? null,
        description: sample?.description ?? null,
        scientificName: sample?.scientific_name ?? null,
        taxonId: sample?.taxon_id ?? null,
        attributes: sample?.attributes_json ?? {},
      };
    });
  }, [experiments, samplesMap]);

  const experimentsGridHeight = React.useMemo(() => {
    const headerHeight = 48;
    const rowHeight = 42;
    const maxHeight = 500;
    // Wrapped rows grow past the fixed rowHeight estimate, so a row-count fit
    // would clip them — give the grid its full max height instead.
    if (wrap) return maxHeight;
    return Math.min(
      maxHeight,
      headerHeight + experimentRows.length * rowHeight,
    );
  }, [experimentRows.length, wrap]);

  const experimentsGridDefaultColDef = React.useMemo<ColDef<ExperimentGridRow>>(
    () => ({
      filter: true,
      resizable: true,
      sortable: true,
      minWidth: 20,
      width: 150,
      ...truncatableColDef<ExperimentGridRow>(wrap),
      valueFormatter: (params) => toDisplayText(params.value),
      tooltipValueGetter: (params) => toDisplayText(params.value),
    }),
    [wrap],
  );

  const experimentColumnDefs = React.useMemo<ColDef<ExperimentGridRow>[]>(
    () => [
      {
        headerName: "Accession",
        field: "accession",
        width: 130,
        pinned: "left",
        cellClass: "seqout-accession",
        cellRenderer: (params: ICellRendererParams<ExperimentGridRow>) => {
          const experimentAccession = toDisplayText(params.value);
          if (experimentAccession === "-") return "-";
          return <AccessionLink accession={experimentAccession} />;
        },
      },
      {
        headerName: "Design",
        field: "designDescription",
        width: 200,
        valueFormatter: (params) => toDisplayText(params.value),
      },
      {
        headerName: "Title",
        field: "title",
        width: 180,
        valueFormatter: (params) => toDisplayText(params.value),
      },
      {
        headerName: "Strategy",
        field: "strategy",
        width: 120,
        valueFormatter: (params) => toDisplayText(params.value),
      },
      {
        headerName: "Library Name",
        field: "library",
        width: 130,
        valueFormatter: (params) => toDisplayText(params.value),
      },
      {
        headerName: "Layout",
        field: "layout",
        width: 100,
        valueFormatter: (params) => toDisplayText(params.value),
      },
      {
        headerName: "Platform",
        field: "platform",
        width: 110,
        valueFormatter: (params) => toDisplayText(params.value),
      },
      {
        headerName: "Instrument",
        field: "instrument",
        width: 140,
        valueFormatter: (params) => toDisplayText(params.value),
      },
      {
        headerName: "Sample",
        field: "sample",
        width: 120,
        cellClass: "seqout-accession",
        cellRenderer: (params: ICellRendererParams<ExperimentGridRow>) => {
          const sampleAccession = toDisplayText(params.value);
          if (sampleAccession === "-") return "-";
          return <AccessionLink accession={sampleAccession} />;
        },
      },
      {
        headerName: "Sample Alias",
        field: "sampleAlias",
        width: 130,
        cellRenderer: (params: ICellRendererParams<ExperimentGridRow>) => {
          const sampleAlias = toDisplayText(params.value);
          if (sampleAlias === "-") return "-";
          return <AccessionLink accession={sampleAlias} />;
        },
      },
      {
        headerName: "Sample Title",
        field: "sampleTitle",
        width: 180,
        valueFormatter: (params) => toDisplayText(params.value),
      },
      {
        headerName: "Description",
        field: "description",
        width: 200,
      },
      {
        headerName: "Scientific Name",
        field: "scientificName",
        width: 160,
        valueFormatter: (params) => toDisplayText(params.value),
      },
      {
        headerName: "Taxon ID",
        field: "taxonId",
        width: 100,
        valueFormatter: (params) => toDisplayText(params.value),
      },
      ...attributeKeys.map(
        (key): ColDef<ExperimentGridRow> => ({
          headerName: key,
          width: 150,
          valueGetter: (params: ValueGetterParams<ExperimentGridRow>) =>
            params.data?.attributes[key] ?? "-",
        }),
      ),
    ],
    [attributeKeys],
  );

  // Hide columns whose value is "-" for every row (still exported to CSV).
  const visibleExperimentColumnDefs = React.useMemo<
    ColDef<ExperimentGridRow>[]
  >(() => {
    if (experimentRows.length === 0) return experimentColumnDefs;
    return experimentColumnDefs.filter((col) => {
      if (col.field === "accession") return true; // always keep pinned accession column
      const getValue = (row: ExperimentGridRow): unknown =>
        col.field
          ? row[col.field as keyof ExperimentGridRow]
          : col.headerName
            ? row.attributes[col.headerName]
            : undefined;
      return experimentRows.some((row) => toDisplayText(getValue(row)) !== "-");
    });
  }, [experimentColumnDefs, experimentRows]);

  return (
    <>
      <SearchBar initialQuery={""} />

      {!accession && (
        <Flex
          gap="3"
          align="center"
          p={"4"}
          ml={{ initial: "0", md: "8rem" }}
          mr={{ md: "16rem" }}
          justify="center"
          direction={"column"}
        >
          <Text size={{ initial: "4", md: "5" }} weight="bold">
            No project specified
          </Text>
          <Text
            size="2"
            align="center"
            style={{ color: "var(--gray-11)", maxWidth: "32rem" }}
          >
            The URL needs an accession like{" "}
            <span className="seqout-accession">/p/SRP123456</span>.
          </Text>
          <Button
            variant="surface"
            onClick={() => (window.location.href = "/")}
            mt="1"
          >
            <HomeIcon /> Back to search
          </Button>
        </Flex>
      )}

      {accession && isLoading && (
        <Flex
          gap="2"
          align="center"
          pt={"3"}
          ml={{ initial: "0", md: "8rem" }}
          mr={{ md: "16rem" }}
          justify="center"
        >
          <Spinner size="3" />
          <Text>
            Loading <span className="seqout-accession">{accession}</span>
          </Text>
        </Flex>
      )}

      {accession && isError && (
        <Flex
          gap="3"
          align="center"
          justify="center"
          height={"20rem"}
          direction={"column"}
          px="4"
        >
          <Text size={{ initial: "5", md: "6" }} weight="bold">
            We couldn&rsquo;t load{" "}
            <span className="seqout-accession">{accession}</span>
          </Text>
          <Text
            size="2"
            align="center"
            style={{ color: "var(--gray-11)", maxWidth: "34rem" }}
          >
            The project may not exist, or the server may be temporarily
            unavailable. Retrying is safe.
          </Text>
          <Flex gap="2" mt="1">
            <Button variant="surface" onClick={() => refetchProject()}>
              <ReloadIcon /> Retry
            </Button>
            <Button
              variant="ghost"
              onClick={() => (window.location.href = "/")}
            >
              <MagnifyingGlassIcon /> Search instead
            </Button>
          </Flex>
        </Flex>
      )}

      {accession && !isLoading && !isError && project && (
        <>
          <Flex
            ml={{ initial: "0", md: "12rem" }}
            mr={{ initial: "0", md: "8rem" }}
            py="3"
            px={{ initial: "4", md: "3" }}
            direction="column"
            gap="4"
          >
            <Flex justify="between" style={{ width: "100%" }} align="center">
              <Heading as="h1" size={{ initial: "6", md: "8" }} weight="bold">
                {project.title}
              </Heading>
            </Flex>
            <Flex justify="start" align={"center"} gap="2" wrap={"wrap"}>
              <DbBadge
                size={{ initial: "2", md: "3" }}
                db={
                  isGsaAccession
                    ? "gsa"
                    : isDdbjAccession
                      ? "ddbj"
                      : isPrjAccession
                        ? "ena"
                        : isArrayExpressAccession
                          ? "arrayexpress"
                          : "sra"
                }
                style={{ whiteSpace: "nowrap" }}
                className="seqout-accession"
              >
                <Flex align="center" gap="1">
                  <Text>{accession}</Text>
                  <Tooltip content="Copy accession">
                    <button
                      type="button"
                      onClick={handleCopyAccession}
                      aria-label="Copy accession"
                      style={{
                        border: "none",
                        background: "transparent",
                        color: "inherit",
                        padding: 0,
                        margin: 0,
                        display: "inline-flex",
                        alignItems: "center",
                        cursor: "pointer",
                      }}
                    >
                      {isAccessionCopied ? <CheckIcon /> : <CopyIcon />}
                    </button>
                  </Tooltip>
                </Flex>
              </DbBadge>
              {isGsaAccession &&
                (project.bioproject_id ? (
                  <Badge
                    size={{ initial: "2", md: "3" }}
                    color="tomato"
                    variant="soft"
                    style={{ whiteSpace: "nowrap" }}
                    className="seqout-accession"
                  >
                    <Flex align="center" gap="1">
                      <Text>{project.bioproject_id}</Text>
                      <Tooltip content="Copy BioProject ID">
                        <button
                          type="button"
                          onClick={handleCopyBioproject}
                          aria-label="Copy BioProject ID"
                          style={{
                            border: "none",
                            background: "transparent",
                            color: "inherit",
                            padding: 0,
                            margin: 0,
                            display: "inline-flex",
                            alignItems: "center",
                            cursor: "pointer",
                          }}
                        >
                          {isBioprojectCopied ? <CheckIcon /> : <CopyIcon />}
                        </button>
                      </Tooltip>
                    </Flex>
                  </Badge>
                ) : (
                  <Badge
                    size={{ initial: "2", md: "3" }}
                    color="tomato"
                    variant="soft"
                  >
                    GSA
                  </Badge>
                ))}
              {project.alias?.startsWith("P") && (
                <BioProjectBadge accession={project.alias} />
              )}
              {project.alias?.startsWith("G") && (
                <a href={`/p/${project.alias}`}>
                  <Badge
                    size={{ initial: "2", md: "3" }}
                    style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                    className="seqout-accession"
                  >
                    {project.alias}
                    <EnterIcon />
                  </Badge>
                </a>
              )}
              {externalIds
                .filter((entry) => entry.value !== project.alias)
                .map((entry) => {
                  const keyLower = entry.key.toLowerCase();
                  const value = entry.value;
                  if (keyLower === "bioproject") {
                    return (
                      <BioProjectBadge key={`${entry.key}:${value}`} accession={value} />
                    );
                  }
                  if (keyLower === "biosample") {
                    return (
                      <a
                        key={`${entry.key}:${value}`}
                        href={`https://www.ncbi.nlm.nih.gov/biosample/${value}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Badge
                          size={{ initial: "2", md: "3" }}
                          color="gray"
                          style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                          className="seqout-accession"
                        >
                          {value}
                          <ExternalLinkIcon />
                        </Badge>
                      </a>
                    );
                  }
                  if (
                    keyLower === "geo" ||
                    keyLower === "sra" ||
                    /^(GSE|[SED]RP)\d+$/.test(value)
                  ) {
                    return (
                      <a key={`${entry.key}:${value}`} href={`/p/${value}`}>
                        <Badge
                          size={{ initial: "2", md: "3" }}
                          style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                          className="seqout-accession"
                        >
                          {value}
                          <EnterIcon />
                        </Badge>
                      </a>
                    );
                  }

                  return (
                    <Badge
                      key={`${entry.key}:${value}`}
                      size={{ initial: "2", md: "3" }}
                      color="gray"
                      style={{ whiteSpace: "nowrap" }}
                      className="seqout-accession"
                    >
                      {entry.key}: {value}
                    </Badge>
                  );
                })}
              <a
                href={externalStudyUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <DbBadge
                  size={{ initial: "2", md: "3" }}
                  db={externalStudyDb}
                  style={{ whiteSpace: "nowrap" }}
                >
                  {externalStudyLabel} <ExternalLinkIcon />
                </DbBadge>
              </a>
            </Flex>
            <Flex align={"center"} gap={"2"}>
              <InfoCircledIcon />
              <Text color="gray">
                Last updated on{" "}
                {project.updated_at
                  ? new Date(project.updated_at).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })
                  : "N/A"}
              </Text>
            </Flex>
            {projectAuthors.length > 0 &&
              projectAuthors.join(", ") !== project?.center_name && (
                <Flex align="start" gap="2" style={{ minWidth: 0 }}>
                  <PersonIcon style={{ flexShrink: 0, marginTop: "0.125rem" }} />
                  <ProjectAuthors
                    authors={projectAuthors}
                    centerName={project?.center_name}
                  />
                </Flex>
              )}
            {headerCenter && (
              <Flex align="baseline" gap="2">
                <SewingPinIcon
                  style={{ flexShrink: 0, marginTop: "0.125rem" }}
                />
                <Text style={{ color: "var(--gray-11)" }}>
                  {headerCenter.label}
                </Text>
                {headerCenter.countryCode && (
                  <CountryFlagIcon
                    code={headerCenter.countryCode}
                    label={headerCenter.label}
                  />
                )}
              </Flex>
            )}
            {projectOrganisms.length > 0 && (
              <Flex align="start" gap="2" wrap="wrap">
                <Text size="2" color="gray" style={{ flexShrink: 0 }}>
                  {projectOrganisms.length === 1 ? "Organism:" : "Organisms:"}
                </Text>
                <Flex gap="2" align="center" wrap="wrap">
                  {projectOrganisms.map((name) => (
                    <Badge
                      key={name}
                      size="2"
                      color="green"
                      variant="soft"
                      style={{ fontStyle: "italic" }}
                    >
                      {name}
                    </Badge>
                  ))}
                </Flex>
              </Flex>
            )}
            <ProjectSummary
              text={project.abstract}
              charLimit={ABSTRACT_CHAR_LIMIT}
            />
            {/* ENA/DDBJ study hierarchy: parent umbrella / child studies. */}
            <StudyHierarchy project={project} />
            {/* Experiments (Original) + AI Enriched metadata, merged via tabs */}
            <MetadataTableTabs
              accession={accession}
              sectionId="experiments"
              sectionTitle="Experiments"
              hasEnriched={project?.has_enriched}
              titleBadge={
                <Badge style={{ whiteSpace: "nowrap" }}>
                  {isExperimentsLoading
                    ? "Loading..."
                    : experiments && experiments.length < experimentsTotal
                      ? `Showing first ${experiments.length.toLocaleString()} of ${experimentsTotal.toLocaleString()} experiments`
                      : formatExperimentCount(experimentsTotal)}
                </Badge>
              }
              onExportOriginalCsv={() => {
                if (!experiments || !samplesMap) return;
                const baseHeaders = [
                  "Accession",
                  "Title",
                  "Strategy",
                  "Library Name",
                  "Layout",
                  "Platform",
                  "Instrument",
                  "Sample",
                  "Sample Alias",
                  "Sample Title",
                  "Description",
                  "Scientific Name",
                  "Taxon ID",
                ];
                const allHeaders = baseHeaders.concat(attributeKeys);
                const rows = experiments.map((e) => {
                  const sampleAcc = e.samples[0];
                  const sample =
                    sampleAcc && samplesMap ? samplesMap.get(sampleAcc) : null;
                  const baseRow = [
                    e.accession,
                    e.title ?? "-",
                    e.library_strategy ?? "-",
                    e.library_name ?? "-",
                    e.library_layout ?? "-",
                    e.platform ?? "-",
                    e.instrument_model ?? "-",
                    sampleAcc ?? "-",
                    sample?.alias ?? "-",
                    sample?.title ?? "-",
                    sample?.description ?? "-",
                    sample?.scientific_name ?? "-",
                    sample?.taxon_id ?? "-",
                  ];
                  const attrRow = attributeKeys.map(
                    (key) => sample?.attributes_json?.[key] ?? "-",
                  );
                  return [...baseRow, ...attrRow];
                });
                const escape = (val: string) =>
                  `"${String(val).replace(/"/g, '""')}"`;
                const csv = [
                  allHeaders.map(escape).join(","),
                  ...rows.map((row) => row.map(escape).join(",")),
                ].join("\n");
                const blob = new Blob([csv], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${accession}_experiments.csv`;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                }, 0);
              }}
              originalContent={
                <Flex
                  align="start"
                  gap="2"
                  direction="column"
                  style={{ width: "100%" }}
                >
                  {isExperimentsLoading && (
                    <Flex gap="2" align="center">
                      <Spinner size="2" />
                      <Text size="2">Loading experiments...</Text>
                    </Flex>
                  )}
                  {isExperimentsError && (
                    <Text color="red">Failed to load experiments</Text>
                  )}
                  {!isExperimentsLoading &&
                    experiments &&
                    experiments.length === 0 && (
                      <Text size="2" color="gray">
                        No experiments found
                      </Text>
                    )}
                  {!isExperimentsLoading &&
                    experiments &&
                    experiments.length > 0 && (
                      <>
                        {highlightOrganism && (
                          <Callout.Root size={"1"}>
                            <Callout.Icon>
                              <InfoCircledIcon />
                            </Callout.Icon>
                            <Callout.Text>
                              Showing{" "}
                              <Text
                                weight="medium"
                                style={{ fontStyle: "italic" }}
                              >
                                {highlightOrganism}
                              </Text>{" "}
                              samples first
                            </Callout.Text>
                          </Callout.Root>
                        )}
                        <div
                          className={agGridThemeClassName}
                          style={{
                            width: "100%",
                            height: `${experimentsGridHeight}px`,
                          }}
                        >
                          <AgGridReact<ExperimentGridRow>
                            columnDefs={visibleExperimentColumnDefs}
                            defaultColDef={experimentsGridDefaultColDef}
                            enableCellTextSelection
                            ensureDomOrder
                            getRowId={(params) => params.data.rowKey}
                            rowData={experimentRows}
                            theme="legacy"
                            getRowStyle={organismRowStyle}
                            postSortRows={organismPostSort}
                            onBodyScroll={infiniteScrollOnBodyScroll({
                              loadedCount: experimentRows.length,
                              hasNextPage: experimentsQuery.hasNextPage,
                              isFetchingNextPage:
                                experimentsQuery.isFetchingNextPage,
                              fetchNextPage: experimentsQuery.fetchNextPage,
                            })}
                          />
                        </div>
                        {experimentsQuery.isFetchingNextPage && (
                          <Flex gap="2" align="center">
                            <Spinner size="1" />
                            <Text size="2" color="gray">
                              Loading more experiments...
                            </Text>
                          </Flex>
                        )}
                      </>
                    )}
                </Flex>
              }
            />
            {publications && publications.length > 0 && (
              <>
                <Flex id="publications" align="center" gap="2">
                  <Heading as="h2" weight="medium" size="6">
                    Linked publications
                  </Heading>
                  <SectionAnchor id="publications" />
                </Flex>

                <Flex direction="column" gap="3">
                  {publications.map((pub) => (
                    <PublicationCard
                      key={pub.pmid ?? pub.doi ?? pub.title}
                      publication={pub}
                      accession={accession}
                    />
                  ))}
                </Flex>
              </>
            )}
            {linkedGeoProjects?.map(({ accession: geoAccession, project }) => (
              <SupplementaryDataSection
                key={`linked-geo-supplementary-${geoAccession}`}
                accession={geoAccession}
                rawSupplementaryData={project?.supplementary_data}
                agGridThemeClassName={agGridThemeClassName}
                title={`Supplementary Data (${geoAccession})`}
              />
            ))}

            {runsData && runsData.total_runs > 0 && (
              <DownloadFastqSection
                accession={accession}
                runsData={runsData}
                agGridThemeClassName={agGridThemeClassName}
                expTitleMap={expTitleMap}
              />
            )}

            {bamsData && bamsData.total_bams > 0 && (
              <BamFilesSection
                accession={accession}
                bamsData={bamsData}
                agGridThemeClassName={agGridThemeClassName}
                expTitleMap={expTitleMap}
              />
            )}

            {/* GSA has no similarity embeddings, so the graph would be empty. */}
            {!isGsaAccession && (
              <>
                <Flex id="similar" align="center" gap="2">
                  <Heading as="h2" weight="medium" size="6">
                    Similar projects
                  </Heading>
                  <SectionAnchor id="similar" />
                </Flex>
                <LazyMount>
                  <SimilarProjectsGraph
                    accession={project.accession}
                    source="sra"
                    title={project.title}
                    description={project.abstract}
                    organisms={project.organisms}
                    coords2d={project.coords_2d}
                    coords3d={project.coords_3d}
                    neighbors={project.neighbors}
                  />
                </LazyMount>
              </>
            )}
            <LazyMount>
              <SubmittingOrgPanel center={project.center} />
            </LazyMount>
          </Flex>
        </>
      )}
    </>
  );
}
