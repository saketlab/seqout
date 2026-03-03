import SearchBar from "@/components/search-bar";
import StatsGrowthChartCard from "@/components/stats-growth-chart-card";
import StatsOrganismGrowthCard from "@/components/stats-organism-growth-card";
import StatsSourceHistogramCard from "@/components/stats-source-histogram-card";
import { Flex, Text } from "@radix-ui/themes";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Statistics",
  description:
    "Database growth, source distribution, and organism trends across 1 million+ GEO, SRA, ENA & ArrayExpress projects indexed by seqout.",
  alternates: {
    canonical: "https://seqout.org/stats",
  },
};

export default function StatsPage() {
  return (
    <>
      <SearchBar />
      <Flex
        gap="4"
        py={{ initial: "4", md: "4" }}
        px={{ initial: "4", md: "0" }}
        ml={{ initial: "0", md: "13rem" }}
        mr={{ initial: "0", md: "16rem" }}
        direction="column"
      >
        <Text size={{ initial: "6", md: "8" }} weight={"bold"}>
          Key statistics
        </Text>
        <Text color="gray">
          seqout currently indexes roughly 1 million projects and over 40
          million samples across SRA, GEO, ArrayExpress, and ENA for fast search
          and discovery.
        </Text>
        <StatsSourceHistogramCard />
        <StatsGrowthChartCard />
        <StatsOrganismGrowthCard />
      </Flex>
    </>
  );
}
