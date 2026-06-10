"use client";
import {
  EnrichedMetadataBadges,
  EnrichedMetadataGrid,
  exportEnrichedCsv,
  useEnrichedMetadata,
} from "@/components/enriched-metadata-card";
import SectionAnchor from "@/components/section-anchor";
import {
  ArchiveIcon,
  DownloadIcon,
  MagicWandIcon,
} from "@radix-ui/react-icons";
import { Button, Flex, Tabs, Text } from "@radix-ui/themes";
import { useState, type ReactNode } from "react";

type TabValue = "original" | "enriched";

/**
 * Merges the "Original" (Experiments/Samples) table and the AI "Enriched"
 * metadata table into a single section. A Radix tab control sits just left of
 * the CSV download button; the active tab drives both which grid is shown and
 * which CSV the button exports. When enriched metadata is unavailable, only the
 * original table is shown (no tabs).
 */
export default function MetadataTableTabs({
  accession,
  sectionId,
  sectionTitle,
  originalContent,
  onExportOriginalCsv,
}: {
  accession: string;
  sectionId: string;
  sectionTitle: string;
  originalContent: ReactNode;
  onExportOriginalCsv: () => void;
}) {
  const [tab, setTab] = useState<TabValue>("original");
  const { data: enriched } = useEnrichedMetadata(accession);

  // Without enriched data there is nothing to switch to.
  const hasEnriched = !!enriched;
  const activeTab: TabValue = hasEnriched ? tab : "original";
  const showEnriched = hasEnriched && activeTab === "enriched";

  return (
    <>
      <Flex id={sectionId} justify="between" align="center" gap="2" wrap="wrap">
        <Flex align="center" gap="2">
          <Text weight="medium" size="6">
            {sectionTitle}
          </Text>
          {showEnriched && enriched && (
            <EnrichedMetadataBadges data={enriched} />
          )}
          <SectionAnchor id={sectionId} />
        </Flex>
        <Flex align="center" gap="3">
          {hasEnriched && (
            <Tabs.Root
              value={activeTab}
              onValueChange={(value) => setTab(value as TabValue)}
            >
              <Tabs.List size="2">
                <Tabs.Trigger value="original">
                  <Flex gap={"2"} align={"center"}>
                    <ArchiveIcon />
                    <span>Original</span>
                  </Flex>
                </Tabs.Trigger>
                <Tabs.Trigger value="enriched">
                  <Flex gap={"2"} align={"center"}>
                    <MagicWandIcon />
                    <span>Enriched</span>
                  </Flex>
                </Tabs.Trigger>
              </Tabs.List>
            </Tabs.Root>
          )}
          <Button
            onClick={() => {
              if (showEnriched && enriched) {
                exportEnrichedCsv(enriched, accession);
              } else {
                onExportOriginalCsv();
              }
            }}
          >
            <DownloadIcon /> CSV
          </Button>
        </Flex>
      </Flex>
      {showEnriched && enriched ? (
        <EnrichedMetadataGrid data={enriched} />
      ) : (
        originalContent
      )}
    </>
  );
}
