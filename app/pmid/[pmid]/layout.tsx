import { ARCHIVE_LIST_TEXT } from "@/utils/constants";
import type { Metadata } from "next";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  params: Promise<{ pmid: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { pmid } = await params;
  return {
    title: `PMID ${pmid} - Datasets`,
    description: `Sequencing datasets linked to PMID ${pmid} across ${ARCHIVE_LIST_TEXT}.`,
    alternates: {
      canonical: `/pmid/${encodeURIComponent(pmid)}`,
    },
    robots: { index: false, follow: true },
  };
}

export default function PublicationLayout({ children }: Props) {
  return children;
}
