"use client";

import EditableHeading from "@/components/editable-heading";
import ResultCard from "@/components/result-card";
import SearchBar from "@/components/search-bar";
import { getJson } from "@/utils/api";
import { cleanJournalName } from "@/utils/format";
import { doiHref, isPmid, pmidHref, pubmedHref } from "@/utils/project";
import { getProjectShortUrl } from "@/utils/shortUrl";
import type { StudyPublication } from "@/utils/types";
import { ExternalLinkIcon, InfoCircledIcon } from "@radix-ui/react-icons";
import { Button, Flex, IconButton, Link, Popover, Text } from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

type PublicationProject = {
  accession: string;
  source: string;
  title: string | null;
  published_at: string | null;
  via: string | null;
};

type PublicationResponse = Pick<
  StudyPublication,
  "pmid" | "title" | "journal" | "doi" | "pub_date" | "authors" | "citation_count"
> & {
  projects: PublicationProject[];
  total_projects: number;
};

const fetchPublication = async (pmid: string) => {
  // Wall-clock timing; the endpoint returns none.
  const start = performance.now();
  const data = await getJson<PublicationResponse>(
    `/publication?pmid=${encodeURIComponent(pmid)}`,
  );
  return { ...data, took_ms: performance.now() - start };
};

// The endpoint returns every linked project unbounded; a consortium paper can
// link thousands, so cap the first paint and let the user ask for the rest.
const INITIAL_ROWS = 100;

export default function PublicationProjectsBody({ pmid }: { pmid: string }) {
  const router = useRouter();
  const [showAll, setShowAll] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["publication-projects", pmid],
    queryFn: () => fetchPublication(pmid),
    enabled: isPmid(pmid),
    retry: false,
    // A paper's linked projects only change when the archives re-index.
    staleTime: Infinity,
  });

  const projects = data?.projects ?? [];
  const visible = showAll ? projects : projects.slice(0, INITIAL_ROWS);

  return (
    <>
      <SearchBar />

      <Flex
        gap="4"
        mt="4"
        px={{ initial: "0", md: "4" }}
        width={{ initial: "98%", md: "100%" }}
        mx="auto"
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
              <IconButton aria-label="About publication links">
                <InfoCircledIcon />
              </IconButton>
            </Popover.Trigger>
            <Popover.Content maxWidth="340px">
              <Text size="2">
                Projects are linked to a paper by the archives themselves, so a
                submitter&rsquo;s mistake can attach an unrelated project here.
                Each card shows which table the link came from.
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
          <Flex direction="column" gap="1">
            {data.title && (
              <Text size="4" weight="bold">
                {data.title}
              </Text>
            )}
            <Text size="2" color="gray">
              {[
                data.authors,
                data.journal ? cleanJournalName(data.journal) : null,
                data.pub_date,
                data.citation_count != null
                  ? `${data.citation_count.toLocaleString()} citations`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
            <Flex gap="3" align="center" mt="1">
              <Link
                href={pubmedHref(pmid)}
                target="_blank"
                rel="noopener noreferrer"
                size="2"
              >
                PubMed <ExternalLinkIcon style={{ verticalAlign: "middle" }} />
              </Link>
              {data.doi && (
                <Link
                  href={doiHref(data.doi)}
                  target="_blank"
                  rel="noopener noreferrer"
                  size="2"
                >
                  DOI <ExternalLinkIcon style={{ verticalAlign: "middle" }} />
                </Link>
              )}
            </Flex>
          </Flex>
        )}

        {data && (
          <Text color="gray" weight="light">
            {data.total_projects.toLocaleString()} project
            {data.total_projects === 1 ? "" : "s"} in{" "}
            {((data.took_ms ?? 0) / 1000).toFixed(2)} seconds
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
              title={p.title}
              updated_at={p.published_at}
              via={p.via}
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
