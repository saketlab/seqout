import type { Metadata } from "next";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  params: Promise<{ name: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { name } = await params;
  const author = decodeURIComponent(name);
  return {
    title: `${author} - Datasets`,
    description: `Sequencing datasets authored by ${author} across GEO, SRA, ENA, GSA, and ArrayExpress.`,
    alternates: {
      canonical: `/authors/${encodeURIComponent(author)}`,
    },
    robots: { index: false, follow: true },
  };
}

export default function AuthorLayout({ children }: Props) {
  return children;
}
