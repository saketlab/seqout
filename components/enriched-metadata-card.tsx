"use client";
import { ensureAgGridModules } from "@/lib/ag-grid";
import { SERVER_URL } from "@/utils/constants";
import SectionAnchor from "@/components/section-anchor";
import { DownloadIcon } from "@radix-ui/react-icons";
import { Badge, Button, Flex, Spinner, Text, Tooltip } from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useTheme } from "next-themes";

ensureAgGridModules();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OntologySample = Record<string, any>;

interface EnrichedResponse {
  accession: string;
  title: string;
  n_samples: number;
  single_cell_modality: string | null;
  version: "v3" | "v1";
  samples: OntologySample[];
}

const ONTOLOGY_URLS: Record<string, string> = {
  MONDO: "https://www.ebi.ac.uk/ols4/ontologies/mondo/terms?iri=http://purl.obolibrary.org/obo/",
  UBERON: "https://www.ebi.ac.uk/ols4/ontologies/uberon/terms?iri=http://purl.obolibrary.org/obo/",
  CL: "https://www.ebi.ac.uk/ols4/ontologies/cl/terms?iri=http://purl.obolibrary.org/obo/",
  EFO: "https://www.ebi.ac.uk/ols4/ontologies/efo/terms?iri=http://purl.obolibrary.org/obo/",
};

function ontologyUrl(id: string): string | null {
  const prefix = id.split(":")[0];
  const base = ONTOLOGY_URLS[prefix];
  if (!base) return null;
  return `${base}${id.replace(":", "_")}`;
}

function OntologyCellRenderer(
  idField: string,
  nameField: string,
) {
  return function Renderer(params: ICellRendererParams<OntologySample>) {
    const raw = params.value;
    const data = params.data;
    if (!data) return <>{raw ?? ""}</>;

    const ontoName = data[nameField];
    const ontoId = data[idField];

    if (!ontoId || !ontoName) return <>{raw ?? ""}</>;

    const prefix = ontoId.split(":")[0];
    const url = ontologyUrl(ontoId);
    return (
      <Flex align="center" gap="1" style={{ overflow: "hidden" }}>
        <Text truncate size="2">{ontoName}</Text>
        <Tooltip content={ontoId}>
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              <Badge color="iris" size="1" style={{ cursor: "pointer", flexShrink: 0 }}>
                {prefix}
              </Badge>
            </a>
          ) : (
            <Badge color="gray" size="1" style={{ flexShrink: 0 }}>
              {prefix}
            </Badge>
          )}
        </Tooltip>
      </Flex>
    );
  };
}

const ONTOLOGY_MAPPED_FIELDS: Record<string, { id: string; name: string }> = {
  disease: { id: "disease_ontology_id", name: "disease_ontology_name" },
  tissue: { id: "tissue_ontology_id", name: "tissue_ontology_name" },
  cell_type: { id: "cell_type_ontology_id", name: "cell_type_ontology_name" },
  assay: { id: "assay_ontology_id", name: "assay_ontology_name" },
  development_stage: { id: "development_stage_ontology_id", name: "development_stage_ontology_name" },
};

const ONTOLOGY_RENDERERS = Object.fromEntries(
  Object.entries(ONTOLOGY_MAPPED_FIELDS).map(([field, onto]) => [
    field, OntologyCellRenderer(onto.id, onto.name),
  ]),
);

const numericComparator = (a: number | null, b: number | null) => (a ?? 0) - (b ?? 0);

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

