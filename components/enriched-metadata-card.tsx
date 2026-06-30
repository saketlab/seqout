"use client";
import { useWrapText } from "@/components/wrap-text-toggle";
import {
  ensureAgGridModules,
  infiniteScrollOnBodyScroll,
  TABLE_PAGE_SIZE,
  wrapColDef,
} from "@/lib/ag-grid";
import { SERVER_URL } from "@/utils/constants";
import {
  ExclamationTriangleIcon,
  InfoCircledIcon,
  MagicWandIcon,
} from "@radix-ui/react-icons";
import { Badge, Flex, Spinner, Text, Tooltip } from "@radix-ui/themes";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useTheme } from "next-themes";

ensureAgGridModules();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OntologySample = Record<string, any>;

export interface EnrichedResponse {
  accession: string;
  title: string;
  n_samples: number;
  single_cell_modality: string | null;
  version: "v3" | "v1";
  samples: OntologySample[];
}

const ONTOLOGY_URLS: Record<string, string> = {
  MONDO:
    "https://www.ebi.ac.uk/ols4/ontologies/mondo/terms?iri=http://purl.obolibrary.org/obo/",
  UBERON:
    "https://www.ebi.ac.uk/ols4/ontologies/uberon/terms?iri=http://purl.obolibrary.org/obo/",
  CL: "https://www.ebi.ac.uk/ols4/ontologies/cl/terms?iri=http://purl.obolibrary.org/obo/",
  EFO: "https://www.ebi.ac.uk/ols4/ontologies/efo/terms?iri=http://purl.obolibrary.org/obo/",
};

function ontologyUrl(id: string): string | null {
  const prefix = id.split(":")[0];
  const base = ONTOLOGY_URLS[prefix];
  if (!base) return null;
  return `${base}${id.replace(":", "_")}`;
}

/**
 * Fields that inherit a low-confidence flag when `organism` is uncertain —
 * an unreliable organism call undermines these organism-dependent attributes.
 */
const ORGANISM_DEPENDENT_FIELDS = [
  "tissue",
  "disease",
  "sample_type",
  "cell_line",
  "taxid",
  "ethnicity",
  "age",
  "sex",
];

/** Whether `field` is flagged low-confidence for the given sample row. */
function isLowConfidence(
  data: OntologySample | undefined,
  field: string | undefined,
): boolean {
  if (!data || !field) return false;
  const tags = data["low_confidence_tags"];
  if (!Array.isArray(tags)) return false;
  if (tags.includes(field)) return true;
  return tags.includes("organism") && ORGANISM_DEPENDENT_FIELDS.includes(field);
}

/** Amber warning badge shown in cells flagged as low-confidence. */
function LowConfidenceBadge() {
  return (
    <Tooltip content="Low-confidence value">
      <Badge
        color="amber"
        size="1"
        variant="soft"
        style={{ cursor: "help", flexShrink: 0 }}
      >
        <ExclamationTriangleIcon />
      </Badge>
    </Tooltip>
  );
}

/**
 * Default cell renderer that shows the (optionally formatted) value and
 * appends a low-confidence warning badge when the field is flagged for the row.
 */
function PlainCellRenderer(params: ICellRendererParams<OntologySample>) {
  const field = params.colDef?.field;
  const low = isLowConfidence(params.data, field);
  const text = params.valueFormatted ?? params.value ?? "";
  return (
    <Flex align="center" gap="1" style={{ overflow: "hidden" }}>
      <Text truncate size="2">
        {text}
      </Text>
      {low && <LowConfidenceBadge />}
    </Flex>
  );
}

