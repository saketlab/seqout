"use client";
import DbBadge from "@/components/db-badge";
import { MetadataTable, SectionHeader } from "@/components/detail-ui";
import ProjectSummary from "@/components/project-summary";
import PublicationCard, {
  StudyPublication,
} from "@/components/publication-card";
import SearchBar from "@/components/search-bar";
import { ScopedFastqSection, type RunRow } from "@/components/sra-project-page";
import SubmittingOrgPanel, {
  CenterInfo,
} from "@/components/submitting-org-panel";
import { SupplementaryDataSection } from "@/components/supplementary-data-section";
import TextWithLineBreaks from "@/components/text-with-line-breaks";
import { useToast } from "@/components/toast-provider";
import { getExternalArchiveUrl } from "@/utils/accessionLinks";
import { getJson } from "@/utils/api";
import { copyToClipboard } from "@/utils/clipboard";
import { SERVER_URL } from "@/utils/constants";
import { dbForArchive } from "@/utils/db-colors";
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  EnterIcon,
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
  Popover,
  Spinner,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useParams } from "next/navigation";
import React, { useState } from "react";

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

// The gray attribute/metadata box repeated across the sample and experiment
// sections.
function InfoPanel({ children }: { children: React.ReactNode }) {
  return (
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
      {children}
    </Flex>
  );
}

type TaxonInfo = {
  commonName: string | null;
  rank: string | null;
  division: string | null;
  image: string | null;
  extract: string | null;
  wikiUrl: string | null;
};

// Taxonomy details from NCBI (rank/common name), image + blurb from Wikipedia.
// Both are best-effort: a failed leg just leaves its fields null. Both endpoints
// send Access-Control-Allow-Origin, so this runs straight from the browser.
const fetchTaxon = async (
  name: string,
  taxonId: string | null,
): Promise<TaxonInfo> => {
  const info: TaxonInfo = {
    commonName: null,
    rank: null,
    division: null,
    image: null,
    extract: null,
    wikiUrl: null,
  };
  if (taxonId) {
    try {
      const res = await fetch(
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=taxonomy&id=${encodeURIComponent(taxonId)}&retmode=json`,
      );
      const rec = res.ok ? (await res.json())?.result?.[taxonId] : null;
      if (rec) {
        info.commonName = rec.commonname || null;
        info.rank = rec.rank || null;
        info.division = rec.division || rec.genbankdivision || null;
      }
    } catch {
      /* NCBI unreachable — leave those fields null */
    }
  }
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name.replace(/ /g, "_"))}`,
    );
    if (res.ok) {
      const data = await res.json();
      info.image = data?.thumbnail?.source || null;
      info.extract = data?.extract || null;
      info.wikiUrl = data?.content_urls?.desktop?.page || null;
    }
  } catch {
    /* no Wikipedia page — no image/blurb */
  }
  return info;
};

// Info button for the sample's organism, shown at the far end of the Sample
// metadata section heading — the sample-side analog of the experiment section's
// /e badge. Opens a popover with NCBI + Wikipedia details.
function OrganismInfoButton({
  name,
  taxonId,
}: {
  name: string;
  taxonId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["taxon", name, taxonId],
    queryFn: () => fetchTaxon(name, taxonId),
    enabled: open,
    staleTime: Infinity,
  });
  const ncbiUrl = taxonId
    ? `https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?id=${taxonId}`
    : null;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger>
        <Button size={"2"} style={{ cursor: "pointer" }}>
          <InfoCircledIcon />
          <Text style={{ fontStyle: "italic" }}>{name}</Text>
        </Button>
      </Popover.Trigger>
      <Popover.Content maxWidth="20rem" size={"1"}>
        {isLoading && (
          <Text size="2" color="gray">
            Loading…
          </Text>
        )}
        {data && (
          <Flex direction="column" gap="2">
            {data.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={data.image}
                alt={name}
                style={{
                  width: "100%",
                  maxHeight: "10rem",
                  objectFit: "cover",
                  borderRadius: "var(--radius-2)",
                }}
              />
            )}
            <Text size="3" weight="bold" style={{ fontStyle: "italic" }}>
              {name}
            </Text>
            {data.commonName && (
              <Text size="2" color="gray">
                {data.commonName?.charAt(0).toUpperCase() +
                  data.commonName?.slice(1)}
              </Text>
            )}
            <Flex gap="2" wrap="wrap">
              {data.rank && (
                <Badge size="1" variant="soft">
                  {data.rank}
                </Badge>
              )}
              {data.division && (
                <Badge size="1" color="gray" variant="soft">
                  {data.division}
                </Badge>
              )}
              {taxonId && (
                <Badge size="1" color="gray" variant="soft">
                  ID{" "}
                  <span style={{ fontFamily: "var(--font-geist-mono)" }}>
                    {taxonId}
                  </span>
                </Badge>
              )}
            </Flex>
            {data.extract && (
              <Text size="1" color="gray">
                {data.extract}
                {data.wikiUrl && (
                  <>
                    {" "}
                    <Link
                      href={data.wikiUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      size="1"
                      underline="hover"
                    >
                      Read more on Wikipedia.
                    </Link>
                  </>
                )}
              </Text>
            )}
            {ncbiUrl && (
              <Link
                href={ncbiUrl}
                target="_blank"
                rel="noopener noreferrer"
                size="1"
              >
                View on NCBI Taxonomy <ExternalLinkIcon />
              </Link>
            )}
          </Flex>
        )}
      </Popover.Content>
    </Popover.Root>
  );
}

