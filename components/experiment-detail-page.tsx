"use client";
import DbBadge from "@/components/db-badge";
import ProjectSupplementary from "@/components/project-supplementary";
import { MetadataTable, SectionHeader } from "@/components/detail-ui";
import SearchBar from "@/components/search-bar";
import { ScopedFastqSection, type RunRow } from "@/components/sra-project-page";
import { useToast } from "@/components/toast-provider";
import { getExternalArchiveUrl } from "@/utils/accessionLinks";
import { getJson } from "@/utils/api";
import { copyToClipboard } from "@/utils/clipboard";
import { dbForArchive } from "@/utils/db-colors";
import {
  CheckIcon,
  CopyIcon,
  EnterIcon,
  ExternalLinkIcon,
  HomeIcon,
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
import { useTheme } from "next-themes";
import { useParams } from "next/navigation";
import { useState } from "react";

type Experiment = {
  accession: string;
  title: string | null;
  design_description: string | null;
  library_layout: string | null;
  library_name: string | null;
  library_selection: string | null;
  library_source: string | null;
  library_strategy: string | null;
  samples: string[] | null;
  platform: string | null;
  instrument_model: string | null;
  submission: string | null;
  study: string | null;
  runs: RunRow[] | null;
};

const fetchExperiment = async (
  accession: string | null,
): Promise<Experiment | null> => {
  if (!accession) return null;
  return getJson<Experiment>(`/experiment/${accession}`);
};

export default function ExperimentDetailPage() {
  const params = useParams();
  const { resolvedTheme } = useTheme();
  const { showToast } = useToast();
  const accession = (params.accession as string | undefined)?.toUpperCase();
  const [isAccessionCopied, setIsAccessionCopied] = useState(false);
  const agGridThemeClassName =
    resolvedTheme === "dark" ? "ag-theme-quartz-dark" : "ag-theme-quartz";

  const {
    data: experiment,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["experiment", accession],
    queryFn: () => fetchExperiment(accession ?? null),
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

  const runs = experiment?.runs ?? [];
  const samples = (experiment?.samples ?? []).filter(Boolean);
  const externalLink = accession ? getExternalArchiveUrl(accession) : null;
  const badgeColor = externalLink
    ? dbForArchive(externalLink.archive)
    : undefined;

  const fields: [string, string | null][] = experiment
    ? [
        ["Library strategy", experiment.library_strategy],
        ["Library source", experiment.library_source],
        ["Library selection", experiment.library_selection],
        ["Library layout", experiment.library_layout],
        ["Library name", experiment.library_name],
        ["Platform", experiment.platform],
        ["Instrument model", experiment.instrument_model],
      ]
    : [];

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
            No experiment specified
          </Text>
          <Text
            size="2"
            align="center"
            style={{ color: "var(--gray-11)", maxWidth: "32rem" }}
          >
            The URL needs an accession like{" "}
            <span className="seqout-accession">/e/SRX123456</span>.
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
            The experiment may not exist, or the server may be temporarily
            unavailable. Retrying is safe.
          </Text>
          <Flex gap="2" mt="1">
            <Button variant="surface" onClick={() => refetch()}>
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

      {accession && !isLoading && !isError && experiment && (
        <Flex
          ml={{ initial: "0", md: "12rem" }}
          mr={{ initial: "0", md: "8rem" }}
          py="3"
          px={{ initial: "4", md: "3" }}
          direction="column"
          gap="4"
        >
          <Heading as="h1" size={{ initial: "6", md: "8" }} weight="bold">
            {experiment.title || accession}
          </Heading>

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

            {experiment.study && (
              <a href={`/p/${experiment.study}`}>
                <Badge
                  size={{ initial: "2", md: "3" }}
                  color="green"
                  style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  {experiment.study}
                  <EnterIcon />
                </Badge>
              </a>
            )}

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
          </Flex>

          <Flex direction="column" gap="3">
            <SectionHeader id="experiment" title="Experiment metadata" />
            {experiment.design_description && (
              <Text>{experiment.design_description}</Text>
            )}
            <MetadataTable
              rows={[
                ...fields,
                [
                  samples.length > 1
                    ? "Associated samples"
                    : "Associated sample",
                  samples.length > 0 ? (
                    <Flex gap="2" align="center" wrap="wrap">
                      {samples.map((s) => (
                        <Link key={s} href={`/s/${s}`} size="2">
                          {s}
                        </Link>
                      ))}
                    </Flex>
                  ) : null,
                ],
              ]}
            />
          </Flex>

          {runs.length > 0 && (
            <ScopedFastqSection
              runs={runs}
              studyAccession={experiment.study ?? accession ?? ""}
              expTitleMap={
                new Map([[experiment.accession, experiment.title ?? ""]])
              }
              agGridThemeClassName={agGridThemeClassName}
            />
          )}

          <ProjectSupplementary accession={experiment.study} />
        </Flex>
      )}
    </>
  );
}
