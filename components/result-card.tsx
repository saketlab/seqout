import CountryFlagIcon from "@/components/country-flag-icon";
import { cleanJournalName, titleCaseCenter } from "@/utils/format";
import { getProjectShortUrl } from "@/utils/shortUrl";
import { ExternalLinkIcon } from "@radix-ui/react-icons";
import { Badge, Box, Flex, Popover, Text } from "@radix-ui/themes";
import Link from "next/link";
import { memo, useState } from "react";

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

function formatDate(updatedAt: string | null): string | null {
  if (!updatedAt) return null;
  const d = new Date(updatedAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function ResultCard({
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
  const [authorsPopoverOpen, setAuthorsPopoverOpen] = useState(false);

  const formattedDate = formatDate(updated_at);
  const cleanedJournal = journal ? cleanJournalName(journal) : null;
  const hasCitations = citation_count != null && citation_count > 0;

  return (
    <Flex
      direction="column"
      gap="2"
      py="4"
      pr="2"
      pl="0"
      data-result-card="true"
      style={{
        paddingLeft: 0,
        scrollMarginTop: "6rem",
        scrollMarginBottom: "1rem",
      }}
    >
        <Flex
          gap="3"
          justify="between"
          align="start"
          wrap="wrap"
        >
          <Text
            size={{ initial: "2", md: "3" }}
            weight="bold"
            asChild
            style={{ flex: "1 1 16rem", minWidth: 0 }}
          >
            <Link
              href={href ?? getProjectShortUrl(accession)}
              data-result-link="true"
              style={{
                cursor: "pointer",
                userSelect: "none",
                color: "inherit",
                textDecoration: "none",
              }}
            >
              {title}
            </Link>
          </Text>
          {(hasCitations || cleanedJournal || formattedDate) && (
            <Flex
              gap="2"
              align="center"
              wrap="wrap"
              style={{ flexShrink: 0 }}
            >
              {hasCitations && (
                <Badge size="2" color="iris" variant="soft">
                  {citation_count!.toLocaleString()} citations
                </Badge>
              )}
              {cleanedJournal && (
                doi ? (
                  <Badge size="2" color="blue" variant="soft" asChild>
                    <a
                      href={`https://doi.org/${doi}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{ textDecoration: "none", color: "inherit" }}
                    >
                      {cleanedJournal} <ExternalLinkIcon />
                    </a>
                  </Badge>
                ) : (
                  <Badge size="2" color="blue" variant="soft">
                    {cleanedJournal} <ExternalLinkIcon />
                  </Badge>
                )
              )}
              {formattedDate && (
                <Badge size="2" color="gray" variant="soft">
                  {formattedDate}
                </Badge>
              )}
            </Flex>
          )}
        </Flex>
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
                style={{ color: "var(--gray-11)" }}
              >
                {authorList.length > 0 && (
                  <Flex gap="1" align="center" wrap="wrap">
                    {authorList.length === 1 && (
                      <Text size="2">{authorList[0]}</Text>
                    )}
                    {authorList.length >= 2 && (
                      <>
                        <Text size="2">{authorList.slice(0, 2).join(", ")}</Text>
                        {authorList.length > 2 && (
                          <Popover.Root
                            open={authorsPopoverOpen}
                            onOpenChange={setAuthorsPopoverOpen}
                          >
                            <Popover.Trigger>
                              <button
                                type="button"
                                aria-label={`${authorList.length - 2} more authors: ${authorList.join(", ")}`}
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
                                  +{authorList.length - 2}
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
                                {authorList.map((author, i) => (
                                  <Text
                                    key={`${author}-${i}`}
                                    size="1"
                                  >
                                    {author}
                                  </Text>
                                ))}
                              </Flex>
                            </Popover.Content>
                          </Popover.Root>
                        )}
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
                ? "jade"
                : isArrayExpressAccession
                  ? "gold"
                  : accessionUpper.startsWith("G")
                    ? undefined
                    : "brown"
            }
            variant={
              isArrayExpressAccession || isPrjAccession ? "solid" : undefined
            }
            className="seqout-accession"
          >
            {accession}
          </Badge>
          {single_cell_modality && (
            <Badge size={"2"} color="cyan">
              {single_cell_modality}
            </Badge>
          )}
        </Flex>
    </Flex>
  );
}

export default memo(ResultCard);
