"use client";

import { useToast } from "@/components/toast-provider";
import { copyToClipboard } from "@/utils/clipboard";
import { SERVER_URL } from "@/utils/constants";
import { cleanJournalName } from "@/utils/format";
import { fetchPubmedSummary } from "@/utils/pubmed";
import { doiHref, pmidHref, pubmedHref } from "@/utils/project";
import type { StudyPublication } from "@/utils/types";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "@radix-ui/react-icons";
import { Badge, Card, Flex, Link, Text, Tooltip } from "@radix-ui/themes";
import NextLink from "next/link";
import ProjectAuthors from "@/components/project-authors";
import { useEffect, useRef, useState } from "react";

export type { StudyPublication };

type PublicationCardProps = {
  publication: StudyPublication;
  accession?: string;
};

function extractYear(pubDate: string | number | null): string | null {
  if (!pubDate) return null;
  // pub_date is usually a string ("2015-06-15") but can arrive as a bare
  // year number (2025) — coerce before matching so it never crashes.
  const match = String(pubDate).trim().match(/^\d{4}/);
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
  const list = authors
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
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
    parts.push(doiHref(pub.doi));
  }
  return parts.join(" ");
}

const chipStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 4,
  // 6px vertical padding + 12px icon + 6px = 24px tall, clears WCAG 2.5.8
  padding: "6px 12px",
  minHeight: "24px",
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
  getText,
  toast,
}: {
  label: string;
  getText: () => string | Promise<string | null> | null;
  toast: string;
}) {
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(timer.current ?? undefined), []);

  const handleClick = async () => {
    const text = await getText();
    if (!text || !copyToClipboard(text)) return;
    setCopied(true);
    clearTimeout(timer.current ?? undefined);
    timer.current = setTimeout(() => setCopied(false), 1500);
    showToast(toast);
  };

  return (
    <Tooltip content={copied ? "Copied!" : `Copy ${label}`}>
      <button type="button" onClick={handleClick} style={chipStyle}>
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
  publication: incoming,
  accession,
}: PublicationCardProps) {
  // Fallback: backend gave a PMID but no enriched details — pull them from
  // NCBI PubMed. Tag the fetched fields with the PMID they belong to so a
  // stale fallback never bleeds onto a different publication.
  const [fallback, setFallback] = useState<{
    pmid: string;
    extra: Partial<StudyPublication>;
  } | null>(null);
  useEffect(() => {
    const needsDetails =
      incoming.pmid && !incoming.title && !incoming.journal && !incoming.authors;
    if (!needsDetails) return;
    const controller = new AbortController();
    fetchPubmedSummary(incoming.pmid!, controller.signal).then((extra) =>
      setFallback({ pmid: incoming.pmid!, extra }),
    );
    return () => controller.abort();
  }, [incoming]);

  // Existing (non-null) fields always win over the fallback.
  const extra = fallback?.pmid === incoming.pmid ? fallback.extra : {};
  const publication: StudyPublication = {
    ...incoming,
    title: incoming.title ?? extra.title ?? null,
    journal: incoming.journal ?? extra.journal ?? null,
    authors: incoming.authors ?? extra.authors ?? null,
    pub_date: incoming.pub_date ?? extra.pub_date ?? null,
    doi: incoming.doi ?? extra.doi ?? null,
  };

  const year = extractYear(publication.pub_date);
  const cleanedJournal = publication.journal
    ? cleanJournalName(publication.journal)
    : null;
  const hasCitations =
    publication.citation_count != null && publication.citation_count > 0;
  const titleLink = publication.doi
    ? doiHref(publication.doi)
    : publication.pmid
      ? pubmedHref(publication.pmid)
      : null;

  const fetchBibtex = async (): Promise<string | null> => {
    if (!accession) return null;
    try {
      const res = await fetch(
        `${SERVER_URL}/project/${encodeURIComponent(accession)}/cite?type=all&format=bibtex`,
      );
      if (!res.ok) return null;
      const allBibtex = await res.text();
      if (!publication.pmid) return allBibtex;
      const entries = allBibtex.split(/\n\n+/);
      return (
        entries.find((e) => e.includes(`pmid    = {${publication.pmid}}`)) ??
        allBibtex
      );
    } catch {
      return null;
    }
  };

  return (
    <Card>
      <Flex direction="column" gap="2">
        {/* Header row: title (left, expands) + triage meta (right, wraps
            below on narrow viewports). Same structural skeleton as the
            search result card — citations, journal, year live next to the
            title for one-glance scanning, not buried at the bottom. */}
        <Flex gap="3" justify="between" align="start" wrap="wrap">
          {titleLink ? (
            <Text
              size={{ initial: "2", md: "3" }}
              weight="bold"
              asChild
              style={{ flex: "1 1 16rem", minWidth: 0 }}
            >
              <Link
                href={titleLink}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "inherit", textDecoration: "none" }}
              >
                {publication.title}{" "}
                <ExternalLinkIcon
                  style={{ verticalAlign: "middle", opacity: 0.6 }}
                />
              </Link>
            </Text>
          ) : (
            <Text
              size={{ initial: "2", md: "3" }}
              weight="bold"
              style={{ flex: "1 1 16rem", minWidth: 0 }}
            >
              {publication.title}
            </Text>
          )}

          {(hasCitations || cleanedJournal || year) && (
            <Flex gap="2" align="center" wrap="wrap" style={{ flexShrink: 0 }}>
              {hasCitations && (
                <Badge size="2" color="iris" variant="soft">
                  {publication.citation_count!.toLocaleString()} citations
                </Badge>
              )}
              {cleanedJournal && (
                <Badge
                  size="2"
                  color="blue"
                  variant="soft"
                  style={{ cursor: publication.doi ? "pointer" : undefined }}
                  onClick={
                    publication.doi
                      ? (e) => {
                          e.stopPropagation();
                          window.open(doiHref(publication.doi!), "_blank");
                        }
                      : undefined
                  }
                >
                  {cleanedJournal}
                  {publication.doi && <ExternalLinkIcon />}
                </Badge>
              )}
              {year && (
                <Text size="1" style={{ color: "var(--gray-11)" }}>
                  {year}
                </Text>
              )}
            </Flex>
          )}
        </Flex>

        {publication.authors && (
          <ProjectAuthors
            authors={publication.authors.split(",")}
            initialVisible={4}
            size="2"
          />
        )}

        {/* Bottom row: canonical identifiers (PMID / DOI) rendered in
            Geist Mono via the seqout-accession class, plus citation-copy
            and BibTeX-copy actions. Parallel to the result-card's bottom
            badge row (accession + modality tags). */}
        <Flex gap="2" align="center" wrap="wrap">
          {publication.pmid && (
            <>
              <Tooltip content="See every project linked to this paper">
                <NextLink
                  href={pmidHref(publication.pmid)}
                  prefetch={false}
                  style={{ textDecoration: "none" }}
                >
                  <Badge
                    size="2"
                    color="gray"
                    variant="soft"
                    className="seqout-accession"
                    style={{ cursor: "pointer" }}
                  >
                    PMID {publication.pmid}
                  </Badge>
                </NextLink>
              </Tooltip>
              <CopyButton
                label="PMID"
                getText={() => publication.pmid}
                toast="PMID copied"
              />
              <Tooltip content="Open in PubMed">
                <Link
                  href={pubmedHref(publication.pmid)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open PMID ${publication.pmid} in PubMed`}
                  style={{ textDecoration: "none" }}
                >
                  <Badge
                    size="2"
                    color="gray"
                    variant="soft"
                    style={{ cursor: "pointer" }}
                  >
                    PubMed
                    <ExternalLinkIcon />
                  </Badge>
                </Link>
              </Tooltip>
            </>
          )}
          {publication.doi && !cleanedJournal && (
            <Link
              href={doiHref(publication.doi)}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: "none" }}
            >
              <Badge
                size="2"
                color="gray"
                variant="soft"
                className="seqout-accession"
                style={{ cursor: "pointer" }}
              >
                doi:{publication.doi}
              </Badge>
            </Link>
          )}
          <CopyButton
            label="Cite"
            getText={() => formatCellCitation(publication)}
            toast="Citation copied"
          />
          {accession && (
            <CopyButton
              label="BibTeX"
              getText={fetchBibtex}
              toast="BibTeX copied"
            />
          )}
        </Flex>
      </Flex>
    </Card>
  );
}
