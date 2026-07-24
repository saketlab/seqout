"use client";
import {
  EnrichedMetadataBadges,
  EnrichedMetadataGrid,
  exportEnrichedCsv,
  useEnrichedMetadata,
} from "@/components/enriched-metadata-card";
import { FirstVisitPing, useFirstVisit } from "@/components/first-visit-ping";
import SectionAnchor from "@/components/section-anchor";
import { useToast } from "@/components/toast-provider";
import { WrapTextToggle } from "@/components/wrap-text-toggle";
import { buildCombinedRows, combinedHeaders } from "@/utils/combinedCsv";
import { downloadCsv } from "@/utils/exportCsv";
import { buildSectionHash, parseSectionHash } from "@/utils/sectionHash";
import { copySectionLink } from "@/utils/shareSectionLink";
import {
  ArchiveIcon,
  DownloadIcon,
  Link2Icon,
  MagicWandIcon,
} from "@radix-ui/react-icons";
import {
  AlertDialog,
  Button,
  Flex,
  Heading,
  Spinner,
  Tabs,
  Text,
} from "@radix-ui/themes";
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
  titleBadge,
  hasEnriched,
  originalContent,
  onExportOriginalCsv,
  combinedExport,
}: {
  accession: string;
  sectionId: string;
  sectionTitle: string;
  titleBadge?: ReactNode;
  // Whether the study has enriched metadata, from the cheap `has_enriched` flag
  // on the project response — lets us show the tab without fetching the payload.
  hasEnriched?: boolean;
  originalContent: ReactNode;
  onExportOriginalCsv: () => void;
  /**
   * Sources to fold into the combined export. Omitted (or with nothing to join
   * to) the CSV button downloads this table alone, with no dialog.
   */
  combinedExport?: {
    /** "sample" or "experiment" — names the table in the dialog's opt-out. */
    noun: string;
    sraAccessions: string[];
    geoAccession: string | null;
    /** Whether either level of supplementary file exists for this project. */
    hasSupplementary: boolean;
  };
}) {
  // Restore the tab from the URL hash (e.g. a shared `#samples=enriched` link).
  // Safe to read at init without a hydration mismatch: `activeTab` below is
  // pinned to "original" until the enriched data loads client-side, so the
  // first render is identical regardless of this value.
  const [seenEnriched, markEnrichedSeen] = useFirstVisit(
    "seqout-enriched-tab-clicked",
  );
  const [tab, setTab] = useState<TabValue>(() => {
    if (typeof window === "undefined") return "original";
    const { id, tab: hashTab } = parseSectionHash(window.location.hash);
    return id === sectionId && hashTab === "enriched" ? "enriched" : "original";
  });
  // Lazy: only fetch enriched metadata once its tab is active (clicked or
  // deep-linked via `#samples=enriched`), so the heavy per-sample payload isn't
  // loaded on every project page / crawler hit. react-query keeps the result
  // cached, so switching back and forth doesn't refetch.
  const showEnriched = !!hasEnriched && tab === "enriched";
  const {
    data: enriched,
    isLoading: isEnrichedLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useEnrichedMetadata(accession, showEnriched);

  // Native anchor scrolling doesn't fire for tab-suffixed hashes
  // (`#samples=enriched`), so bring the section into view ourselves.
  useEffect(() => {
    const { id } = parseSectionHash(window.location.hash);
    if (id === sectionId) {
      document.getElementById(sectionId)?.scrollIntoView();
    }
  }, [sectionId]);

  // No enriched data → there's nothing to switch to, so pin to the original tab.
  const activeTab: TabValue = hasEnriched ? tab : "original";

  const [askCombined, setAskCombined] = useState(false);
  const [combining, setCombining] = useState(false);
  const { showToast } = useToast();

  // Nothing to join to (no FASTQ side, no supplementary) — the dialog would
  // offer a combined export identical to the plain one, so skip it.
  const canCombine =
    !!combinedExport &&
    (combinedExport.sraAccessions.length > 0 || combinedExport.hasSupplementary);

  const downloadCombined = async () => {
    if (!combinedExport) return;
    setCombining(true);
    try {
      const { rows, truncated } = await buildCombinedRows({
        accession,
        sraAccessions: combinedExport.sraAccessions,
        geoAccession: combinedExport.geoAccession,
      });
      if (rows.length === 0) {
        showToast("No combined metadata to download");
        return;
      }
      downloadCsv(rows, combinedHeaders(rows), `${accession}_combined.csv`);
      // Silence here would present a partial export as complete.
      if (truncated) {
        showToast("Export hit the server row limit — some rows are missing");
      }
    } catch (error) {
      console.error("Combined metadata export failed:", error);
      showToast("Couldn't build the combined CSV");
    } finally {
      setCombining(false);
      setAskCombined(false);
    }
  };

  return (
    <>
      <Flex id={sectionId} justify="between" align="center" gap="2" wrap="wrap">
        <Flex align="center" gap="2">
          <Heading as="h2" weight="medium" size="6">
            {sectionTitle}
          </Heading>
          {!showEnriched && titleBadge}
          {showEnriched && enriched && (
            <EnrichedMetadataBadges data={enriched} />
          )}
          <SectionAnchor id={sectionId} />
        </Flex>
        <Flex align="center" gap="3">
          {hasEnriched && (
            <Tabs.Root
              value={activeTab}
              onValueChange={(value) => {
                if (value === "enriched") markEnrichedSeen();
                setTab(value as TabValue);
              }}
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
                <Tabs.Trigger value="enriched" style={{ position: "relative" }}>
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
                  {/* Inside the box, not hanging off it: Tabs.List is
                      `overflow-x: auto` and would clip an outset dot. */}
                  {!seenEnriched && activeTab === "original" && (
                    <FirstVisitPing
                      style={{ top: "4px", right: "4px", left: "auto" }}
                    />
                  )}
                </Tabs.Trigger>
              </Tabs.List>
            </Tabs.Root>
          )}
          <WrapTextToggle size="2" />
          {/* ponytail: enriched CSV export is hidden for now — drop the
              `!showEnriched &&` guard to bring it back. */}
          {!showEnriched && (
            <Button
              onClick={() => {
                if (showEnriched && enriched) {
                  void exportEnrichedCsv(accession);
                } else if (canCombine) {
                  setAskCombined(true);
                } else {
                  onExportOriginalCsv();
                }
              }}
            >
              <DownloadIcon /> CSV
            </Button>
          )}
        </Flex>
      </Flex>
      <AlertDialog.Root open={askCombined} onOpenChange={setAskCombined}>
        <AlertDialog.Content maxWidth="480px">
          <AlertDialog.Title>
            Download combined metadata from all sources?
          </AlertDialog.Title>
          <AlertDialog.Description size="2">
            Joins {combinedExport?.noun} metadata with FASTQ links and
            supplementary files into one CSV, at one row per run.
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end" wrap="wrap">
            <AlertDialog.Cancel>
              <Button
                variant="soft"
                color="gray"
                disabled={combining}
                onClick={() => onExportOriginalCsv()}
              >
                Only download {combinedExport?.noun} metadata
              </Button>
            </AlertDialog.Cancel>
            <Button
              onClick={(e) => {
                // Keep the dialog up while the sources are fetched — the join
                // can take a few seconds on a large study.
                e.preventDefault();
                void downloadCombined();
              }}
              disabled={combining}
            >
              {combining ? <Spinner size="1" /> : <DownloadIcon />}
              {combining ? "Building CSV…" : "Yes"}
            </Button>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
      {!showEnriched && originalContent}
      {showEnriched && enriched && (
        <EnrichedMetadataGrid
          data={enriched}
          fetchNextPage={fetchNextPage}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
        />
      )}
      {showEnriched && !enriched && isEnrichedLoading && (
        <Flex align="center" gap="2">
          <Spinner size="2" />
          <Text size="2">Loading enriched metadata...</Text>
        </Flex>
      )}
      {showEnriched && !enriched && !isEnrichedLoading && (
        <Text size="2" color="gray">
          No enriched metadata available for this study.
        </Text>
      )}
    </>
  );
}
