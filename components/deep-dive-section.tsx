"use client";

// "Enhance search" dialog on the search page (trigger sits below More filters).
// Lists the query terms that have hierarchy children in the ontology graph;
// picking one renders an interactive React Flow explorer of its children.

import { getDeepDiveTerms } from "@/utils/api";
import { Crosshair1Icon } from "@radix-ui/react-icons";
import { Button, Dialog, Flex, Select, Text } from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

// client-only: React Flow touches the DOM and has no business rendering on the server
const DeepDiveGraph = dynamic(() => import("@/components/deep-dive-graph"), {
  ssr: false,
});

export function DeepDiveSection() {
  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const [selectedName, setSelectedName] = useState<string | null>(null);

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
        <Button variant="classic">
          <Crosshair1Icon />
          Enhance search
        </Button>
      </Dialog.Trigger>
      <Dialog.Content
        size="4"
        style={{ width: "56rem", maxWidth: "calc(100vw - 2rem)" }}
      >
        <Flex direction="column" gap="2">
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
          {selectedTerm ? (
            <DeepDiveGraph
              key={selectedTerm.name}
              rootTerm={selectedTerm.term}
              rootName={selectedTerm.name}
              query={query}
              searchParams={new URLSearchParams(searchParams.toString())}
            />
          ) : null}
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
