"use client";

import { InstituteFilter } from "@/components/institute-filter";
import ResultCard from "@/components/result-card";
import SearchBar from "@/components/search-bar";
import { getJson } from "@/utils/api";
import { authorHref } from "@/utils/project";
import { getProjectShortUrl } from "@/utils/shortUrl";
import {
  InfoCircledIcon,
  MagnifyingGlassIcon,
  MixerHorizontalIcon,
  Pencil1Icon,
} from "@radix-ui/react-icons";
import {
  Box,
  Button,
  Dialog,
  Flex,
  Heading,
  IconButton,
  Popover,
  Text,
  TextField,
} from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import * as React from "react";

type AuthorProject = {
  accession: string;
  title: string | null;
  summary: string | null;
  updated_at: string | null;
  journal: string | null;
  doi: string | null;
  citation_count: number | null;
  authors: string | null;
  center_name?: string | null;
  institute?: string | null;
  country_code?: string | null;
  single_cell_modality?: string | null;
};

type AuthorProjectsResponse = {
  q: string;
  total: number;
  results: AuthorProject[];
  institutes: { name: string; count: number }[];
  took_ms: number;
};

const fetchAuthorProjects = async (name: string) => {
  // Wall-clock (fetch + network), like the search page — the endpoint returns no timing.
  const start = performance.now();
  const data = await getJson<AuthorProjectsResponse>(
    `/author/projects?q=${encodeURIComponent(name)}&limit=200`,
  );
  return { ...data, took_ms: performance.now() - start };
};

// A result belongs to an institute if that name is one of its "; "-joined orgs.
// `institute` must already be lowercased.
function hasInstitute(r: AuthorProject, institute: string): boolean {
  return (r.institute ?? "")
    .split(";")
    .some((p) => p.trim().toLowerCase() === institute);
}

