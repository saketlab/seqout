import { fetchProjectSocialTitle } from "@/lib/project-og";
import { SITE_URL } from "@/utils/constants";
import type { Metadata } from "next";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  params: Promise<{ accession: string }>;
};

const CATALOG_URLS: Record<string, string> = {
  GEO: "https://www.ncbi.nlm.nih.gov/geo/",
  SRA: "https://www.ncbi.nlm.nih.gov/sra",
  ENA: "https://www.ebi.ac.uk/ena/browser/home",
  ArrayExpress: "https://www.ebi.ac.uk/biostudies/arrayexpress",
};

function detectProjectType(accession: string): {
  type: string;
  database: string;
} {
  const upper = accession.toUpperCase();

  if (upper.startsWith("E-")) {
    return { type: "ArrayExpress Experiment", database: "ArrayExpress" };
  }

  if (upper.startsWith("G")) {
    return { type: "GEO Series", database: "GEO" };
  }

  if (upper.startsWith("ERP") || upper.startsWith("DRP")) {
    return { type: "ENA Study", database: "ENA" };
  }

  return { type: "SRA Study", database: "SRA" };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { accession } = await params;
  const title = await fetchProjectSocialTitle(accession);
  const { type: projectType, database } = detectProjectType(accession);

  const pageTitle = `${accession} - ${title}`;
  const description = `Explore ${projectType} ${accession}: ${title}. View unified metadata, samples, experiments, and similar projects on seqout.`;
  const image = `/p/${encodeURIComponent(accession)}/opengraph-image`;

  return {
    title: pageTitle,
    description,
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
  const { accession } = await params;
  const title = await fetchProjectSocialTitle(accession);
  const { type: projectType, database } = detectProjectType(accession);
  const description = `Explore ${projectType} ${accession}: ${title}. View unified metadata, samples, experiments, and similar projects on seqout.`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `${accession} - ${title}`,
    description,
    url: `${SITE_URL}/p/${encodeURIComponent(accession)}`,
    identifier: accession,
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
