import HomeSearchBar from "@/components/home-search-bar";
import Navabar from "@/components/navbar";
import { Flex } from "@radix-ui/themes";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "seqout - Search GEO, SRA, ENA, DDBJ, GSA & ArrayExpress",
  description:
    "Search millions of GEO, SRA, ENA, DDBJ, GSA & ArrayExpress datasets. Unified metadata, relevance-ranked results, and consolidated sample tables for research.",
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
