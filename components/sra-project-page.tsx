"use client";
import ProjectSummary from "@/components/project-summary";
import PublicationCard, {
  StudyPublication,
} from "@/components/publication-card";
import SearchBar from "@/components/search-bar";
import SimilarProjectsGraph, {
  SimilarNeighbor,
} from "@/components/similar-projects-graph";
import SubmittingOrgPanel, {
  CenterInfo,
} from "@/components/submitting-org-panel";
import EnrichedMetadataCard from "@/components/enriched-metadata-card";
import SectionAnchor from "@/components/section-anchor";
import TextWithLineBreaks from "@/components/text-with-line-breaks";
import { ensureAgGridModules } from "@/lib/ag-grid";
import { copyToClipboard } from "@/utils/clipboard";
import { SERVER_URL } from "@/utils/constants";
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  EnterIcon,
  ExternalLinkIcon,
  HomeIcon,
  InfoCircledIcon,
} from "@radix-ui/react-icons";
import {
  Badge,
  Button,
  Flex,
  Link,
  Select,
  Spinner,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";
import type {
  ColDef,
  GridApi,
  ICellRendererParams,
  ValueGetterParams,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useTheme } from "next-themes";
import Image from "next/image";
import { useParams } from "next/navigation";
import React, { useCallback, useRef, useState } from "react";

ensureAgGridModules();

type Project = {
  accession: string;
  alias: string | null;
  title: string;
  abstract: string;
  organisms?: string[] | string | null;
  coords_2d?: number[] | null;
  coords_3d?: number[] | null;
  neighbors?: SimilarNeighbor[] | null;
  submission: string;
  study_type: string;
  updated_at: Date;
  external_id?: Record<string, string> | string | null;
  links?: unknown;
  center?: CenterInfo | null;
  publications?: StudyPublication[] | null;
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
  title: string | null;
  library: string | null;
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

const getBestCloudUrl = (run: RunRow): string =>
  run.ncbi_sra_normalized_url ||
  run.ncbi_sra_lite_url ||
  run.ncbi_sra_url ||
  run.ncbi_sra_url_aws ||
  "";


const toDisplayText = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
};

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(val < 10 ? 1 : 0)} ${units[i]}`;
};

const fetchProject = async (
  accession: string | null,
): Promise<Project | null> => {
  if (!accession) return null;

  const res = await fetch(`${SERVER_URL}/project/${accession}`);
  if (!res.ok) throw new Error("Network error");

  const data = (await res.json()) as Project & {
    neighbors?: SimilarNeighbor[] | string | null;
  };
  if (data && typeof data.external_id === "string") {
    try {
      data.external_id = JSON.parse(data.external_id) as Record<string, string>;
    } catch {
      data.external_id = null;
    }
  }
  if (data && typeof data.links === "string") {
    try {
      data.links = JSON.parse(data.links) as Record<string, unknown>;
    } catch {
      data.links = null;
    }
  }
  if (data && typeof data.neighbors === "string") {
    try {
      data.neighbors = JSON.parse(data.neighbors) as SimilarNeighbor[];
    } catch {
      data.neighbors = null;
    }
  }
  if (data && typeof data.organisms === "string") {
    const organismText = data.organisms;
    try {
      data.organisms = JSON.parse(organismText) as string[];
    } catch {
      data.organisms = organismText
        .split(/[;,|]/)
        .map((item: string) => item.trim())
        .filter((item: string) => item.length > 0);
    }
  }

  const alias = data?.alias?.trim().toUpperCase();
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
): Promise<Experiment[]> => {
  if (!accession) return [];
  const res = await fetch(`${SERVER_URL}/project/${accession}/experiments`);
  if (!res.ok) throw new Error("Network error");
  return (await res.json()) as Experiment[];
};

const fetchSample = async (accession: string): Promise<Sample | null> => {
  const res = await fetch(`${SERVER_URL}/sample/${accession}`);
  if (!res.ok) return null;

  const s = (await res.json()) as Sample | { attributes_json: unknown };
  if (typeof s.attributes_json === "string") {
    try {
      s.attributes_json = JSON.parse(s.attributes_json);
    } catch {
      s.attributes_json = null;
    }
  }
  return s as Sample;
};

const fetchSamplesForExperiments = async (
  experiments: Experiment[],
): Promise<Map<string, Sample>> => {
  const sampleAccessions = experiments
    .map((exp) => exp.samples[0])
    .filter(Boolean);
  const samples = await Promise.all(
    sampleAccessions.map((acc) => fetchSample(acc)),
  );
  const sampleMap = new Map<string, Sample>();
  samples.forEach((s) => {
    if (s) sampleMap.set(s.accession, s);
  });
  return sampleMap;
};

const fetchRuns = async (
  accession: string | null,
): Promise<RunsData | null> => {
  if (!accession) return null;
  const res = await fetch(`${SERVER_URL}/project/${accession}/runs`);
  if (!res.ok) return null;
  return (await res.json()) as RunsData;
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

function DownloadFastqSection({
  accession,
  runsData,
  agGridThemeClassName,
  experiments,
}: {
  accession: string;
  runsData: RunsData;
  agGridThemeClassName: string;
  experiments?: Experiment[] | null;
}) {
  const [copied, setCopied] = useState(false);
  const [scriptCopied, setScriptCopied] = useState(false);
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

  React.useEffect(() => {
    if (!availableSources.has(selectedSource)) {
      const first = (
        Object.keys(DOWNLOAD_SOURCE_LABELS) as DownloadSource[]
      ).find((s) => availableSources.has(s));
      if (first) setSelectedSource(first);
    }
  }, [availableSources, selectedSource]);

  const expTitleMap = React.useMemo(() => {
    const map = new Map<string, string>();
    if (experiments) {
      for (const exp of experiments) {
        if (exp.title) map.set(exp.accession, exp.title);
      }
    }
    return map;
  }, [experiments]);

  const onGridReady = useCallback((params: { api: GridApi<RunRow> }) => {
    gridRef.current = params.api;
  }, []);

  const onSelectionChanged = useCallback(() => {
    const selected = gridRef.current?.getSelectedRows() ?? [];
    setSelectedCount(selected.length);
  }, []);

  const getDownloadRows = (): RunRow[] => {
    const selected = gridRef.current?.getSelectedRows() ?? [];
    return selected.length > 0 ? selected : runsData.runs;
  };

  const buildTsvContent = (runs: RunRow[]): string => {
    const header =
      "run_accession\texperiment_accession\tlibrary_layout\t" +
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
            run.experiment_accession || "",
            run.library_layout || "",
            `https://${url}`,
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
  };

  const resolveRunUrls = (
    run: RunRow,
    source: DownloadSource,
  ): ResolvedEntry[] => {
    const dirpath = `${accession}/${run.experiment_accession || "unknown"}/${run.run_accession}`;
    const sraMd5 = run.sra_md5 || "";

    if (source === "fastq") {
      const ftps = run.fastq_ftp
        ? run.fastq_ftp.split(";").filter(Boolean)
        : [];
      if (ftps.length > 0) {
        const md5s = run.fastq_md5
          ? run.fastq_md5.split(";").filter(Boolean)
          : [];
        return ftps.map((ftp, i) => {
          const filename = ftp.split("/").pop() || ftp;
          return { url: `https://${ftp}`, filename, dirpath, md5: md5s[i] || "" };
        });
      }
      // Fall through to best cloud URL if no FASTQ available
      const fallback = getBestCloudUrl(run);
      if (fallback) {
        const filename = fallback.split("/").pop() || run.run_accession;
        return [{ url: fallback, filename, dirpath, md5: sraMd5 }];
      }
      return [];
    }

    const urlMap: Record<Exclude<DownloadSource, "fastq">, string | null> = {
      sra: run.ncbi_sra_normalized_url,
      sra_lite: run.ncbi_sra_lite_url,
      s3: run.ncbi_sra_lite_s3_url,
      gcs: run.ncbi_sra_lite_gs_url,
    };
    const url = urlMap[source];
    if (!url) return [];
    const filename = url.split("/").pop() || run.run_accession;
    return [{ url, filename, dirpath, md5: sraMd5 }];
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
    let downloadCmd: (u: Entry) => string;
    if (source === "s3") {
      downloadCmd = (u) =>
        `mkdir -p "${u.dirpath}" && aws s3 cp "${u.url}" "${u.dirpath}/${u.filename}"`;
    } else if (source === "gcs") {
      downloadCmd = (u) =>
        `mkdir -p "${u.dirpath}" && gsutil cp "${u.url}" "${u.dirpath}/${u.filename}"`;
    } else {
      downloadCmd = (u) =>
        `mkdir -p "${u.dirpath}" && wget -q --show-progress -O "${u.dirpath}/${u.filename}" "${u.url}"`;
    }

    const sourceLabel = DOWNLOAD_SOURCE_LABELS[source];
    const checksums = entries
      .filter((u) => u.md5)
      .map((u) => `${u.md5}  ${u.dirpath}/${u.filename}`);

    const lines = [
      "#!/usr/bin/env bash",
      `# Download ${sourceLabel.split(" (")[0]} for ${accession}${selectedCount > 0 ? ` (${selectedCount} selected runs)` : ""}`,
      `# ${entries.length} files from ${runs.length} runs${totalBytes > 0 ? ` · ${formatBytes(totalBytes)}` : ""}`,
      "# Generated by seqout.org",
      "",
      "set -euo pipefail",
      "",
      "# Download metadata",
      `curl -sS "https://seqout.org/api/project/${accession}/metadata/download" -o "${accession}/metadata.csv" --create-dirs`,
      "",
      ...entries.map(downloadCmd),
      "",
      `echo "Done. Files saved under ./${accession}/"`,
    ];

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

  const apiBase = SERVER_URL.startsWith("http")
    ? SERVER_URL
    : typeof window !== "undefined"
      ? `${window.location.origin}${SERVER_URL}`
      : SERVER_URL;
  // TSV columns: 1=run 2=exp 3=layout 4=fastq_url 5=fastq_bytes 6=fastq_md5
  //   7=sra_lite_url 8=sra_lite_bytes 9=sra_url 10=sra_bytes 11=s3_url 12=gs_url 13=filename 14=directory_path
  // awk picks best URL: fastq($4) → sra($9) → sra_lite($7) → s3($11)
  const wgetCmd = `curl -sS "${apiBase}/project/${accession}/runs/download" | tail -n +2 | awk -F'\\t' '{u=$4; if(u=="") u=$9; if(u=="") u=$7; if(u=="") u=$11; if(u!="") print u}' | xargs -P4 -I{} wget -q --show-progress -x -nH --cut-dirs=6 "{}"`;

  const copyCommand = () => {
    copyToClipboard(wgetCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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
          if (urls.length > 0) {
            return (
              <Flex direction="column" gap="1" py="1">
                {urls.map((ftp, i) => {
                  const filename = ftp.split("/").pop() || ftp;
                  const size = parseInt(bytes[i], 10) || 0;
                  return (
                    <Flex key={ftp} align="center" gap="2">
                      <Link
                        href={`https://${ftp}`}
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
                    url: row.sra_ftp.startsWith("ftp://")
                      ? row.sra_ftp
                      : `https://${row.sra_ftp}`,
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
    () => ({ filter: true, resizable: true, sortable: true }),
    [],
  );

  const downloadLabel =
    selectedCount > 0 ? `Download ${selectedCount} selected` : "Download all";

  return (
    <>
      <Flex id="fastq" justify="between" align="center">
        <Flex align="center" gap="2">
          <Text weight="medium" size="6">
            FASTQ files
          </Text>
          <SectionAnchor id="fastq" />
          <Badge size={{ initial: "2", md: "3" }} color="gray">
            {runsData.total_runs.toLocaleString()} runs
          </Badge>
        </Flex>
      </Flex>

      <Flex gap="3" justify={"between"} wrap="wrap">
        <Flex gap={"2"}>
          <Badge size={{ initial: "2", md: "3" }} color="blue" variant="soft">
            {runsData.paired_runs > 0 &&
              `${runsData.paired_runs.toLocaleString()} paired-end`}
            {runsData.paired_runs > 0 && runsData.single_runs > 0 && " · "}
            {runsData.single_runs > 0 &&
              `${runsData.single_runs.toLocaleString()} single-end`}
          </Badge>
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

        <Flex gap="2">
          <Button size="1" variant="surface" onClick={downloadTsv}>
            <DownloadIcon /> {downloadLabel} (TSV)
          </Button>
          <Select.Root
            size="1"
            value={selectedSource}
            onValueChange={(v) => setSelectedSource(v as DownloadSource)}
          >
            <Select.Trigger variant="surface" />
            <Select.Content>
              {(
                Object.keys(DOWNLOAD_SOURCE_LABELS) as DownloadSource[]
              )
                .filter((src) => availableSources.has(src))
                .map((src) => (
                  <Select.Item key={src} value={src}>
                    {DOWNLOAD_SOURCE_LABELS[src]}
                  </Select.Item>
                ))}
            </Select.Content>
          </Select.Root>
          <Button
            size="1"
            variant="surface"
            onClick={() => {
              const script = buildDownloadScript(
                getDownloadRows(),
                selectedSource,
              );
              if (!script) return;
              copyToClipboard(script);
              setScriptCopied(true);
              setTimeout(() => setScriptCopied(false), 1500);
            }}
          >
            {scriptCopied ? <CheckIcon /> : <CopyIcon />}{" "}
            {scriptCopied ? "Copied!" : "Copy script"}
          </Button>
        </Flex>
      </Flex>

      <div
        className={agGridThemeClassName}
        style={{ width: "100%", height: "400px" }}
      >
        <AgGridReact<RunRow>
          columnDefs={runColDefs}
          defaultColDef={defaultColDef}
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

export default function ProjectPage() {
  const params = useParams();
  const { resolvedTheme } = useTheme();
  const accession = params.accession as string | undefined;
  const accessionUpper = accession?.toUpperCase();
  const isArrayExpressAccession = accessionUpper?.startsWith("E-") ?? false;
  const isPrjAccession = accessionUpper?.startsWith("PRJ") ?? false;
  const externalStudyUrl =
    accession && isPrjAccession
      ? `https://www.ebi.ac.uk/ena/browser/view/${accession}`
      : `https://trace.ncbi.nlm.nih.gov/Traces/?view=study&acc=${accession}`;
  const externalStudyLabel = isPrjAccession
    ? "Visit ENA page"
    : "Visit SRA page";
  const [isAccessionCopied, setIsAccessionCopied] = useState(false);
  const agGridThemeClassName =
    resolvedTheme === "dark" ? "ag-theme-quartz-dark" : "ag-theme-quartz";

  const {
    data: project,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["project", accession],
    queryFn: () => fetchProject(accession ?? null),
    enabled: !!accession,
  });

  const {
    data: experiments,
    isLoading: isExperimentsLoading,
    isError: isExperimentsError,
  } = useQuery({
    queryKey: ["project-experiments", accession],
    queryFn: () => fetchExperiments(accession ?? null),
    enabled: !!accession,
  });

  const { data: samplesMap } = useQuery({
    queryKey: ["project-samples", accession],
    queryFn: () => fetchSamplesForExperiments(experiments!),
    enabled: !!experiments && experiments.length > 0,
  });

  const { data: runsData } = useQuery({
    queryKey: ["project-runs", accession],
    queryFn: () => fetchRuns(accession ?? null),
    enabled: !!accession,
  });

  const externalIds = React.useMemo(
    () => normalizeExternalIds(project?.external_id),
    [project?.external_id],
  );

  const publications = project?.publications ?? null;

  const handleCopyAccession = () => {
    if (!accession) return;
    copyToClipboard(accession);
    setIsAccessionCopied(true);
    window.setTimeout(() => setIsAccessionCopied(false), 1500);
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
        title: experiment.title,
        library: experiment.library_name ?? experiment.library_strategy,
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
    return Math.min(maxHeight, headerHeight + experimentRows.length * rowHeight);
  }, [experimentRows.length]);

  const experimentsGridDefaultColDef = React.useMemo<ColDef<ExperimentGridRow>>(
    () => ({
      filter: true,
      resizable: true,
      sortable: true,
    }),
    [],
  );

  const experimentColumnDefs = React.useMemo<ColDef<ExperimentGridRow>[]>(
    () => [
      {
        headerName: "Accession",
        field: "accession",
        minWidth: 140,
        pinned: "left",
        cellRenderer: (params: ICellRendererParams<ExperimentGridRow>) => {
          const experimentAccession = toDisplayText(params.value);
          if (experimentAccession === "-") return "-";
          return (
            <Link
              href={`https://www.ncbi.nlm.nih.gov/sra/${experimentAccession}[accn]`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {experimentAccession}
            </Link>
          );
        },
      },
      {
        headerName: "Title",
        field: "title",
        minWidth: 220,
        valueFormatter: (params) => toDisplayText(params.value),
      },
      {
        headerName: "Library",
        field: "library",
        minWidth: 140,
        valueFormatter: (params) => toDisplayText(params.value),
      },
      {
        headerName: "Layout",
        field: "layout",
        minWidth: 120,
        valueFormatter: (params) => toDisplayText(params.value),
      },
      {
        headerName: "Platform",
        field: "platform",
        minWidth: 130,
        valueFormatter: (params) => toDisplayText(params.value),
      },
      {
        headerName: "Instrument",
        field: "instrument",
        minWidth: 150,
        valueFormatter: (params) => toDisplayText(params.value),
      },
      {
        headerName: "Sample",
        field: "sample",
        minWidth: 130,
        cellRenderer: (params: ICellRendererParams<ExperimentGridRow>) => {
          const sampleAccession = toDisplayText(params.value);
          if (sampleAccession === "-") return "-";
          if (
            sampleAccession.startsWith("SRS") ||
            sampleAccession.startsWith("ERS") ||
            sampleAccession.startsWith("DRS")
          ) {
            return (
              <Link
                href={`https://www.ncbi.nlm.nih.gov/sra/${sampleAccession}[accn]`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {sampleAccession}
              </Link>
            );
          }
          return <span>{sampleAccession}</span>;
        },
      },
      {
        headerName: "Sample Alias",
        field: "sampleAlias",
        minWidth: 150,
        cellRenderer: (params: ICellRendererParams<ExperimentGridRow>) => {
          const sampleAlias = toDisplayText(params.value);
          if (sampleAlias === "-") return "-";
          if (sampleAlias.startsWith("GSM")) {
            return (
              <Link
                href={`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${sampleAlias}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {sampleAlias}
              </Link>
            );
          }
          if (sampleAlias.startsWith("SAM")) {
            return (
              <Link
                href={`https://www.ncbi.nlm.nih.gov/biosample/${sampleAlias}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {sampleAlias}
              </Link>
            );
          }
          return <span>{sampleAlias}</span>;
        },
      },
      {
        headerName: "Sample Title",
        field: "sampleTitle",
        minWidth: 220,
        valueFormatter: (params) => toDisplayText(params.value),
      },
      {
        headerName: "Description",
        field: "description",
        minWidth: 240,
        autoHeight: true,
        wrapText: true,
        cellRenderer: (params: ICellRendererParams<ExperimentGridRow>) => {
          const value = toDisplayText(params.value);
          if (value === "-") return "-";
          return <TextWithLineBreaks text={value} />;
        },
      },
      {
        headerName: "Scientific Name",
        field: "scientificName",
        minWidth: 200,
        valueFormatter: (params) => toDisplayText(params.value),
      },
      {
        headerName: "Taxon ID",
        field: "taxonId",
        minWidth: 120,
        valueFormatter: (params) => toDisplayText(params.value),
      },
      ...attributeKeys.map(
        (key): ColDef<ExperimentGridRow> => ({
          headerName: key,
          minWidth: 170,
          valueGetter: (params: ValueGetterParams<ExperimentGridRow>) =>
            params.data?.attributes[key] ?? "-",
        }),
      ),
    ],
    [attributeKeys],
  );

  return (
    <>
      <SearchBar initialQuery={""} />

      {!accession && (
        <Flex
          gap="4"
          align="center"
          p={"4"}
          ml={{ initial: "0", md: "8rem" }}
          mr={{ md: "16rem" }}
          justify="center"
          direction={"column"}
        >
          <Text size={"4"} weight={"bold"} color="gray" align={"center"}>
            No project selected 🤷
          </Text>
          <Button
            variant="surface"
            onClick={() => (window.location.href = "/")}
          >
            <HomeIcon /> Go back
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
          <Text>Getting metadata</Text>
        </Flex>
      )}

      {accession && isError && (
        <Flex
          gap="2"
          align="center"
          justify="center"
          height={"20rem"}
          direction={"column"}
        >
          <Image
            draggable={"false"}
            src="/empty-box.svg"
            alt="empty box"
            width={100}
            height={100}
          />
          <Text color="gray" size={"6"} weight={"bold"}>
            Could not find project
          </Text>
          <Text color="gray" size={"2"}>
            Check your network connection or query
          </Text>
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
              <Text size={{ initial: "4", md: "6" }} weight="bold">
                {project.title}
              </Text>
            </Flex>
            <Flex justify="start" align={"center"} gap="2" wrap={"wrap"}>
              <Badge
                size={{ initial: "2", md: "3" }}
                color={
                  isPrjAccession
                    ? undefined
                    : isArrayExpressAccession
                      ? "gold"
                      : "brown"
                }
                variant={isArrayExpressAccession || isPrjAccession ? "solid" : undefined}
                style={
                  isPrjAccession
                    ? {
                        whiteSpace: "nowrap",
                        backgroundColor: "#6bb4b5",
                        color: "white",
                      }
                    : { whiteSpace: "nowrap" }
                }
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
              </Badge>
              <Badge
                size={{ initial: "2", md: "3" }}
                color="gray"
                style={{ whiteSpace: "nowrap" }}
              >
                {isExperimentsLoading
                  ? "Loading..."
                  : experiments
                    ? `${experiments.length} Experiments`
                    : "0 Experiments"}
              </Badge>
              {project.alias?.startsWith("P") && (
                <a
                  href={`https://www.ncbi.nlm.nih.gov/bioproject/${project.alias}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Badge
                    size={{ initial: "2", md: "3" }}
                    color="green"
                    style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                  >
                    {project.alias}
                    <ExternalLinkIcon />
                  </Badge>
                </a>
              )}
              {project.alias?.startsWith("G") && (
                <a href={`/p/${project.alias}`}>
                  <Badge
                    size={{ initial: "2", md: "3" }}
                    style={{ cursor: "pointer", whiteSpace: "nowrap" }}
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
                      <a
                        key={`${entry.key}:${value}`}
                        href={`https://www.ncbi.nlm.nih.gov/bioproject/${value}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Badge
                          size={{ initial: "2", md: "3" }}
                          color="green"
                          style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                        >
                          {value}
                          <ExternalLinkIcon />
                        </Badge>
                      </a>
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
                        >
                          {value}
                          <ExternalLinkIcon />
                        </Badge>
                      </a>
                    );
                  }
                  if (keyLower === "geo" || value.startsWith("GSE")) {
                    return (
                      <a key={`${entry.key}:${value}`} href={`/p/${value}`}>
                        <Badge
                          size={{ initial: "2", md: "3" }}
                          style={{ cursor: "pointer", whiteSpace: "nowrap" }}
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
                <Badge
                  size={{ initial: "2", md: "3" }}
                  color="sky"
                  style={{ whiteSpace: "nowrap" }}
                >
                  {externalStudyLabel} <ExternalLinkIcon />
                </Badge>
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
            <ProjectSummary
              text={project.abstract}
              charLimit={ABSTRACT_CHAR_LIMIT}
            />
            <Flex id="experiments" justify={"between"} align={"center"}>
              <Flex align="center" gap="2">
                <Text weight="medium" size="6">
                  Experiments
                </Text>
                <SectionAnchor id="experiments" />
              </Flex>
              <Button
                onClick={() => {
                  if (!experiments || !samplesMap) return;
                  const baseHeaders = [
                    "Accession",
                    "Title",
                    "Library",
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
                      sampleAcc && samplesMap
                        ? samplesMap.get(sampleAcc)
                        : null;
                    const baseRow = [
                      e.accession,
                      e.title ?? "-",
                      e.library_name ?? e.library_strategy ?? "-",
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
              >
                <DownloadIcon /> CSV
              </Button>
            </Flex>
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
                  <div
                    className={agGridThemeClassName}
                    style={{ width: "100%", height: `${experimentsGridHeight}px` }}
                  >
                    <AgGridReact<ExperimentGridRow>
                      columnDefs={experimentColumnDefs}
                      defaultColDef={experimentsGridDefaultColDef}
                      getRowId={(params) => params.data.rowKey}
                      rowData={experimentRows}
                      theme="legacy"
                    />
                  </div>
                )}
            </Flex>
            <EnrichedMetadataCard accession={accession} />

            <Flex id="publications" align="center" gap="2">
              <Text weight="medium" size="6">
                Linked publications
              </Text>
              <SectionAnchor id="publications" />
            </Flex>

            {publications && publications.length > 0 ? (
              <Flex direction="column" gap="3">
                {publications.map((pub) => (
                  <PublicationCard
                    key={pub.pmid ?? pub.doi ?? pub.title}
                    publication={pub}
                    accession={accession}
                  />
                ))}
              </Flex>
            ) : (
              <Text size="2" color="gray">
                No linked publications found
              </Text>
            )}
            <Flex id="similar" align="center" gap="2">
              <Text weight="medium" size="6">
                Similar projects
              </Text>
              <Badge color="teal" size={"2"}>
                Beta
              </Badge>
              <SectionAnchor id="similar" />
            </Flex>
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
            <SubmittingOrgPanel center={project.center} />

            {runsData && runsData.total_runs > 0 && (
              <DownloadFastqSection
                accession={accession}
                runsData={runsData}
                agGridThemeClassName={agGridThemeClassName}
                experiments={experiments}
              />
            )}
          </Flex>
        </>
      )}
    </>
  );
}
