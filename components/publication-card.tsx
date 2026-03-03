"use client";

import { cleanJournalName } from "@/utils/format";
import { SERVER_URL } from "@/utils/constants";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "@radix-ui/react-icons";
import { Badge, Box, Card, Flex, Link, Text, Tooltip } from "@radix-ui/themes";
import Image from "next/image";
import { useState } from "react";

export type StudyPublication = {
  pmid: string | null;
  title: string | null;
  journal: string | null;
  doi: string | null;
  pub_date: string | null;
  authors: string | null;
  issn: string | null;
  citation_count: number | null;
  journal_h_index: number | null;
  journal_i10_index: number | null;
  journal_2yr_mean_citedness: number | null;
  journal_cited_by_count: number | null;
  journal_works_count: number | null;
};

type PublicationCardProps = {
  publication: StudyPublication;
  accession?: string;
};

function formatAuthors(authors: string | null): string {
  if (!authors) return "";
  const list = authors.split(",").map((a) => a.trim());
  if (list.length > 4) {
    return `${list.slice(0, 4).join(", ")} et al.`;
  }
  return list.join(", ");
}

function extractYear(pubDate: string | null): string | null {
  if (!pubDate) return null;
  const match = pubDate.trim().match(/^\d{4}/);
  return match ? match[0] : null;
}

function toCellAuthor(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0] + ".";
  const last = parts[parts.length - 1];
  const initials = parts
    .slice(0, -1)
    .map((p) => p[0].toUpperCase() + ".")
    .join("");
  return `${last}, ${initials}`;
}

function formatCellAuthors(authors: string): string {
  const list = authors.split(",").map((a) => a.trim()).filter(Boolean);
  const formatted = list.map(toCellAuthor);
  if (formatted.length > 10) {
    return formatted.slice(0, 10).join(", ") + ", et al.";
  }
  if (formatted.length > 1) {
    return (
      formatted.slice(0, -1).join(", ") +
      ", and " +
      formatted[formatted.length - 1]
    );
  }
  return formatted[0];
}

function formatCellCitation(pub: StudyPublication): string {
  const parts: string[] = [];
  if (pub.authors) {
    parts.push(formatCellAuthors(pub.authors));
  }
  const year = extractYear(pub.pub_date);
  if (year) {
    parts.push(`(${year}).`);
  }
  if (pub.title) {
    const title = pub.title.endsWith(".") ? pub.title : `${pub.title}.`;
    parts.push(title);
  }
  if (pub.journal) {
    parts.push(cleanJournalName(pub.journal) + ".");
  }
  if (pub.doi) {
    parts.push(`https://doi.org/${pub.doi}`);
  }
  return parts.join(" ");
}

function copyToClipboard(text: string): boolean {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => {});
    return true;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(textarea);
  return ok;
}

const copyBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "2px 8px",
  borderRadius: "var(--radius-2)",
  border: "1px solid var(--gray-a7)",
  background: "var(--gray-a3)",
  color: "var(--gray-11)",
  fontSize: "var(--font-size-1)",
  fontWeight: 500,
  cursor: "pointer",
  lineHeight: 1,
};

function CopyButton({
  label,
  copied,
  onClick,
}: {
  label: string;
  copied: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip content={copied ? "Copied!" : `Copy ${label}`}>
      <button type="button" onClick={onClick} style={copyBtnStyle}>
        {copied ? (
          <CheckIcon width="12" height="12" />
        ) : (
          <CopyIcon width="12" height="12" />
        )}
        {copied ? "Copied" : label}
      </button>
    </Tooltip>
  );
}

export default function PublicationCard({
  publication,
  accession,
}: PublicationCardProps) {
  const [copiedCitation, setCopiedCitation] = useState(false);
  const [copiedBibtex, setCopiedBibtex] = useState(false);

  const year = extractYear(publication.pub_date);
  const titleLink = publication.doi
    ? `https://doi.org/${publication.doi}`
    : publication.pmid
      ? `https://pubmed.ncbi.nlm.nih.gov/${publication.pmid}`
      : null;

  const handleCopyCitation = () => {
    const text = formatCellCitation(publication);
    if (copyToClipboard(text)) {
      setCopiedCitation(true);
      setTimeout(() => setCopiedCitation(false), 1500);
    }
  };

  const handleCopyBibtex = async () => {
    if (!accession) return;
    try {
      const res = await fetch(
        `${SERVER_URL}/project/${encodeURIComponent(accession)}/cite?type=all&format=bibtex`,
      );
      if (!res.ok) return;
      const allBibtex = await res.text();
      let bibtex = allBibtex;
      if (publication.pmid) {
        const entries = allBibtex.split(/\n\n+/);
        const match = entries.find((e) =>
          e.includes(`pmid    = {${publication.pmid}}`),
        );
        if (match) bibtex = match;
      }
      if (copyToClipboard(bibtex)) {
        setCopiedBibtex(true);
        setTimeout(() => setCopiedBibtex(false), 1500);
      }
    } catch {
      /* fetch failed */
    }
  };

  return (
    <Card>
      <Flex gap={"4"} align={"center"}>
        <Box display={{ initial: "block", md: "none" }}>
          <Image
            draggable={"false"}
            src={"/page.svg"}
            height={24}
            width={24}
            alt="page icon"
          />
        </Box>
        <Box display={{ initial: "none", md: "block" }}>
          <Image
            draggable={"false"}
            src={"/page.svg"}
            height={40}
            width={40}
            alt="page icon"
          />
        </Box>
        <Flex direction={"column"} style={{ flex: 1 }}>
          {titleLink ? (
            <Link
              href={titleLink}
              target="_blank"
              rel="noopener noreferrer"
              size={{ initial: "2", md: "3" }}
              weight={"medium"}
            >
              {publication.title} <ExternalLinkIcon />
            </Link>
          ) : (
            <Text size={{ initial: "2", md: "3" }} weight={"medium"}>
              {publication.title}
            </Text>
          )}

          {publication.authors && (
            <Text
              style={{ fontStyle: "italic" }}
              size={{ initial: "1", md: "2" }}
            >
              {formatAuthors(publication.authors)}
            </Text>
          )}
          <Flex gap={"2"} align={"center"} wrap={"wrap"} mt={"1"}>
            {publication.journal && (
              <Text weight={"medium"} size={"2"}>
                {cleanJournalName(publication.journal)}
              </Text>
            )}
            {year && (
              <Badge color="gray" variant="soft" size={"1"}>
                {year}
              </Badge>
            )}
            {publication.citation_count != null &&
              publication.citation_count > 0 && (
                <Badge color="iris" size={"1"}>
                  {publication.citation_count.toLocaleString()} citations
                </Badge>
              )}
            <CopyButton
              label="Cite"
              copied={copiedCitation}
              onClick={handleCopyCitation}
            />
            {accession && (
              <CopyButton
                label="BibTeX"
                copied={copiedBibtex}
                onClick={handleCopyBibtex}
              />
            )}
          </Flex>
        </Flex>
      </Flex>
    </Card>
  );
}
