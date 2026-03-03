import MapGraph from "@/components/map-graph";
import SearchBar from "@/components/search-bar";
import { Flex } from "@radix-ui/themes";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Map",
  description: "2D accession map for GEO, SRA, ENA & ArrayExpress projects.",
  alternates: {
    canonical: "https://seqout.org/map",
  },
};

export default function MapPage() {
  return (
    <Flex direction="column" style={{ height: "100dvh" }}>
      <SearchBar />
      <main style={{ flex: 1, minHeight: 0 }}>
        <MapGraph />
      </main>
    </Flex>
  );
}