function ProjectBadge({
  accession,
  size = { initial: "2", md: "3" },
}: {
  accession: string;
  size?: React.ComponentProps<typeof Badge>["size"];
}) {
  return (
    <a href={`/p/${accession}`}>
      <Badge
        size={size}
        color="green"
        style={{ cursor: "pointer", whiteSpace: "nowrap" }}
      >
        {accession}
        <EnterIcon />
      </Badge>
    </a>
  );
}

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
          <InfoPanel key={idx}>
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
          </InfoPanel>
        );
      })}
    </Flex>
  );
}

// The experiment's full metadata, shown as its own section (not a card) with a
// badge linking to the dedicated /e page, mirroring what that page displays.
function ExperimentSection({ experiment }: { experiment: Experiment }) {
  return (
    <Flex direction="column" gap="3">
      <SectionHeader
        id="experiment"
        title="Experiment"
        right={
          <a href={`/e/${experiment.accession}`}>
            <DbBadge
              size={{ initial: "2", md: "3" }}
              db={getDbBadgeColor(experiment.accession)}
              variant="soft"
              style={{ cursor: "pointer", whiteSpace: "nowrap" }}
            >
              {experiment.accession}
              <EnterIcon />
            </DbBadge>
          </a>
        }
      />
      {/* design_description is prose, so it reads as a description above the
          table rather than a cramped cell — matching the /e page. */}
      {experiment.design_description && (
        <Text>{experiment.design_description}</Text>
      )}
      <MetadataTable
        rows={[
          ["Title", experiment.title],
          ["Library strategy", experiment.library_strategy],
          ["Library source", experiment.library_source],
          ["Library selection", experiment.library_selection],
          ["Library layout", experiment.library_layout],
          ["Library name", experiment.library_name],
          ["Platform", experiment.platform],
          ["Instrument model", experiment.instrument_model],
          ["Submission", experiment.submission],
        ]}
      />
    </Flex>
  );
}

