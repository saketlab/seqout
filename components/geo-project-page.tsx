"use client";
import AccessionLink from "@/components/accession-link";
import DbBadge from "@/components/db-badge";
import CountryFlagIcon from "@/components/country-flag-icon";
import LinkedSraFastq from "@/components/linked-sra-fastq";
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
import { useToast } from "@/components/toast-provider";
import { useWrapText } from "@/components/wrap-text-toggle";
import {
  ensureAgGridModules,
  infiniteScrollOnBodyScroll,
  TABLE_PAGE_SIZE,
  truncatableColDef,
} from "@/lib/ag-grid";
import { getExternalArchiveUrl } from "@/utils/accessionLinks";
import { getJson, getJsonWithTotal } from "@/utils/api";
import { copyToClipboard } from "@/utils/clipboard";
import { dbForAccession } from "@/utils/db-colors";
import {
  buildCurlCommand,
  buildSupplementaryDownloadScript,
} from "@/utils/downloadScript";
import { titleCaseCenter } from "@/utils/format";
import {
  makeOrganismPostSort,
  makeOrganismRowStyle,
} from "@/utils/organism-highlight";
import {
  normalizeAliases,
  normalizeAuthors,
  parsePostgresTextArray,
  toDisplayText,
} from "@/utils/project";
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
import React, { useEffect, useMemo, useState } from "react";

ensureAgGridModules();

type Project = {
  accession: string;
  title: string;
  summary: string;
  overall_design: string | string[] | null;
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
  has_enriched?: boolean;
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
        downloadUrl: getAppDownloadUrl(browserDownloadUrl, fileName),
        sourceSampleAccession,
      };
    })
    .filter((entry): entry is SupplementaryDataItem => entry !== null);

const fetchSamples = async (
  accession: string,
  offset: number,
): Promise<{ items: GeoSample[]; total: number | null }> =>
  getJsonWithTotal<GeoSample[]>(
    `/geo/series/${accession}/samples?limit=${TABLE_PAGE_SIZE}&offset=${offset}`,
  );

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

const SUMMARY_CHAR_LIMIT = 350;
const OVERALL_DESIGN_CHAR_LIMIT = 350;

