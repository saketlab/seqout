"use client";
import { getExternalArchiveUrl, getInternalUrl } from "@/utils/accessionLinks";
import { ExternalLinkIcon } from "@radix-ui/react-icons";
import { Flex, Link, Tooltip } from "@radix-ui/themes";

const ICON_STYLE = { display: "inline-flex", color: "var(--gray-9)" };

export default function AccessionLink({ accession }: { accession: string }) {
  const internal = getInternalUrl(accession);
  const external = getExternalArchiveUrl(accession);

  return (
    <Flex as="span" align="center" gap="1" display="inline-flex">
      {internal ? (
        <Link href={internal}>{accession}</Link>
      ) : (
        <span>{accession}</span>
      )}
      {external && (
        <Tooltip content={external.label}>
          <a
            href={external.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={external.label}
            style={ICON_STYLE}
          >
            <ExternalLinkIcon />
          </a>
        </Tooltip>
      )}
    </Flex>
  );
}
