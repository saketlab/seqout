"use client";

import type { ForceGraph3DInstance } from "3d-force-graph";
import ProjectSummary from "@/components/project-summary";
import { SERVER_URL } from "@/utils/constants";
import {
  Button,
  Flex,
  Select,
  Spinner,
  Table,
  Tabs,
  Text,
} from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type SimilarNeighbor = {
  accession: string;
  source?: string | null;
  organisms?: unknown;
  x_2d?: number | null;
  y_2d?: number | null;
  x_3d?: number | null;
  y_3d?: number | null;
  z_3d?: number | null;
  title?: string | null;
  description?: string | null;
};

type SimilarProjectsGraphProps = {
  accession: string;
  source: "geo" | "sra";
  title: string;
  description: string | null | undefined;
  organisms?: unknown;
  coords2d?: number[] | null;
  coords3d?: number[] | null;
  neighbors?: SimilarNeighbor[] | null;
};

type GraphNode = {
  id: string;
  source: "geo" | "sra";
  x: number;
  y: number;
  z: number;
  fx: number;
  fy: number;
  fz: number;
  title?: string | null;
  description?: string | null;
  organisms: string[];
  isCenter: boolean;
};

type GraphLink = {
  source: string | { id?: string };
  target: string | { id?: string };
};

type BulkProjectMetadata = {
  title?: string | null;
  description?: string | null;
  organisms: string[];
};

const safeNum = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const clampText = (value: string, maxChars = 300) =>
  value.length > maxChars ? `${value.slice(0, maxChars)}...` : value;

const escHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const toSource = (value: string | null | undefined, fallback: "geo" | "sra") =>
  value?.toLowerCase() === "geo" || value?.toLowerCase() === "sra"
    ? (value.toLowerCase() as "geo" | "sra")
    : fallback;

const MIN_RADIUS = 45;
const TARGET_MEDIAN_RADIUS = 170;
const ALL_ORGANISMS = "__all__";

const normalizeOrganisms = (value: unknown): string[] => {
  if (!value) return [];
  let parsed: unknown = value;

  if (typeof parsed === "string") {
    const trimmed = parsed.trim();
    if (!trimmed) return [];
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      return trimmed
        .split(/[;,|]/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    }
  }

  if (Array.isArray(parsed)) {
    return parsed
      .map((item) =>
        typeof item === "string"
          ? item.trim()
          : item && typeof item === "object" && "name" in item
            ? String((item as { name: unknown }).name).trim()
            : "",
      )
      .filter((item) => item.length > 0);
  }

  return [];
};

const linkEndpointId = (endpoint: GraphLink["source"]): string | null => {
  if (typeof endpoint === "string") return endpoint;
  if (endpoint && typeof endpoint === "object" && "id" in endpoint) {
    const id = endpoint.id;
    return typeof id === "string" ? id : null;
  }
  return null;
};

const parseBulkProjectMetadataPayload = (
  payload: unknown,
): Map<string, BulkProjectMetadata> => {
  const map = new Map<string, BulkProjectMetadata>();

  const add = (accession: unknown, metadata: unknown) => {
    if (typeof accession !== "string" || accession.length === 0) return;

    if (!metadata || typeof metadata !== "object") {
      map.set(accession.toUpperCase(), { organisms: [] });
      return;
    }

    const record = metadata as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title : null;
    const description =
      typeof record.description === "string"
        ? record.description
        : typeof record.summary === "string"
          ? record.summary
          : typeof record.abstract === "string"
            ? record.abstract
            : null;
    const organisms = normalizeOrganisms(record.organisms);

    map.set(accession.toUpperCase(), {
      title,
      description,
      organisms,
    });
  };

  if (Array.isArray(payload)) {
    payload.forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      const item = entry as Record<string, unknown>;
      add(item.accession, item);
    });
    return map;
  }

  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;

    if (Array.isArray(obj.results)) {
      obj.results.forEach((entry) => {
        if (!entry || typeof entry !== "object") return;
        const item = entry as Record<string, unknown>;
        add(item.accession, item);
      });
      return map;
    }

    if (Array.isArray(obj.data)) {
      obj.data.forEach((entry) => {
        if (!entry || typeof entry !== "object") return;
        const item = entry as Record<string, unknown>;
        add(item.accession, item);
      });
      return map;
    }

    Object.entries(obj).forEach(([accession, metadata]) => {
      add(accession, metadata);
    });
  }

  return map;
};

