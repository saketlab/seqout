"use client";
import SectionAnchor from "@/components/section-anchor";
import { useToast } from "@/components/toast-provider";
import { getJsonOrNull } from "@/utils/api";
import { copyToClipboard } from "@/utils/clipboard";
import { SITE_URL } from "@/utils/constants";
import { DownloadIcon, ExternalLinkIcon } from "@radix-ui/react-icons";
import { Badge, Button, Flex, Heading, Link } from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";

type SuppFile = { url: string; filename: string };
type SuppResp = { total_files: number; files: SuppFile[] };

export default function ProjectSupplementary({
  accession,
}: {
  accession: string | null | undefined;
}) {
  const { showToast } = useToast();
  // Supplementary files only exist for GEO (G*) and ArrayExpress (E-*); skip
  // the guaranteed-404 fetch for SRA-parented (SRP/ERP/DRP) pages.
  const hasSupplementary = !!accession && /^(G|E-)/i.test(accession);
  const { data } = useQuery({
    queryKey: ["supplementary", accession],
    queryFn: () =>
      getJsonOrNull<SuppResp>(`/project/${accession}/supplementary`),
    enabled: hasSupplementary,
    staleTime: 60 * 60 * 1000,
  });

  if (!accession || !data || data.total_files === 0) return null;

  const copyScript = () => {
    copyToClipboard(
      `curl -sS "${SITE_URL}/api/project/${accession}/supplementary/download" | bash`,
    );
    showToast("Download script copied");
  };

  return (
    <Flex direction="column" gap="3">
      <Flex id="supplementary" align="center" gap="2" wrap="wrap">
        <Heading as="h2" weight="medium" size="5">
          Supplementary files
        </Heading>
        <SectionAnchor id="supplementary" />
        <Badge color="gray">{data.total_files}</Badge>
        <Button size="1" variant="surface" onClick={copyScript}>
          <DownloadIcon /> Copy script
        </Button>
      </Flex>
      <Flex
        direction="column"
        gap="1"
        style={{ maxHeight: "16rem", overflowY: "auto" }}
      >
        {data.files.map((f) => (
          <Link
            key={f.url}
            href={f.url}
            target="_blank"
            rel="noopener noreferrer"
            size="2"
            style={{ fontFamily: "var(--code-font-family)" }}
          >
            {f.filename} <ExternalLinkIcon />
          </Link>
        ))}
      </Flex>
    </Flex>
  );
}
