import { cleanJournalName } from "@/utils/format";
import { getProjectShortUrl } from "@/utils/shortUrl";
import { ExternalLinkIcon } from "@radix-ui/react-icons";
import { Badge, Card, Flex, Text } from "@radix-ui/themes";
import { useRouter } from "next/navigation";

type ResultCardProps = {
  accesssion: string;
  title: string | null;
  summary: string | null;
  updated_at: string | null;
  journal: string | null;
  doi: string | null;
  citation_count: number | null;
};

export default function ResultCard({
  accesssion,
  title,
  summary,
  updated_at,
  journal,
  doi,
  citation_count,
}: ResultCardProps) {
  const router = useRouter();
  const isArrayExpressAccession = accesssion.toUpperCase().startsWith("E-");

  const handleClick = () => {
    router.push(getProjectShortUrl(accesssion));
  };

  return (
    <Card>
      <Flex direction={"column"} gap={"2"}>
        <Text
          size={{ initial: "2", md: "3" }}
          weight={"bold"}
          style={{ cursor: "pointer", width: "100%", userSelect: "none" }}
          onClick={handleClick}
        >
          {title}
        </Text>
        <Text size={"2"} truncate>
          {summary}
        </Text>
        <Flex gap={"2"} align={"center"} wrap={"wrap"}>
          <Badge
            size={"2"}
            color={
              isArrayExpressAccession
                ? "gold"
                : accesssion.startsWith("G")
                  ? undefined
                  : "brown"
            }
            variant={isArrayExpressAccession ? "solid" : undefined}
          >
            {accesssion}
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
