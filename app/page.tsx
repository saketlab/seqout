import HomeSearchBar from "@/components/home-search-bar";
import Navabar from "@/components/navbar";
import { Flex } from "@radix-ui/themes";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "seqout - Search GEO, SRA, ENA, GSA & ArrayExpress Datasets",
  description:
    "Search and explore millions of GEO, SRA, ENA, GSA (CNCB-NGDC Genome Sequence Archive) & ArrayExpress sequencing datasets. Unified metadata views, relevance-ranked results, and consolidated sample tables for faster research.",
  alternates: {
    canonical: "/",
  },
};

export default function Home() {
  return (
    <Flex style={{ height: "100dvh" }} direction="column">
      <Navabar />
      <main>
        <HomeSearchBar />
      </main>
    </Flex>
  );
}