function OntologyCellRenderer(idField: string, nameField: string) {
  return function Renderer(params: ICellRendererParams<OntologySample>) {
    const raw = params.value;
    const data = params.data;
    const low = isLowConfidence(data, params.colDef?.field);
    if (!data) return <>{raw ?? ""}</>;

    const ontoName = data[nameField];
    const ontoId = data[idField];

    if (!ontoId || !ontoName) {
      return (
        <Flex align="center" gap="1" style={{ overflow: "hidden" }}>
          <Text truncate size="2">
            {raw ?? ""}
          </Text>
          {low && <LowConfidenceBadge />}
        </Flex>
      );
    }

    const prefix = ontoId.split(":")[0];
    const url = ontologyUrl(ontoId);
    return (
      <Flex align="center" gap="1" style={{ overflow: "hidden" }}>
        <Text truncate size="2">
          {ontoName}
        </Text>
        <Tooltip content={ontoId}>
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              <Badge
                color="iris"
                size="1"
                style={{ cursor: "pointer", flexShrink: 0 }}
              >
                {prefix}
              </Badge>
            </a>
          ) : (
            <Badge color="gray" size="1" style={{ flexShrink: 0 }}>
              {prefix}
            </Badge>
          )}
        </Tooltip>
        {low && <LowConfidenceBadge />}
      </Flex>
    );
  };
}

const ONTOLOGY_MAPPED_FIELDS: Record<string, { id: string; name: string }> = {
  disease: { id: "disease_ontology_id", name: "disease_ontology_name" },
  tissue: { id: "tissue_ontology_id", name: "tissue_ontology_name" },
  cell_type: { id: "cell_type_ontology_id", name: "cell_type_ontology_name" },
  assay: { id: "assay_ontology_id", name: "assay_ontology_name" },
  development_stage: {
    id: "development_stage_ontology_id",
    name: "development_stage_ontology_name",
  },
};

const ONTOLOGY_RENDERERS = Object.fromEntries(
  Object.entries(ONTOLOGY_MAPPED_FIELDS).map(([field, onto]) => [
    field,
    OntologyCellRenderer(onto.id, onto.name),
  ]),
);

const numericComparator = (a: number | null, b: number | null) =>
  (a ?? 0) - (b ?? 0);

type FieldDef = {
  field: string;
  header: string;
  minWidth?: number;
  v3Only?: boolean;
};

const ALL_FIELDS: FieldDef[] = [
  { field: "sample", header: "Sample", minWidth: 130 },
  { field: "organism", header: "Organism", minWidth: 140, v3Only: true },
  { field: "tissue", header: "Tissue", minWidth: 150 },
  { field: "cell_type", header: "Cell Type", minWidth: 150 },
  { field: "cell_line", header: "Cell Line" },
  { field: "disease", header: "Disease", minWidth: 150 },
  { field: "phenotype", header: "Phenotype" },
  { field: "sex", header: "Sex" },
  { field: "age", header: "Age" },
  { field: "ethnicity", header: "Ethnicity" },
  { field: "strain", header: "Strain" },
  { field: "assay", header: "Assay", minWidth: 150 },
  { field: "assay_category", header: "Assay Category", v3Only: true },
  { field: "treatment", header: "Treatment" },
  { field: "development_stage", header: "Dev. Stage", minWidth: 150 },
  { field: "sample_type", header: "Sample Type" },
  { field: "genetic_modification", header: "Genetic Mod." },
  { field: "tissue_primary_site", header: "Primary Site", v3Only: true },
  { field: "tissue_site_type", header: "Site Type", v3Only: true },
  { field: "taxid", header: "Taxon ID", v3Only: true },
  { field: "cell_count", header: "Cell Count", minWidth: 120 },
  { field: "gene_count", header: "Gene Count", minWidth: 120 },
];

const V3_FIELDS = ALL_FIELDS;
const V1_FIELDS = ALL_FIELDS.filter((f) => !f.v3Only);

/**
 * Fetch enriched metadata. `offset == null` fetches the full set (used by CSV
 * export); a number fetches one TABLE_PAGE_SIZE page for infinite scroll.
 */
async function fetchEnrichedMetadata(
  accession: string,
  offset: number | null,
): Promise<EnrichedResponse | null> {
  const url =
    offset == null
      ? `${SERVER_URL}/project/${accession}/enriched`
      : `${SERVER_URL}/project/${accession}/enriched?limit=${TABLE_PAGE_SIZE}&offset=${offset}`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Failed to fetch enriched metadata");
  return res.json();
}

