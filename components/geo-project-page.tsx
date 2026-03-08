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
import TextWithLineBreaks, {
  normalizeLineBreakText,
} from "@/components/text-with-line-breaks";
import { ensureAgGridModules } from "@/lib/ag-grid";
import { copyToClipboard } from "@/utils/clipboard";
import { SERVER_URL } from "@/utils/constants";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
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
  Spinner,
  Tabs,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";
import type {
  ColDef,
  ICellRendererParams,
  ValueGetterParams,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useTheme } from "next-themes";
import Image from "next/image";
import { useParams } from "next/navigation";
import React, { useState } from "react";

ensureAgGridModules();

// Component to truncate text in table cells with more/less toggle
function TruncatedCell({
  text,
  wordLimit = 10,
}: {
  text: string | null;
  wordLimit?: number;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!text || text === "-") return <>{text ?? "-"}</>;
  const normalizedText = normalizeLineBreakText(text);

  const words = normalizedText.split(/\s+/);
  const shouldTruncate = words.length > wordLimit;

  if (!shouldTruncate) return <TextWithLineBreaks text={normalizedText} />;

  const display = expanded
    ? normalizedText
    : words.slice(0, wordLimit).join(" ") + "...";

  return (
    <>
      <TextWithLineBreaks text={display} />
      <Link
        ml="1"
        style={{ cursor: "pointer" }}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? "less" : "more"}
      </Link>
    </>
  );
}

type Project = {
  accession: string;
  title: string;
  summary: string;
  overall_design: string;
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
  publications?: StudyPublication[] | null;
};

// type SimilarProject = {
//   accession: string;
//   title: string | null;
//   summary: string | null;
//   updated_at: Date | null;
// };

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
};

const toDisplayText = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
};

