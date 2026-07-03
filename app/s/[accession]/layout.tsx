import { SITE_URL } from "@/utils/constants";
import type { Metadata } from "next";
import type { ReactNode } from "react";

const API_BASE_URL =
  process.env.PYSRAWEB_API_BASE ?? "https://seqout.org/api";

type Props = {
  children: ReactNode;
  params: Promise<{ accession: string }>;
};

function detectSampleType(accession: string): {
  type: string;
  database: string;
} {
  const upper = accession.toUpperCase();
  if (upper.startsWith("GSM")) {
    return { type: "GEO Sample", database: "GEO" };
  }
  if (/^[SED]RX/i.test(upper)) {
    return { type: "SRA Experiment", database: "SRA" };
  }
  if (/^[SED]RS/i.test(upper)) {
    return { type: "SRA Sample", database: "SRA" };
  }
  if (upper.startsWith("SAM")) {
    return { type: "BioSample", database: "SRA" };
  }
  return { type: "Sample", database: "SRA" };
}

async function fetchSampleTitle(accession: string): Promise<string> {
  try {
    const res = await fetch(
      `${API_BASE_URL}/sample-detail/${encodeURIComponent(accession)}`,
      { next: { revalidate: 3600 } },
    );
    if (!res.ok) return accession;
    const data = await res.json();
    const sample = data?.sample;
    return sample?.title?.trim() || accession;
  } catch {
    return accession;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { accession } = await params;
  const title = await fetchSampleTitle(accession);
  const { type: sampleType, database } = detectSampleType(accession);

  const pageTitle = `${accession} - ${title}`;
  const description = `Explore ${sampleType} ${accession}: ${title}. View metadata, experiment info, and download links on seqout.`;

  return {
    title: pageTitle,
    description,
    alternates: {
      canonical: `/s/${encodeURIComponent(accession)}`,
    },
    openGraph: {
      title: `${title} • ${accession}`,
      description: `${sampleType} on ${database} • ${title}`,
      type: "article",
    },
    twitter: {
      card: "summary",
      title: `${title} • ${accession}`,
      description: `${sampleType} on ${database}`,
    },
  };
}

export default async function SampleLayout({ children, params }: Props) {
  const { accession } = await params;
  const title = await fetchSampleTitle(accession);
  const { type: sampleType, database } = detectSampleType(accession);
  const description = `Explore ${sampleType} ${accession}: ${title}. View metadata, experiment info, and download links on seqout.`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `${accession} - ${title}`,
    description,
    url: `${SITE_URL}/s/${encodeURIComponent(accession)}`,
    identifier: accession,
    includedInDataCatalog: {
      "@type": "DataCatalog",
      name: database,
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {children}
    </>
  );
}
