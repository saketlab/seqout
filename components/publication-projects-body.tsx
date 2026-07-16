"use client";

import EditableHeading from "@/components/editable-heading";
import {
  CiteDialog,
  CopyButton,
  formatCellCitation,
} from "@/components/publication-card";
import ResultCard from "@/components/result-card";
import SearchBar from "@/components/search-bar";
import { getJson } from "@/utils/api";
import { cleanJournalName, formatPubDate } from "@/utils/format";
import { doiHref, isPmid, pmidHref, pubmedHref } from "@/utils/project";
import { getProjectShortUrl } from "@/utils/shortUrl";
import type { StudyPublication } from "@/utils/types";
import { ExternalLinkIcon, InfoCircledIcon } from "@radix-ui/react-icons";
import {
  Badge,
  Button,
  Card,
  Flex,
  IconButton,
  Link,
  Popover,
  Text,
} from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

type PublicationProject = {
  accession: string;
  source: string;
  title: string | null;
  summary: string | null;
  published_at: string | null;
  via: string | null;
  center_name: string | null;
  country_code: string | null;
};

type PublicationResponse = Pick<
  StudyPublication,
  | "pmid"
  | "title"
  | "journal"
  | "doi"
  | "pub_date"
  | "authors"
  | "citation_count"
> & {
  projects: PublicationProject[];
};

const fetchPublication = async (pmid: string) => {
  // Wall-clock timing; the endpoint returns none.
  const start = performance.now();
  const data = await getJson<PublicationResponse>(
    `/publication?pmid=${encodeURIComponent(pmid)}`,
  );
  return { ...data, took_ms: performance.now() - start };
};

const INITIAL_ROWS = 100;

export default function PublicationProjectsBody({ pmid }: { pmid: string }) {
  const router = useRouter();
  const [showAll, setShowAll] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["publication-projects", pmid],
    queryFn: () => fetchPublication(pmid),
    enabled: isPmid(pmid),
    retry: false,
    staleTime: Infinity,
  });

  const projects = data?.projects ?? [];
  const visible = showAll ? projects : projects.slice(0, INITIAL_ROWS);
  const pubDate = formatPubDate(data?.pub_date ?? null);

  return (
    <>
      <SearchBar />

      <Flex
        gap="4"
        mt="4"
        ml={{ initial: "0", md: "12rem" }}
        mr={{ initial: "0", md: "8rem" }}
        px={{ initial: "4", md: "3" }}
        direction="column"
      >
        <Flex align="center" justify="between" gap="2">
          <EditableHeading
            label="Projects for PMID"
            value={pmid}
            placeholder="PMID"
            editLabel="Edit PMID"
            inputMode="numeric"
            isValid={isPmid}
            onSubmit={(next) => router.push(pmidHref(next))}
          />
          <Popover.Root>
            <Popover.Trigger>
              <IconButton variant="soft" aria-label="About publication links">
                <InfoCircledIcon />
              </IconButton>
            </Popover.Trigger>
            <Popover.Content maxWidth={"16rem"}>
              <Text size="2">
                Projects are linked to publications by the archive, so
                submission errors may occasionally associate an unrelated
                project with a paper.
              </Text>
            </Popover.Content>
          </Popover.Root>
        </Flex>

        {isLoading && <Text color="gray">Searching…</Text>}
        {isError && (
          <Flex
            align="center"
            justify="center"
            direction="column"
            height="20rem"
            gap="3"
          >
            <Text size={{ initial: "5", md: "6" }} weight="bold">
              No publication found for PMID {pmid}
            </Text>
            <Text
              size="2"
              align="center"
              style={{ color: "var(--gray-11)", maxWidth: "32rem" }}
            >
              {String(error)}
            </Text>
          </Flex>
        )}

        {data && (
          <Card>
            <Flex direction="column" gap="1">
              {data.title && (
                <Text size="4" weight="bold" className="seqout-paper-title">
                  {data.title}
                </Text>
              )}
              {data.authors && (
                <Text size="2" color="gray">
                  {data.authors}
                </Text>
              )}
              <Flex gap="2" align="center" wrap="wrap" mt="1">
                {data.citation_count != null && data.citation_count > 0 && (
                  <Badge size="2" color="iris" variant="soft">
                    {data.citation_count.toLocaleString()} citations
                  </Badge>
                )}
                {data.journal &&
                  (data.doi ? (
                    <Badge size="2" color="blue" variant="soft" asChild>
                      <a
                        href={doiHref(data.doi)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ textDecoration: "none", color: "inherit" }}
                      >
                        {cleanJournalName(data.journal)} <ExternalLinkIcon />
                      </a>
                    </Badge>
                  ) : (
                    <Badge size="2" color="blue" variant="soft">
                      {cleanJournalName(data.journal)} <ExternalLinkIcon />
                    </Badge>
                  ))}
                {pubDate && (
                  <Badge size="2" color="gray" variant="soft">
                    {pubDate}
                  </Badge>
                )}
                <Link
                  href={pubmedHref(pmid)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open PMID ${pmid} in PubMed`}
                  style={{ textDecoration: "none" }}
                >
                  <Badge
                    size="2"
                    color="gray"
                    variant="soft"
                    style={{ cursor: "pointer" }}
                  >
                    View on PubMed
                    <ExternalLinkIcon />
                  </Badge>
                </Link>
                <CopyButton
                  label="PMID"
                  getText={() => pmid}
                  toast="PMID copied"
                />
                {/* No BibTeX: that endpoint is keyed by project accession, and
                    this page spans every project linked to the paper. */}
                <CiteDialog
                  label="Cite"
                  title="Citation"
                  getText={() => formatCellCitation(data)}
                  toast="Citation copied"
                />
              </Flex>
            </Flex>
          </Card>
        )}

        {data && (
          <Text color="gray" weight="light">
            Found {projects.length.toLocaleString()} project
            {projects.length === 1 ? "" : "s"} in{" "}
            {(data.took_ms / 1000).toFixed(2)} seconds
          </Text>
        )}

        <Flex
          direction="column"
          gap="0"
          className="seqout-divided-list"
          style={{ paddingLeft: 0 }}
        >
          {/* journal/authors/citations are the same paper on every row; the header shows them once */}
          {visible.map((p) => (
            <ResultCard
              key={`${p.source}:${p.accession}`}
              accession={p.accession}
              source={p.source}
              title={p.title}
              summary={p.summary}
              updated_at={p.published_at}
              center_name={p.center_name}
              country_code={p.country_code}
              titleSize="4"
              centerOnOwnRow
              href={getProjectShortUrl(p.accession)}
            />
          ))}
        </Flex>

        {!showAll && projects.length > INITIAL_ROWS && (
          <Flex justify="center" py="4">
            <Button variant="soft" onClick={() => setShowAll(true)}>
              Show all {projects.length.toLocaleString()} projects
            </Button>
          </Flex>
        )}
      </Flex>
    </>
  );
}
