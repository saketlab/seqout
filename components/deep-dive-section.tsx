"use client";

// "Enhance search" dialog on the search page (trigger sits below More filters).
// Lists the query terms that have hierarchy children in the ontology graph;
// picking one renders an interactive React Flow explorer of its children.

import { getDeepDiveTerms } from "@/utils/api";
import { Button, Dialog, Flex, Select, Spinner, Text } from "@radix-ui/themes";

function NetworkIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="16" y="16" width="6" height="6" rx="1" />
      <rect x="2" y="16" width="6" height="6" rx="1" />
      <rect x="9" y="2" width="6" height="6" rx="1" />
      <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" />
      <path d="M12 12V8" />
    </svg>
  );
}
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";

// client-only: React Flow touches the DOM and has no business rendering on the server
const DeepDiveGraph = dynamic(() => import("@/components/deep-dive-graph"), {
  ssr: false,
});

const KEY = "seqout-ontology-deep-dive-clicked";
const EVENT = "seqout-ontology-deep-dive-clicked-change";

function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

const getServerSnapshot = () => true;
const getSnapshot = () => window.localStorage.getItem(KEY) === "true";

export function DeepDiveSection() {
  const hasClicked = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const handleClick = () => {
    window.localStorage.setItem(KEY, "true");
    window.dispatchEvent(new Event(EVENT));
  };

  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);

  const { data } = useQuery({
    queryKey: ["deep-dive-terms", query],
    queryFn: ({ signal }) => getDeepDiveTerms(query, signal),
    enabled: query.trim().length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const terms = useMemo(() => data?.terms ?? [], [data]);
  // Default to the first term; fall back to it if the current selection isn't in
  // the (possibly refreshed) term list. Derived, so no reset-in-effect needed.
  const activeName =
    selectedName && terms.some((t) => t.name === selectedName)
      ? selectedName
      : (terms[0]?.name ?? null);
  const selectedTerm = useMemo(
    () => terms.find((t) => t.name === activeName) ?? null,
    [terms, activeName],
  );

  // Nothing to enhance: no query, or no query term has children in the graph.
  if (!query.trim() || terms.length === 0) return null;

  return (
    <Dialog.Root>
      <Dialog.Trigger>
        <Button
          variant="classic"
          onClick={handleClick}
          style={{ position: "relative" }}
        >
          <NetworkIcon />
          Ontology deep-dive
          {!hasClicked && (
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                top: "-3px",
                left: "-3px",
                display: "flex",
                height: "8px",
                width: "8px",
              }}
            >
              <span
                className="animate-ping"
                style={{
                  position: "absolute",
                  display: "inline-flex",
                  height: "100%",
                  width: "100%",
                  borderRadius: "9999px",
                  backgroundColor: "var(--red-9)",
                  opacity: 0.75,
                }}
              />
              <span
                style={{
                  position: "relative",
                  display: "inline-flex",
                  borderRadius: "9999px",
                  height: "8px",
                  width: "8px",
                  backgroundColor: "var(--red-9)",
                }}
              />
            </span>
          )}
        </Button>
      </Dialog.Trigger>
      <Dialog.Content
        size="4"
        style={{ width: "56rem", maxWidth: "calc(100vw - 2rem)" }}
      >
        <Flex direction="column" gap="2">
          <Flex align="center" justify="between" gap="2" wrap="wrap">
            <Flex align="center" gap="2" wrap="wrap">
              <Text size="2" weight="medium">
                Related terms for
              </Text>
              <Select.Root
                value={activeName ?? undefined}
                onValueChange={setSelectedName}
              >
                <Select.Trigger placeholder="Select a term…" />
                <Select.Content>
                  {terms.map((t) => (
                    <Select.Item key={t.name} value={t.name}>
                      {t.term}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Flex>
            {graphLoading ? (
              <Flex align="center" gap="2">
                <Spinner size="2" />
                <Text size="2" color="gray">
                  Loading…
                </Text>
              </Flex>
            ) : null}
          </Flex>
          {selectedTerm ? (
            <DeepDiveGraph
              key={selectedTerm.name}
              rootTerm={selectedTerm.term}
              rootName={selectedTerm.name}
              query={query}
              searchParams={new URLSearchParams(searchParams.toString())}
              onLoadingChange={setGraphLoading}
            />
          ) : null}
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
