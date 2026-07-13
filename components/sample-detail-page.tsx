"use client";
import ProjectSummary from "@/components/project-summary";
import { SupplementaryDataSection } from "@/components/supplementary-data-section";
import PublicationCard, {
  StudyPublication,
} from "@/components/publication-card";
import SearchBar from "@/components/search-bar";
import SubmittingOrgPanel, {
  CenterInfo,
} from "@/components/submitting-org-panel";
import SectionAnchor from "@/components/section-anchor";
import TextWithLineBreaks from "@/components/text-with-line-breaks";
import { ensureAgGridModules } from "@/lib/ag-grid";
import { useToast } from "@/components/toast-provider";
import { getExternalArchiveUrl } from "@/utils/accessionLinks";
import { getJson } from "@/utils/api";
import { copyToClipboard } from "@/utils/clipboard";
import { SERVER_URL } from "@/utils/constants";
import { dbColorForArchive } from "@/utils/db-colors";
import { fileUrl } from "@/utils/fileUrl";
import { formatBytes } from "@/utils/format";
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  HomeIcon,
  InfoCircledIcon,
  MagnifyingGlassIcon,
  ReloadIcon,
} from "@radix-ui/react-icons";
import {
  Badge,
  Button,
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
  ICellRendererParams,
  ValueGetterParams,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useTheme } from "next-themes";
import { useParams } from "next/navigation";
import React, { useState } from "react";

ensureAgGridModules();

type Project = {
  accession: string;
  alias: string | null;
  title: string;
  abstract?: string | null;
  summary?: string | null;
  organisms?: string[] | string | null;
  center?: CenterInfo | CenterInfo[] | null;
  publications?: StudyPublication[] | null;
  published_at?: string | null;
  updated_at?: string | null;
  supplementary_data?: unknown;
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
  study: string | null;
};

type Sample = {
  accession: string;
  alias?: string | null;
  description?: string | null;
  title?: string | null;
  scientific_name?: string | null;
  taxon_id?: string | null;
  attributes_json?: Record<string, string> | null;
  // GEO sample fields
  channels?: GeoChannel[];
  channel_count?: number;
  sample_type?: string | null;
  platform_ref?: string | null;
  supplementary_data?: unknown;
};

type GeoChannel = {
  Characteristics?: { "@tag": string; "#text": string }[];
  Source?: string;
  Organism?: { "#text": string; "@taxid": string } | string;
  Molecule?: string;
  Label?: string;
  "@position"?: string;
};

