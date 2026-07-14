import { fetchProjectSocialTitle } from "@/lib/project-og";
import {
  type Archive,
  ARCHIVE_CATALOG_URLS as CATALOG_URLS,
  ARCHIVE_LICENSE_URLS as LICENSE_URLS,
  SITE_URL,
} from "@/utils/constants";
import { ARCHIVE_BY_DB, dbForAccession, type DbSource } from "@/utils/db-colors";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const revalidate = 86400;

type Props = {
  children: ReactNode;
  params: Promise<{ accession: string }>;
};

const PROJECT_NOUN: Record<DbSource, string> = {
  geo: "Series",
  sra: "Study",
  ena: "Study",
  arrayexpress: "Experiment",
  gsa: "Study",
  dra: "Study",
  gea: "Experiment",
};

function detectProjectType(accession: string): {
  type: string;
  database: Archive;
} {
  const db = dbForAccession(accession) ?? "sra";
  const database = ARCHIVE_BY_DB[db];
  return { type: `${database} ${PROJECT_NOUN[db]}`, database };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const accession = (await params).accession.toUpperCase();
  const title = await fetchProjectSocialTitle(accession);
  const { type: projectType, database } = detectProjectType(accession);

  const pageTitle = `${accession} - ${title}`;
  const description = `Explore ${projectType} ${accession}: ${title}. View unified metadata, samples, experiments, and similar projects on seqout.`;
  const image = `/p/${encodeURIComponent(accession)}/opengraph-image`;

  return {
    title: pageTitle,
    description,
    alternates: {
      canonical: `/p/${encodeURIComponent(accession)}`,
    },
    openGraph: {
      title: `${title} • ${accession}`,
      description: `${projectType} on ${database} • ${title}`,
      type: "article",
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: `${accession} - ${title} (${database})`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} • ${accession}`,
      description: `${projectType} on ${database}`,
      images: [image],
    },
  };
}

export default async function ProjectLayout({ children, params }: Props) {
  const accession = (await params).accession.toUpperCase();
  const title = await fetchProjectSocialTitle(accession);
  const { type: projectType, database } = detectProjectType(accession);
  const description = `Explore ${projectType} ${accession}: ${title}. View unified metadata, samples, experiments, and similar projects on seqout.`;

  const canonicalUrl = `${SITE_URL}/p/${encodeURIComponent(accession)}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `${accession} - ${title}`,
    description,
    url: canonicalUrl,
    identifier: accession,
    keywords: [
      database,
      "sequencing",
      "sample metadata",
      "experiment metadata",
      "genomics",
      accession,
    ],
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
    distribution: [
      {
        "@type": "DataDownload",
        encodingFormat: "text/csv",
        contentUrl: `${SITE_URL}/api/project/${encodeURIComponent(
          accession,
        )}/metadata/download`,
      },
    ],
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
