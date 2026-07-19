"use client";

// Example illustration of the ontology graph around the query `nafld`, built on
// React Flow (@xyflow/react) — the same library as the search deep-dive graph.
//
// `nafld` sits at the center; every equivalent name is joined to it by a MAPS_TO
// edge (the synonym cluster the search expands into). Node/edge data comes from
// querying the ontology graph for `nafld`.
//
// Drag a node to tease it out of place; on release it springs back to its home
// (CSS bounce transition). Colors are Radix CSS variables, so it adapts to theme.

import { Flex, Text } from "@radix-ui/themes";
import {
  Background,
  Handle,
  type Node,
  type Edge,
  Position,
  ReactFlow,
  getStraightPath,
  useEdgesState,
  useInternalNode,
  useNodesState,
  type InternalNode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useTheme } from "next-themes";
import { useCallback, useMemo, useSyncExternalStore } from "react";

type Kind = "query" | "syn";
interface TermData extends Record<string, unknown> {
  label: string;
  kind: Kind;
}

const HUB = "metabolic dysfunction associated steatotic liver disease";

// `nafld` at the center; the rest of its MAPS_TO cluster fanned around it in a
// star — every alias links only to the center.
const CENTER = { x: 400, y: 250 };
const RING: { id: string; label: string; kind: Kind }[] = [
  { id: "hub", label: HUB, kind: "syn" },
  { id: "masld", label: "masld", kind: "syn" },
  { id: "mdasld", label: "mdasld", kind: "syn" },
  { id: "nafld1", label: "nafld1", kind: "syn" },
  { id: "nafl", label: "non alcoholic fatty liver", kind: "syn" },
  { id: "fld_susc", label: "fatty liver disease, nonalcoholic, susceptibility to, 1", kind: "syn" },
  { id: "fld_na", label: "fatty liver disease, nonalcoholic", kind: "syn" },
  { id: "nafld_full", label: "nafld nonalcoholic fatty liver disease", kind: "syn" },
  { id: "nonalc", label: "nonalcoholic fatty liver disease", kind: "syn" },
  { id: "nafld_d", label: "non alcoholic fatty liver disease", kind: "syn" },
];

const RX = 340;
const RY = 200;
const LAYOUT: { id: string; label: string; x: number; y: number; kind: Kind }[] = [
  { id: "nafld", label: "nafld", x: CENTER.x, y: CENTER.y, kind: "query" },
  ...RING.map((n, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / RING.length;
    return { ...n, x: CENTER.x + RX * Math.cos(angle), y: CENTER.y + RY * Math.sin(angle) };
  }),
];

const HOME: Record<string, { x: number; y: number }> = Object.fromEntries(
  LAYOUT.map((n) => [n.id, { x: n.x, y: n.y }]),
);

interface EdgeSpec {
  s: string;
  t: string;
  name?: boolean;
}
// Star: nafld to every alias, no alias-to-alias links.
const EDGE_SPECS: EdgeSpec[] = RING.map((n): EdgeSpec => ({
  s: "nafld",
  t: n.id,
  name: n.id === "hub",
}));

function nodeColors(kind: Kind) {
  if (kind === "query") {
    return { bg: "var(--accent-9)", border: "var(--accent-9)", text: "var(--accent-contrast)", weight: 600 };
  }
  return { bg: "var(--gray-3)", border: "var(--gray-7)", text: "var(--gray-12)", weight: 400 };
}

