"use client";
import SearchBar from "@/components/search-bar";
import SectionAnchor from "@/components/section-anchor";
import ProjectSupplementary from "@/components/project-supplementary";
import { RunsSection, type RunRow } from "@/components/sample-detail-page";
import { useToast } from "@/components/toast-provider";
import { getExternalArchiveUrl } from "@/utils/accessionLinks";
import { getJson } from "@/utils/api";
import DbBadge from "@/components/db-badge";
import { dbForArchive } from "@/utils/db-colors";
import { copyToClipboard } from "@/utils/clipboard";
import {
  CheckIcon,
  CopyIcon,
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
  Spinner,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useParams } from "next/navigation";
import { useState } from "react";

type RunDetail = RunRow & { study_accession: string | null };

const fetchRun = async (run: string | null): Promise<RunDetail | null> => {
  if (!run) return null;
  return getJson<RunDetail>(`/run/${run}`);
};

export default function RunDetailPage() {
  const params = useParams();
  const { resolvedTheme } = useTheme();
  const { showToast } = useToast();
  const accession = (params.accession as string | undefined)?.toUpperCase();
  const [isAccessionCopied, setIsAccessionCopied] = useState(false);
  const agGridThemeClassName =
    resolvedTheme === "dark" ? "ag-theme-quartz-dark" : "ag-theme-quartz";

  const {
    data: run,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["run", accession],
    queryFn: () => fetchRun(accession ?? null),
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

  const externalLink = accession ? getExternalArchiveUrl(accession) : null;
  const badgeColor = externalLink
    ? dbForArchive(externalLink.archive)
    : undefined;

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
            No run specified
          </Text>
          <Text
            size="2"
            align="center"
            style={{ color: "var(--gray-11)", maxWidth: "32rem" }}
          >
            The URL needs an accession like{" "}
            <span className="seqout-accession">/r/SRR123456</span>.
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
            The run may not exist, or the server may be temporarily unavailable.
            Retrying is safe.
          </Text>
          <Flex gap="2" mt="1">
            <Button variant="surface" onClick={() => refetch()}>
              <ReloadIcon /> Retry
            </Button>
            <Button variant="ghost" onClick={() => (window.location.href = "/")}>
              <MagnifyingGlassIcon /> Search instead
            </Button>
          </Flex>
        </Flex>
      )}

      {accession && !isLoading && !isError && run && (
        <Flex
          ml={{ initial: "0", md: "12rem" }}
          mr={{ initial: "0", md: "8rem" }}
          py="3"
          px={{ initial: "4", md: "3" }}
          direction="column"
          gap="4"
        >
          <Heading as="h1" size={{ initial: "4", md: "6" }} weight="bold">
            {run.run_alias || accession}
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

            {run.experiment_accession && (
              <a href={`/e/${run.experiment_accession}`}>
                <DbBadge
                  size={{ initial: "2", md: "3" }}
                  db={badgeColor}
                  variant="soft"
                  style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  {run.experiment_accession}
                  <ExternalLinkIcon />
                </DbBadge>
              </a>
            )}

            {run.study_accession && (
              <a href={`/p/${run.study_accession}`}>
                <Badge
                  size={{ initial: "2", md: "3" }}
                  color="green"
                  style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  {run.study_accession}
                  <ExternalLinkIcon />
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
                  variant="outline"
                  style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  {externalLink.label}
                  <ExternalLinkIcon />
                </DbBadge>
              </a>
            )}
          </Flex>

          <Flex id="downloads" align="center" gap="2">
            <Heading as="h2" weight="medium" size="5">
              Downloads
            </Heading>
            <SectionAnchor id="downloads" />
          </Flex>
          <RunsSection runs={[run]} agGridThemeClassName={agGridThemeClassName} />

          <ProjectSupplementary accession={run.study_accession} />
        </Flex>
      )}
    </>
  );
}