export default function AuthorProjectsBody({ name }: { name: string }) {
  const router = useRouter();
  const [draft, setDraft] = React.useState(name);
  const [editing, setEditing] = React.useState(false);

  const submit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next.length >= 2 && next !== name) {
      router.push(authorHref(next));
    }
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ["author-projects", name],
    queryFn: () => fetchAuthorProjects(name),
    enabled: name.length >= 2,
  });

  const results = data?.results ?? [];
  const institutes = data?.institutes ?? [];
  const [selectedInstitute, setSelectedInstitute] = React.useState<
    string | null
  >(null);

  const filtered = React.useMemo(() => {
    const rows = data?.results ?? [];
    if (!selectedInstitute) return rows;
    const target = selectedInstitute.toLowerCase();
    return rows.filter((r) => hasInstitute(r, target));
  }, [data?.results, selectedInstitute]);

  const instituteFilter = (
    <InstituteFilter
      facets={institutes}
      totalCount={data?.total ?? results.length}
      selectedKey={selectedInstitute}
      onChangeSelection={setSelectedInstitute}
    />
  );

  return (
    <>
      <SearchBar />

      <Flex
        gap="4"
        mt={"4"}
        px={{ initial: "0", md: "4" }}
        width={{ initial: "98%", md: "100%" }}
        mx="auto"
        justify={{ initial: "start", md: "between" }}
        direction={{ initial: "column", md: "row" }}
      >
        <Flex
          gap="3"
          direction="column"
          width={{
            initial: "100%",
            md: "calc(100% - 240px)",
            lg: "calc(100% - 300px)",
          }}
          minWidth="0"
        >
          <Flex align="center" justify="between" gap="2">
            <Heading size="6">
              Projects by{" "}
              <Popover.Root
                open={editing}
                onOpenChange={(o) => {
                  setEditing(o);
                  if (o) setDraft(name);
                }}
              >
                <Popover.Trigger>
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label="Edit author name"
                    onKeyDown={(e) =>
                      (e.key === "Enter" || e.key === " ") && setEditing(true)
                    }
                    style={{
                      cursor: "pointer",
                      fontStyle: "italic",
                      textDecoration: "underline",
                      textDecorationStyle: "dashed",
                      textUnderlineOffset: 4,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {name}{" "}
                    <Pencil1Icon
                      style={{ verticalAlign: "middle", opacity: 0.7 }}
                    />
                  </span>
                </Popover.Trigger>
                <Popover.Content size="1">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      submit();
                    }}
                  >
                    <Flex direction="row" gap="2">
                      <TextField.Root
                        size="2"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder="Author name"
                        autoFocus
                        aria-label="Author name"
                      />
                      <Flex justify="end">
                        <IconButton type="submit">
                          <MagnifyingGlassIcon />
                        </IconButton>
                      </Flex>
                    </Flex>
                  </form>
                </Popover.Content>
              </Popover.Root>
            </Heading>
            <Popover.Root>
              <Popover.Trigger>
                <IconButton aria-label="About name matching">
                  <InfoCircledIcon />
                </IconButton>
              </Popover.Trigger>
              <Popover.Content maxWidth="340px">
                <Text size={"2"}>
                  Matched on first and last name, so common names may include
                  other projects by people with the same name.
                </Text>
              </Popover.Content>
            </Popover.Root>
          </Flex>

          {isLoading && <Text color="gray">Searching…</Text>}
          {isError && (
            <Text color="red">Something went wrong. Please try again.</Text>
          )}
          {!isLoading && !isError && results.length === 0 && (
            <Flex
              align="center"
              justify="center"
              direction="column"
              height="20rem"
              gap="3"
            >
              <Text size={{ initial: "5", md: "6" }} weight="bold">
                No projects found for &ldquo;{name}&rdquo;
              </Text>
              <Text
                size="2"
                align="center"
                style={{ color: "var(--gray-11)", maxWidth: "32rem" }}
              >
                Check the spelling or try just the last name. Only datasets
                linked to a publication (or GEO contributor) are findable.
              </Text>
            </Flex>
          )}
          {results.length > 0 && (
            <Text color="gray" weight="light">
              {data?.total?.toLocaleString()} result
              {data?.total === 1 ? "" : "s"} in{" "}
              {((data?.took_ms ?? 0) / 1000).toFixed(2)} seconds
              {selectedInstitute &&
                ` · ${filtered.length} shown · ${selectedInstitute}`}
            </Text>
          )}
          <Flex
            direction="column"
            gap="0"
            className="seqout-divided-list"
            style={{ paddingLeft: 0 }}
          >
            {filtered.map((r) => (
              <ResultCard
                key={r.accession}
                accession={r.accession}
                title={r.title}
                summary={r.summary}
                updated_at={r.updated_at}
                journal={r.journal}
                doi={r.doi}
                citation_count={r.citation_count}
                authors={r.authors}
                center_name={r.institute ?? r.center_name}
                country_code={r.country_code}
                single_cell_modality={r.single_cell_modality}
                href={getProjectShortUrl(r.accession)}
              />
            ))}
          </Flex>
        </Flex>

        {/* Desktop: sticky sidebar rail. */}
        <Box
          width={{ md: "220px", lg: "280px" }}
          flexShrink="0"
          display={{
            initial: "none",
            md: institutes.length > 0 ? "block" : "none",
          }}
          style={{ alignSelf: "start", position: "sticky", top: "5rem" }}
        >
          {instituteFilter}
        </Box>
      </Flex>

      {/* Mobile: floating button → dialog, like the search page's organism rail. */}
      {institutes.length > 0 && (
        <Flex
          display={{ initial: "flex", md: "none" }}
          position="fixed"
          direction="column"
          align="end"
          bottom={{ initial: "9", sm: "4" }}
          style={{ right: "1rem", zIndex: 999 }}
        >
          <Dialog.Root>
            <Dialog.Trigger>
              <Button>
                <MixerHorizontalIcon />
                Institutes
              </Button>
            </Dialog.Trigger>
            <Dialog.Content
              size="2"
              style={{
                width: "calc(100vw - 2rem)",
                maxWidth: "calc(100vw - 2rem)",
              }}
            >
              <Dialog.Title>Institutes</Dialog.Title>
              <Dialog.Description size="1">
                Narrow projects by institute.
              </Dialog.Description>
              <Flex
                mt="3"
                width="100%"
                style={{ height: "24rem", overflowY: "auto" }}
              >
                <div style={{ width: "100%" }}>{instituteFilter}</div>
              </Flex>
            </Dialog.Content>
          </Dialog.Root>
        </Flex>
      )}
    </>
  );
}
