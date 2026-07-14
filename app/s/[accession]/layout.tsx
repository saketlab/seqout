import {
  type Archive,
  ARCHIVE_CATALOG_URLS as CATALOG_URLS,
  ARCHIVE_LICENSE_URLS as LICENSE_URLS,
  SITE_URL,
} from "@/utils/constants";
import { ARCHIVE_BY_DB, dbForAccession } from "@/utils/db-colors";
import type { Metadata } from "next";
import type { ReactNode } from "react";

const API_BASE_URL =
  process.env.PYSRAWEB_API_BASE ?? "https://seqout.org/api";

export const revalidate = 86400;

type Props = {
  children: ReactNode;
  params: Promise<{ accession: string }>;
};

function detectSampleType(accession: string): {
  type: string;
  database: Archive;
} {
  const upper = accession.toUpperCase();
  const database = ARCHIVE_BY_DB[dbForAccession(upper) ?? "sra"];
  if (upper.startsWith("GSM")) return { type: "GEO Sample", database };
  if (/^[SED]RX/.test(upper)) return { type: `${database} Experiment`, database };
  if (/^[SED]RS/.test(upper)) return { type: `${database} Sample`, database };
  if (upper.startsWith("SAM")) return { type: "BioSample", database };
  return { type: "Sample", database };
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
  const accession = (await params).accession.toUpperCase();
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
  const accession = (await params).accession.toUpperCase();
  const title = await fetchSampleTitle(accession);
  const { type: sampleType, database } = detectSampleType(accession);
  const description = `Explore ${sampleType} ${accession}: ${title}. View metadata, experiment info, and download links on seqout.`;

  const canonicalUrl = `${SITE_URL}/s/${encodeURIComponent(accession)}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `${accession} - ${title}`,
    description,
    url: canonicalUrl,
    identifier: accession,
    keywords: [database, "sequencing", "sample metadata", "genomics", accession],
    license: LICENSE_URLS[database],
    includedInDataCatalog: {
      "@type": "DataCatalog",
      name: database,
      url: CATALOG_URLS[database],
    },
    creator: {
      "@type": "Organization",
      name: "Saket Lab",
      url: "https://saketlab.org",
    },
  };

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "seqout", item: SITE_URL },
      {
        "@type": "ListItem",
        position: 2,
        name: "Search",
        item: `${SITE_URL}/search`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: accession,
        item: canonicalUrl,
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      {children}
    </>
  );
}
