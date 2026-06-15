"use client";
import CountryFlagIcon from "@/components/country-flag-icon";
import MetadataTableTabs from "@/components/metadata-table-tabs";
import ProjectSummary from "@/components/project-summary";
import PublicationCard, {
  StudyPublication,
} from "@/components/publication-card";
import SearchBar from "@/components/search-bar";
import SectionAnchor from "@/components/section-anchor";
import SimilarProjectsGraph, {
  SimilarNeighbor,
} from "@/components/similar-projects-graph";
import { DownloadFastqSection } from "@/components/sra-project-page";
import SubmittingOrgPanel, {
  CenterInfo,
} from "@/components/submitting-org-panel";
import { useToast } from "@/components/toast-provider";
import { ensureAgGridModules } from "@/lib/ag-grid";
import { getJson, getJsonOrNull } from "@/utils/api";
import { copyToClipboard } from "@/utils/clipboard";
import { buildCurlCommand, buildSupplementaryDownloadScript } from "@/utils/downloadScript";
import { titleCaseCenter } from "@/utils/format";
import {
  normalizeAuthors,
  parsePostgresTextArray,
  toDisplayText,
} from "@/utils/project";
import {
  getOrganismBannerStyle,
  makeOrganismPostSort,
  makeOrganismRowStyle,
} from "@/utils/organism-highlight";
import { useScrollSpy } from "@/utils/useScrollSpy";
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
  Dialog,
  Flex,
  Heading,
  Link,
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
import { useParams, useSearchParams } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";

ensureAgGridModules();

type Project = {
  accession: string;
  title: string;
  summary: string;
  overall_design: string;
  authors?: string[] | string | null;
  organisms?: string[] | string | null;
  coords_2d?: number[] | null;
  coords_3d?: number[] | null;
  neighbors?: SimilarNeighbor[] | null;
  alias?: string | string[] | null;
  pubmed_id: string[];
  samples_ref: string | null;
  series_type: string | null;
  relation: string | null;
  supplementary_data?: unknown;
  published_at: Date | null;
  updated_at: Date | null;
  center?: CenterInfo[] | null;
  center_name?: string | null;
  country_code?: string | null;
  publications?: StudyPublication[] | null;
};

type Characteristic = {
  "@tag": string;
  "#text": string;
};

type Channel = {
  Label: string | null;
  Source: string | null;
  Molecule: string | null;
  Organism: { "#text": string; "@taxid": string } | null;
  "@position": string | null;
  "Label-Protocol": string | null;
  "Extract-Protocol": string | null;
  Characteristics?: Characteristic[];
};

type GeoSample = {
  id?: string | number | null;
  accession: string;
  channel_count: number | null;
  channels: Channel[] | null;
  description: string | null;
  platform_ref: string | null;
  published_at: Date | null;
  updated_at: Date | null;
  supplementary_data: unknown[] | null;
  title: string | null;
  sample_type: string | null;
  hybridization_protocol: string | null;
  scan_protocol: string | null;
};

type GeoSampleGridRow = {
  rowKey: string;
  sample: string | null;
  title: string | null;
  description: string | null;
  channelCount: number | null;
  sampleType: string | null;
  platform: string | null;
  channelPosition: string | number | null;
  label: string | null;
  source: string | null;
  molecule: string | null;
  organism: string | null;
  labelProtocol: string | null;
  extractProtocol: string | null;
  hybridizationProtocol: string | null;
  scanProtocol: string | null;
  characteristics: Record<string, string>;
};

type SupplementaryDataRecord = {
  url: string;
  "@type": string | null;
  path: string | null;
  size: number | null;
};

type SupplementaryDataItem = {
  id: string;
  url: string;
  fileName: string;
  fileSizeBytes: number | null;
  fileSizeLabel: string | null;
  curlCommand: string;
  browserDownloadUrl: string;
  downloadUrl: string;
  sourceSampleAccession?: string | null;
};

type SampleSupplementaryGroupRow = {
  id: string;
  sampleAccession: string;
  items: SupplementaryDataItem[];
  fileCount: number;
  totalSizeBytes: number | null;
};

type LinkedRunsData = React.ComponentProps<
  typeof DownloadFastqSection
>["runsData"];

const normalizeAliases = (value: Project["alias"]): string[] => {
  if (!value) return [];

  const candidates = Array.isArray(value)
    ? value
    : (() => {
        const trimmed = value.trim();
        if (!trimmed) return [];

        try {
          const parsed = JSON.parse(trimmed) as unknown;
          if (Array.isArray(parsed)) {
            return parsed
              .filter((item): item is string => typeof item === "string")
              .map((item) => item.trim());
          }
        } catch {
          // fall through to postgres/text parsing
        }

        const postgresArrayItems = parsePostgresTextArray(trimmed);
        if (postgresArrayItems.length > 0) {
          return postgresArrayItems;
        }

        return [trimmed];
      })();

  const deduped = new Set<string>();
  candidates
    .map((alias) => alias.trim())
    .filter((alias) => alias.length > 0)
    .forEach((alias) => deduped.add(alias));
  return Array.from(deduped);
};

const SUPPLEMENTARY_PLACEHOLDER_VALUES = new Set([
  "NONE",
  "NULL",
  "N/A",
  "NA",
  "-",
  "",
]);

const isValidSupplementaryUrl = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (SUPPLEMENTARY_PLACEHOLDER_VALUES.has(trimmed.toUpperCase())) {
    return false;
  }
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
};

const normalizeSupplementaryRecord = (
  value: unknown,
): SupplementaryDataRecord | null => {
  if (!value) return null;

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const textValue =
      typeof record["#text"] === "string" ? record["#text"] : null;
    const urlValue = typeof record.url === "string" ? record.url : null;
    const resolvedUrl = textValue ?? urlValue;
    if (
      typeof resolvedUrl !== "string" ||
      !isValidSupplementaryUrl(resolvedUrl)
    ) {
      return null;
    }
    const rawType = record["@type"];
    const rawPath = record.path;
    const rawSize = record.size;
    return {
      url: resolvedUrl.trim(),
      "@type":
        typeof rawType === "string" && rawType.trim() ? rawType.trim() : null,
      path:
        typeof rawPath === "string" && rawPath.trim() ? rawPath.trim() : null,
      size:
        typeof rawSize === "number" && Number.isFinite(rawSize)
          ? rawSize
          : null,
    };
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    if (isValidSupplementaryUrl(trimmed)) {
      return { url: trimmed, "@type": null, path: null, size: null };
    }

    try {
      return normalizeSupplementaryRecord(JSON.parse(trimmed) as unknown);
    } catch {
      return null;
    }
  }

  return null;
};

const parseSupplementaryData = (
  rawValue: unknown,
): SupplementaryDataRecord[] => {
  if (!rawValue) {
    return [];
  }

  if (Array.isArray(rawValue)) {
    return rawValue
      .map((entry) => normalizeSupplementaryRecord(entry))
      .filter((entry): entry is SupplementaryDataRecord => entry !== null);
  }

  if (typeof rawValue === "string") {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      return [];
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map((entry) => normalizeSupplementaryRecord(entry))
          .filter((entry): entry is SupplementaryDataRecord => entry !== null);
      }
      const normalized = normalizeSupplementaryRecord(parsed);
      return normalized ? [normalized] : [];
    } catch {
      const postgresArrayItems = parsePostgresTextArray(trimmed);
      if (postgresArrayItems.length > 0) {
        return postgresArrayItems
          .map((entry) => normalizeSupplementaryRecord(entry))
          .filter((entry): entry is SupplementaryDataRecord => entry !== null);
      }
      const normalized = normalizeSupplementaryRecord(trimmed);
      return normalized ? [normalized] : [];
    }
  }

  const normalized = normalizeSupplementaryRecord(rawValue);
  return normalized ? [normalized] : [];
};

const getFileNameFromUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    const fileName = parsed.pathname.split("/").filter(Boolean).pop();
    return fileName ?? "supplementary_file";
  } catch {
    const fileName = url.split("/").filter(Boolean).pop();
    return fileName ?? "supplementary_file";
  }
};

const getBrowserDownloadUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "ftp:") {
      parsed.protocol = "https:";
      return parsed.toString();
    }
    return url;
  } catch {
    return url;
  }
};

const getAppDownloadUrl = (url: string, fileName: string): string =>
  `/web-api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(fileName)}`;

const INLINE_PREVIEW_EXTENSIONS = new Set([
  ".txt",
  ".tsv",
  ".csv",
  ".json",
  ".xml",
  ".html",
  ".htm",
  ".md",
  ".yaml",
  ".yml",
  ".log",
]);

const shouldUseProxyDownload = (url: string, fileName: string): boolean => {
  const normalizedName = fileName.toLowerCase();
  const nameMatch = normalizedName.match(/(\.[a-z0-9]+)$/);
  if (nameMatch) {
    return INLINE_PREVIEW_EXTENSIONS.has(nameMatch[1]);
  }

  const normalizedUrl = url.toLowerCase().split("?")[0].split("#")[0];
  const urlMatch = normalizedUrl.match(/(\.[a-z0-9]+)$/);
  return urlMatch ? INLINE_PREVIEW_EXTENSIONS.has(urlMatch[1]) : false;
};

