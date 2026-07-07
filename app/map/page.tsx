import MapGraph from "@/components/seqout-map";
import SearchBar from "@/components/search-bar";
import { Flex } from "@radix-ui/themes";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dataset Map",
  description:
    "Interactive 2D scatter-plot of GEO, SRA, ENA & ArrayExpress projects. Explore clusters of similar sequencing datasets by visualizing embedding-based proximity.",
  alternates: {
    canonical: "https://seqout.org/map",
  },
};

export default function MapPage() {
  return (
    <Flex
      direction="column"
      style={{ height: "100dvh", minHeight: 0, overflow: "hidden" }}
    >
      <SearchBar mobileVariant="compact" />
      <main style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <MapGraph />
      </main>
    </Flex>
  );
}
