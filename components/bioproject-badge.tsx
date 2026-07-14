import DbBadge from "@/components/db-badge";
import { dbForAccession } from "@/utils/db-colors";
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
        <DbBadge
          size={{ initial: "2", md: "3" }}
          db={dbForAccession(accession)}
          style={{ cursor: "pointer", whiteSpace: "nowrap" }}
          className="seqout-accession"
        >
          {accession}
          <EnterIcon />
        </DbBadge>
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
