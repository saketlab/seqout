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
    title: `${acc} - Experiment`,
    description: `Metadata, runs, and download links for experiment ${acc} on seqout.`,
    alternates: {
      canonical: `/e/${encodeURIComponent(acc)}`,
    },
    // ssr:false — crawlers get an empty body. Index once server-rendered.
    robots: { index: false, follow: true },
  };
}

export default function ExperimentLayout({ children }: Props) {
  return children;
}
