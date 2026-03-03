import SearchBar from "@/components/search-bar";
import { Flex, Link, Text } from "@radix-ui/themes";
import type { Metadata } from "next";
import Image from "next/image";

export const metadata: Metadata = {
  title: "About and FAQ",
  description:
    "Learn about seqout - a fast exploration tool for GEO, SRA, ENA & ArrayExpress sequencing datasets. Frequently asked questions about data sources, features, and usage.",
  alternates: {
    canonical: "https://seqout.org/faq",
  },
};

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "Where does seqout fetch its datasets from?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "We maintain a local mirror of all publicly available datasets on NCBI's FTP servers. This includes all SRA datasets and GEO datasets. We do not own or modify the original data.",
      },
    },
    {
      "@type": "Question",
      name: "Does seqout download sequencing data?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "No. seqout only indexes and serves metadata. It does not download or host raw sequencing files such as FASTQ or BAM.",
      },
    },
    {
      "@type": "Question",
      name: "How is seqout different from browsing NCBI directly?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "seqout provides unified GEO, SRA, ENA & ArrayExpress metadata, relevance-ranked search, and consolidated tabular views, eliminating multi-page navigation and reducing discovery time.",
      },
    },
    {
      "@type": "Question",
      name: "Is seqout suitable for large-scale searches?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. The backend is optimized for low-latency queries over millions of records, enabling fast filtering and comparison across studies.",
      },
    },
    {
      "@type": "Question",
      name: "Who is seqout intended for?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "seqout is designed for researchers who frequently explore public sequencing metadata and want faster, more structured discovery workflows.",
      },
    },
  ],
};

export default function FAQ() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <SearchBar />
      <Flex
        gap="4"
        py={{ initial: "4", md: "4" }}
        px={{ initial: "4", md: "0" }}
        ml={{ initial: "0", md: "13rem" }}
        mr={{ initial: "0", md: "16rem" }}
        direction={"column"}
      >
        <Text size={{ initial: "6", md: "8" }} weight={"bold"}>
          About
        </Text>
        <Text size={{ initial: "2", md: "3" }}>
          seqout is a web app for fast exploration of datasets from{" "}
          <Link href="https://www.ncbi.nlm.nih.gov/geo/">GEO</Link>,{" "}
          <Link href="https://www.ncbi.nlm.nih.gov/sra">SRA</Link>,{" "}
          <Link href="https://www.ebi.ac.uk/ena/browser/home">ENA</Link>, and{" "}
          <Link href="https://www.ebi.ac.uk/biostudies/arrayexpress">
            ArrayExpress
          </Link>{" "}
          featuring consolidated tabular views of experiment- and sample-level
          metadata, substantially reducing navigation overhead and enabling
          faster exploration and comparison of studies.
        </Text>
        <Text size={{ initial: "6", md: "8" }} weight={"bold"}>
          Frequently Asked Questions
        </Text>
        <Flex direction={"column"} gap={"3"}>
          <Text size={{ initial: "4", md: "6" }} weight={"medium"}>
            Where does seqout fetch its datasets from?
          </Text>
          <Text size={{ initial: "2", md: "3" }}>
            We maintain a local mirror of all publicly available datasets on
            NCBI&apos;s FTP servers. This includes all{" "}
            <Link href="https://ftp.ncbi.nlm.nih.gov/sra/reports/Metadata/">
              SRA datasets
            </Link>{" "}
            and{" "}
            <Link href="https://ftp.ncbi.nlm.nih.gov/geo/">GEO datasets</Link>.
            We do not own or modify the original data.
          </Text>
        </Flex>

        <Flex direction={"column"} gap={"3"}>
          <Text size={{ initial: "4", md: "6" }} weight={"medium"}>
            Does seqout download sequencing data?
          </Text>
          <Text size={{ initial: "2", md: "3" }}>
            No. seqout only indexes and serves metadata. It does not download
            or host raw sequencing files such as FASTQ or BAM.
          </Text>
        </Flex>

        <Flex direction={"column"} gap={"3"}>
          <Text size={{ initial: "4", md: "6" }} weight={"medium"}>
            How is seqout different from browsing NCBI directly?
          </Text>
          <Text size={{ initial: "2", md: "3" }}>
            seqout provides unified GEO, SRA, ENA & ArrayExpress metadata, relevance-ranked
            search, and consolidated tabular views, eliminating multi-page
            navigation and reducing discovery time.
          </Text>
        </Flex>

        <Flex direction={"column"} gap={"3"}>
          <Text size={{ initial: "4", md: "6" }} weight={"medium"}>
            Is seqout suitable for large-scale searches?
          </Text>
          <Text size={{ initial: "2", md: "3" }}>
            Yes. The backend is optimized for low-latency queries over millions
            of records, enabling fast filtering and comparison across studies.
          </Text>
        </Flex>
        <Flex direction={"column"} gap={"3"}>
          <Text size={{ initial: "4", md: "6" }} weight={"medium"}>
            Who is seqout intended for?
          </Text>
          <Text size={{ initial: "2", md: "3" }}>
            seqout is designed for researchers who frequently explore public
            sequencing metadata and want faster, more structured discovery
            workflows.
          </Text>
        </Flex>
      </Flex>
      <Flex
        direction={{ initial: "column", md: "row" }}
        pt={"6"}
        pb={"4"}
        px={{ initial: "4", md: "0" }}
        align={"baseline"}
        gap={"4"}
        justify={"between"}
        ml={{ initial: "0", md: "13rem" }}
        mr={{ initial: "0", md: "16rem" }}
      >
        <Image
          width="198"
          height="63"
          alt="KCDH + IITB Logo"
          src={"/KCDH_logo.webp"}
        />
        <Text size={"2"}>© Saket Lab, 2026</Text>
      </Flex>
    </>
  );
}
