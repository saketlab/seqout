import SearchPageBody from "@/components/search-page-body";
import SearchPageSkeleton from "@/components/search-page-skeleton";
import { Suspense } from "react";
import type { Metadata } from "next";

type SearchParams = Promise<{ q?: string; db?: string }>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const { q } = await searchParams;

  if (!q) {
    const fallbackDesc =
      "Search results for GEO, SRA, ENA, GSA & ArrayExpress sequencing datasets. Filter by organism, library strategy, and more.";
    return {
      title: "Search Results",
      description: fallbackDesc,
      openGraph: {
        title: "seqout - Search Results",
        description: fallbackDesc,
      },
      twitter: {
        card: "summary_large_image" as const,
        title: "seqout - Search Results",
        description: fallbackDesc,
      },
      robots: { index: false, follow: true },
    };
  }

  // No count fetch: it duplicated the client's search query and blocked the URL
  // update on every navigation. The body shows the real total.
  const description = `Search results for "${q}" across GEO, SRA, ENA, GSA & ArrayExpress sequencing datasets.`;

  const title = `seqout: ${q} - Search results`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
    },
    twitter: {
      card: "summary_large_image" as const,
      title,
      description,
    },
    robots: { index: false, follow: true },
  };
}

export default function SearchPage() {
  return (
    <Suspense fallback={<SearchPageSkeleton />}>
      <SearchPageBody />
    </Suspense>
  );
}