// Sample metadata as a table, mirroring the experiment section. Title and
// organism live in the page header, so they're not repeated here.
function SraSampleDetail({ sample }: { sample: Sample | null }) {
  if (!sample) return null;
  // ponytail: the API builds attributes_json server-side as a jsonb object
  // (jsonb_object_agg / to_jsonb), so it arrives as a plain object — no need to
  // parse strings or fold {tag,value} arrays.
  const attributes: Record<string, string> =
    sample.attributes_json && !Array.isArray(sample.attributes_json)
      ? sample.attributes_json
      : {};

  const rows: [string, string][] = [];
  if (sample.description) rows.push(["Description", sample.description]);
  for (const [key, value] of Object.entries(attributes)) {
    rows.push([key, value || "-"]);
  }

  if (rows.length === 0) {
    return (
      <Text size="2" color="gray">
        No sample metadata.
      </Text>
    );
  }

  return <MetadataTable rows={rows} />;
}

function getDbBadgeColor(accession: string) {
  const external = getExternalArchiveUrl(accession);
  return external ? dbForArchive(external.archive) : undefined;
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

  const externalLink = accession ? getExternalArchiveUrl(accession) : null;
  const badgeColor = accession ? getDbBadgeColor(accession) : undefined;

  const publications = project?.publications ?? null;
  const projectDescription = project?.abstract || project?.summary || null;

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
            <Heading as="h1" size={{ initial: "6", md: "8" }} weight="bold">
              {sample?.title || accession}
            </Heading>
          </Flex>

          <Flex justify="start" align="center" gap="2" wrap="wrap">
            <DbBadge
              size={{ initial: "2", md: "3" }}
              db={badgeColor}
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
            </DbBadge>

            {projectAccession && <ProjectBadge accession={projectAccession} />}

            {externalLink && (
              <a
                href={externalLink.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <DbBadge
                  size={{ initial: "2", md: "3" }}
                  db={badgeColor}
                  style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  {externalLink.label}
                  <ExternalLinkIcon />
                </DbBadge>
              </a>
            )}

            <a
              href={`${SERVER_URL}/sample-detail/${accession}/download`}
              download
            >
              <Badge
                size={{ initial: "2", md: "3" }}
                style={{ cursor: "pointer", whiteSpace: "nowrap" }}
              >
                <DownloadIcon /> Download metadata
              </Badge>
            </a>
          </Flex>

          {/* Sample detail */}
          <Flex direction="column" gap="3">
            <SectionHeader
              id="sample"
              title="Sample metadata"
              right={
                sample?.scientific_name ? (
                  <OrganismInfoButton
                    name={sample.scientific_name}
                    taxonId={sample.taxon_id ?? null}
                  />
                ) : undefined
              }
            />
            {sampleType === "geo_sample" && sample ? (
              <GeoSampleDetail sample={sample} />
            ) : (
              <SraSampleDetail sample={sample ?? null} />
            )}
          </Flex>

          {/* Experiment (SRA/ENA/DDBJ samples only) */}
          {sampleType !== "geo_sample" && experiment && (
            <ExperimentSection experiment={experiment} />
          )}

          {/* Runs */}
          {runs && runs.length > 0 && (
            <ScopedFastqSection
              runs={runs}
              studyAccession={projectAccession ?? accession ?? ""}
              expTitleMap={
                experiment
                  ? new Map([[experiment.accession, experiment.title ?? ""]])
                  : undefined
              }
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
              <SectionHeader
                id="project"
                title="Parent project"
                right={
                  projectAccession ? (
                    <ProjectBadge accession={projectAccession} />
                  ) : undefined
                }
              />

              <Flex justify="between" align="center">
                <Text size="3" weight="medium">
                  {project.title}
                </Text>
              </Flex>

              {projectDescription && (
                <ProjectSummary text={projectDescription} charLimit={350} />
              )}
            </Flex>
          )}

          {/* Linked publications — before the submitting-org map below. */}
          {publications && publications.length > 0 && (
            <Flex direction="column" gap="3">
              <SectionHeader id="publications" title="Linked publications" />
              {publications.map((pub, i) => (
                <PublicationCard
                  key={pub.pmid || i}
                  publication={pub}
                  accession={projectAccession || accession}
                />
              ))}
            </Flex>
          )}

          {project?.center && <SubmittingOrgPanel center={project.center} />}
        </Flex>
      )}
    </>
  );
}
