import { cleanJournalName, countryFlag, titleCaseCenter } from "@/utils/format";
import { getProjectShortUrl } from "@/utils/shortUrl";
import { ExternalLinkIcon } from "@radix-ui/react-icons";
import { Badge, Card, Flex, HoverCard, Text } from "@radix-ui/themes";
import Link from "next/link";

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
}: ResultCardProps) {
  const accessionUpper = accession.toUpperCase();
  const isArrayExpressAccession = accessionUpper.startsWith("E-");
  const isPrjAccession = accessionUpper.startsWith("PRJ");
  const authorList = parseAuthors(authors);
  const additionalAuthorCount = Math.max(authorList.length - 1, 0);

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
            const flag = country_code ? countryFlag(country_code) : "";
            return (
              <Flex
                gap="1"
                align="center"
                wrap="wrap"
                style={{ color: "var(--gray-10)" }}
              >
                {authorList.length === 1 && (
                  <Text size="2">{authorList[0]}</Text>
                )}
                {authorList.length === 2 && (
                  <Text size="2">{`${authorList[0]} and ${authorList[1]}`}</Text>
                )}
                {authorList.length > 2 && (
                  <>
                    <Text size="2">{authorList[0]}</Text>
                    <HoverCard.Root openDelay={100} closeDelay={100}>
                      <HoverCard.Trigger>
                        <Badge
                          size="1"
                          variant="soft"
                          color="gray"
                          style={{ cursor: "default" }}
                        >
                          +{additionalAuthorCount}
                        </Badge>
                      </HoverCard.Trigger>
                      <HoverCard.Content
                        side="top"
                        align="start"
                        sideOffset={6}
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
                      </HoverCard.Content>
                    </HoverCard.Root>
                  </>
                )}
                {(formattedCenter || flag) && (
                  <Text size="2">
                    {formattedCenter
                      ? authors
                        ? `· ${formattedCenter}`
                        : formattedCenter
                      : ""}
                    {flag ? `${formattedCenter ? " " : ""}${flag}` : ""}
                  </Text>
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