function TermNode({ data }: { data: TermData }) {
  const c = nodeColors(data.kind);
  const strong = data.kind === "query";
  return (
    <div
      style={{
        maxWidth: 170,
        padding: "6px 10px",
        borderRadius: 8,
        textAlign: "center",
        fontSize: 11,
        fontWeight: c.weight,
        lineHeight: 1.25,
        background: c.bg,
        border: `${strong ? 2 : 1}px solid ${c.border}`,
        color: c.text,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} isConnectable={false} />
      {data.label}
      <Handle type="source" position={Position.Top} style={{ opacity: 0 }} isConnectable={false} />
    </div>
  );
}

const nodeTypes = { term: TermNode };

// --- Floating edges: attach at the node boundary facing the other node, so the
// links radiate cleanly from the center in the ring layout.
function nodeBoundaryPoint(node: InternalNode, other: InternalNode) {
  const { width: w = 0, height: h = 0 } = node.measured;
  const p = node.internals.positionAbsolute;
  const o = other.internals.positionAbsolute;
  const cx = p.x + w / 2;
  const cy = p.y + h / 2;
  const ox = o.x + (other.measured.width ?? 0) / 2;
  const oy = o.y + (other.measured.height ?? 0) / 2;
  const dx = ox - cx;
  const dy = oy - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scale = 0.5 / Math.max(Math.abs(dx) / w, Math.abs(dy) / h);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

function FloatingEdge({
  id,
  source,
  target,
  style,
  data,
}: {
  id: string;
  source: string;
  target: string;
  style?: React.CSSProperties;
  data?: { label?: string };
}) {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  if (!s || !t) return null;
  const sp = nodeBoundaryPoint(s, t);
  const tp = nodeBoundaryPoint(t, s);
  const [path, labelX, labelY] = getStraightPath({
    sourceX: sp.x,
    sourceY: sp.y,
    targetX: tp.x,
    targetY: tp.y,
  });
  return (
    <>
      <path id={id} d={path} className="react-flow__edge-path" style={style} />
      {data?.label && (
        <text
          x={labelX}
          y={labelY - 3}
          textAnchor="middle"
          fontSize={10}
          fontFamily="var(--code-font-family, monospace)"
          fill="var(--gray-11)"
          stroke="var(--gray-1)"
          strokeWidth={3}
          paintOrder="stroke"
          style={{ pointerEvents: "none" }}
        >
          {data.label}
        </text>
      )}
    </>
  );
}

const edgeTypes = { floating: FloatingEdge };

// Stable no-op subscription: the store never changes, so the snapshot flips from
// the server value (false) to the client value (true) on hydration only.
const subscribeNoop = () => () => {};

export default function OntologyGraphFigure() {
  // next-themes resolves the theme only on the client, so gate colorMode behind a
  // client flag: server and first client render both use "light" (no hydration
  // mismatch), then it switches to the real theme once hydrated.
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const { resolvedTheme } = useTheme();
  const colorMode: "light" | "dark" =
    mounted && resolvedTheme === "dark" ? "dark" : "light";

  const initialNodes = useMemo<Node<TermData>[]>(
    () =>
      LAYOUT.map((n) => ({
        id: n.id,
        type: "term",
        position: { x: n.x, y: n.y },
        data: { label: n.label, kind: n.kind },
      })),
    [],
  );
  const initialEdges = useMemo<Edge[]>(
    () =>
      EDGE_SPECS.map((e) => ({
        id: `${e.s}-${e.t}`,
        source: e.s,
        target: e.t,
        type: "floating",
        data: e.name ? { label: "MAPS_TO" } : undefined,
        style: { stroke: "var(--gray-7)", strokeWidth: 1.4, strokeDasharray: "5 4" },
      })),
    [],
  );

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  // Spring-back: on release, dispatch the node back to its home position. The CSS
  // bounce transition (below) animates the return; the `dragging` class disables
  // it mid-drag so following the cursor stays crisp.
  const onNodeDragStop = useCallback((_e: unknown, node: Node) => {
    const home = HOME[node.id];
    if (home) onNodesChange([{ id: node.id, type: "position", position: { ...home } }]);
  }, [onNodesChange]);

  return (
    <Flex direction="column" gap="3">
      <style>{`
        .og-flow .react-flow__node { transition: transform 360ms cubic-bezier(.34,1.4,.64,1); }
        .og-flow .react-flow__node.dragging { transition: none; }
      `}</style>
      <div
        className="og-flow"
        style={{
          height: 460,
          border: "1px solid var(--gray-5)",
          borderRadius: 10,
          background: "var(--gray-1)",
          overflow: "hidden",
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
          colorMode={colorMode}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag={false}
          zoomOnScroll={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} />
        </ReactFlow>
      </div>

      <Flex align="center" gap="2">
        <svg width="34" height="10" aria-hidden="true">
          <line x1="1" y1="5" x2="33" y2="5" stroke="var(--gray-7)" strokeWidth="1.6" strokeDasharray="5 4" />
        </svg>
        <Text size="1" style={{ color: "var(--gray-11)" }}>
          <Text as="span" style={{ fontFamily: "var(--code-font-family, monospace)" }}>
            MAPS_TO
          </Text>{" "}
          — synonym or alias for the same concept
        </Text>
      </Flex>

      <Text size="1" style={{ color: "var(--gray-10)" }}>
        Example: the ontology graph around the term{" "}
        <Text as="span" weight="medium">nafld</Text>. Each surrounding node is an
        equivalent name for the same concept.
      </Text>
    </Flex>
  );
}
