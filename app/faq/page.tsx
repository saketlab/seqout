import SectionAnchor from "@/components/section-anchor";
import SearchBar from "@/components/search-bar";
import {
  Flex,
  Grid,
  Heading,
  Link,
  Separator,
  Text,
} from "@radix-ui/themes";
import type { Metadata } from "next";
import Image from "next/image";
import type { ReactNode } from "react";
import { LAST_INDEX_REFRESH, SERVER_API_BASE } from "@/utils/constants";
import type { LastUpdated } from "@/utils/types";

export const metadata: Metadata = {
  title: "About and FAQ",
  description:
    "Learn about seqout - a fast exploration tool for GEO, SRA, ENA & ArrayExpress sequencing datasets. Frequently asked questions about data sources, features, and usage.",
  alternates: {
    canonical: "https://seqout.org/faq",
  },
};

const updateFrequencyAnswer = (date: string) =>
  `We refresh the metadata index on a regular schedule to stay in sync with NCBI and EBI. The last full refresh was on ${date}. New datasets appear within a few days of their public release.`;

const faqItems = [
  {
    id: "data-sources",
    question: "Where does seqout fetch its datasets from?",
    answer:
      "We maintain a local mirror of all publicly available datasets on NCBI's FTP servers. This includes all SRA datasets and GEO datasets. We also index ArrayExpress and ENA metadata from EBI. We do not own or modify the original data.",
  },
  {
    id: "download-data",
    question: "Does seqout download sequencing data?",
    answer:
      "No. seqout only indexes and serves metadata. It does not download or host raw sequencing files such as FASTQ or BAM. Project pages do provide bash scripts for downloading FASTQ/SRA files from NCBI, AWS S3, and Google Cloud Storage.",
  },
  {
    id: "difference",
    question: "How is seqout different from browsing NCBI directly?",
    answer:
      "seqout combines GEO, SRA, ENA & ArrayExpress metadata into one interface with relevance-ranked search and consolidated tabular views. NCBI spreads this across multiple pages. seqout also adds enriched metadata, similarity graphs, citation counts, and download scripts.",
  },
  {
    id: "scale",
    question: "Is seqout suitable for large-scale searches?",
    answer:
      "Yes. The backend handles low-latency queries over millions of records. You can filter and compare across studies without waiting.",
  },
  {
    id: "audience",
    question: "Who is seqout intended for?",
    answer:
      "We built seqout for researchers who explore public sequencing metadata and want faster, more structured ways to find datasets.",
  },
  {
    id: "update-frequency",
    question: "How often is seqout updated?",
    answer: updateFrequencyAnswer(LAST_INDEX_REFRESH),
  },
  {
    id: "api",
    question: "Can I use seqout programmatically?",
    answer:
      "Yes. seqout offers a free REST API with no authentication required. All endpoints return JSON and support cursor-based pagination. Rate limits are 60 requests/minute for most endpoints, 30/minute for search, and 10/minute for bulk operations. See the API Reference for full documentation.",
  },
  {
    id: "enriched-metadata",
    question: "What is enriched metadata?",
    answer:
      "For many projects, we run small language models (SLMs) over free-text sample descriptions to extract structured fields like tissue, cell type, disease, sex, and age. The extractions may contain errors, so treat them as a starting point rather than ground truth. Enriched columns appear in the sample table with a purple AI badge.",
  },
  {
    id: "mcp",
    question: "What is the MCP server?",
    answer:
      "seqout exposes a remote Model Context Protocol (MCP) server. LLM clients like Claude Desktop can connect to it and search datasets through chat. The URL is https://seqout.org/api/mcp. See the MCP page for setup instructions.",
  },
  {
    id: "similarity",
    question: "How does the similarity graph work?",
    answer:
      "We embed each project into a vector space based on its metadata and precompute nearest-neighbor relationships. The similarity graph renders these as an interactive 3D force-directed layout. You can filter by organism and click through clusters of related studies.",
  },
  {
    id: "accession-map",
    question: "What is the 2D accession map?",
    answer:
      "The Map page shows a 2D embedding of roughly 1 million datasets, where proximity reflects metadata similarity. You can zoom, pan, filter by country, and click individual points to navigate to project pages. The browser loads data in a binary format for fast rendering.",
  },
  {
    id: "cite",
    question: "How do I cite seqout?",
    answer:
      "Aniruddha Mukherjee and Saket Choudhary. seqout.org.",
  },
  {
    id: "open-source",
    question: "Is seqout open source?",
    answer:
      "Yes. The frontend source code lives on GitHub at github.com/saketlab/seqout.",
  },
  {
    id: "browsers",
    question: "What browsers are supported?",
    answer:
      "Chrome, Firefox, Safari, and Edge all work. The 3D similarity graph and deck.gl maps require WebGL.",
  },
];

const buildFaqJsonLd = (items: typeof faqItems) => ({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: items.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: item.answer,
    },
  })),
});