export type UseEnrichedMetadata = {
  data: EnrichedResponse | null;
  isLoading: boolean;
  fetchNextPage: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
};

/**
 * Shared infinite query for enriched metadata (20 samples/page). Deduped by
 * react-query across consumers. `data` accumulates the loaded pages and is
 * `null` when enriched metadata is unavailable (404) or empty.
 */
export function useEnrichedMetadata(
  accession: string,
  enabled = true,
): UseEnrichedMetadata {
  const query = useInfiniteQuery({
    queryKey: ["enriched-metadata", accession],
    queryFn: ({ pageParam }) => fetchEnrichedMetadata(accession, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage) return undefined;
      return lastPage.samples.length === TABLE_PAGE_SIZE
        ? allPages.length * TABLE_PAGE_SIZE
        : undefined;
    },
    enabled: !!accession && enabled,
  });
  const first = query.data?.pages[0] ?? null;
  const samples = query.data?.pages.flatMap((p) => p?.samples ?? []) ?? [];
  const data = first && samples.length > 0 ? { ...first, samples } : null;
  return {
    data,
    isLoading: query.isLoading,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
  };
}

function getVisibleFields(data: EnrichedResponse): FieldDef[] {
  const isV3 = data.version === "v3";
  const allFields = isV3 ? V3_FIELDS : V1_FIELDS;
  return allFields.filter(
    (f) =>
      f.field === "sample" ||
      data.samples.some((s) => {
        const val = s[f.field];
        if (val != null && val !== "") return true;
        const onto = ONTOLOGY_MAPPED_FIELDS[f.field];
        if (onto && isV3) {
          const ontoName = s[onto.name];
          return ontoName != null && ontoName !== "";
        }
        return false;
      }),
  );
}

/**
 * Badges (AI / Ontology / single-cell modality) describing the enriched data.
 * Rendered next to the section title when the enriched tab is active.
 */
export function EnrichedMetadataBadges({ data }: { data: EnrichedResponse }) {
  const isV3 = data.version === "v3";
  const loaded = data.samples.length;
  return (
    <>
      <Badge size="3" style={{ whiteSpace: "nowrap" }}>
        {loaded < data.n_samples
          ? `Showing first ${loaded.toLocaleString()} of ${data.n_samples.toLocaleString()} samples`
          : `${data.n_samples.toLocaleString()} samples`}
      </Badge>
      <Tooltip content="Attributes are generated with an AI-assisted pipeline. Their correctness is not guaranteed.">
        <Badge size="3" style={{ cursor: "help" }} variant="soft">
          <MagicWandIcon /> AI Generated
        </Badge>
      </Tooltip>
      {isV3 && (
        <Tooltip content="Includes standardised ontology mappings (MONDO, UBERON, CL, EFO)">
          <Badge size="3" variant="soft" style={{ cursor: "help" }}>
            <InfoCircledIcon /> Ontology
          </Badge>
        </Tooltip>
      )}
      {data.single_cell_modality && (
        <Tooltip content={`Single-cell modality: ${data.single_cell_modality}`}>
          <Badge color="cyan" size="3" variant="soft">
            {data.single_cell_modality}
          </Badge>
        </Tooltip>
      )}
    </>
  );
}

/**
 * Export the FULL enriched dataset (re-fetched without pagination) to CSV, so
 * the download is complete even when the grid has only scrolled a few pages.
 */
