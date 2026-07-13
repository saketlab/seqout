import type { Metadata } from "next";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  params: Promise<{ accession: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { accession } = await params;
  const acc = decodeURIComponent(accession).toUpperCase();
  return {
    title: `${acc} - Run`,
    description: `Metadata, checksums, and FASTQ download links for run ${acc} on seqout.`,
    alternates: {
      canonical: `/r/${encodeURIComponent(acc)}`,
    },
    robots: { index: false, follow: true },
  };
}

export default function RunLayout({ children }: Props) {
  return children;
}
