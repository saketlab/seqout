"use client";

// Interactive ontology-hierarchy explorer for one search term.
// Root = the picked query term; clicking a node selects it AND lazily fetches
// its direct children (synonym-transparent, done server-side). Arrows only, no
// edge labels. The Search button swaps the selected node's term into the
// original query and opens the results in a new tab.

import { getDeepDiveChildren, type DeepDiveChild } from "@/utils/api";
import { MagnifyingGlassIcon } from "@radix-ui/react-icons";
import { Badge, Button, Flex, Text, Tooltip } from "@radix-ui/themes";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";

const COL_W = 280; // horizontal gap between hierarchy levels
const ROW_H = 58; // vertical gap between siblings in a column

// Column-stack layout: each depth gets an x-column and a running y-cursor, so nodes
// never overlap. Not a tidy tree (a node isn't centered on its parent); dagre if needed.

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface NodeData extends Record<string, unknown> {
  label: string;
  name: string;
  hasChildren: boolean;
  isRoot: boolean;
  depth: number;
}

interface DeepDiveGraphProps {
  rootTerm: string; // display label of the query term
  rootName: string; // lowercase graph key
  query: string; // original search query
  searchParams: URLSearchParams; // current params, preserved on swap-search
  onLoadingChange?: (loading: boolean) => void; // true while any child fetch is in flight
}

function nodeStyle(isRoot: boolean, selected: boolean): React.CSSProperties {
  return {
    width: 200,
    padding: "6px 10px",
    fontSize: 11,
    lineHeight: 1.3,
    borderRadius: 6,
    cursor: "pointer",
    textAlign: "left" as const,
    // Background & text are left to React Flow's colorMode theming so they stay
    // readable in both light and dark; we only override the border to highlight
    // the root / selected node.
    ...(selected
      ? { border: "2px solid var(--accent-9)" }
      : isRoot
        ? { border: "2px solid var(--accent-8)" }
        : {}),
  };
}

export default function DeepDiveGraph({
  rootTerm,
  rootName,
  query,
  searchParams,
  onLoadingChange,
}: DeepDiveGraphProps) {
  // The parent remounts this component per term (key=name), so state is
  // initialised directly for the root instead of reset inside an effect.
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>([
    {
      id: rootName,
      position: { x: 0, y: 0 },
      data: {
        label: rootTerm,
        name: rootName,
        hasChildren: true,
        isRoot: true,
        depth: 0,
      },
      style: nodeStyle(true, false),
    },
  ]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selected, setSelected] = useState<{
    name: string;
    label: string;
  } | null>(null);

  const depthCursor = useRef<Record<number, number>>({ 0: ROW_H });
  const expanded = useRef<Set<string>>(new Set());

  // Track in-flight child fetches (several can run at once) and report to parent.
  const loadingCount = useRef(0);
  const setLoading = useCallback(
    (delta: number) => {
      loadingCount.current += delta;
      onLoadingChange?.(loadingCount.current > 0);
    },
    [onLoadingChange],
  );

  // Sync React Flow's built-in theming to the app's dark/light mode.
  const { resolvedTheme } = useTheme();
  const colorMode: "light" | "dark" =
    resolvedTheme === "dark" ? "dark" : "light";
  const rf = useRef<ReactFlowInstance<Node<NodeData>, Edge> | null>(null);

  const fit = useCallback(() => {
    // let React Flow measure the freshly added nodes before fitting
    setTimeout(() => rf.current?.fitView({ padding: 0.2, duration: 300 }), 60);
  }, []);

  const addChildren = useCallback(
    (parentId: string, parentDepth: number, children: DeepDiveChild[]) => {
      const depth = parentDepth + 1;
      setNodes((prev) => {
        const existing = new Set(prev.map((n) => n.id));
        const toAdd: Node<NodeData>[] = [];
        for (const c of children) {
          if (existing.has(c.name)) continue; // dedupe; cross-link edge still added
          const y = depthCursor.current[depth] ?? 0;
          depthCursor.current[depth] = y + ROW_H;
          toAdd.push({
            id: c.name,
            position: { x: depth * COL_W, y },
            data: {
              label: c.name,
              name: c.name,
              hasChildren: c.has_children,
              isRoot: false,
              depth,
            },
            style: nodeStyle(false, false),
          });
        }
        return [...prev, ...toAdd];
      });
      setEdges((prev) => {
        const have = new Set(prev.map((e) => e.id));
        const toAdd: Edge[] = [];
        for (const c of children) {
          const id = `${parentId}->${c.name}`;
          if (have.has(id)) continue;
          toAdd.push({
            id,
            source: parentId,
            target: c.name,
            markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
          });
        }
        return [...prev, ...toAdd];
      });
      fit();
    },
    [setNodes, setEdges, fit],
  );

  const expand = useCallback(
    async (name: string, depth: number) => {
      if (expanded.current.has(name)) return;
      expanded.current.add(name);
      setLoading(1);
      try {
        const res = await getDeepDiveChildren(name);
        addChildren(name, depth, res.children);
      } catch {
        expanded.current.delete(name); // allow retry on transient failure
      } finally {
        setLoading(-1);
      }
    },
    [addChildren, setLoading],
  );

  // Fetch the root's children once on mount (async → no sync setState in effect).
  useEffect(() => {
    void expand(rootName, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onNodeClick = useCallback(
    (_e: React.MouseEvent, node: Node<NodeData>) => {
      setSelected({ name: node.data.name, label: node.data.label });
      if (node.data.hasChildren) void expand(node.data.name, node.data.depth);
    },
    [expand],
  );

  // The full query the Search button will run: original query with the picked
  // term swapped for the selected node's term.
  const newQuery = selected
    ? query.replace(new RegExp(escapeRegExp(rootTerm), "i"), selected.name)
    : null;

  const onSearch = useCallback(() => {
    if (!newQuery) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("q", newQuery);
    window.open(`/search?${params.toString()}`, "_blank", "noopener");
  }, [newQuery, searchParams]);

  // reflect selection with React Flow's built-in `selected` styling
  const displayNodes: Node<NodeData>[] = nodes.map((n) => ({
    ...n,
    selected: n.id === selected?.name,
    style: nodeStyle(n.data.isRoot, n.id === selected?.name),
  }));

  return (
    <Flex direction="column" gap="2">
      <div
        style={{
          height: 380,
          border: "1px solid var(--gray-5)",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <ReactFlow
          nodes={displayNodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onInit={(inst) => (rf.current = inst)}
          colorMode={colorMode}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          nodesConnectable={false}
          minZoom={0.1}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <Flex align="center" justify="between" gap="3">
        {newQuery ? (
          <Tooltip content="New search query">
            <Badge variant="surface" size={"3"} style={{ maxWidth: "60%" }}>
              <Text wrap={"wrap"}>{newQuery}</Text>
            </Badge>
          </Tooltip>
        ) : (
          <Text size="2" color="gray" truncate>
            {" "}
            Click a term to explore and select it
          </Text>
        )}
        <Button
          size="2"
          disabled={!newQuery}
          onClick={onSearch}
          style={{ flexShrink: 0 }}
        >
          <MagnifyingGlassIcon /> Search
        </Button>
      </Flex>
    </Flex>
  );
}