export default function GeoProjectPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const highlightOrganism = searchParams.get("organism")?.toLowerCase() ?? null;
  const wrap = useWrapText();
  const { resolvedTheme } = useTheme();
  const { showToast } = useToast();
  const accession = params.accession as string | undefined;
  const isEAccession = accession?.toUpperCase().startsWith("E-") ?? false;
  const isGea = /^E-GEAD-\d+$/.test(accession?.toUpperCase() ?? "");
  const isArrayExpress = isEAccession && !isGea;
  const geaExternalUrl =
    isGea && accession ? (getExternalArchiveUrl(accession)?.url ?? null) : null;
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
  const linkedGeoSeriesAliases = React.useMemo(() => {
    const fromAlias = projectAliases.filter((alias) => {
      const normalized = alias.toUpperCase();
      return (
        normalized.startsWith("GSE") &&
        normalized !== (accession ?? "").toUpperCase()
      );
    });
    // E-GEOD-NNNNN is the ArrayExpress mirror of GSE-NNNNN; derive it directly.
    const geod = accession?.toUpperCase().match(/^E-GEOD-(\d+)$/);
    const derived = geod ? `GSE${geod[1]}` : null;
    if (derived && !fromAlias.some((a) => a.toUpperCase() === derived)) {
      return [derived, ...fromAlias];
    }
    return fromAlias;
  }, [projectAliases, accession]);
  const linkedArrayExpressAliases = React.useMemo(
    () =>
      projectAliases.filter((alias) => alias.toUpperCase().startsWith("E-")),
    [projectAliases],
  );
  const similarGseAccession = isEAccession
    ? (linkedGeoSeriesAliases[0] ?? null)
    : null;
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
  // must stay a GEO accession: the GEO series endpoint cannot serve an SRA study
  const borrowedAccession =
    similarGseAccession ??
    (isEAccession ? (linkedSraAliases[0] ?? null) : null);
  const { data: borrowedProject } = useQuery({
    queryKey: ["project", borrowedAccession],
    queryFn: () => fetchProject(borrowedAccession),
    enabled: !!borrowedAccession,
  });
  const dataAccession = borrowedAccession ?? accession;
  const dataProject = borrowedProject ?? project;
  const samplesAccession = similarGseAccession ?? accession;
  // Paginated: 20 samples/page, fetch more as the grid scrolls (loaded-only).
  const samplesQuery = useInfiniteQuery({
    queryKey: ["samples", samplesAccession],
    queryFn: ({ pageParam }) => fetchSamples(samplesAccession!, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.items.length === TABLE_PAGE_SIZE
        ? allPages.length * TABLE_PAGE_SIZE
        : undefined,
    enabled: !!samplesAccession,
  });
  const samples = React.useMemo(
    () => samplesQuery.data?.pages.flatMap((p) => p.items),
    [samplesQuery.data],
  );
  // Full count from the X-Total-Count header so the badge shows the real total,
  // not just the rows loaded so far.
  const samplesTotal =
    samplesQuery.data?.pages[0]?.total ?? samples?.length ?? 0;
  const isSamplesLoading = samplesQuery.isLoading;

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
      showToast(
        `Downloading ${items.length} file${items.length === 1 ? "" : "s"}`,
      );
    } catch (error) {
      console.error("Failed to download supplementary files:", error);
      showToast("Failed to start supplementary downloads");
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
      showToast(
        `Downloading ${items.length} file${items.length === 1 ? "" : "s"}`,
      );
    } catch (error) {
      console.error("Failed to download sample supplementary files:", error);
      showToast("Failed to start sample supplementary downloads");
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

  const sampleGridHeight = React.useMemo(() => {
    const headerHeight = 48;
    const rowHeight = 42;
    const maxHeight = 500;
    // Wrapped rows grow past the fixed rowHeight estimate, so a row-count fit
    // would clip them — give the grid its full max height instead.
    if (wrap) return maxHeight;
    return Math.min(maxHeight, headerHeight + sampleRows.length * rowHeight);
  }, [sampleRows.length, wrap]);

  const sampleGridDefaultColDef = React.useMemo<ColDef<GeoSampleGridRow>>(
    () => ({
      filter: true,
      resizable: true,
      sortable: true,
      minWidth: 20,
      width: 150,
      ...truncatableColDef<GeoSampleGridRow>(wrap),
      valueFormatter: (params) => toDisplayText(params.value),
      tooltipValueGetter: (params) => toDisplayText(params.value),
    }),
    [wrap],
  );

  const sampleColumnDefs = React.useMemo<ColDef<GeoSampleGridRow>[]>(
    () => [
      {
        headerName: "Sample",
        field: "sample",
        width: 160,
        pinned: "left",
        cellClass: "seqout-accession",
        cellRenderer: (params: ICellRendererParams<GeoSampleGridRow>) => {
          const sampleAccession = toDisplayText(params.value);
          if (sampleAccession === "-") return "-";
          if (isArrayExpress) {
            return (
              <Link
                href={`https://www.ebi.ac.uk/biostudies/ArrayExpress/studies/${accession}/sdrf`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {sampleAccession}
              </Link>
            );
          }
          return <AccessionLink accession={sampleAccession} />;
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

  const supplementaryDataItems = buildSupplementaryItems({
    rawValue: dataProject?.supplementary_data,
    idPrefix: "supplementary",
  });

  const sampleSupplementaryDataItems =
    !samples || samples.length === 0
      ? []
      : samples.flatMap((sample, sampleIndex) =>
          buildSupplementaryItems({
            rawValue: sample.supplementary_data,
            idPrefix: `sample-supplementary-${sample.accession || sampleIndex}`,
            sourceSampleAccession: sample.accession,
          }),
        );

  const sampleSupplementaryGroupedRows: SampleSupplementaryGroupRow[] = (() => {
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
  })();

  const cliDownloadCommand = `curl -sS "https://seqout.org/api/project/${dataAccession}/supplementary/download" | bash`;

  const sizeLabel = (items: SupplementaryDataItem[]) => {
    if (
      items.length === 0 ||
      items.some((item) => item.fileSizeBytes === null)
    ) {
      return null;
    }
    return formatFileSize(
      items.reduce((sum, item) => sum + (item.fileSizeBytes ?? 0), 0),
    );
  };
  const allSupplementarySizeLabel = sizeLabel(supplementaryDataItems);
  const allSampleSupplementarySizeLabel = sizeLabel(
    sampleSupplementaryDataItems,
  );

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
      ? `Copy download script (${selectedSupplementaryCount} selected)`
      : "Copy download script";
  const sampleSupplementaryDownloadLabel =
    selectedSampleSupplementaryCount > 0
      ? `Download ${selectedSampleSupplementaryCount} selected`
      : "Download all";
  const sampleSupplementaryScriptLabel =
    selectedSampleSupplementaryCount > 0
      ? `Copy download script (${selectedSampleSupplementaryCount} selected)`
      : "Copy download script";

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
              <Heading as="h1" size={{ initial: "6", md: "8" }} weight="bold">
                {project.title}
              </Heading>
            </Flex>
            <Flex justify={"start"} align="center" gap="2" wrap="wrap">
              <DbBadge
                size={{ initial: "2", md: "3" }}
                db={dbForAccession(accession) ?? "geo"}
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
              {linkedBioProjectAliases.map((alias) => (
                <BioProjectBadge key={`bioproject-${alias}`} accession={alias} />
              ))}
              {linkedSraAliases.map((alias) => (
                <a key={`sra-${alias}`} href={`/p/${alias}`}>
                  <DbBadge
                    size={{ initial: "2", md: "3" }}
                    db={dbForAccession(alias) ?? "sra"}
                    style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                    className="seqout-accession"
                  >
                    {alias}
                    <EnterIcon />
                  </DbBadge>
                </a>
              ))}
              {linkedArrayExpressAliases
                .filter(
                  (alias) =>
                    alias.toUpperCase() !== (accession ?? "").toUpperCase(),
                )
                .map((alias) => (
                  <a key={`ae-${alias}`} href={`/p/${alias}`}>
                    <DbBadge
                      size={{ initial: "2", md: "3" }}
                      db={dbForAccession(alias) ?? "arrayexpress"}
                      style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                      className="seqout-accession"
                    >
                      {alias}
                      <EnterIcon />
                    </DbBadge>
                  </a>
                ))}
              {isEAccession &&
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
                  const prjAccession = bioProject["@target"].split("/").pop();
                  if (!prjAccession) return null;
                  // Already rendered above via linkedBioProjectAliases — don't
                  // double up.
                  if (
                    linkedBioProjectAliases.some(
                      (a) => a.toUpperCase() === prjAccession.toUpperCase(),
                    )
                  )
                    return null;
                  return (
                    <BioProjectBadge
                      accession={prjAccession}
                      ncbiHref={bioProject["@target"]}
                    />
                  );
                })()}
              <a
                href={
                  geaExternalUrl ??
                  (isArrayExpress
                    ? `https://www.ebi.ac.uk/biostudies/ArrayExpress/studies/${accession}/sdrf`
                    : `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${accession}`)
                }
                target="_blank"
                rel="noopener noreferrer"
              >
                <DbBadge
                  size={{ initial: "2", md: "3" }}
                  db={dbForAccession(accession) ?? "geo"}
                  style={{ whiteSpace: "nowrap" }}
                >
                  {isGea
                    ? "Visit GEA page"
                    : isArrayExpress
                      ? "Visit ArrayExpress page"
                      : "Visit GEO page"}{" "}
                  <ExternalLinkIcon />
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
              hasEnriched={project?.has_enriched}
              titleBadge={
                samplesTotal > 0 ? (
                  <Badge size={"3"} style={{ whiteSpace: "nowrap" }}>
                    {samples && samples.length < samplesTotal
                      ? `Showing first ${samples.length.toLocaleString()} of ${samplesTotal.toLocaleString()} samples`
                      : `${samplesTotal.toLocaleString()} ${samplesTotal === 1 ? "sample" : "samples"}`}
                  </Badge>
                ) : undefined
              }
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
                          height: `${sampleGridHeight}px`,
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
                          onBodyScroll={infiniteScrollOnBodyScroll({
                            loadedCount: sampleRows.length,
                            hasNextPage: samplesQuery.hasNextPage,
                            isFetchingNextPage: samplesQuery.isFetchingNextPage,
                            fetchNextPage: samplesQuery.fetchNextPage,
                          })}
                        />
                      </div>
                      {samplesQuery.isFetchingNextPage && (
                        <Flex align="center" gap="2">
                          <Spinner size="1" />
                          <Text size="1" color="gray">
                            Loading more samples...
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

            <LinkedSraFastq
              aliasField={linkedSraAliases}
              agGridThemeClassName={agGridThemeClassName}
            />
            <Flex
              id="supplementary"
              justify="between"
              align="center"
              gap="3"
              wrap="wrap"
            >
              <Flex align="center" gap="2" wrap="wrap">
                <Heading as="h2" weight="medium" size="6">
                  Supplementary Data
                </Heading>
                {supplementaryDataItems.length > 0 && (
                  <>
                    <Badge>
                      {supplementaryDataItems.length.toLocaleString()} file
                      {supplementaryDataItems.length !== 1 ? "s" : ""}
                    </Badge>
                    {allSupplementarySizeLabel && (
                      <Badge>{allSupplementarySizeLabel} total</Badge>
                    )}
                  </>
                )}
                <SectionAnchor id="supplementary" />
              </Flex>
              {supplementaryDataItems.length > 0 && (
                <Flex gap="2" wrap="wrap">
                  <Button
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
                        <Dialog.Title mb="0">Copy download script</Dialog.Title>
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
              )}
            </Flex>
            {supplementaryDataItems.length === 0 && (
              <Text size="2" color="gray">
                No supplementary files found
              </Text>
            )}
            {supplementaryDataItems.length > 0 && (
              <Flex direction="column" gap="2" style={{ width: "100%" }}>
                <div
                  className={agGridThemeClassName}
                  style={{
                    width: "100%",
                    height: `${Math.min(
                      500,
                      48 + supplementaryDataItems.length * 42,
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
            {sampleSupplementaryDataItems.length > 0 && (
            <>
            <Flex justify="between" align="center" gap="3" wrap="wrap" mt="4">
              <Flex align="center" gap="2" wrap="wrap">
                <Text weight="medium" size="4">
                  Sample supplementary files
                </Text>
                {sampleSupplementaryDataItems.length > 0 && (
                  <>
                    <Badge>
                      {sampleSupplementaryDataItems.length.toLocaleString()}{" "}
                      file
                      {sampleSupplementaryDataItems.length !== 1 ? "s" : ""}
                    </Badge>
                    <Badge>
                      {sampleSupplementaryGroupedRows.length.toLocaleString()}{" "}
                      sample
                      {sampleSupplementaryGroupedRows.length !== 1 ? "s" : ""}
                    </Badge>
                    {allSampleSupplementarySizeLabel && (
                      <Badge size="2" variant="soft">
                        {allSampleSupplementarySizeLabel} total
                      </Badge>
                    )}
                  </>
                )}
              </Flex>
              {sampleSupplementaryDataItems.length > 0 && (
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
                          {sampleSupplementaryScriptCopied ? "Copied!" : "Copy"}
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
              )}
            </Flex>
              <Flex direction="column" gap="2" style={{ width: "100%" }}>
                <div
                  className={agGridThemeClassName}
                  style={{
                    width: "100%",
                    height: `${Math.min(
                      500,
                      48 + sampleSupplementaryGroupedRows.length * 72,
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
            </>
            )}

            <Flex id="similar" align="center" gap="2">
              <Heading as="h2" weight="medium" size="6">
                Similar projects
              </Heading>
              <SectionAnchor id="similar" />
            </Flex>
            <LazyMount>
              <SimilarProjectsGraph
                accession={(dataProject ?? project).accession}
                source="geo"
                title={(dataProject ?? project).title}
                description={(dataProject ?? project).summary}
                organisms={(dataProject ?? project).organisms}
                coords2d={(dataProject ?? project).coords_2d}
                coords3d={(dataProject ?? project).coords_3d}
                neighbors={(dataProject ?? project).neighbors}
              />
              <SubmittingOrgPanel center={project.center} />
            </LazyMount>
          </Flex>
        </>
      )}
    </>
  );
}
