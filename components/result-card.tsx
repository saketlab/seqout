import CountryFlagIcon from "@/components/country-flag-icon";
import { cleanJournalName, titleCaseCenter } from "@/utils/format";
import { getProjectShortUrl } from "@/utils/shortUrl";
import { ExternalLinkIcon } from "@radix-ui/react-icons";
import { Badge, Box, Card, Flex, Popover, Text } from "@radix-ui/themes";
import Link from "next/link";
import { useState } from "react";

type ResultCardProps = {
  accession: string;
  title: string | null;
  summary: string | null;
  updated_at: string | null;
  journal: string | null;
  doi: string | null;
  citation_count: number | null;
  authors: string | null;
  center_name?: string | null;
  country_code?: string | null;
  href?: string;
  single_cell_modality?: string | null;
};

function parseAuthors(authors: string | null): string[] {
  if (!authors) return [];
  return authors
    .split(",")
    .map((author) => author.trim())
    .filter(Boolean);
}

export default function ResultCard({
  accession,
  title,
  summary,
  updated_at,
  journal,
  doi,
  citation_count,
  authors,
  center_name,
  country_code,
  href,
  single_cell_modality,
}: ResultCardProps) {
  const accessionUpper = accession.toUpperCase();
  const isArrayExpressAccession = accessionUpper.startsWith("E-");
  const isPrjAccession = accessionUpper.startsWith("PRJ");
  const authorList = parseAuthors(authors);
  const additionalAuthorCount = Math.max(authorList.length - 1, 0);
  const [authorsPopoverOpen, setAuthorsPopoverOpen] = useState(false);

  return (
    <Card>
      <Flex direction={"column"} gap={"2"}>
        <Text size={{ initial: "2", md: "3" }} weight={"bold"} asChild>
          <Link
            href={href ?? getProjectShortUrl(accession)}
            style={{
              cursor: "pointer",
              width: "100%",
              userSelect: "none",
              color: "inherit",
              textDecoration: "none",
            }}
          >
            {title}
          </Link>
        </Text>
        <Text size={"2"} truncate>
          {summary}
        </Text>
        {(authors || center_name) &&
          (() => {
            const formattedCenter =
              center_name && center_name !== authors
                ? titleCaseCenter(center_name)
                : null;
            return (
              <Flex
                direction="column"
                gap="1"
                style={{ color: "var(--gray-10)" }}
              >
                {authorList.length > 0 && (
                  <Flex gap="1" align="center" wrap="wrap">
                    {authorList.length === 1 && (
                      <Text size="2">{authorList[0]}</Text>
                    )}
                    {authorList.length === 2 && (
                      <Text size="2">{`${authorList[0]} and ${authorList[1]}`}</Text>
                    )}
                    {authorList.length > 2 && (
                      <>
                        <Text size="2">{authorList[0]}</Text>
                        <Popover.Root
                          open={authorsPopoverOpen}
                          onOpenChange={setAuthorsPopoverOpen}
                        >
                          <Popover.Trigger>
                            <button
                              type="button"
                              aria-label={`Show ${additionalAuthorCount} more authors`}
                              onMouseEnter={() => setAuthorsPopoverOpen(true)}
                              onMouseLeave={() => setAuthorsPopoverOpen(false)}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                padding: 0,
                                border: "none",
                                background: "transparent",
                                cursor: "pointer",
                              }}
                            >
                              <Badge size="1" variant="soft" color="gray">
                                +{additionalAuthorCount}
                              </Badge>
                            </button>
                          </Popover.Trigger>
                          <Popover.Content
                            side="top"
                            align="start"
                            sideOffset={6}
                            onMouseEnter={() => setAuthorsPopoverOpen(true)}
                            onMouseLeave={() => setAuthorsPopoverOpen(false)}
                            style={{
                              maxWidth: "min(320px, 85vw)",
                              maxHeight: "14rem",
                              overflowY: "auto",
                            }}
                          >
                            <Flex direction="column" gap="1">
                              {authorList.map((author) => (
                                <Text key={author} size="1">
                                  {author}
                                </Text>
                              ))}
                            </Flex>
                          </Popover.Content>
                        </Popover.Root>
                      </>
                    )}
                    {(formattedCenter || country_code) && (
                      <Box display={{ initial: "none", sm: "block" }}>
                        <Flex align="center" gap="1">
                          <Text size="2">
                            {formattedCenter
                              ? authors
                                ? `· ${formattedCenter}`
                                : formattedCenter
                              : ""}
                          </Text>
                          {country_code && (
                            <CountryFlagIcon
                              code={country_code}
                              label={formattedCenter ?? country_code}
                            />
                          )}
                        </Flex>
                      </Box>
                    )}
                  </Flex>
                )}
                {(formattedCenter || country_code) && (
                  <Box display={{ initial: "block", sm: "none" }}>
                    <Flex align="center" gap="1">
                      <Text size="2">{formattedCenter ?? ""}</Text>
                      {country_code && (
                        <CountryFlagIcon
                          code={country_code}
                          label={formattedCenter ?? country_code}
                        />
                      )}
                    </Flex>
                  </Box>
                )}
              </Flex>
            );
          })()}
        <Flex gap={"2"} align={"center"} wrap={"wrap"}>
          <Badge
            size={"2"}
            color={
              isPrjAccession
                ? undefined
                : isArrayExpressAccession
                  ? "gold"
                  : accessionUpper.startsWith("G")
                    ? undefined
                    : "brown"
            }
            variant={
              isArrayExpressAccession || isPrjAccession ? "solid" : undefined
            }
            style={
              isPrjAccession
                ? { backgroundColor: "#6bb4b5", color: "white" }
                : undefined
            }
          >
            {accession}
          </Badge>
          <Badge size={"2"} color="gray">
            Last updated on{" "}
            {updated_at
              ? new Date(updated_at).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })
              : null}
          </Badge>
          {citation_count != null && citation_count > 0 && (
            <Badge size={"2"} color="iris">
              {citation_count.toLocaleString()} citations
            </Badge>
          )}
          {single_cell_modality && (
            <Badge size={"2"} color="cyan">
              {single_cell_modality}
            </Badge>
          )}
          {journal && (
            <Badge
              size={"2"}
              color="blue"
              style={{ cursor: doi ? "pointer" : undefined }}
              onClick={
                doi
                  ? (e) => {
                      e.stopPropagation();
                      window.open(`https://doi.org/${doi}`, "_blank");
                    }
                  : undefined
              }
            >
              {cleanJournalName(journal)} <ExternalLinkIcon />
            </Badge>
          )}
        </Flex>
      </Flex>
    </Card>
  );
}