const parsePostgresTextArray = (value: string): string[] => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return [];
  }

  const content = trimmed.slice(1, -1);
  if (!content) {
    return [];
  }

  const items: string[] = [];
  let current = "";
  let inQuotes = false;
  let escaped = false;

  for (const char of content) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      if (inQuotes) {
        escaped = true;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      if (current.trim()) {
        items.push(current.trim());
      }
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    items.push(current.trim());
  }

  return items;
};

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
    if (typeof resolvedUrl !== "string" || resolvedUrl.trim().length === 0) {
      return null;
    }
    const rawType = record["@type"];
    const rawPath = record.path;
    const rawSize = record.size;
    return {
      url: resolvedUrl.trim(),
      "@type":
        typeof rawType === "string" && rawType.trim() ? rawType.trim() : null,
      path: typeof rawPath === "string" && rawPath.trim() ? rawPath.trim() : null,
      size: typeof rawSize === "number" && Number.isFinite(rawSize) ? rawSize : null,
    };
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    if (
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      trimmed.startsWith("ftp://")
    ) {
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

const shellEscapeSingleQuotes = (value: string): string =>
  `'${value.replace(/'/g, `'\"'\"'`)}'`;

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

const buildCurlCommand = (url: string): string =>
  `curl -O ${shellEscapeSingleQuotes(url)}`;

const buildCombinedCurlCommand = (urls: string[]): string => {
  if (urls.length === 0) return "";
  return `curl -L ${urls.map((url) => `-O ${shellEscapeSingleQuotes(url)}`).join(" ")}`;
};

const buildSupplementaryDownloadScript = (
  accession: string,
  items: { fileName: string; browserDownloadUrl: string }[],
): string => {
  if (items.length === 0) return "";
  const lines = [
    "#!/usr/bin/env bash",
    `# Download supplementary files for ${accession}`,
    `# ${items.length} file${items.length !== 1 ? "s" : ""}`,
    "# Generated by seqout.org",
    "",
    "set -euo pipefail",
    "",
    `mkdir -p ${shellEscapeSingleQuotes(accession)}`,
    ...items.map(
      (item) =>
        `curl -L -o ${shellEscapeSingleQuotes(`${accession}/${item.fileName}`)} ${shellEscapeSingleQuotes(item.browserDownloadUrl)}`,
    ),
    "",
    `echo "Done — ${items.length} file${items.length !== 1 ? "s" : ""} saved under ./${accession}/"`,
    "",
  ];
  return lines.join("\n");
};

const formatFileSize = (sizeInBytes: number | null): string | null => {
  if (sizeInBytes === null || !Number.isFinite(sizeInBytes) || sizeInBytes < 0) {
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

const fetchSamples = async (accession: string): Promise<GeoSample[]> => {
  const res = await fetch(`${SERVER_URL}/geo/series/${accession}/samples`);
  if (!res.ok) {
    throw new Error("Network error");
  }
  return res.json();
};

const fetchProject = async (
  accession: string | null,
): Promise<Project | null> => {
  if (!accession) {
    return null;
  }

  const res = await fetch(`${SERVER_URL}/project/${accession}`);
  if (!res.ok) {
    throw new Error("Network error");
  }
  const data = (await res.json()) as Project & {
    neighbors?: SimilarNeighbor[] | string | null;
  };
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

// const fetchSimilarProjects = async (
//   searchText: string,
//   currentAccession: string,
// ): Promise<SimilarProject[]> => {
//   const res = await fetch(
//     `${SERVER_URL}/search?q=${encodeURIComponent(searchText)}&db=geo`,
//   );
//   if (!res.ok) {
//     throw new Error("Network error");
//   }
//   const data = await res.json();
//   // Filter out the current project and return top 5
//   return (data.results as SimilarProject[])
//     .filter((p) => p.accession !== currentAccession)
//     .slice(0, 5);
// };

const SUMMARY_CHAR_LIMIT = 350;
const OVERALL_DESIGN_CHAR_LIMIT = 350;

export default function GeoProjectPage() {
  const params = useParams();
  const { resolvedTheme } = useTheme();
  const accession = params.accession as string | undefined;
  const isArrayExpress = accession?.toUpperCase().startsWith("E-") ?? false;
  const [isAccessionCopied, setIsAccessionCopied] = useState(false);
  const [copiedSupplementaryId, setCopiedSupplementaryId] = useState<
    string | null
  >(null);
  const [isDownloadingAllSupplementary, setIsDownloadingAllSupplementary] =
    useState(false);
  const [downloadAllProgressPercent, setDownloadAllProgressPercent] = useState<
    number | null
  >(null);
  const [canScrollSupplementaryTabsLeft, setCanScrollSupplementaryTabsLeft] =
    useState(false);
  const [canScrollSupplementaryTabsRight, setCanScrollSupplementaryTabsRight] =
    useState(false);
  const supplementaryTabsListRef = React.useRef<HTMLDivElement | null>(null);
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

  // const { data: similarProjects, isLoading: isSimilarLoading } = useQuery({
  //   queryKey: ["similarProjects", project?.overall_design],
  //   queryFn: () =>
  //     fetchSimilarProjects(project!.overall_design, project!.accession),
  //   enabled: !!project?.overall_design,
  // });

  const publications = project?.publications ?? null;
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
      projectAliases.filter((alias) =>
        alias.toUpperCase().startsWith("E-"),
      ),
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

  const { data: samples, isLoading: isSamplesLoading } = useQuery({
    queryKey: ["samples", accession],
    queryFn: () => fetchSamples(accession!),
    enabled: !!accession,
  });

  const handleCopyAccession = () => {
    if (!accession) return;
    copyToClipboard(accession);
    setIsAccessionCopied(true);
    window.setTimeout(() => setIsAccessionCopied(false), 1500);
  };

  const handleCopySupplementaryCommand = (
    itemId: string,
    command: string,
  ) => {
    copyToClipboard(command);
    setCopiedSupplementaryId(itemId);
    window.setTimeout(() => {
      setCopiedSupplementaryId((current) =>
        current === itemId ? null : current,
      );
    }, 1500);
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

  const updateSupplementaryTabsScrollState = React.useCallback(() => {
    const tabsListElement = supplementaryTabsListRef.current;
    if (!tabsListElement) {
      setCanScrollSupplementaryTabsLeft(false);
      setCanScrollSupplementaryTabsRight(false);
      return;
    }
    const maxScrollLeft =
      tabsListElement.scrollWidth - tabsListElement.clientWidth;
    setCanScrollSupplementaryTabsLeft(tabsListElement.scrollLeft > 4);
    setCanScrollSupplementaryTabsRight(
      maxScrollLeft - tabsListElement.scrollLeft > 4,
    );
  }, []);

  const scrollSupplementaryTabs = (direction: "left" | "right") => {
    const tabsListElement = supplementaryTabsListRef.current;
    if (!tabsListElement) return;
    tabsListElement.scrollBy({
      left: direction === "left" ? -220 : 220,
      behavior: "smooth",
    });
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
    }),
    [],
  );

  const sampleColumnDefs = React.useMemo<ColDef<GeoSampleGridRow>[]>(
    () => [
      {
        headerName: "Sample",
        field: "sample",
        minWidth: 140,
        pinned: "left",
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
        minWidth: 220,
        autoHeight: true,
        wrapText: true,
        cellRenderer: (params: ICellRendererParams<GeoSampleGridRow>) => (
          <TruncatedCell text={toDisplayText(params.value)} />
        ),
      },
      {
        headerName: "Description",
        field: "description",
        minWidth: 260,
        autoHeight: true,
        wrapText: true,
        cellRenderer: (params: ICellRendererParams<GeoSampleGridRow>) => (
          <TruncatedCell text={toDisplayText(params.value)} />
        ),
      },
      {
        headerName: "Channel Count",
        field: "channelCount",
        minWidth: 140,
        valueFormatter: (params) => toDisplayText(params.value),
      },
      {
        headerName: "Sample Type",
        field: "sampleType",
        minWidth: 140,
        valueFormatter: (params) => toDisplayText(params.value),
      },
      {
        headerName: "Platform",
        field: "platform",
        minWidth: 140,
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
        minWidth: 150,
        valueFormatter: (params) => toDisplayText(params.value),
      },
      {
        headerName: "Label",
        field: "label",
        minWidth: 120,
        valueFormatter: (params) => toDisplayText(params.value),
      },
      {
        headerName: "Source",
        field: "source",
        minWidth: 220,
        autoHeight: true,
        wrapText: true,
        cellRenderer: (params: ICellRendererParams<GeoSampleGridRow>) => (
          <TruncatedCell text={toDisplayText(params.value)} />
        ),
      },
      {
        headerName: "Molecule",
        field: "molecule",
        minWidth: 140,
        valueFormatter: (params) => toDisplayText(params.value),
      },
      {
        headerName: "Organism",
        field: "organism",
        minWidth: 160,
        valueFormatter: (params) => toDisplayText(params.value),
      },
      {
        headerName: "Label Protocol",
        field: "labelProtocol",
        minWidth: 300,
        autoHeight: true,
        wrapText: true,
        cellRenderer: (params: ICellRendererParams<GeoSampleGridRow>) => (
          <TruncatedCell text={toDisplayText(params.value)} />
        ),
      },
      {
        headerName: "Extract Protocol",
        field: "extractProtocol",
        minWidth: 300,
        autoHeight: true,
        wrapText: true,
        cellRenderer: (params: ICellRendererParams<GeoSampleGridRow>) => (
          <TruncatedCell text={toDisplayText(params.value)} />
        ),
      },
      ...characteristicTags.map(
        (tag): ColDef<GeoSampleGridRow> => ({
          headerName: tag,
          minWidth: 140,
          valueGetter: (params: ValueGetterParams<GeoSampleGridRow>) =>
            params.data?.characteristics[tag] ?? "-",
        }),
      ),
      {
        headerName: "Hybridization Protocol",
        field: "hybridizationProtocol",
        minWidth: 300,
        autoHeight: true,
        wrapText: true,
        cellRenderer: (params: ICellRendererParams<GeoSampleGridRow>) => (
          <TruncatedCell text={toDisplayText(params.value)} />
        ),
      },
      {
        headerName: "Scan Protocol",
        field: "scanProtocol",
        minWidth: 300,
        autoHeight: true,
        wrapText: true,
        cellRenderer: (params: ICellRendererParams<GeoSampleGridRow>) => (
          <TruncatedCell text={toDisplayText(params.value)} />
        ),
      },
    ],
    [accession, characteristicTags, isArrayExpress],
  );

  const supplementaryDataItems = React.useMemo(() => {
    return parseSupplementaryData(project?.supplementary_data)
      .map((entry, index): SupplementaryDataItem | null => {
        const url = entry.url?.trim();
        if (!url) {
          return null;
        }
        const browserDownloadUrl = getBrowserDownloadUrl(url);
        const fileName = entry.path?.trim() || getFileNameFromUrl(url);
        return {
          id: `supplementary-${index}`,
          url: browserDownloadUrl,
          fileName,
          fileSizeBytes: entry.size,
          fileSizeLabel: formatFileSize(entry.size),
          curlCommand: buildCurlCommand(browserDownloadUrl),
          browserDownloadUrl,
          downloadUrl: shouldUseProxyDownload(browserDownloadUrl, fileName)
            ? getAppDownloadUrl(browserDownloadUrl, fileName)
            : browserDownloadUrl,
        };
      })
      .filter((entry): entry is SupplementaryDataItem => entry !== null);
  }, [project?.supplementary_data]);

  const allSupplementaryCurlCommand = React.useMemo(
    () =>
      buildCombinedCurlCommand(
        supplementaryDataItems.map((item) => item.browserDownloadUrl),
      ),
    [supplementaryDataItems],
  );

  const cliDownloadCommand = `curl -sS "https://seqout.org/api/project/${accession}/supplementary/download" | bash`;

  const allSupplementarySizeLabel = React.useMemo(() => {
    if (!isArrayExpress || supplementaryDataItems.length === 0) {
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
  }, [isArrayExpress, supplementaryDataItems]);

  const showAllSupplementaryTab = supplementaryDataItems.length > 1;

  React.useEffect(() => {
    updateSupplementaryTabsScrollState();
    const frameId = window.requestAnimationFrame(
      updateSupplementaryTabsScrollState,
    );
    window.addEventListener("resize", updateSupplementaryTabsScrollState);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", updateSupplementaryTabsScrollState);
    };
  }, [
    updateSupplementaryTabsScrollState,
    supplementaryDataItems,
    showAllSupplementaryTab,
  ]);

  return (
    <>
      <SearchBar initialQuery={""} />

      {!accession && (
        <Flex
          gap="4"
          align="center"
          p={"4"}
          ml={{ initial: "0", md: "8rem" }}
          mr={{ initial: "0", md: "16rem" }}
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
          <Text>Getting metadata</Text>
        </Flex>
      )}

      {/* Error state */}
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
              <Text size={{ initial: "4", md: "6" }} weight="bold">
                {project.title}
              </Text>
            </Flex>
            <Flex justify={"start"} align="center" gap="2" wrap="wrap">
              <Badge
                size={{ initial: "2", md: "3" }}
                color={isArrayExpress ? "gold" : undefined}
                variant={isArrayExpress ? "solid" : undefined}
                style={{ whiteSpace: "nowrap" }}
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
              <Text weight="medium" size="6">
                Overall design
              </Text>
              <SectionAnchor id="overall-design" />
            </Flex>
            <ProjectSummary
              text={project.overall_design}
              charLimit={OVERALL_DESIGN_CHAR_LIMIT}
            />

            {/* Samples table */}
            <Flex id="samples" justify={"between"} align={"center"}>
              <Flex align="center" gap="2">
                <Text weight="medium" size="6">
                  Samples
                </Text>
                <SectionAnchor id="samples" />
              </Flex>
              <Button
                onClick={() => {
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
              >
                <DownloadIcon /> CSV
              </Button>
            </Flex>
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
                <div
                  className={agGridThemeClassName}
                  style={{
                    height: "500px",
                    width: "100%",
                  }}
                >
                  <AgGridReact<GeoSampleGridRow>
                    columnDefs={sampleColumnDefs}
                    defaultColDef={sampleGridDefaultColDef}
                    getRowId={(params) => params.data.rowKey}
                    rowData={sampleRows}
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
              source="geo"
              title={project.title}
              description={project.summary}
              organisms={project.organisms}
              coords2d={project.coords_2d}
              coords3d={project.coords_3d}
              neighbors={project.neighbors}
            />
            <SubmittingOrgPanel center={project.center} />
            <Flex id="supplementary" justify="between" align="center">
              <Flex align="center" gap="2">
                <Text weight="medium" size="6">
                  Supplementary Data
                </Text>
                <SectionAnchor id="supplementary" />
              </Flex>
              {supplementaryDataItems.length > 0 && (
                <Button
                  size="1"
                  variant="surface"
                  onClick={() => {
                    const script = buildSupplementaryDownloadScript(
                      accession,
                      supplementaryDataItems,
                    );
                    if (!script) return;
                    copyToClipboard(script);
                    setCopiedSupplementaryId("script");
                    setTimeout(() => setCopiedSupplementaryId((c) => c === "script" ? null : c), 1500);
                  }}
                >
                  {copiedSupplementaryId === "script" ? <CheckIcon /> : <CopyIcon />}{" "}
                  {copiedSupplementaryId === "script" ? "Copied!" : "Copy script"}
                </Button>
              )}
            </Flex>
            {supplementaryDataItems.length === 0 && (
              <Text size="2" color="gray">
                No supplementary files found
              </Text>
            )}
            {supplementaryDataItems.length > 0 && (
              <Tabs.Root
                defaultValue={
                  showAllSupplementaryTab
                    ? "supplementary-all"
                    : supplementaryDataItems[0].id
                }
                style={{ width: "100%", maxWidth: "100%", overflow: "hidden" }}
              >
                <Flex align="center" gap="2">
                  {canScrollSupplementaryTabsLeft && (
                    <Button
                      size="1"
                      variant="soft"
                      onClick={() => scrollSupplementaryTabs("left")}
                      aria-label="Scroll supplementary tabs left"
                    >
                      <ChevronLeftIcon />
                    </Button>
                  )}
                  <Tabs.List
                    ref={supplementaryTabsListRef}
                    onScroll={updateSupplementaryTabsScrollState}
                    style={{
                      width: "100%",
                      maxWidth: "100%",
                      overflowX: "auto",
                      overflowY: "hidden",
                      whiteSpace: "nowrap",
                      display: "flex",
                      flexWrap: "nowrap",
                    }}
                  >
                    {showAllSupplementaryTab && (
                      <Tabs.Trigger
                        value="supplementary-all"
                        style={{ flexShrink: 0 }}
                      >
                        <Flex align="center" gap="2">
                          <span>All</span>
                          {allSupplementarySizeLabel && (
                            <Badge color="gray" variant="soft" size="1">
                              {allSupplementarySizeLabel}
                            </Badge>
                          )}
                        </Flex>
                      </Tabs.Trigger>
                    )}
                    {supplementaryDataItems.map((item) => (
                      <Tabs.Trigger
                        key={item.id}
                        value={item.id}
                        style={{ flexShrink: 0, fontFamily: "monospace" }}
                      >
                        <Flex align="center" gap="2">
                          <span>{item.fileName}</span>
                          {item.fileSizeLabel && (
                            <Badge color="gray" variant="soft" size="1">
                              {item.fileSizeLabel}
                            </Badge>
                          )}
                        </Flex>
                      </Tabs.Trigger>
                    ))}
                  </Tabs.List>
                  {canScrollSupplementaryTabsRight && (
                    <Button
                      size="1"
                      variant="soft"
                      onClick={() => scrollSupplementaryTabs("right")}
                      aria-label="Scroll supplementary tabs right"
                    >
                      <ChevronRightIcon />
                    </Button>
                  )}
                </Flex>
                {showAllSupplementaryTab && (
                  <Tabs.Content
                    value="supplementary-all"
                    style={{ marginTop: "0.75rem", maxWidth: "100%" }}
                  >
                    <Flex direction="column" gap="2" style={{ maxWidth: "100%" }}>
                      <div
                        style={{
                          width: "100%",
                          maxWidth: "100%",
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr) auto",
                          alignItems: "center",
                          columnGap: "0.5rem",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            minWidth: 0,
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
                            <code>{allSupplementaryCurlCommand}</code>
                          </pre>
                          <Tooltip content="Copy command">
                            <button
                              type="button"
                              onClick={() =>
                                handleCopySupplementaryCommand(
                                  "supplementary-all",
                                  allSupplementaryCurlCommand,
                                )
                              }
                              aria-label="Copy all-files curl command"
                              style={{
                                width: "2.5rem",
                                minWidth: "2.5rem",
                                border: "none",
                                background: "transparent",
                                color: "inherit",
                                padding: "0.5rem",
                                margin: 0,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                              }}
                            >
                              {copiedSupplementaryId === "supplementary-all" ? (
                                <CheckIcon />
                              ) : (
                                <CopyIcon />
                              )}
                            </button>
                          </Tooltip>
                        </div>
                        <Tooltip content="Download all files">
                          <Button
                            size={"3"}
                            disabled={isDownloadingAllSupplementary}
                            onClick={() =>
                              handleDownloadAllSupplementaryFiles(
                                supplementaryDataItems,
                              )
                            }
                            aria-label="Download all supplementary files"
                          >
                            {isDownloadingAllSupplementary ? (
                              <Flex align="center" gap="1">
                                <Spinner size="1" />
                                <Text size="1">
                                  {downloadAllProgressPercent !== null
                                    ? `${downloadAllProgressPercent}%`
                                    : "..." }
                                </Text>
                              </Flex>
                            ) : (
                              <DownloadIcon />
                            )}
                          </Button>
                        </Tooltip>
                      </div>
                    </Flex>
                  </Tabs.Content>
                )}
                {supplementaryDataItems.map((item) => (
                  <Tabs.Content
                    key={item.id}
                    value={item.id}
                    style={{ marginTop: "0.75rem", maxWidth: "100%" }}
                  >
                    <Flex
                      direction="column"
                      gap="2"
                      style={{ maxWidth: "100%" }}
                    >
                      <div
                        style={{
                          width: "100%",
                          maxWidth: "100%",
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr) auto",
                          alignItems: "center",
                          columnGap: "0.5rem",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            minWidth: 0,
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
                            <code>{item.curlCommand}</code>
                          </pre>
                          <Tooltip content="Copy command">
                            <button
                              type="button"
                              onClick={() =>
                                handleCopySupplementaryCommand(
                                  item.id,
                                  item.curlCommand,
                                )
                              }
                              aria-label="Copy curl command"
                              style={{
                                width: "2.5rem",
                                minWidth: "2.5rem",
                                border: "none",
                                background: "transparent",
                                color: "inherit",
                                padding: "0.5rem",
                                margin: 0,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                              }}
                            >
                              {copiedSupplementaryId === item.id ? (
                                <CheckIcon />
                              ) : (
                                <CopyIcon />
                              )}
                            </button>
                          </Tooltip>
                        </div>
                        <Tooltip content="Download file to device">
                          <Button asChild size={"3"}>
                            <a
                              href={item.downloadUrl}
                              download={item.fileName}
                              aria-label={`Download ${item.fileName}`}
                            >
                              <DownloadIcon />
                            </a>
                          </Button>
                        </Tooltip>
                      </div>
                    </Flex>
                  </Tabs.Content>
                ))}
              </Tabs.Root>
            )}
            {supplementaryDataItems.length > 0 && (
              <Flex direction="column" gap="2">
                <Text size="4" weight="medium">
                  Download all via CLI
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
                    <code>{cliDownloadCommand}</code>
                  </pre>
                  <Tooltip content="Copy command">
                    <button
                      type="button"
                      onClick={() =>
                        handleCopySupplementaryCommand(
                          "cli-download",
                          cliDownloadCommand,
                        )
                      }
                      aria-label="Copy CLI download command"
                      style={{
                        width: "2.5rem",
                        minWidth: "2.5rem",
                        border: "none",
                        background: "transparent",
                        color: "inherit",
                        padding: "0.5rem",
                        margin: 0,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                      }}
                    >
                      {copiedSupplementaryId === "cli-download" ? (
                        <CheckIcon />
                      ) : (
                        <CopyIcon />
                      )}
                    </button>
                  </Tooltip>
                </div>
              </Flex>
            )}
          </Flex>
        </>
      )}
    </>
  );
}
