"use client";

import ResultCard from "@/components/result-card";
import SearchBar from "@/components/search-bar";
import { getJson } from "@/utils/api";
import { getProjectShortUrl } from "@/utils/shortUrl";
import { Button, Flex, Heading, Text } from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type SubmissionStudy = {
  accession: string;
  source: string;
  title: string | null;
  summary: string | null;
  published_at: string | null;
};

type SubmissionResponse = {
  submission: string;
  studies: SubmissionStudy[];
};

const isSubmission = (value: string) => /^[SED]RA\d+$/i.test(value.trim());

const INITIAL_ROWS = 100;

export default function SubmissionStudiesBody({
  accession,
}: {
  accession: string;
}) {
  const router = useRouter();
  const [showAll, setShowAll] = useState(false);
  const acc = accession.toUpperCase();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["submission-studies", acc],
    queryFn: () => getJson<SubmissionResponse>(`/submission/${acc}`),
    enabled: isSubmission(acc),
    retry: false,
    staleTime: Infinity,
  });

  const studies = data?.studies ?? [];
  const visible = showAll ? studies : studies.slice(0, INITIAL_ROWS);
  const soleStudy = studies.length === 1 ? studies[0].accession : null;

  // A submission that resolves to a single study is really just that study —
  // send visitors straight there. (Search already jumps on single, so this only
  // fires when the page is opened directly.)
  useEffect(() => {
    if (soleStudy) router.replace(getProjectShortUrl(soleStudy));
  }, [soleStudy, router]);

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
        <Heading size="6">Studies for submission {acc}</Heading>

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
              No studies found for submission {acc}
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

        {data && studies.length > 1 && (
          <Text color="gray" weight="light">
            {studies.length.toLocaleString()} studies
          </Text>
        )}

        {/* length 1 redirects; render the list only for the multi-study case */}
        {studies.length > 1 && (
          <Flex
            direction="column"
            gap="0"
            className="seqout-divided-list"
            style={{ paddingLeft: 0 }}
          >
            {visible.map((s) => (
              <ResultCard
                key={s.accession}
                accession={s.accession}
                source={s.source}
                title={s.title}
                summary={s.summary}
                updated_at={s.published_at}
                titleSize="4"
                href={getProjectShortUrl(s.accession)}
              />
            ))}
          </Flex>
        )}

        {!showAll && studies.length > INITIAL_ROWS && (
          <Flex justify="center" py="4">
            <Button variant="soft" onClick={() => setShowAll(true)}>
              Show all {studies.length.toLocaleString()} studies
            </Button>
          </Flex>
        )}
      </Flex>
    </>
  );
}