async function fetchEnrichedMetadata(
  accession: string,
): Promise<EnrichedResponse | null> {
  const res = await fetch(`${SERVER_URL}/project/${accession}/enriched`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Failed to fetch enriched metadata");
  return res.json();
}

export default function EnrichedMetadataCard({
  accession,
}: {
  accession: string;
}) {
  const { resolvedTheme } = useTheme();
  const agGridThemeClassName =
    resolvedTheme === "dark" ? "ag-theme-quartz-dark" : "ag-theme-quartz";

  const { data, isLoading } = useQuery({
    queryKey: ["enriched-metadata", accession],
    queryFn: () => fetchEnrichedMetadata(accession),
    enabled: !!accession,
  });

  if (isLoading) {
    return (
      <Flex gap="2" align="center">
        <Spinner size="2" />
        <Text size="2">Loading enriched metadata...</Text>
      </Flex>
    );
  }

  if (!data || data.samples.length === 0) return null;

  const isV3 = data.version === "v3";
  const allFields = isV3 ? V3_FIELDS : V1_FIELDS;

  const visibleFields = allFields.filter(
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

  const columnDefs: ColDef<OntologySample>[] = visibleFields.map((f) => {
    const onto = isV3 ? ONTOLOGY_MAPPED_FIELDS[f.field] : undefined;
    const base = { field: f.field, headerName: f.header, minWidth: f.minWidth ?? 100, flex: 1 };

    // Show "~N" when cell_count_estimated is true
    if (f.field === "cell_count") {
      return {
        ...base,
        comparator: numericComparator,
        valueFormatter: (params: { data?: OntologySample }) => {
          if (!params.data) return "";
          const count = params.data["cell_count"];
          if (count == null) return "";
          return params.data["cell_count_estimated"] ? `~${count.toLocaleString()}` : count.toLocaleString();
        },
      };
    }

    if (f.field === "gene_count") {
      return {
        ...base,
        comparator: numericComparator,
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
        : {}),
    };
  });

  const gridHeight = Math.min(400, 42 + data.samples.length * 42);

  const handleExportCsv = () => {
    const exportFields: { key: string; header: string }[] = [];
    for (const f of visibleFields) {
      exportFields.push({ key: f.field, header: f.header });
      const onto = isV3 ? ONTOLOGY_MAPPED_FIELDS[f.field] : undefined;
      if (onto) {
        exportFields.push({ key: onto.id, header: `${f.header} Ontology ID` });
        exportFields.push({ key: onto.name, header: `${f.header} Ontology Name` });
      }
    }
    const headers = exportFields.map((f) => f.header);
    const escape = (val: string) => `"${String(val).replace(/"/g, '""')}"`;
    const rows = data.samples.map((s) =>
      exportFields.map((f) => escape(s[f.key] ?? "")),
    );
    const csv = [headers.map(escape).join(","), ...rows.map((r) => r.join(","))].join("\n");
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
  };

  return (
    <>
      <Flex id="enriched" justify="between" align="center">
        <Flex align="center" gap="2">
          <Text weight="medium" size="6">
            Enriched metadata
          </Text>
          <Badge color="purple" size="2">
            AI
          </Badge>
          {isV3 && (
            <Tooltip content="Includes standardised ontology mappings (MONDO, UBERON, CL, EFO)">
              <Badge color="iris" size="1" variant="soft">
                Ontology
              </Badge>
            </Tooltip>
          )}
          {data.single_cell_modality && (
            <Tooltip content={`Single-cell modality: ${data.single_cell_modality}`}>
              <Badge color="cyan" size="1" variant="soft">
                {data.single_cell_modality}
              </Badge>
            </Tooltip>
          )}
          <SectionAnchor id="enriched" />
        </Flex>
        <Button onClick={handleExportCsv}>
          <DownloadIcon /> CSV
        </Button>
      </Flex>
      <div
        className={agGridThemeClassName}
        style={{ width: "100%", height: `${gridHeight}px` }}
      >
        <AgGridReact<OntologySample>
          columnDefs={columnDefs}
          defaultColDef={{ filter: true, sortable: true, resizable: true }}
          enableCellTextSelection
          ensureDomOrder
          getRowId={(params) => params.data.sample}
          rowData={data.samples}
          theme="legacy"
        />
      </div>
      {data.samples.some((s) => s["cell_count_estimated"]) && (
        <Text size="1" color="gray">
          ~ Cell counts marked with ~ are series-level estimates distributed across samples.
        </Text>
      )}
    </>
  );
}