const formatFileSize = (sizeInBytes: number | null): string | null => {
  if (
    sizeInBytes === null ||
    !Number.isFinite(sizeInBytes) ||
    sizeInBytes < 0
  ) {
    return null;
  }
  if (sizeInBytes < 1024) {
    return `${sizeInBytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = sizeInBytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const rounded = value >= 10 ? value.toFixed(0) : value.toFixed(1);
  return `${rounded} ${units[unitIndex]}`;
};

const buildSupplementaryItems = ({
  rawValue,
  idPrefix,
  sourceSampleAccession = null,
}: {
  rawValue: unknown;
  idPrefix: string;
  sourceSampleAccession?: string | null;
}): SupplementaryDataItem[] =>
  parseSupplementaryData(rawValue)
    .map((entry, index): SupplementaryDataItem | null => {
      const url = entry.url?.trim();
      if (!url) {
        return null;
      }
      const browserDownloadUrl = getBrowserDownloadUrl(url);
      const fileName = entry.path?.trim() || getFileNameFromUrl(url);
      return {
        id: `${idPrefix}-${index}`,
        url: browserDownloadUrl,
        fileName,
        fileSizeBytes: entry.size,
        fileSizeLabel: formatFileSize(entry.size),
        curlCommand: buildCurlCommand(browserDownloadUrl),
        browserDownloadUrl,
        downloadUrl: shouldUseProxyDownload(browserDownloadUrl, fileName)
          ? getAppDownloadUrl(browserDownloadUrl, fileName)
          : browserDownloadUrl,
        sourceSampleAccession,
      };
    })
    .filter((entry): entry is SupplementaryDataItem => entry !== null);

const fetchSamples = async (accession: string): Promise<GeoSample[]> =>
  getJson<GeoSample[]>(`/geo/series/${accession}/samples`);

const fetchProject = async (
  accession: string | null,
): Promise<Project | null> => {
  if (!accession) {
    return null;
  }

  const data = await getJson<
    Project & {
      neighbors?: SimilarNeighbor[] | string | null;
    }
  >(`/project/${accession}`);
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
  return data as Project;
};

const fetchLinkedRuns = async (
  accession: string | null,
): Promise<LinkedRunsData | null> => {
  if (!accession) return null;
  return getJsonOrNull<LinkedRunsData>(`/project/${accession}/runs`);
};

const SUMMARY_CHAR_LIMIT = 350;
const OVERALL_DESIGN_CHAR_LIMIT = 350;

export default function GeoProjectPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const highlightOrganism = searchParams.get("organism")?.toLowerCase() ?? null;
  const { resolvedTheme } = useTheme();
  const { showToast } = useToast();
  const accession = params.accession as string | undefined;
  const isArrayExpress = accession?.toUpperCase().startsWith("E-") ?? false;
  const [isAccessionCopied, setIsAccessionCopied] = useState(false);
  const [isDownloadingAllSupplementary, setIsDownloadingAllSupplementary] =
    useState(false);
  const [downloadAllProgressPercent, setDownloadAllProgressPercent] = useState<
    number | null
  >(null);
  const supplementaryGridRef =
    React.useRef<GridApi<SupplementaryDataItem> | null>(null);
  const [selectedSupplementaryCount, setSelectedSupplementaryCount] =
    useState(0);
  const [supplementaryScriptDialogOpen, setSupplementaryScriptDialogOpen] =
    useState(false);
  const [supplementaryScriptPreview, setSupplementaryScriptPreview] =
    useState("");
  const [supplementaryScriptCopied, setSupplementaryScriptCopied] =
    useState(false);
  const [
    isDownloadingAllSampleSupplementary,
    setIsDownloadingAllSampleSupplementary,
  ] = useState(false);
  const [
    sampleDownloadAllProgressPercent,
    setSampleDownloadAllProgressPercent,
  ] = useState<number | null>(null);
  const sampleSupplementaryGridRef =
    React.useRef<GridApi<SampleSupplementaryGroupRow> | null>(null);
  const [
    selectedSampleSupplementaryCount,
    setSelectedSampleSupplementaryCount,
  ] = useState(0);
  const [
    sampleSupplementaryScriptDialogOpen,
    setSampleSupplementaryScriptDialogOpen,
  ] = useState(false);
  const [
    sampleSupplementaryScriptPreview,
    setSampleSupplementaryScriptPreview,
  ] = useState("");
  const [sampleSupplementaryScriptCopied, setSampleSupplementaryScriptCopied] =
    useState(false);
  const isDark = resolvedTheme === "dark";
  const agGridThemeClassName = isDark
    ? "ag-theme-quartz-dark"
    : "ag-theme-quartz";

  useScrollSpy([
    "overall-design",
    "enriched",
    "samples",
    "publications",
    "fastq",
    "supplementary",
    "similar",
  ]);
  const organismRowStyle = useMemo(
    () =>
      makeOrganismRowStyle<GeoSampleGridRow>(
        highlightOrganism,
        isDark,
        (d) => d.organism ?? null,
      ),
    [highlightOrganism, isDark],
  );
  const organismPostSort = useMemo(
    () =>
      makeOrganismPostSort<GeoSampleGridRow>(
        highlightOrganism,
        (d) => d.organism ?? null,
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

  const publications = project?.publications ?? null;
  const projectAuthors = React.useMemo(
    () => normalizeAuthors(project?.authors ?? null),
    [project?.authors],
  );
  const projectAliases = React.useMemo(
    () => normalizeAliases(project?.alias ?? null),
    [project?.alias],
  );
  const linkedGeoSeriesAliases = React.useMemo(
    () =>
      projectAliases.filter((alias) => {
        const normalized = alias.toUpperCase();
        return (
          normalized.startsWith("GSE") &&
          normalized !== (accession ?? "").toUpperCase()
        );
      }),
    [projectAliases, accession],
  );
  const linkedArrayExpressAliases = React.useMemo(
    () =>
      projectAliases.filter((alias) => alias.toUpperCase().startsWith("E-")),
    [projectAliases],
  );
  const linkedSraAliases = React.useMemo(
    () =>
      projectAliases.filter((alias) => {
        const normalized = alias.toUpperCase();
        return (
          normalized.startsWith("SRP") ||
          normalized.startsWith("ERP") ||
          normalized.startsWith("DRP")
        );
      }),
    [projectAliases],
  );
  const linkedBioProjectAliases = React.useMemo(
    () =>
      projectAliases.filter((alias) => {
        const normalized = alias.toUpperCase();
        return normalized.startsWith("PRJ") || normalized.startsWith("P");
      }),
    [projectAliases],
  );
  const { data: linkedSraRuns } = useQuery({
    queryKey: ["linked-sra-runs", linkedSraAliases],
    queryFn: async () => {
      const runs = await Promise.all(
        linkedSraAliases.map(async (sraAccession) => ({
          accession: sraAccession,
          runsData: await fetchLinkedRuns(sraAccession),
        })),
      );
      return runs.filter(
        (entry): entry is { accession: string; runsData: LinkedRunsData } =>
          !!entry.runsData && entry.runsData.total_runs > 0,
      );
    },
    enabled: linkedSraAliases.length > 0,
  });
  const linkedSraExpTitleMap = React.useMemo(
    () => new Map<string, string>(),
    [],
  );

  const { data: samples, isLoading: isSamplesLoading } = useQuery({
    queryKey: ["samples", accession],
    queryFn: () => fetchSamples(accession!),
    enabled: !!accession,
  });

  const projectOrganisms = React.useMemo<string[]>(() => {
    if (!samples) return [];
    const set = new Set<string>();
    for (const sample of samples) {
      const channels = sample.channels ?? [];
      for (const channel of channels) {
        const name = channel.Organism?.["#text"]?.trim();
        if (name && name !== "-") set.add(name);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [samples]);

  // Prefer top-level center_name/country_code; fall back to nested center[].
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

    const list = project.center;
    if (!list || list.length === 0) return null;
    const first = list.find((c) => c.organization && c.organization !== "GEO");
    if (!first || !first.organization) return null;
    return {
      label: titleCaseCenter(first.organization),
      countryCode: first.country_code ?? null,
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

  const handleDownloadAllSupplementaryFiles = async (
    items: SupplementaryDataItem[],
  ) => {
    if (items.length === 0) return;

    try {
      setIsDownloadingAllSupplementary(true);
      setDownloadAllProgressPercent(0);
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const link = document.createElement("a");
        link.href = item.downloadUrl;
        link.download = item.fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        const progress = Math.round(((index + 1) / items.length) * 100);
        setDownloadAllProgressPercent(progress);
        await new Promise((resolve) => window.setTimeout(resolve, 150));
      }
    } catch (error) {
      console.error("Failed to download all supplementary files:", error);
    } finally {
      setIsDownloadingAllSupplementary(false);
      window.setTimeout(() => {
        setDownloadAllProgressPercent(null);
      }, 300);
    }
  };

  const handleSupplementaryGridReady = React.useCallback(
    (params: { api: GridApi<SupplementaryDataItem> }) => {
      supplementaryGridRef.current = params.api;
    },
    [],
  );

  const handleSupplementarySelectionChanged = () => {
    const selected = supplementaryGridRef.current?.getSelectedRows() ?? [];
    setSelectedSupplementaryCount(selected.length);
    if (supplementaryScriptDialogOpen) {
      const rows = selected.length > 0 ? selected : supplementaryDataItems;
      setSupplementaryScriptPreview(computeSupplementaryScriptText(rows));
    }
  };

  const getSupplementaryDownloadItems = (
    allItems: SupplementaryDataItem[],
  ): SupplementaryDataItem[] => {
    const selected = supplementaryGridRef.current?.getSelectedRows() ?? [];
    return selected.length > 0 ? selected : allItems;
  };

  const computeSupplementaryScriptText = (
    items: SupplementaryDataItem[],
  ): string => {
    if (items.length === 0) return "";
    const isAll = items.length === supplementaryDataItems.length;
    return isAll ? cliDownloadCommand : buildSupplementaryDownloadScript(items);
  };

  const handleCopySupplementaryScript = async () => {
    if (!supplementaryScriptPreview) return;
    let didCopy = false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(supplementaryScriptPreview);
        didCopy = true;
      } catch {
        didCopy = false;
      }
    }
    if (!didCopy) {
      didCopy = copyToClipboard(supplementaryScriptPreview);
    }
    setSupplementaryScriptCopied(didCopy);
    window.setTimeout(() => setSupplementaryScriptCopied(false), 1500);
    if (didCopy) showToast("Download script copied");
  };

  const handleDownloadAllSampleSupplementaryFiles = async (
    items: SupplementaryDataItem[],
  ) => {
    if (items.length === 0) return;

    try {
      setIsDownloadingAllSampleSupplementary(true);
      setSampleDownloadAllProgressPercent(0);
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const link = document.createElement("a");
        link.href = item.downloadUrl;
        link.download = item.fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        const progress = Math.round(((index + 1) / items.length) * 100);
        setSampleDownloadAllProgressPercent(progress);
        await new Promise((resolve) => window.setTimeout(resolve, 150));
      }
    } catch (error) {
      console.error("Failed to download sample supplementary files:", error);
    } finally {
      setIsDownloadingAllSampleSupplementary(false);
      window.setTimeout(() => {
        setSampleDownloadAllProgressPercent(null);
      }, 300);
    }
  };

  const handleSampleSupplementaryGridReady = React.useCallback(
    (params: { api: GridApi<SampleSupplementaryGroupRow> }) => {
      sampleSupplementaryGridRef.current = params.api;
    },
    [],
  );

  const handleSampleSupplementarySelectionChanged = () => {
    const selectedGroups =
      sampleSupplementaryGridRef.current?.getSelectedRows() ?? [];
    const selectedItems = selectedGroups.flatMap((group) => group.items);
    setSelectedSampleSupplementaryCount(selectedItems.length);
    if (sampleSupplementaryScriptDialogOpen) {
      const rows =
        selectedItems.length > 0 ? selectedItems : sampleSupplementaryDataItems;
      setSampleSupplementaryScriptPreview(
        buildSupplementaryDownloadScript(rows),
      );
    }
  };

  const getSampleSupplementaryDownloadItems = (): SupplementaryDataItem[] => {
    const selectedGroups =
      sampleSupplementaryGridRef.current?.getSelectedRows() ?? [];
    if (selectedGroups.length === 0) {
      return sampleSupplementaryDataItems;
    }
    return selectedGroups.flatMap((group) => group.items);
  };

  const handleCopySampleSupplementaryScript = async () => {
    if (!sampleSupplementaryScriptPreview) return;
    let didCopy = false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(sampleSupplementaryScriptPreview);
        didCopy = true;
      } catch {
        didCopy = false;
      }
    }
    if (!didCopy) {
      didCopy = copyToClipboard(sampleSupplementaryScriptPreview);
    }
    setSampleSupplementaryScriptCopied(didCopy);
    window.setTimeout(() => setSampleSupplementaryScriptCopied(false), 1500);
    if (didCopy) showToast("Sample download script copied");
  };

  // Collect all unique characteristic tags across all samples and channels
  const characteristicTags = React.useMemo(() => {
    if (!samples) return [];
    const tags = new Set<string>();
    samples.forEach((sample) => {
      sample.channels?.forEach((channel) => {
        if (Array.isArray(channel.Characteristics)) {
          channel.Characteristics.forEach((char) => {
            if (char["@tag"]) tags.add(char["@tag"]);
          });
        } else if (
          channel.Characteristics &&
          typeof channel.Characteristics === "object"
        ) {
          if (channel.Characteristics["@tag"])
            tags.add(channel.Characteristics["@tag"]);
        }
      });
    });
    return Array.from(tags);
  }, [samples]);

  const sampleRows = React.useMemo<GeoSampleGridRow[]>(() => {
    if (!samples) return [];

    return samples.flatMap((sample) => {
      const sampleRowKey = String(sample.id ?? sample.accession);
      const channels = sample.channels ?? [];

      if (channels.length === 0) {
        return [
          {
            rowKey: `${sampleRowKey}-ch0`,
            sample: sample.accession,
            title: sample.title,
            description: sample.description,
            channelCount: sample.channel_count,
            sampleType: sample.sample_type,
            platform: sample.platform_ref,
            channelPosition: "-",
            label: "-",
            source: "-",
            molecule: "-",
            organism: "-",
            labelProtocol: "-",
            extractProtocol: "-",
            hybridizationProtocol: sample.hybridization_protocol,
            scanProtocol: sample.scan_protocol,
            characteristics: {},
          },
        ];
      }

      return channels.map((channel, channelIdx) => {
        const characteristics: Record<string, string> = {};

        if (Array.isArray(channel.Characteristics)) {
          channel.Characteristics.forEach((char) => {
            if (char["@tag"]) {
              characteristics[char["@tag"]] = char["#text"] ?? "-";
            }
          });
        } else if (
          channel.Characteristics &&
          typeof channel.Characteristics === "object" &&
          channel.Characteristics["@tag"]
        ) {
          characteristics[channel.Characteristics["@tag"]] =
            channel.Characteristics["#text"] ?? "-";
        }

        return {
          rowKey: `${sampleRowKey}-ch${channelIdx}`,
          sample: sample.accession,
          title: sample.title,
          description: sample.description,
          channelCount: sample.channel_count,
          sampleType: sample.sample_type,
          platform: sample.platform_ref,
          channelPosition: channel["@position"] ?? channelIdx + 1,
          label: channel.Label,
          source: channel.Source,
          molecule: channel.Molecule,
          organism: channel.Organism?.["#text"] ?? "-",
          labelProtocol: channel["Label-Protocol"],
          extractProtocol: channel["Extract-Protocol"],
          hybridizationProtocol: sample.hybridization_protocol,
          scanProtocol: sample.scan_protocol,
          characteristics,
        };
      });
    });
  }, [samples]);

  const sampleGridDefaultColDef = React.useMemo<ColDef<GeoSampleGridRow>>(
    () => ({
      filter: true,
      resizable: true,
      sortable: true,
      autoHeight: false,
      wrapText: false,
      minWidth: 20,
      width: 150,
      cellStyle: {
        fontSize: "14px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      },
      valueFormatter: (params) => toDisplayText(params.value),
      tooltipValueGetter: (params) => toDisplayText(params.value),
    }),
    [],
  );

  const sampleColumnDefs = React.useMemo<ColDef<GeoSampleGridRow>[]>(
    () => [
      {
        headerName: "Sample",
        field: "sample",
        width: 130,
        pinned: "left",
        cellClass: "seqout-accession",
        cellRenderer: (params: ICellRendererParams<GeoSampleGridRow>) => {
          const sampleAccession = toDisplayText(params.value);
          if (sampleAccession === "-") return "-";
          const href = isArrayExpress
            ? `https://www.ebi.ac.uk/biostudies/ArrayExpress/studies/${accession}/sdrf`
            : `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${sampleAccession}`;
          return (
            <Link href={href} target="_blank" rel="noopener noreferrer">
              {sampleAccession}
            </Link>
          );
        },
      },
      {
        headerName: "Title",
        field: "title",
        width: 180,
      },
      {
        headerName: "Description",
        field: "description",
        width: 200,
      },
      {
        headerName: "Channel Count",
        field: "channelCount",
        width: 120,
        valueFormatter: (params) => toDisplayText(params.value),
      },
      {
        headerName: "Sample Type",
        field: "sampleType",
        width: 120,
        valueFormatter: (params) => toDisplayText(params.value),
      },
      {
        headerName: "Platform",
        field: "platform",
        width: 120,
        cellRenderer: (params: ICellRendererParams<GeoSampleGridRow>) => {
          const platform = toDisplayText(params.value);
          if (platform === "-") return "-";
          return (
            <Link
              href={`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${platform}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {platform}
            </Link>
          );
        },
      },
      {
        headerName: "Channel Position",
        field: "channelPosition",
        width: 130,
        valueFormatter: (params) => toDisplayText(params.value),
      },
      {
        headerName: "Label",
        field: "label",
        width: 110,
        valueFormatter: (params) => toDisplayText(params.value),
      },
      {
        headerName: "Source",
        field: "source",
        width: 160,
      },
      {
        headerName: "Molecule",
        field: "molecule",
        width: 120,
        valueFormatter: (params) => toDisplayText(params.value),
      },
      {
        headerName: "Organism",
        field: "organism",
        width: 140,
        valueFormatter: (params) => toDisplayText(params.value),
      },
      {
        headerName: "Label Protocol",
        field: "labelProtocol",
        width: 220,
      },
      {
        headerName: "Extract Protocol",
        field: "extractProtocol",
        width: 220,
      },
      ...characteristicTags.map(
        (tag): ColDef<GeoSampleGridRow> => ({
          headerName: tag,
          width: 140,
          valueGetter: (params: ValueGetterParams<GeoSampleGridRow>) =>
            params.data?.characteristics[tag] ?? "-",
        }),
      ),
      {
        headerName: "Hybridization Protocol",
        field: "hybridizationProtocol",
        width: 220,
      },
      {
        headerName: "Scan Protocol",
        field: "scanProtocol",
        width: 220,
      },
    ],
    [accession, characteristicTags, isArrayExpress],
  );

  // Hide columns whose value is "-" for every row (still exported to CSV).
  const visibleSampleColumnDefs = React.useMemo<
    ColDef<GeoSampleGridRow>[]
  >(() => {
    if (sampleRows.length === 0) return sampleColumnDefs;
    return sampleColumnDefs.filter((col) => {
      if (col.field === "sample") return true; // always keep pinned accession column
      const getValue = (row: GeoSampleGridRow): unknown =>
        col.field
          ? row[col.field as keyof GeoSampleGridRow]
          : col.headerName
            ? row.characteristics[col.headerName]
            : undefined;
      return sampleRows.some((row) => toDisplayText(getValue(row)) !== "-");
    });
  }, [sampleColumnDefs, sampleRows]);

  const supplementaryDataItems = React.useMemo(
    () =>
      buildSupplementaryItems({
        rawValue: project?.supplementary_data,
        idPrefix: "supplementary",
      }),
    [project?.supplementary_data],
  );

  const sampleSupplementaryDataItems = React.useMemo(() => {
    if (!samples || samples.length === 0) {
      return [];
    }

    return samples.flatMap((sample, sampleIndex) =>
      buildSupplementaryItems({
        rawValue: sample.supplementary_data,
        idPrefix: `sample-supplementary-${sample.accession || sampleIndex}`,
        sourceSampleAccession: sample.accession,
      }),
    );
  }, [samples]);

  const sampleSupplementaryGroupedRows = React.useMemo<
    SampleSupplementaryGroupRow[]
  >(() => {
    if (sampleSupplementaryDataItems.length === 0) {
      return [];
    }
    const groups = new Map<string, SupplementaryDataItem[]>();
    for (const item of sampleSupplementaryDataItems) {
      const sampleAccession = item.sourceSampleAccession?.trim() || "Unknown";
      const existing = groups.get(sampleAccession);
      if (existing) {
        existing.push(item);
      } else {
        groups.set(sampleAccession, [item]);
      }
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([sampleAccession, items], index) => {
        const hasUnknownSize = items.some(
          (item) => item.fileSizeBytes === null,
        );
        const totalSizeBytes = hasUnknownSize
          ? null
          : items.reduce((sum, item) => sum + (item.fileSizeBytes ?? 0), 0);
        return {
          id: `sample-supp-group-${sampleAccession}-${index}`,
          sampleAccession,
          items,
          fileCount: items.length,
          totalSizeBytes,
        };
      });
  }, [sampleSupplementaryDataItems]);

  const cliDownloadCommand = `curl -sS "https://seqout.org/api/project/${accession}/supplementary/download" | bash`;

  const allSupplementarySizeLabel = React.useMemo(() => {
    if (supplementaryDataItems.length === 0) {
      return null;
    }
    const missingSize = supplementaryDataItems.some(
      (item) => item.fileSizeBytes === null,
    );
    if (missingSize) {
      return null;
    }
    const totalSize = supplementaryDataItems.reduce(
      (sum, item) => sum + (item.fileSizeBytes ?? 0),
      0,
    );
    return formatFileSize(totalSize);
  }, [supplementaryDataItems]);

  const allSampleSupplementarySizeLabel = React.useMemo(() => {
    if (sampleSupplementaryDataItems.length === 0) {
      return null;
    }
    const missingSize = sampleSupplementaryDataItems.some(
      (item) => item.fileSizeBytes === null,
    );
    if (missingSize) {
      return null;
    }
    const totalSize = sampleSupplementaryDataItems.reduce(
      (sum, item) => sum + (item.fileSizeBytes ?? 0),
      0,
    );
    return formatFileSize(totalSize);
  }, [sampleSupplementaryDataItems]);

  const supplementaryColDefs = React.useMemo<ColDef<SupplementaryDataItem>[]>(
    () => [
      {
        headerName: "File",
        field: "fileName",
        flex: 1,
        minWidth: 260,
        cellRenderer: (params: ICellRendererParams<SupplementaryDataItem>) => {
          const row = params.data;
          if (!row) return "-";
          return (
            <Link
              href={row.browserDownloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              size="1"
              style={{ fontFamily: "var(--code-font-family)" }}
            >
              {row.fileName}
            </Link>
          );
        },
      },
      {
        headerName: "Size",
        field: "fileSizeBytes",
        minWidth: 100,
        maxWidth: 140,
        valueGetter: (params: ValueGetterParams<SupplementaryDataItem>) =>
          params.data?.fileSizeBytes ?? 0,
        valueFormatter: (params) =>
          typeof params.value === "number" && params.value > 0
            ? (formatFileSize(params.value as number) ?? "-")
            : "-",
      },
    ],
    [],
  );
  const sampleSupplementaryColDefs = React.useMemo<
    ColDef<SampleSupplementaryGroupRow>[]
  >(
    () => [
      {
        headerName: "Sample",
        field: "sampleAccession",
        minWidth: 160,
        maxWidth: 220,
        pinned: "left",
        cellRenderer: (
          params: ICellRendererParams<SampleSupplementaryGroupRow>,
        ) => {
          const sampleAccession = params.data?.sampleAccession || "-";
          if (sampleAccession === "Unknown" || sampleAccession === "-") {
            return <span>{sampleAccession}</span>;
          }
          return (
            <Link
              href={`/s/${sampleAccession}`}
              target="_blank"
              rel="noopener noreferrer"
              size="1"
              style={{ fontFamily: "var(--code-font-family)" }}
            >
              {sampleAccession}
            </Link>
          );
        },
      },
      {
        headerName: "Supplementary files",
        minWidth: 360,
        flex: 1,
        autoHeight: true,
        wrapText: true,
        cellRenderer: (
          params: ICellRendererParams<SampleSupplementaryGroupRow>,
        ) => {
          const row = params.data;
          if (!row || row.items.length === 0) {
            return "-";
          }
          return (
            <Flex direction="column" gap="1" py="1">
              {row.items.map((item) => (
                <Flex key={item.id} align="center" gap="2">
                  <Link
                    href={item.browserDownloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    size="1"
                    style={{ fontFamily: "var(--code-font-family)" }}
                  >
                    {item.fileName}
                  </Link>
                  {item.fileSizeLabel && (
                    <Text size="1" color="gray">
                      {item.fileSizeLabel}
                    </Text>
                  )}
                </Flex>
              ))}
            </Flex>
          );
        },
      },
      {
        headerName: "Count",
        field: "fileCount",
        minWidth: 90,
        maxWidth: 110,
      },
      {
        headerName: "Total size",
        field: "totalSizeBytes",
        minWidth: 120,
        maxWidth: 140,
        valueFormatter: (params) =>
          typeof params.value === "number"
            ? (formatFileSize(params.value as number) ?? "-")
            : "-",
      },
    ],
    [],
  );

  const supplementaryDefaultColDef = React.useMemo<
    ColDef<SupplementaryDataItem>
  >(() => ({ filter: true, resizable: true, sortable: true }), []);
  const sampleSupplementaryDefaultColDef = React.useMemo<
    ColDef<SampleSupplementaryGroupRow>
  >(() => ({ filter: true, resizable: true, sortable: true }), []);

  const supplementaryDownloadLabel =
    selectedSupplementaryCount > 0
      ? `Download ${selectedSupplementaryCount} selected`
      : "Download all";
  const supplementaryScriptLabel =
    selectedSupplementaryCount > 0
      ? `Copy script (${selectedSupplementaryCount} selected)`
      : "Copy script";
  const sampleSupplementaryDownloadLabel =
    selectedSampleSupplementaryCount > 0
      ? `Download ${selectedSampleSupplementaryCount} selected`
      : "Download all";
  const sampleSupplementaryScriptLabel =
    selectedSampleSupplementaryCount > 0
      ? `Copy script (${selectedSampleSupplementaryCount} selected)`
      : "Copy script";

  return (
    <>
      <SearchBar initialQuery={""} />

      {!accession && (
        <Flex
          gap="3"
          align="center"
          p={"4"}
          ml={{ initial: "0", md: "8rem" }}
          mr={{ initial: "0", md: "16rem" }}
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
            <span className="seqout-accession">/p/GSE196830</span>.
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

      {/* Loading state */}
      {accession && isLoading && (
        <Flex
          gap="2"
          align="center"
          pt={"3"}
          ml={{ initial: "0", md: "8rem" }}
          mr={{ initial: "0", md: "16rem" }}
          justify="center"
        >
          <Spinner size="3" />
          <Text>
            Loading <span className="seqout-accession">{accession}</span>
          </Text>
        </Flex>
      )}

      {/* Error state */}
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
          <Flex gap="2" mt="1" align={"center"}>
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

      {/* Data state */}
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
              <Heading as="h1" size={{ initial: "4", md: "6" }} weight="bold">
                {project.title}
              </Heading>
            </Flex>
            <Flex justify={"start"} align="center" gap="2" wrap="wrap">
              <Badge
                size={{ initial: "2", md: "3" }}
                color={isArrayExpress ? "gold" : undefined}
                variant={isArrayExpress ? "solid" : undefined}
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
              </Badge>
              {samples && samples.length > 0 && (
                <Badge
                  size={{ initial: "2", md: "3" }}
                  color="gray"
                  style={{ whiteSpace: "nowrap" }}
                >
                  {samples.length} {samples.length === 1 ? "Sample" : "Samples"}
                </Badge>
              )}
              {linkedBioProjectAliases.map((alias) => (
                <a
                  key={`bioproject-${alias}`}
                  href={`https://www.ncbi.nlm.nih.gov/bioproject/${alias}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Badge
                    size={{ initial: "2", md: "3" }}
                    color="green"
                    style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                    className="seqout-accession"
                  >
                    {alias}
                    <ExternalLinkIcon />
                  </Badge>
                </a>
              ))}
              {linkedSraAliases.map((alias) => (
                <a key={`sra-${alias}`} href={`/p/${alias}`}>
                  <Badge
                    size={{ initial: "2", md: "3" }}
                    color="brown"
                    style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                    className="seqout-accession"
                  >
                    {alias}
                    <EnterIcon />
                  </Badge>
                </a>
              ))}
              {linkedArrayExpressAliases
                .filter(
                  (alias) =>
                    alias.toUpperCase() !== (accession ?? "").toUpperCase(),
                )
                .map((alias) => (
                  <a key={`ae-${alias}`} href={`/p/${alias}`}>
                    <Badge
                      size={{ initial: "2", md: "3" }}
                      color="gold"
                      variant="solid"
                      style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                      className="seqout-accession"
                    >
                      {alias}
                      <EnterIcon />
                    </Badge>
                  </a>
                ))}
              {isArrayExpress &&
                linkedGeoSeriesAliases.map((alias) => (
                  <a key={`gse-${alias}`} href={`/p/${alias}`}>
                    <Badge
                      size={{ initial: "2", md: "3" }}
                      style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                      className="seqout-accession"
                    >
                      {alias}
                      <EnterIcon />
                    </Badge>
                  </a>
                ))}
              {project.relation &&
                (() => {
                  const relations = project.relation as unknown as {
                    "@target": string;
                    "@type": string;
                  }[];
                  const bioProject = relations.find(
                    (r) => r["@type"] === "BioProject",
                  );
                  if (!bioProject) return null;
                  return (
                    <a
                      href={bioProject["@target"]}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Badge
                        size={{ initial: "2", md: "3" }}
                        color="green"
                        style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                        className="seqout-accession"
                      >
                        {bioProject["@target"].split("/").pop()}
                        <ExternalLinkIcon />
                      </Badge>
                    </a>
                  );
                })()}
              <a
                href={
                  isArrayExpress
                    ? `https://www.ebi.ac.uk/biostudies/ArrayExpress/studies/${accession}/sdrf`
                    : `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${accession}`
                }
                target="_blank"
                rel="noopener noreferrer"
              >
                <Badge
                  size={{ initial: "2", md: "3" }}
                  color="sky"
                  style={{ whiteSpace: "nowrap" }}
                >
                  {isArrayExpress
                    ? "Visit ArrayExpress page"
                    : "Visit GEO page"}{" "}
                  <ExternalLinkIcon />
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
            {projectAuthors.length > 0 && (
              <Flex align="start" gap="2" style={{ minWidth: 0 }}>
                <PersonIcon style={{ flexShrink: 0, marginTop: "0.125rem" }} />
                <Text color="gray" style={{ minWidth: 0 }}>
                  {projectAuthors.join(", ")}
                </Text>
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
              text={project.summary}
              charLimit={SUMMARY_CHAR_LIMIT}
            />
            {project.relation &&
              (() => {
                const relations = project.relation as unknown as {
                  "@target": string;
                  "@type": string;
                }[];
                const superSeries = relations.filter(
                  (r) => r["@type"] === "SuperSeries of",
                );
                const subSeries = relations.filter(
                  (r) => r["@type"] === "SubSeries of",
                );

                if (superSeries.length === 0 && subSeries.length === 0)
                  return null;

                return (
                  <Flex direction="column" gap="2">
                    {superSeries.length > 0 && (
                      <Flex align="center" gap="2" wrap="wrap">
                        <Text size="2" weight="medium">
                          SuperSeries of:
                        </Text>
                        {superSeries.map((s) => (
                          <a key={s["@target"]} href={`/p/${s["@target"]}`}>
                            <Badge
                              size={{ initial: "1", md: "2" }}
                              style={{ cursor: "pointer" }}
                            >
                              {s["@target"]}
                            </Badge>
                          </a>
                        ))}
                      </Flex>
                    )}
                    {subSeries.length > 0 && (
                      <Flex align="center" gap="2" wrap="wrap">
                        <Text size="2" weight="medium">
                          SubSeries of:
                        </Text>
                        {subSeries.map((s) => (
                          <a key={s["@target"]} href={`/p/${s["@target"]}`}>
                            <Badge
                              size={{ initial: "1", md: "2" }}
                              style={{ cursor: "pointer" }}
                            >
                              {s["@target"]}
                            </Badge>
                          </a>
                        ))}
                      </Flex>
                    )}
                  </Flex>
                );
              })()}
            <Flex id="overall-design" align="center" gap="2">
              <Heading as="h2" weight="medium" size="6">
                Overall design
              </Heading>
              <SectionAnchor id="overall-design" />
            </Flex>
            <ProjectSummary
              text={project.overall_design}
              charLimit={OVERALL_DESIGN_CHAR_LIMIT}
            />

            {/* Samples (Original) + AI Enriched metadata, merged via tabs */}
            <MetadataTableTabs
              accession={accession}
              sectionId="samples"
              sectionTitle="Samples"
              onExportOriginalCsv={() => {
                if (!samples || samples.length === 0) return;
                // Build CSV headers
                const headers = [
                  "Sample",
                  "Title",
                  "Description",
                  "Channel Count",
                  "Sample Type",
                  "Platform",
                  "Channel Position",
                  "Label",
                  "Source",
                  "Molecule",
                  "Organism",
                  "Label Protocol",
                  "Extract Protocol",
                  ...characteristicTags,
                  "Hybridization Protocol",
                  "Scan Protocol",
                ];

                // Build CSV rows
                const rows = samples.flatMap((sample) => {
                  const channels = sample.channels ?? [];
                  if (channels.length === 0) {
                    return [
                      [
                        sample.accession,
                        sample.title ?? "-",
                        sample.description ?? "-",
                        sample.channel_count ?? "-",
                        sample.sample_type ?? "-",
                        sample.platform_ref ?? "-",
                        "-",
                        "-",
                        "-",
                        "-",
                        "-",
                        "-",
                        "-",
                        ...characteristicTags.map(() => "-"),
                        sample.hybridization_protocol ?? "-",
                        sample.scan_protocol ?? "-",
                      ],
                    ];
                  }
                  return channels.map((channel, channelIdx) => {
                    const charMap = new Map();
                    if (Array.isArray(channel.Characteristics)) {
                      channel.Characteristics.forEach((char) => {
                        if (char["@tag"])
                          charMap.set(char["@tag"], char["#text"] ?? "-");
                      });
                    } else if (
                      channel.Characteristics &&
                      typeof channel.Characteristics === "object"
                    ) {
                      if (channel.Characteristics["@tag"])
                        charMap.set(
                          channel.Characteristics["@tag"],
                          channel.Characteristics["#text"] ?? "-",
                        );
                    }
                    return [
                      sample.accession,
                      sample.title ?? "-",
                      sample.description ?? "-",
                      sample.channel_count ?? "-",
                      sample.sample_type ?? "-",
                      sample.platform_ref ?? "-",
                      channel["@position"] ?? channelIdx + 1,
                      channel.Label ?? "-",
                      channel.Source ?? "-",
                      channel.Molecule ?? "-",
                      channel.Organism?.["#text"] ?? "-",
                      channel["Label-Protocol"] ?? "-",
                      channel["Extract-Protocol"] ?? "-",
                      ...characteristicTags.map(
                        (tag) => charMap.get(tag) ?? "-",
                      ),
                      sample.hybridization_protocol ?? "-",
                      sample.scan_protocol ?? "-",
                    ];
                  });
                });

                // Use exportCsv utility
                import("@/utils/exportCsv").then((mod) => {
                  // Convert rows to array of objects for exportExperimentsToCsv
                  const experiments = rows.map((row) => {
                    const obj: Record<string, unknown> = {};
                    headers.forEach((header, idx) => {
                      obj[header] = row[idx];
                    });
                    return obj;
                  });
                  mod.default(experiments, `${accession}_samples.csv`);
                });
              }}
              originalContent={
                <Flex
                  align="start"
                  gap="2"
                  direction="column"
                  style={{
                    width: "100%",
                    maxHeight: "500px",
                  }}
                >
                  {isSamplesLoading && (
                    <Flex gap="2" align="center">
                      <Spinner size="2" />
                      <Text size="2">Loading samples...</Text>
                    </Flex>
                  )}
                  {!isSamplesLoading && samples && samples.length === 0 && (
                    <Text size="2" color="gray">
                      No samples found
                    </Text>
                  )}
                  {!isSamplesLoading && samples && samples.length > 0 && (
                    <>
                      {highlightOrganism && (
                        <Flex
                          align="center"
                          gap="2"
                          py="1"
                          px="3"
                          style={getOrganismBannerStyle(isDark)}
                        >
                          <Text size="2" color="gray">
                            Showing{" "}
                            <Text
                              weight="medium"
                              style={{ fontStyle: "italic" }}
                            >
                              {highlightOrganism}
                            </Text>{" "}
                            samples first
                          </Text>
                        </Flex>
                      )}
                      <div
                        className={agGridThemeClassName}
                        style={{
                          height: "500px",
                          width: "100%",
                        }}
                      >
                        <AgGridReact<GeoSampleGridRow>
                          columnDefs={visibleSampleColumnDefs}
                          defaultColDef={sampleGridDefaultColDef}
                          enableCellTextSelection
                          ensureDomOrder
                          getRowId={(params) => params.data.rowKey}
                          rowData={sampleRows}
                          theme="legacy"
                          getRowStyle={organismRowStyle}
                          postSortRows={organismPostSort}
                        />
                      </div>
                    </>
                  )}
                </Flex>
              }
            />

            <Flex id="publications" align="center" gap="2">
              <Heading as="h2" weight="medium" size="6">
                Linked publications
              </Heading>
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

            {linkedSraRuns?.map(({ accession: sraAccession, runsData }) => (
              <DownloadFastqSection
                key={`linked-sra-fastq-${sraAccession}`}
                accession={sraAccession}
                runsData={runsData}
                agGridThemeClassName={agGridThemeClassName}
                expTitleMap={linkedSraExpTitleMap}
              />
            ))}
            <Flex id="supplementary" align="center" gap="2">
              <Heading as="h2" weight="medium" size="6">
                Supplementary Data
              </Heading>
              <SectionAnchor id="supplementary" />
            </Flex>
            {supplementaryDataItems.length === 0 && (
              <Text size="2" color="gray">
                No supplementary files found
              </Text>
            )}
            {supplementaryDataItems.length > 0 && (
              <Flex direction="column" gap="2" style={{ width: "100%" }}>
                <Flex gap="3" justify="between" wrap="wrap">
                  <Flex gap="2" align="center" wrap="wrap">
                    <Badge size="2" color="blue">
                      {supplementaryDataItems.length.toLocaleString()} file
                      {supplementaryDataItems.length !== 1 ? "s" : ""}
                    </Badge>
                    {allSupplementarySizeLabel && (
                      <Badge size="2" variant="soft">
                        {allSupplementarySizeLabel} total
                      </Badge>
                    )}
                  </Flex>
                  <Flex gap="2" wrap="wrap">
                    <Button
                      size="2"
                      variant="surface"
                      disabled={isDownloadingAllSupplementary}
                      onClick={() => {
                        const items = getSupplementaryDownloadItems(
                          supplementaryDataItems,
                        );
                        if (items.length === 0) return;
                        void handleDownloadAllSupplementaryFiles(items);
                      }}
                    >
                      {isDownloadingAllSupplementary ? (
                        <Flex align="center" gap="1">
                          <Spinner size="1" />
                          <Text size="1">
                            {downloadAllProgressPercent !== null
                              ? `${downloadAllProgressPercent}%`
                              : "..."}
                          </Text>
                        </Flex>
                      ) : (
                        <>
                          <DownloadIcon /> {supplementaryDownloadLabel}
                        </>
                      )}
                    </Button>
                    <Dialog.Root
                      open={supplementaryScriptDialogOpen}
                      onOpenChange={(open) => {
                        setSupplementaryScriptDialogOpen(open);
                        if (open) {
                          const items = getSupplementaryDownloadItems(
                            supplementaryDataItems,
                          );
                          setSupplementaryScriptPreview(
                            computeSupplementaryScriptText(items),
                          );
                          setSupplementaryScriptCopied(false);
                        }
                      }}
                    >
                      <Dialog.Trigger>
                        <Button size="2" variant="surface">
                          <FileTextIcon /> {supplementaryScriptLabel}
                        </Button>
                      </Dialog.Trigger>
                      <Dialog.Content size="3">
                        <Flex justify="between" align="center" gap="3" mb="3">
                          <Dialog.Title mb="0">
                            Copy download script
                          </Dialog.Title>
                          <Button
                            size="2"
                            variant="soft"
                            onClick={() => {
                              void handleCopySupplementaryScript();
                            }}
                            disabled={!supplementaryScriptPreview}
                          >
                            {supplementaryScriptCopied ? (
                              <CheckIcon />
                            ) : (
                              <CopyIcon />
                            )}
                            {supplementaryScriptCopied ? "Copied!" : "Copy"}
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
                              overflowY: "auto",
                              maxHeight: "24rem",
                              fontSize: "12px",
                              lineHeight: "1.5",
                              fontFamily: "var(--default-mono-font-family)",
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-all",
                            }}
                          >
                            <code>
                              {supplementaryScriptPreview ||
                                "# No supplementary files available"}
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
                    height: `${Math.min(
                      supplementaryDataItems.length * 42 + 49,
                      320,
                    )}px`,
                  }}
                >
                  <AgGridReact<SupplementaryDataItem>
                    columnDefs={supplementaryColDefs}
                    defaultColDef={supplementaryDefaultColDef}
                    enableCellTextSelection
                    ensureDomOrder
                    rowData={supplementaryDataItems}
                    getRowId={(params) => params.data.id}
                    rowSelection={{
                      mode: "multiRow",
                      checkboxes: true,
                      headerCheckbox: true,
                    }}
                    onGridReady={handleSupplementaryGridReady}
                    onSelectionChanged={handleSupplementarySelectionChanged}
                    theme="legacy"
                  />
                </div>
              </Flex>
            )}
            <Flex align="center" gap="2" mt="4">
              <Text weight="medium" size="4">
                Sample supplementary files
              </Text>
            </Flex>
            {sampleSupplementaryDataItems.length === 0 && (
              <Text size="2" color="gray">
                No sample supplementary files found
              </Text>
            )}
            {sampleSupplementaryDataItems.length > 0 && (
              <Flex direction="column" gap="2" style={{ width: "100%" }}>
                <Flex gap="3" justify="between" wrap="wrap">
                  <Flex gap="2" align="center" wrap="wrap">
                    <Badge size="2" color="blue">
                      {sampleSupplementaryDataItems.length.toLocaleString()}{" "}
                      file
                      {sampleSupplementaryDataItems.length !== 1 ? "s" : ""}
                    </Badge>
                    <Badge size="2" variant="soft">
                      {sampleSupplementaryGroupedRows.length.toLocaleString()}{" "}
                      sample
                      {sampleSupplementaryGroupedRows.length !== 1 ? "s" : ""}
                    </Badge>
                    {allSampleSupplementarySizeLabel && (
                      <Badge size="2" variant="soft">
                        {allSampleSupplementarySizeLabel} total
                      </Badge>
                    )}
                  </Flex>
                  <Flex gap="2" wrap="wrap">
                    <Button
                      size="2"
                      variant="surface"
                      disabled={isDownloadingAllSampleSupplementary}
                      onClick={() => {
                        const items = getSampleSupplementaryDownloadItems();
                        if (items.length === 0) return;
                        void handleDownloadAllSampleSupplementaryFiles(items);
                      }}
                    >
                      {isDownloadingAllSampleSupplementary ? (
                        <Flex align="center" gap="1">
                          <Spinner size="1" />
                          <Text size="1">
                            {sampleDownloadAllProgressPercent !== null
                              ? `${sampleDownloadAllProgressPercent}%`
                              : "..."}
                          </Text>
                        </Flex>
                      ) : (
                        <>
                          <DownloadIcon /> {sampleSupplementaryDownloadLabel}
                        </>
                      )}
                    </Button>
                    <Dialog.Root
                      open={sampleSupplementaryScriptDialogOpen}
                      onOpenChange={(open) => {
                        setSampleSupplementaryScriptDialogOpen(open);
                        if (open) {
                          const items = getSampleSupplementaryDownloadItems();
                          setSampleSupplementaryScriptPreview(
                            buildSupplementaryDownloadScript(items),
                          );
                          setSampleSupplementaryScriptCopied(false);
                        }
                      }}
                    >
                      <Dialog.Trigger>
                        <Button size="2" variant="surface">
                          <FileTextIcon /> {sampleSupplementaryScriptLabel}
                        </Button>
                      </Dialog.Trigger>
                      <Dialog.Content size="3">
                        <Flex justify="between" align="center" gap="3" mb="3">
                          <Dialog.Title mb="0">
                            Copy sample download script
                          </Dialog.Title>
                          <Button
                            size="2"
                            variant="soft"
                            onClick={() => {
                              void handleCopySampleSupplementaryScript();
                            }}
                            disabled={!sampleSupplementaryScriptPreview}
                          >
                            {sampleSupplementaryScriptCopied ? (
                              <CheckIcon />
                            ) : (
                              <CopyIcon />
                            )}
                            {sampleSupplementaryScriptCopied
                              ? "Copied!"
                              : "Copy"}
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
                              overflowY: "auto",
                              maxHeight: "24rem",
                              fontSize: "12px",
                              lineHeight: "1.5",
                              fontFamily: "var(--default-mono-font-family)",
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-all",
                            }}
                          >
                            <code>
                              {sampleSupplementaryScriptPreview ||
                                "# No sample supplementary files available"}
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
                    height: `${Math.min(
                      Math.max(
                        sampleSupplementaryGroupedRows.length * 72 + 49,
                        180,
                      ),
                      420,
                    )}px`,
                  }}
                >
                  <AgGridReact<SampleSupplementaryGroupRow>
                    columnDefs={sampleSupplementaryColDefs}
                    defaultColDef={sampleSupplementaryDefaultColDef}
                    enableCellTextSelection
                    ensureDomOrder
                    rowData={sampleSupplementaryGroupedRows}
                    getRowId={(params) => params.data.id}
                    rowSelection={{
                      mode: "multiRow",
                      checkboxes: true,
                      headerCheckbox: true,
                    }}
                    onGridReady={handleSampleSupplementaryGridReady}
                    onSelectionChanged={
                      handleSampleSupplementarySelectionChanged
                    }
                    theme="legacy"
                  />
                </div>
              </Flex>
            )}

            <Flex id="similar" align="center" gap="2">
              <Heading as="h2" weight="medium" size="6">
                Similar projects
              </Heading>
              <Badge color="teal" size={"2"}>
                Beta
              </Badge>
              <SectionAnchor id="similar" />
            </Flex>
            <SimilarProjectsGraph
              accession={project.accession}
              source="geo"
              title={project.title}
              description={project.summary}
              organisms={project.organisms}
              coords2d={project.coords_2d}
              coords3d={project.coords_3d}
              neighbors={project.neighbors}
            />
            <SubmittingOrgPanel center={project.center} />
          </Flex>
        </>
      )}
    </>
  );
}
