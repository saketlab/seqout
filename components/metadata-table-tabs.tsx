"use client";
import {
  EnrichedMetadataBadges,
  EnrichedMetadataGrid,
  exportEnrichedCsv,
  useEnrichedMetadata,
} from "@/components/enriched-metadata-card";
import SectionAnchor from "@/components/section-anchor";
import { useToast } from "@/components/toast-provider";
import { buildSectionHash, parseSectionHash } from "@/utils/sectionHash";
import { copySectionLink } from "@/utils/shareSectionLink";
import {
  ArchiveIcon,
  DownloadIcon,
  Link2Icon,
  MagicWandIcon,
} from "@radix-ui/react-icons";
import { Button, Flex, Tabs, Text } from "@radix-ui/themes";
import { useEffect, useState, type ReactNode } from "react";

type TabValue = "original" | "enriched";

/**
 * Small link icon rendered inside a tab trigger. Clicking it selects that tab
 * and copies a sharable URL whose hash encodes the section and the tab (e.g.
 * `#samples=enriched`), mirroring the SectionAnchor next to the section title.
 */
function TabShareIcon({
  sectionId,
  sectionTitle,
  tab,
  label,
  onSelect,
}: {
  sectionId: string;
  sectionTitle: string;
  tab: TabValue;
  label: string;
  onSelect: (tab: TabValue) => void;
}) {
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);

  const share = async () => {
    onSelect(tab);
    const didCopy = await copySectionLink(buildSectionHash(sectionId, tab));
    setCopied(didCopy);
    window.setTimeout(() => setCopied(false), 1500);
    if (didCopy) showToast(`Link to ${label} table copied`);
  };

  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`Copy link to ${sectionTitle} ${label} table`}
      title={copied ? "Copied table link" : `Copy link to ${label} table`}
      onClick={(e) => {
        // Don't let Radix also handle this click; we drive the tab change
        // ourselves so selecting + copying happen together.
        e.stopPropagation();
        void share();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          void share();
        }
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        color: copied ? "var(--accent-11)" : "inherit",
        opacity: copied ? 1 : hovered ? 1 : 0.55,
        transition: "opacity 150ms, color 150ms",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Link2Icon />
    </span>
  );
}

/**
 * Merges the "Original" (Experiments/Samples) table and the AI "Enriched"
 * metadata table into a single section. A Radix tab control sits just left of
 * the CSV download button; the active tab drives both which grid is shown and
 * which CSV the button exports. When enriched metadata is unavailable, only the
 * original table is shown (no tabs).
 *
 * Each tab carries its own link icon so the active table selection can be
 * shared via a URL hash (e.g. `#samples=enriched`); opening such a link
 * restores the corresponding tab.
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
  // Restore the tab from the URL hash (e.g. a shared `#samples=enriched` link).
  // Safe to read at init without a hydration mismatch: `activeTab` below is
  // pinned to "original" until the enriched data loads client-side, so the
  // first render is identical regardless of this value.
  const [tab, setTab] = useState<TabValue>(() => {
    if (typeof window === "undefined") return "original";
    const { id, tab: hashTab } = parseSectionHash(window.location.hash);
    return id === sectionId && hashTab === "enriched" ? "enriched" : "original";
  });
  const { data: enriched } = useEnrichedMetadata(accession);

  // Native anchor scrolling doesn't fire for tab-suffixed hashes
  // (`#samples=enriched`), so bring the section into view ourselves.
  useEffect(() => {
    const { id } = parseSectionHash(window.location.hash);
    if (id === sectionId) {
      document.getElementById(sectionId)?.scrollIntoView();
    }
  }, [sectionId]);

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
                    <TabShareIcon
                      sectionId={sectionId}
                      sectionTitle={sectionTitle}
                      tab="original"
                      label="Original"
                      onSelect={setTab}
                    />
                  </Flex>
                </Tabs.Trigger>
                <Tabs.Trigger value="enriched">
                  <Flex gap={"2"} align={"center"}>
                    <MagicWandIcon />
                    <span>Enriched</span>
                    <TabShareIcon
                      sectionId={sectionId}
                      sectionTitle={sectionTitle}
                      tab="enriched"
                      label="Enriched"
                      onSelect={setTab}
                    />
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