function nodeLabel(node: GraphNode) {
  const title = node.title ? escHtml(node.title) : "Untitled project";
  const accession = escHtml(node.id);
  const description = node.description
    ? escHtml(clampText(node.description))
    : "Description unavailable.";

  return `
    <div style="max-width: 420px; white-space: normal; line-height: 1.35; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; background: var(--gray-2); color: var(--gray-12); border: 1px solid var(--gray-a6); border-radius: 10px; padding: 10px 12px; box-shadow: 0 8px 22px rgba(0,0,0,0.18); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);">
      <div style="font-size: 13px; font-weight: 700; margin-bottom: 4px;">${title}</div>
      <div style="font-size: 12px; margin-bottom: 6px;">${accession}</div>
      <div style="font-size: 12px;">${description}</div>
    </div>
  `;
}

export default function SimilarProjectsGraph({
  accession,
  source,
  title,
  description,
  organisms,
  coords2d,
  coords3d,
  neighbors,
}: SimilarProjectsGraphProps) {
  const graphContainerRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<ForceGraph3DInstance | null>(null);
  const [organismFilter, setOrganismFilter] = useState<string>(ALL_ORGANISMS);
  const [viewMode, setViewMode] = useState<"graph" | "tab">("graph");
  const [isFullscreen, setIsFullscreen] = useState(false);

  const updateGraphSize = useCallback(() => {
    if (!mountRef.current || !graphRef.current) return;
    const rect = mountRef.current.getBoundingClientRect();
    const height = isFullscreen ? Math.max(420, window.innerHeight - 24) : 420;
    graphRef.current.width(Math.max(320, rect.width)).height(height);
  }, [isFullscreen]);

  const normalizedNeighbors = useMemo(() => {
    if (!neighbors || !Array.isArray(neighbors)) return [];
    return neighbors.filter(
      (n): n is SimilarNeighbor =>
        !!n && typeof n.accession === "string" && n.accession.length > 0,
    );
  }, [neighbors]);

  const uniqueNeighborAccessions = useMemo(
    () => Array.from(new Set(normalizedNeighbors.map((n) => n.accession))),
    [normalizedNeighbors],
  );

  const {
    data: bulkProjectMetadataMap,
    isLoading: isBulkProjectMetadataLoading,
  } = useQuery({
    queryKey: ["bulk-project-metadata", uniqueNeighborAccessions.join(",")],
    queryFn: async () => {
      const res = await fetch(`${SERVER_URL}/bulk/project-metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessions: uniqueNeighborAccessions }),
      });
      if (!res.ok) {
        throw new Error("Failed to fetch project metadata in bulk");
      }
      const payload = (await res.json()) as unknown;
      return parseBulkProjectMetadataPayload(payload);
    },
    enabled: uniqueNeighborAccessions.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const centerOrganisms = useMemo(
    () => normalizeOrganisms(organisms),
    [organisms],
  );

  const graphData = useMemo(() => {
    const centerX2d = safeNum(coords2d?.[0], 0);
    const centerY2d = safeNum(coords2d?.[1], 0);
    const centerX3d = safeNum(coords3d?.[0], centerX2d);
    const centerY3d = safeNum(coords3d?.[1], centerY2d);
    const centerZ3d = safeNum(coords3d?.[2], 0);

    const centerNode: GraphNode = {
      id: accession,
      source,
      title,
      description: description ?? null,
      organisms: centerOrganisms,
      isCenter: true,
      x: 0,
      y: 0,
      z: 0,
      fx: 0,
      fy: 0,
      fz: 0,
    };

    const rawNeighbors = normalizedNeighbors.map((n, idx) => {
      const x2d = safeNum(n.x_2d, 0);
      const y2d = safeNum(n.y_2d, 0);
      const x3d = safeNum(n.x_3d, x2d);
      const y3d = safeNum(n.y_3d, y2d);
      const z3d = safeNum(n.z_3d, 0);

      const rawX = x3d - centerX3d;
      const rawY = y3d - centerY3d;
      const rawZ = z3d - centerZ3d;

      return { n, idx, rawX, rawY, rawZ };
    });

    const radii = rawNeighbors
      .map((item) =>
        Math.sqrt(
          item.rawX * item.rawX + item.rawY * item.rawY + item.rawZ * item.rawZ,
        ),
      )
      .filter((r) => r > 0);
    const medianRadius = radii.length
      ? [...radii].sort((a, b) => a - b)[Math.floor(radii.length / 2)]
      : 1;
    const scale = medianRadius > 0 ? TARGET_MEDIAN_RADIUS / medianRadius : 1;

    const neighborNodes: GraphNode[] = rawNeighbors.map(
      ({ n, idx, rawX, rawY, rawZ }) => {
        const detail = bulkProjectMetadataMap?.get(n.accession.toUpperCase());
        const inferredSource = toSource(n.source, source);
        const neighborOrganisms = normalizeOrganisms(n.organisms);

        let x = rawX * scale;
        let y = rawY * scale;
        let z = rawZ * scale;
        const r = Math.sqrt(x * x + y * y + z * z);

        if (r === 0) {
          const angle = (idx / Math.max(1, rawNeighbors.length)) * Math.PI * 2;
          x = Math.cos(angle) * MIN_RADIUS;
          y = Math.sin(angle) * MIN_RADIUS;
          z = Math.sin(angle * 1.7) * (MIN_RADIUS * 0.5);
        } else if (r < MIN_RADIUS) {
          const stretch = MIN_RADIUS / r;
          x *= stretch;
          y *= stretch;
          z *= stretch;
        }

        return {
          id: n.accession,
          source: inferredSource,
          title: n.title ?? detail?.title ?? null,
          description: n.description ?? detail?.description ?? null,
          organisms: neighborOrganisms.length
            ? neighborOrganisms
            : (detail?.organisms ?? []),
          isCenter: false,
          x,
          y,
          z,
          fx: x,
          fy: y,
          fz: z,
        };
      },
    );

    const links: GraphLink[] = neighborNodes.map((n) => ({
      source: accession,
      target: n.id,
    }));

    return {
      nodes: [centerNode, ...neighborNodes],
      links,
    };
  }, [
    accession,
    source,
    title,
    description,
    coords2d,
    coords3d,
    normalizedNeighbors,
    bulkProjectMetadataMap,
    centerOrganisms,
  ]);

  const organismOptions = useMemo(() => {
    const values = new Set<string>();
    graphData.nodes.forEach((node) =>
      node.organisms.forEach((item) => values.add(item)),
    );
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [graphData]);

  const filteredGraphData = useMemo(() => {
    if (organismFilter === ALL_ORGANISMS) return graphData;
    const centerNode = graphData.nodes.find((node) => node.isCenter);
    if (!centerNode) return graphData;

    const allowedNeighbors = graphData.nodes.filter(
      (node) =>
        !node.isCenter &&
        node.organisms.some((item) => item === organismFilter),
    );

    const allowedIds = new Set([
      centerNode.id,
      ...allowedNeighbors.map((n) => n.id),
    ]);
    return {
      nodes: [centerNode, ...allowedNeighbors],
      links: graphData.links.filter((link) => {
        const sourceId = linkEndpointId(link.source);
        const targetId = linkEndpointId(link.target);
        return (
          sourceId !== null &&
          targetId !== null &&
          allowedIds.has(sourceId) &&
          allowedIds.has(targetId)
        );
      }),
    };
  }, [graphData, organismFilter]);

  const neighborDistanceByAccession = useMemo(() => {
    const centerX2d = safeNum(coords2d?.[0], 0);
    const centerY2d = safeNum(coords2d?.[1], 0);
    const distances = new Map<string, number>();

    normalizedNeighbors.forEach((neighbor) => {
      const neighborX2d = safeNum(neighbor.x_2d, centerX2d);
      const neighborY2d = safeNum(neighbor.y_2d, centerY2d);
      const dx = neighborX2d - centerX2d;
      const dy = neighborY2d - centerY2d;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const key = neighbor.accession.toUpperCase();
      const previous = distances.get(key);

      if (previous === undefined || distance < previous) {
        distances.set(key, distance);
      }
    });

    return distances;
  }, [coords2d, normalizedNeighbors]);

  const tabViewRows = useMemo(() => {
    const seen = new Set<string>();
    const rows: Array<{
      accession: string;
      title: string;
      description: string;
      distance: number;
    }> = [];

    filteredGraphData.nodes.forEach((node) => {
      if (node.isCenter || seen.has(node.id)) return;
      seen.add(node.id);
      rows.push({
        accession: node.id,
        title: node.title?.trim() || "Untitled project",
        description: node.description?.trim() || "Description unavailable.",
        distance:
          neighborDistanceByAccession.get(node.id.toUpperCase()) ??
          Number.POSITIVE_INFINITY,
      });
    });

    rows.sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      return a.accession.localeCompare(b.accession);
    });

    return rows.map(({ accession, title, description }) => ({
      accession,
      title,
      description,
    }));
  }, [filteredGraphData, neighborDistanceByAccession]);

  useEffect(() => {
    if (organismFilter === ALL_ORGANISMS) return;
    if (!organismOptions.includes(organismFilter)) {
      setOrganismFilter(ALL_ORGANISMS);
    }
  }, [organismFilter, organismOptions]);

  useEffect(() => {
    let isActive = true;

    const mountGraph = async () => {
      if (!mountRef.current) return;
      const ForceGraph3D = (await import("3d-force-graph")).default;
      if (!isActive || !mountRef.current) return;

      const graph = new ForceGraph3D(mountRef.current, {
        controlType: "orbit",
      });

      graphRef.current = graph;
      graph
        .backgroundColor("rgba(0,0,0,0)")
        .showNavInfo(false)
        .enableNodeDrag(false)
        .cooldownTicks(0)
        .linkOpacity(0.85)
        .linkColor(() => "#9ca3af")
        .linkWidth(0.9)
        .nodeRelSize(5)
        .nodeLabel((node) => nodeLabel(node as GraphNode))
        .nodeColor((node) => {
          const graphNode = node as GraphNode;
          if (graphNode.isCenter) return "#d97706";
          return graphNode.source === "geo" ? "#2563eb" : "#8b4513";
        })
        .onNodeClick((node) => {
          const graphNode = node as GraphNode;
          if (graphNode.id === accession) return;
          window.open(
            `/project/${graphNode.source}/${graphNode.id}`,
            "_blank",
            "noopener,noreferrer",
          );
        });

      const rect = mountRef.current.getBoundingClientRect();
      graph.width(Math.max(320, rect.width)).height(420);
      graph.graphData({ nodes: [], links: [] });
      graph.zoomToFit(450, 48);
    };

    mountGraph();

    return () => {
      isActive = false;
      graphRef.current?._destructor();
      graphRef.current = null;
    };
  }, [accession]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.graphData(filteredGraphData);
    graph.nodeLabel((node) => nodeLabel(node as GraphNode));
    graph.zoomToFit(450, 48);
  }, [filteredGraphData]);

  useEffect(() => {
    if (!mountRef.current) return;
    const graph = graphRef.current;
    if (!graph) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      graph
        .width(Math.max(320, entry.contentRect.width))
        .height(isFullscreen ? Math.max(420, window.innerHeight - 24) : 420);
    });

    observer.observe(mountRef.current);
    return () => observer.disconnect();
  }, [isFullscreen]);

  useEffect(() => {
    const onFullscreenChange = () => {
      const activeElement = document.fullscreenElement;
      setIsFullscreen(
        !!activeElement && activeElement === graphContainerRef.current,
      );
      updateGraphSize();
      graphRef.current?.zoomToFit(450, 48);
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, [updateGraphSize]);

  useEffect(() => {
    if (!isFullscreen) return;
    const onWindowResize = () => {
      updateGraphSize();
      graphRef.current?.zoomToFit(450, 48);
    };
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, [isFullscreen, updateGraphSize]);

  useEffect(() => {
    if (viewMode !== "tab") return;
    if (document.fullscreenElement === graphContainerRef.current) {
      void document.exitFullscreen();
    }
  }, [viewMode]);

  const toggleFullscreen = async () => {
    const container = graphContainerRef.current;
    if (!container) return;

    if (document.fullscreenElement === container) {
      await document.exitFullscreen();
      return;
    }

    await container.requestFullscreen();
  };

  if (normalizedNeighbors.length === 0) {
    return (
      <Text size="2" color="gray">
        No similar projects found
      </Text>
    );
  }

  const viewportHeight = isFullscreen
    ? Math.max(420, window.innerHeight - 24)
    : 420;

  return (
    <Flex direction="column" gap="3">
      <Flex justify="between" align="center" gap="2" wrap="wrap">
        <Flex align="center" gap="2" wrap="wrap">
          <Tabs.Root
            value={viewMode}
            onValueChange={(value) =>
              setViewMode(value === "tab" ? "tab" : "graph")
            }
          >
            <Tabs.List>
              <Tabs.Trigger value="graph">Graph view</Tabs.Trigger>
              <Tabs.Trigger value="tab">Table view</Tabs.Trigger>
            </Tabs.List>
          </Tabs.Root>
          {isBulkProjectMetadataLoading && (
            <Flex align="center" gap="1">
              <Spinner size="1" />
              <Text size="2" color="gray">
                Loading...
              </Text>
            </Flex>
          )}
        </Flex>
        <Flex align="center" gap="2" wrap="wrap">
          {viewMode === "graph" && (
            <Button variant="soft" color="gray" onClick={toggleFullscreen}>
              {isFullscreen ? "Exit full screen" : "View full screen"}
            </Button>
          )}
          <Select.Root
            value={organismFilter}
            onValueChange={(value) => setOrganismFilter(value)}
          >
            <Select.Trigger style={{ minWidth: "220px" }} />
            <Select.Content position="popper">
              <Select.Item value={ALL_ORGANISMS}>All organisms</Select.Item>
              {organismOptions.map((item) => (
                <Select.Item key={item} value={item}>
                  {item}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Flex>
      </Flex>

      <div
        ref={graphContainerRef}
        style={{
          width: "100%",
          background: "var(--gray-1)",
          padding: isFullscreen ? "12px" : "0",
        }}
      >
        <div
          ref={mountRef}
          style={{
            display: viewMode === "graph" ? "block" : "none",
            width: "100%",
            height: `${viewportHeight}px`,
            border: "1px solid var(--gray-a6)",
            borderRadius: "12px",
            overflow: "hidden",
          }}
        />
        <div
          style={{
            display: viewMode === "tab" ? "block" : "none",
            width: "100%",
            height: `${viewportHeight}px`,
            border: "1px solid var(--gray-a6)",
            borderRadius: "12px",
            overflow: "auto",
            background: "var(--gray-1)",
          }}
        >
          <Table.Root size="1" variant="surface" style={{ width: "100%" }}>
            <Table.Header
              style={{
                position: "sticky",
                top: 0,
                zIndex: 1,
              }}
            >
              <Table.Row>
                <Table.ColumnHeaderCell style={{ width: "10%" }}>
                  <Text size="2" weight="medium">
                    Accession
                  </Text>
                </Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell style={{ width: "30%" }}>
                  <Text size="2" weight="medium">
                    Title
                  </Text>
                </Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell style={{ width: "50%" }}>
                  <Text size="2" weight="medium">
                    Description
                  </Text>
                </Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {tabViewRows.map((row) => (
                <Table.Row key={row.accession}>
                  <Table.Cell
                    style={{ verticalAlign: "top", wordBreak: "break-word" }}
                  >
                    <Text size="2">
                      <Link
                        target="_blank"
                        href={`/p/${encodeURIComponent(row.accession)}`}
                      >
                        {row.accession}
                      </Link>
                    </Text>
                  </Table.Cell>
                  <Table.Cell
                    style={{ verticalAlign: "top", wordBreak: "break-word" }}
                  >
                    <Text size="2">{row.title}</Text>
                  </Table.Cell>
                  <Table.Cell
                    style={{ verticalAlign: "top", wordBreak: "break-word" }}
                  >
                    <ProjectSummary text={row.description} size="2" />
                  </Table.Cell>
                </Table.Row>
              ))}
              {tabViewRows.length === 0 && (
                <Table.Row>
                  <Table.Cell colSpan={3}>
                    <Text size="2" color="gray">
                      No neighbors found.
                    </Text>
                  </Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table.Root>
        </div>
      </div>
      {organismFilter !== ALL_ORGANISMS &&
        filteredGraphData.nodes.length <= 1 && (
          <Text size="2" color="gray">
            No neighbors found for the selected organism.
          </Text>
        )}
    </Flex>
  );
}
