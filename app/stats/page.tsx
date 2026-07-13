import SearchBar from "@/components/search-bar";
import StatsEnrichedCard from "@/components/stats-enriched-card";
import StatsGlobalContributionsCard from "@/components/stats-global-contributions-card";
import StatsGrowthChartCard from "@/components/stats-growth-chart-card";
import StatsOrganismGrowthCard from "@/components/stats-organism-growth-card";
import StatsPlatformComparisonCard from "@/components/stats-platform-comparison-card";
import StatsSequencingTechnologyCard from "@/components/stats-sequencing-technology-card";
import StatsSourceHistogramCard from "@/components/stats-source-histogram-card";
import { Flex, Heading } from "@radix-ui/themes";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Statistics: GEO, SRA, ENA, DDBJ, GSA & ArrayExpress Growth",
  description:
    "Database growth, source distribution, and organism trends across 1 million+ GEO, SRA, ENA, DDBJ, GSA & ArrayExpress projects indexed by seqout.",
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
        <Heading as="h1" size={{ initial: "6", md: "8" }} weight={"bold"}>
          Key statistics
        </Heading>
        {/* Chart list — hairline dividers replace the former Card wrappers.
            Each chart component provides its own vertical padding + width. */}
        <Flex direction="column" gap="0" className="seqout-divided-list">
          <div id="sources">
            <StatsSourceHistogramCard />
          </div>
          <div id="growth">
            <StatsGrowthChartCard />
          </div>
          <div id="organisms">
            <StatsOrganismGrowthCard />
          </div>
          <div id="sequencing">
            <StatsSequencingTechnologyCard />
          </div>
          <div id="comparison">
            <StatsPlatformComparisonCard />
          </div>
          <div id="enriched">
            <StatsEnrichedCard />
          </div>
          <div id="map">
            <StatsGlobalContributionsCard />
          </div>
        </Flex>
      </Flex>
    </>
  );
}