export type RunRow = {
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

type SampleDetailResponse = {
  sample_type: "geo_sample" | "sra_experiment" | "sra_sample";
  project: Project | null;
  project_accession: string | null;
  sample: Sample | null;
  experiment: Experiment | null;
  runs: RunRow[] | null;
};

const fetchSampleDetail = async (
  accession: string | null,
): Promise<SampleDetailResponse | null> => {
  if (!accession) return null;
  return getJson<SampleDetailResponse>(`/sample-detail/${accession}`);
};

function GeoSampleDetail({ sample }: { sample: Sample }) {
  const channels = sample.channels || [];

  return (
    <Flex direction="column" gap="3">
      {sample.title && (
        <Text size="3" weight="medium">
          {sample.title}
        </Text>
      )}
      {sample.description && (
        <Text size="2" color="gray">
          <TextWithLineBreaks text={sample.description} />
        </Text>
      )}
      {sample.sample_type && (
        <Flex gap="2" align="center">
          <Text size="2" color="gray">
            Type:
          </Text>
          <Badge size="2" variant="soft">
            {sample.sample_type}
          </Badge>
        </Flex>
      )}
      {sample.platform_ref && (
        <Flex gap="2" align="center">
          <Text size="2" color="gray">
            Platform:
          </Text>
          <Text size="2">{sample.platform_ref}</Text>
        </Flex>
      )}

      {channels.map((ch, idx) => {
        const org =
          typeof ch.Organism === "object"
            ? ch.Organism?.["#text"]
            : ch.Organism;
        const chars = ch.Characteristics || [];
        return (
          <Flex
            key={idx}
            direction="column"
            gap="2"
            p="3"
            style={{
              background: "var(--gray-2)",
              borderRadius: "var(--radius-3)",
              border: "1px solid var(--gray-4)",
            }}
          >
            {channels.length > 1 && (
              <Text size="2" weight="medium">
                Channel {ch["@position"] || idx + 1}
              </Text>
            )}
            {org && (
              <Flex gap="2" align="center">
                <Text size="2" color="gray">
                  Organism:
                </Text>
                <Text size="2" style={{ fontStyle: "italic" }}>
                  {org}
                </Text>
              </Flex>
            )}
            {ch.Source && (
              <Flex gap="2" align="center">
                <Text size="2" color="gray">
                  Source:
                </Text>
                <Text size="2">{ch.Source}</Text>
              </Flex>
            )}
            {ch.Molecule && (
              <Flex gap="2" align="center">
                <Text size="2" color="gray">
                  Molecule:
                </Text>
                <Text size="2">{ch.Molecule}</Text>
              </Flex>
            )}
            {chars.length > 0 && (
              <Flex direction="column" gap="1" mt="1">
                <Text size="2" weight="medium">
                  Characteristics
                </Text>
                {chars.map((c, ci) => (
                  <Flex key={ci} gap="2">
                    <Text
                      size="1"
                      color="gray"
                      style={{ minWidth: "120px", fontWeight: 500 }}
                    >
                      {c["@tag"]}:
                    </Text>
                    <Text size="1">{c["#text"]}</Text>
                  </Flex>
                ))}
              </Flex>
            )}
          </Flex>
        );
      })}
    </Flex>
  );
}

function SraSampleDetail({
  sample,
  experiment,
}: {
  sample: Sample | null;
  experiment: Experiment | null;
}) {
  // Parse attributes if string
  let attributes: Record<string, string> = {};
  if (sample?.attributes_json) {
    if (typeof sample.attributes_json === "string") {
      try {
        const parsed = JSON.parse(sample.attributes_json);
        if (Array.isArray(parsed)) {
          for (const attr of parsed) {
            const key = attr.tag || attr.key || "";
            if (key) attributes[key] = attr.value || "";
          }
        } else if (typeof parsed === "object") {
          attributes = parsed;
        }
      } catch {
        /* ignore */
      }
    } else if (typeof sample.attributes_json === "object") {
      if (Array.isArray(sample.attributes_json)) {
        for (const attr of sample.attributes_json as unknown as {
          tag?: string;
          key?: string;
          value?: string;
        }[]) {
          const key = attr.tag || attr.key || "";
          if (key) attributes[key] = attr.value || "";
        }
      } else {
        attributes = sample.attributes_json;
      }
    }
  }

  return (
    <Flex direction="column" gap="3">
      {experiment && (
        <Flex
          direction="column"
          gap="2"
          p="3"
          style={{
            background: "var(--gray-2)",
            borderRadius: "var(--radius-3)",
            border: "1px solid var(--gray-4)",
          }}
        >
          <Text size="2" weight="medium">
            Experiment
          </Text>
          <Flex gap="2" wrap="wrap">
            <Badge size="2" variant="outline">
              {experiment.accession}
            </Badge>
            {experiment.library_strategy && (
              <Badge size="2" color="blue" variant="soft">
                {experiment.library_strategy}
              </Badge>
            )}
            {experiment.library_layout && (
              <Badge
                size="2"
                color={
                  experiment.library_layout === "PAIRED" ? "blue" : "gray"
                }
                variant="soft"
              >
                {experiment.library_layout}
              </Badge>
            )}
            {experiment.platform && (
              <Badge size="2" variant="soft">
                {experiment.platform}
              </Badge>
            )}
            {experiment.instrument_model && (
              <Badge size="2" color="gray" variant="soft">
                {experiment.instrument_model}
              </Badge>
            )}
          </Flex>
          {experiment.title && (
            <Text size="2" color="gray">
              {experiment.title}
            </Text>
          )}
          {experiment.design_description && (
            <Text size="1" color="gray">
              <TextWithLineBreaks text={experiment.design_description} />
            </Text>
          )}
        </Flex>
      )}

      {sample && (
        <Flex
          direction="column"
          gap="2"
          p="3"
          style={{
            background: "var(--gray-2)",
            borderRadius: "var(--radius-3)",
            border: "1px solid var(--gray-4)",
          }}
        >
          <Flex justify="between" align="center">
            <Text size="2" weight="medium">
              Sample
            </Text>
            <Badge size="1" variant="outline">
              {sample.accession}
            </Badge>
          </Flex>
          {sample.title && <Text size="2">{sample.title}</Text>}
          {sample.description && (
            <Text size="1" color="gray">
              <TextWithLineBreaks text={sample.description} />
            </Text>
          )}
          {sample.scientific_name && (
            <Flex gap="2" align="center">
              <Text size="2" color="gray">
                Organism:
              </Text>
              <Text size="2" style={{ fontStyle: "italic" }}>
                {sample.scientific_name}
              </Text>
              {sample.taxon_id && (
                <Text size="1" color="gray">
                  (taxid: {sample.taxon_id})
                </Text>
              )}
            </Flex>
          )}

          {Object.keys(attributes).length > 0 && (
            <Flex direction="column" gap="1" mt="1">
              <Text size="2" weight="medium">
                Attributes
              </Text>
              {Object.entries(attributes).map(([key, value]) => (
                <Flex key={key} gap="2">
                  <Text
                    size="1"
                    color="gray"
                    style={{ minWidth: "140px", fontWeight: 500 }}
                  >
                    {key}:
                  </Text>
                  <Text size="1">{value || "-"}</Text>
                </Flex>
              ))}
            </Flex>
          )}
        </Flex>
      )}
    </Flex>
  );
}

export function RunsSection({
  runs,
  agGridThemeClassName,
}: {
  runs: RunRow[];
  agGridThemeClassName: string;
}) {
  const hasMissingFastq = runs.some((r) => !r.fastq_ftp);
  const pairedCount = runs.filter(
    (r) => r.library_layout === "PAIRED",
  ).length;
  const singleCount = runs.filter(
    (r) => r.library_layout === "SINGLE",
  ).length;
  const totalBytes = runs.reduce((sum, r) => {
    const bytes = r.fastq_bytes
      ? r.fastq_bytes
          .split(";")
          .filter(Boolean)
          .reduce((s, b) => s + (parseInt(b, 10) || 0), 0)
      : 0;
    return sum + bytes;
  }, 0);

  const colDefs = React.useMemo<ColDef<RunRow>[]>(
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
        cellStyle: { fontFamily: "var(--code-font-family)", fontSize: "0.8rem" },
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
                    <Badge size="1" color="amber" variant="soft" style={{ cursor: "help", width: "fit-content" }}>
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
                if (row.ncbi_sra_normalized_url)
                  entries.push({
                    url: row.ncbi_sra_normalized_url,
                    bytes: row.ncbi_sra_normalized_bytes,
                    badge: "SRA",
                    color: "orange",
                  });
                if (row.ncbi_sra_lite_url)
                  entries.push({
                    url: row.ncbi_sra_lite_url,
                    bytes: row.ncbi_sra_lite_bytes,
                    badge: "Lite",
                    color: "blue",
                  });
                if (row.ncbi_sra_lite_s3_url)
                  entries.push({
                    url: row.ncbi_sra_lite_s3_url,
                    bytes: null,
                    badge: "S3",
                    color: "violet",
                  });
                if (row.ncbi_sra_lite_gs_url)
                  entries.push({
                    url: row.ncbi_sra_lite_gs_url,
                    bytes: null,
                    badge: "GCS",
                    color: "gray",
                  });
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
                      const label =
                        e.url.split("/").pop() || row.run_accession;
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
    [hasMissingFastq],
  );

  const defaultColDef = React.useMemo<ColDef<RunRow>>(
    () => ({ filter: true, resizable: true, sortable: true }),
    [],
  );

  const gridHeight = Math.min(400, 48 + runs.length * 42);

  return (
    <>
      <Flex id="runs" align="center" gap="2">
        <Heading as="h2" weight="medium" size="5">
          Runs
        </Heading>
        <SectionAnchor id="runs" />
        <Badge size="2" color="gray">
          {runs.length} run{runs.length !== 1 ? "s" : ""}
        </Badge>
      </Flex>

      <Flex gap="2" wrap="wrap">
        {pairedCount > 0 && (
          <Badge size="2" color="blue" variant="soft">
            {pairedCount} paired-end
          </Badge>
        )}
        {singleCount > 0 && (
          <Badge size="2" variant="soft">
            {singleCount} single-end
          </Badge>
        )}
        {totalBytes > 0 && (
          <Badge size="2" variant="soft">
            {formatBytes(totalBytes)} total
          </Badge>
        )}
      </Flex>

      <div
        className={agGridThemeClassName}
        style={{ width: "100%", height: `${gridHeight}px` }}
      >
        <AgGridReact<RunRow>
          columnDefs={colDefs}
          defaultColDef={defaultColDef}
          enableCellTextSelection
          ensureDomOrder
          rowData={runs}
          getRowId={(params) => params.data.run_accession}
          theme="legacy"
        />
      </div>
    </>
  );
}

function getDbBadgeColor(accession: string) {
  const external = getExternalArchiveUrl(accession);
  return external ? dbColorForArchive(external.archive) : undefined;
}

export default function SampleDetailPage() {
  const params = useParams();
  const { resolvedTheme } = useTheme();
  const { showToast } = useToast();
  const accession = params.accession as string | undefined;
  const [isAccessionCopied, setIsAccessionCopied] = useState(false);
  const agGridThemeClassName =
    resolvedTheme === "dark" ? "ag-theme-quartz-dark" : "ag-theme-quartz";

  const {
    data: detail,
    isLoading,
    isError,
    refetch: refetchSample,
  } = useQuery({
    queryKey: ["sample-detail", accession],
    queryFn: () => fetchSampleDetail(accession ?? null),
    enabled: !!accession,
  });

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

  const project = detail?.project;
  const sample = detail?.sample;
  const experiment = detail?.experiment;
  const runs = detail?.runs;
  const projectAccession = detail?.project_accession;
  const sampleType = detail?.sample_type;

  const externalLink = accession
    ? getExternalArchiveUrl(accession)
    : null;
  const badgeColor = accession ? getDbBadgeColor(accession) : undefined;

  const publications = project?.publications ?? null;
  const projectDescription =
    project?.abstract || project?.summary || null;

  const rawOrganisms = project?.organisms;
  const organisms = React.useMemo(() => {
    if (!rawOrganisms) return [];
    if (Array.isArray(rawOrganisms)) return rawOrganisms;
    if (typeof rawOrganisms === "string") {
      try {
        return JSON.parse(rawOrganisms) as string[];
      } catch {
        return rawOrganisms
          .split(/[;,|]/)
          .map((s) => s.trim())
          .filter(Boolean);
      }
    }
    return [];
  }, [rawOrganisms]);

  return (
    <>
      <SearchBar initialQuery={""} />

      {!accession && (
        <Flex
          gap="4"
          align="center"
          p="4"
          ml={{ initial: "0", md: "8rem" }}
          mr={{ md: "16rem" }}
          justify="center"
          direction="column"
        >
          <Text size={{ initial: "4", md: "5" }} weight="bold">
            No sample specified
          </Text>
          <Text
            size="2"
            align="center"
            style={{ color: "var(--gray-11)", maxWidth: "32rem" }}
          >
            The URL needs an accession like{" "}
            <span className="seqout-accession">/s/SRS123456</span>.
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
          pt="3"
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
          height="20rem"
          direction="column"
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
            The sample may not exist, or the server may be temporarily
            unavailable. Retrying is safe.
          </Text>
          <Flex gap="2" mt="1">
            <Button variant="surface" onClick={() => refetchSample()}>
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

      {accession && !isLoading && !isError && detail && (
        <Flex
          ml={{ initial: "0", md: "12rem" }}
          mr={{ initial: "0", md: "8rem" }}
          py="3"
          px={{ initial: "4", md: "3" }}
          direction="column"
          gap="4"
        >
          {/* Sample header */}
          <Flex justify="between" style={{ width: "100%" }} align="center">
            <Heading as="h1" size={{ initial: "4", md: "6" }} weight="bold">
              {sample?.title || accession}
            </Heading>
          </Flex>

          <Flex justify="start" align="center" gap="2" wrap="wrap">
            <Badge
              size={{ initial: "2", md: "3" }}
              color={badgeColor}
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

            {projectAccession && (
              <a href={`/p/${projectAccession}`}>
                <Badge
                  size={{ initial: "2", md: "3" }}
                  color="green"
                  style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  {projectAccession}
                  <ExternalLinkIcon />
                </Badge>
              </a>
            )}

            {organisms.map((org) => (
              <Badge
                key={org}
                size={{ initial: "2", md: "3" }}
                color="gray"
                variant="soft"
                style={{ fontStyle: "italic" }}
              >
                {org}
              </Badge>
            ))}

            {externalLink && (
              <a
                href={externalLink.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Badge
                  size={{ initial: "2", md: "3" }}
                  color={badgeColor}
                  variant="outline"
                  style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  {externalLink.label}
                  <ExternalLinkIcon />
                </Badge>
              </a>
            )}

            <a
              href={`${SERVER_URL}/sample-detail/${accession}/download`}
              download
            >
              <Badge
                size={{ initial: "2", md: "3" }}
                variant="outline"
                style={{ cursor: "pointer", whiteSpace: "nowrap" }}
              >
                <DownloadIcon /> Download metadata
              </Badge>
            </a>
          </Flex>

          {/* Sample detail */}
          <Flex direction="column" gap="3">
            <Flex id="sample" align="center" gap="2">
              <Heading as="h2" weight="medium" size="5">
                Sample metadata
              </Heading>
              <SectionAnchor id="sample" />
            </Flex>
            {sampleType === "geo_sample" && sample ? (
              <GeoSampleDetail sample={sample} />
            ) : (
              <SraSampleDetail sample={sample ?? null} experiment={experiment ?? null} />
            )}
          </Flex>

          {/* Runs */}
          {runs && runs.length > 0 && (
            <RunsSection
              runs={runs}
              agGridThemeClassName={agGridThemeClassName}
            />
          )}

          {/* The sample's own supplementary files, then the parent study's —
              both as tables, self-hiding when there are no valid files. */}
          {sample?.supplementary_data ? (
            <SupplementaryDataSection
              accession={accession ?? ""}
              rawSupplementaryData={sample.supplementary_data}
              agGridThemeClassName={agGridThemeClassName}
              title="Sample supplementary files"
              clientScriptOnly
            />
          ) : null}

          {projectAccession && project?.supplementary_data ? (
            <SupplementaryDataSection
              accession={projectAccession}
              rawSupplementaryData={project.supplementary_data}
              agGridThemeClassName={agGridThemeClassName}
              title="Study supplementary files"
            />
          ) : null}

          {/* Project context */}
          {project && (
            <Flex direction="column" gap="3">
              <Flex id="project" align="center" gap="2">
                <Heading as="h2" weight="medium" size="5">
                  Parent project
                </Heading>
                <SectionAnchor id="project" />
                {projectAccession && (
                  <a href={`/p/${projectAccession}`}>
                    <Badge
                      size="2"
                      color="green"
                      style={{ cursor: "pointer" }}
                    >
                      {projectAccession}
                      <ExternalLinkIcon />
                    </Badge>
                  </a>
                )}
              </Flex>

              <Flex justify="between" align="center">
                <Text size="3" weight="medium">
                  {project.title}
                </Text>
              </Flex>

              {projectDescription && (
                <ProjectSummary text={projectDescription} charLimit={350} />
              )}

              {project.center && (
                <SubmittingOrgPanel center={project.center} />
              )}
            </Flex>
          )}

          {/* Publications */}
          {publications && publications.length > 0 && (
            <Flex direction="column" gap="3">
              <Flex id="publications" align="center" gap="2">
                <Heading as="h2" weight="medium" size="5">
                  Publications
                </Heading>
                <SectionAnchor id="publications" />
              </Flex>
              {publications.map((pub, i) => (
                <PublicationCard
                  key={pub.pmid || i}
                  publication={pub}
                  accession={projectAccession || accession}
                />
              ))}
            </Flex>
          )}
        </Flex>
      )}
    </>
  );
}