export async function exportEnrichedCsv(accession: string) {
  const data = await fetchEnrichedMetadata(accession, null);
  if (!data || data.samples.length === 0) return;
  const isV3 = data.version === "v3";
  const visibleFields = getVisibleFields(data);
  const exportFields: { key: string; header: string }[] = [];
  for (const f of visibleFields) {
    exportFields.push({ key: f.field, header: f.header });
    const onto = isV3 ? ONTOLOGY_MAPPED_FIELDS[f.field] : undefined;
    if (onto) {
      exportFields.push({ key: onto.id, header: `${f.header} Ontology ID` });
      exportFields.push({
        key: onto.name,
        header: `${f.header} Ontology Name`,
      });
    }
  }
  const headers = exportFields.map((f) => f.header);
  const escape = (val: string) => `"${String(val).replace(/"/g, '""')}"`;
  const rows = data.samples.map((s) =>
    exportFields.map((f) => escape(s[f.key] ?? "")),
  );
  const csv = [
    headers.map(escape).join(","),
    ...rows.map((r) => r.join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${accession}_enriched_metadata.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

/**
 * Renders the enriched-metadata ag-grid (plus footnote) for the given data.
 * The section header / CSV button are owned by the parent tab container.
 */
export function EnrichedMetadataGrid({
  data,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
}: {
  data: EnrichedResponse;
  fetchNextPage: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
}) {
  const { resolvedTheme } = useTheme();
  const wrap = useWrapText();
  const agGridThemeClassName =
    resolvedTheme === "dark" ? "ag-theme-quartz-dark" : "ag-theme-quartz";

  const isV3 = data.version === "v3";
  const visibleFields = getVisibleFields(data);

  const columnDefs: ColDef<OntologySample>[] = visibleFields.map((f) => {
    const onto = isV3 ? ONTOLOGY_MAPPED_FIELDS[f.field] : undefined;
    const base = {
      field: f.field,
      headerName: f.header,
      minWidth: f.minWidth ?? 100,
      flex: 1,
    };

    // Show "~N" when cell_count_estimated is true
    if (f.field === "cell_count") {
      return {
        ...base,
        comparator: numericComparator,
        cellRenderer: PlainCellRenderer,
        valueFormatter: (params: { data?: OntologySample }) => {
          if (!params.data) return "";
          const count = params.data["cell_count"];
          if (count == null) return "";
          return params.data["cell_count_estimated"]
            ? `~${count.toLocaleString()}`
            : count.toLocaleString();
        },
      };
    }

    if (f.field === "gene_count") {
      return {
        ...base,
        comparator: numericComparator,
        cellRenderer: PlainCellRenderer,
        valueFormatter: (params: { value?: number | null }) => {
          if (params.value == null) return "";
          return params.value.toLocaleString();
        },
      };
    }

    return {
      ...base,
      ...(onto
        ? {
            cellRenderer: ONTOLOGY_RENDERERS[f.field],
            valueGetter: (params: { data?: OntologySample }) => {
              if (!params.data) return null;
              return params.data[onto.name] ?? params.data[f.field] ?? null;
            },
          }
        : { cellRenderer: PlainCellRenderer }),
    };
  });

  const gridHeight = Math.min(400, 42 + data.samples.length * 42);

  return (
    <>
      <div
        className={agGridThemeClassName}
        style={{ width: "100%", height: `${gridHeight}px` }}
      >
        <AgGridReact<OntologySample>
          columnDefs={columnDefs}
          defaultColDef={{
            filter: true,
            sortable: true,
            resizable: true,
            ...wrapColDef<OntologySample>(wrap),
          }}
          enableCellTextSelection
          ensureDomOrder
          getRowId={(params) => params.data.sample}
          rowData={data.samples}
          theme="legacy"
          onBodyScroll={infiniteScrollOnBodyScroll({
            loadedCount: data.samples.length,
            hasNextPage,
            isFetchingNextPage,
            fetchNextPage,
          })}
        />
      </div>
      {isFetchingNextPage && (
        <Flex align="center" gap="2">
          <Spinner size="1" />
          <Text size="1" color="gray">
            Loading more samples...
          </Text>
        </Flex>
      )}
      {data.samples.some((s) => s["cell_count_estimated"]) && (
        <Text size="1" color="gray">
          ~ Cell counts marked with ~ are series-level estimates distributed
          across samples.
        </Text>
      )}
      {data.samples.some(
        (s) =>
          Array.isArray(s["low_confidence_tags"]) &&
          s["low_confidence_tags"].length > 0,
      ) && (
        <Flex align="center" gap="1">
          <Text size="1" color="gray">
            Cells marked with{" "}
            <ExclamationTriangleIcon
              style={{ display: "inline", verticalAlign: "-2px" }}
            />{" "}
            are low-confidence values.
          </Text>
        </Flex>
      )}
    </>
  );
}
