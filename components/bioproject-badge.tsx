import { EnterIcon, ExternalLinkIcon } from "@radix-ui/react-icons";
import { Badge, Flex } from "@radix-ui/themes";

export default function BioProjectBadge({
  accession,
  ncbiHref,
}: {
  accession: string;
  ncbiHref?: string;
}) {
  return (
    <Flex align="center" gap="2">
      <a href={`/p/${accession}`}>
        <Badge
          size={{ initial: "2", md: "3" }}
          color="green"
          style={{ cursor: "pointer", whiteSpace: "nowrap" }}
          className="seqout-accession"
        >
          {accession}
          <EnterIcon />
        </Badge>
      </a>
      <a
        href={ncbiHref ?? `https://www.ncbi.nlm.nih.gov/bioproject/${accession}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Visit ${accession} BioProject page`}
      >
        <Badge
          size={{ initial: "2", md: "3" }}
          color="blue"
          style={{ cursor: "pointer", whiteSpace: "nowrap" }}
        >
          Visit BioProject page
          <ExternalLinkIcon />
        </Badge>
      </a>
    </Flex>
  );
}