const FAQ_LINK_MAP: Record<string, { text: string; href: string }[]> = {
  api: [{ text: "API Reference", href: "/api-docs" }],
  mcp: [{ text: "MCP page", href: "/mcp" }],
  "open-source": [
    { text: "github.com/saketlab/seqout", href: "https://github.com/saketlab/seqout" },
  ],
  "accession-map": [{ text: "Map page", href: "/map" }],
};

const ATTRIBUTION_SOURCES = [
  { name: "NCBI GEO", description: "Gene Expression Omnibus", url: "https://www.ncbi.nlm.nih.gov/geo/", label: "ncbi.nlm.nih.gov/geo" },
  { name: "NCBI SRA", description: "Sequence Read Archive", url: "https://www.ncbi.nlm.nih.gov/sra", label: "ncbi.nlm.nih.gov/sra" },
  { name: "EMBL-EBI ENA", description: "European Nucleotide Archive", url: "https://www.ebi.ac.uk/ena/browser/home", label: "ebi.ac.uk/ena" },
  { name: "EMBL-EBI ArrayExpress", description: "Functional Genomics Data", url: "https://www.ebi.ac.uk/biostudies/arrayexpress", label: "ebi.ac.uk/arrayexpress" },
];

const features = [
  {
    title: "Unified search",
    description:
      "Full-text search across GEO, SRA, ENA & ArrayExpress with filters for organism, journal, country, library strategy, instrument model, and time range.",
    href: "/search?q=CRISPR+screen",
  },
  {
    title: "Project detail pages",
    description:
      "Consolidated experiment and sample tables, CSV/metadata export, cross-reference lookup, and BibTeX citations.",
    href: "/p/GSE196830",
  },
  {
    title: "Enriched metadata",
    description:
      "SLM-extracted structured fields (tissue, cell type, disease, sex, age) from free-text sample descriptions.",
    href: "/p/GSE196830#enriched",
  },
  {
    title: "Similarity graph",
    description:
      "Interactive 3D force-directed graph of related projects based on precomputed metadata embeddings.",
    href: "/p/GSE196830#similar",
  },
  {
    title: "Download scripts",
    description:
      "Bash scripts for downloading FASTQ, SRA, or supplementary files via NCBI, AWS S3, or Google Cloud.",
    href: "/p/SRP116528#fastq",
  },
  {
    title: "2D accession map",
    description:
      "Explore ~1M datasets in a 2D similarity embedding. Filter by country and click to navigate to projects.",
    href: "/map",
  },
  {
    title: "Statistics dashboard",
    description:
      "Database growth over time, organism trends, source distribution, and a global contributions map.",
    href: "/stats",
  },
  {
    title: "REST API",
    description:
      "Free, no-auth JSON API with search, project lookup, download links, statistics, and bulk endpoints.",
    href: "/api-docs",
  },
  {
    title: "MCP Server",
    description:
      "Model Context Protocol server so LLM clients like Claude Desktop can search datasets through chat.",
    href: "/mcp",
  },
];

function renderTextWithLinks(
  text: string,
  links: { text: string; href: string }[],
): (string | ReactNode)[] {
  const parts: (string | ReactNode)[] = [];
  let remaining = text;
  for (const link of links) {
    const idx = remaining.indexOf(link.text);
    if (idx >= 0) {
      parts.push(remaining.slice(0, idx));
      parts.push(
        <Link
          key={link.href}
          href={link.href}
          target={link.href.startsWith("http") ? "_blank" : undefined}
          rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
        >
          {link.text}
        </Link>,
      );
      remaining = remaining.slice(idx + link.text.length);
    }
  }
  parts.push(remaining);
  return parts;
}

function FaqItem({
  id,
  question,
  answer,
}: {
  id: string;
  question: string;
  answer: string;
}) {
  const links = FAQ_LINK_MAP[id];

  return (
    <Flex direction="column" gap="3" id={id}>
      <Flex align="center" gap="2">
        <Heading as="h3" size={{ initial: "4", md: "5" }} weight="medium">
          {question}
        </Heading>
        <SectionAnchor id={id} />
      </Flex>
      <Text size={{ initial: "2", md: "3" }} style={{ color: "var(--gray-11)" }}>
        {links ? renderTextWithLinks(answer, links) : answer}
      </Text>
    </Flex>
  );
}

export const revalidate = 604800;

async function getLastRefresh(): Promise<string> {
  try {
    const res = await fetch(`${SERVER_API_BASE}/stats/last-updated`, {
      next: { revalidate },
    });
    if (!res.ok) return LAST_INDEX_REFRESH;
    const { last_updated } = (await res.json()) as LastUpdated;
    if (!last_updated) return LAST_INDEX_REFRESH;
    return new Date(last_updated).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return LAST_INDEX_REFRESH;
  }
}

