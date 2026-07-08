"use client";

import { useQuery } from "@tanstack/react-query";
import { Box, Container, Flex, Grid, Heading, Text } from "@radix-ui/themes";
import * as React from "react";
import ResultCard from "@/components/result-card";
import { InstituteFilter } from "@/components/institute-filter";
import { getJson } from "@/utils/api";
import { getProjectShortUrl } from "@/utils/shortUrl";

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
};

const fetchAuthorProjects = (name: string) =>
  getJson<AuthorProjectsResponse>(
    `/author/projects?q=${encodeURIComponent(name)}&limit=200`,
  );

// A result belongs to an institute if that name is one of its "; "-joined orgs.
function hasInstitute(r: AuthorProject, institute: string): boolean {
  return (r.institute ?? "")
    .split(";")
    .some((p) => p.trim().toLowerCase() === institute.toLowerCase());
}

export default function AuthorProjectsBody({ name }: { name: string }) {
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

  const filtered = selectedInstitute
    ? results.filter((r) => hasInstitute(r, selectedInstitute))
    : results;

  return (
    <Container size="4" px="4" py="6">
      <Heading size="6" mb="1">
        Projects by {name}
      </Heading>
      <Text color="gray" size="2">
        Datasets linked to a publication by {name}. Matched on first and last
        name, so common names may include other people.
      </Text>

      <Grid
        columns={{ initial: "1", md: "minmax(0, 1fr) 260px" }}
        gap="5"
        mt="5"
      >
        <Flex direction="column" gap="3">
          {isLoading && <Text color="gray">Searching…</Text>}
          {isError && (
            <Text color="red">Something went wrong. Please try again.</Text>
          )}
          {!isLoading && !isError && results.length === 0 && (
            <Text color="gray">No projects found for {name}.</Text>
          )}
          {results.length > 0 && (
            <Text color="gray" size="2">
              {selectedInstitute
                ? `${filtered.length} of ${data?.total} projects · ${selectedInstitute}`
                : `${data?.total} project${data?.total === 1 ? "" : "s"}`}
            </Text>
          )}
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

        {institutes.length > 0 && (
          <Box style={{ alignSelf: "start", position: "sticky", top: 16 }}>
            <InstituteFilter
              facets={institutes}
              totalCount={data?.total ?? results.length}
              selectedKey={selectedInstitute}
              onChangeSelection={setSelectedInstitute}
            />
          </Box>
        )}
      </Grid>
    </Container>
  );
}