export default async function FAQ() {
  const lastRefresh = await getLastRefresh();
  const items = faqItems.map((item) =>
    item.id === "update-frequency"
      ? { ...item, answer: updateFrequencyAnswer(lastRefresh) }
      : item,
  );
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildFaqJsonLd(items)) }}
      />
      <SearchBar />
      <Flex
        gap="4"
        py={{ initial: "4", md: "4" }}
        px={{ initial: "4", md: "0" }}
        ml={{ initial: "0", md: "13rem" }}
        mr={{ initial: "0", md: "16rem" }}
        direction="column"
      >
        <Flex align="center" gap="2" id="about">
          <Heading as="h1" size={{ initial: "6", md: "8" }} weight="bold">
            About
          </Heading>
          <SectionAnchor id="about" />
        </Flex>

        <Text size={{ initial: "2", md: "3" }}>
          <Link href="https://seqout.org" weight="bold">
            seqout
          </Link>{" "}
          searches public sequencing datasets from{" "}
          <Link href="https://www.ncbi.nlm.nih.gov/geo/">GEO</Link>,{" "}
          <Link href="https://www.ncbi.nlm.nih.gov/sra">SRA</Link>,{" "}
          <Link href="https://www.ebi.ac.uk/ena/browser/home">ENA</Link>, and{" "}
          <Link href="https://www.ebi.ac.uk/biostudies/arrayexpress">
            ArrayExpress
          </Link>
          . It indexes over{" "}
          <Link href="/stats">1 million projects and 40 million samples</Link>{" "}
          with relevance-ranked search, consolidated experiment and sample
          tables, enriched annotations, similarity graphs, and download
          scripts.
        </Text>

        <Text size={{ initial: "2", md: "3" }}>
          seqout is the web companion to{" "}
          <Link
            href="https://saket-choudhary.me/pysradb/index.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            pysradb
          </Link>
          , a Python package for querying next-generation sequencing metadata and
          data from NCBI Sequence Read Archive.
        </Text>

        <Separator size="4" />

        <Flex align="center" gap="2" id="features">
          <Heading as="h2" size={{ initial: "6", md: "8" }} weight="bold">
            Features
          </Heading>
          <SectionAnchor id="features" />
        </Flex>

        <Grid
          columns={{ initial: "1", sm: "2" }}
          gap={{ initial: "4", md: "5" }}
          width="100%"
        >
          {features.map((f) => (
            <Link
              key={f.title}
              href={f.href}
              underline="hover"
              style={{ display: "block", color: "inherit" }}
            >
              <Flex direction="column" gap="1">
                <Text size="3" weight="medium">
                  {f.title}
                </Text>
                <Text size="2" style={{ color: "var(--gray-11)" }}>
                  {f.description}
                </Text>
              </Flex>
            </Link>
          ))}
        </Grid>

        <Separator size="4" />

        <Flex align="center" gap="2" id="faq">
          <Heading as="h2" size={{ initial: "6", md: "8" }} weight="bold">
            Frequently Asked Questions
          </Heading>
          <SectionAnchor id="faq" />
        </Flex>

        <Flex direction="column" gap="5" pt="2">
          {items.map((item) => (
            <FaqItem
              key={item.id}
              id={item.id}
              question={item.question}
              answer={item.answer}
            />
          ))}
        </Flex>

        <Separator size="4" />

        <Flex align="center" gap="2" id="sources">
          <Heading as="h2" size={{ initial: "6", md: "8" }} weight="bold">
            Data Sources
          </Heading>
          <SectionAnchor id="sources" />
        </Flex>

        <Text size={{ initial: "2", md: "3" }} style={{ color: "var(--gray-11)" }}>
          seqout indexes publicly available metadata from these sources. We
          thank the teams behind these repositories for making sequencing data
          public. We do not host or redistribute raw sequencing data.
        </Text>

        <Flex direction="column" gap="2">
          {ATTRIBUTION_SOURCES.map((src) => (
            <Text key={src.name} size={{ initial: "2", md: "3" }}>
              <Text weight="medium">{src.name}</Text> &mdash; {src.description}.{" "}
              <Link href={src.url} target="_blank" rel="noopener noreferrer">
                {src.label}
              </Link>
            </Text>
          ))}
        </Flex>

        <Separator size="4" />

        <Flex align="center" gap="2" id="contact">
          <Heading as="h2" size={{ initial: "5", md: "7" }} weight="bold">
            Feedback & Contact
          </Heading>
          <SectionAnchor id="contact" />
        </Flex>

        <Text size={{ initial: "2", md: "3" }} style={{ color: "var(--gray-11)" }}>
          Found a bug or have a feature request? Open an issue on{" "}
          <Link
            href="https://github.com/saketlab/seqout/issues"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </Link>
          .
        </Text>
      </Flex>

      <Flex
        direction={{ initial: "column", md: "row" }}
        pt="6"
        pb="4"
        px={{ initial: "4", md: "0" }}
        align="baseline"
        gap="4"
        justify="between"
        ml={{ initial: "0", md: "13rem" }}
        mr={{ initial: "0", md: "16rem" }}
      >
        <Image
          width="198"
          height="63"
          alt="KCDH + IITB Logo"
          src="/KCDH_logo.webp"
        />
        <Text size="2">&copy; Saket Lab, 2026</Text>
      </Flex>
    </>
  );
}
