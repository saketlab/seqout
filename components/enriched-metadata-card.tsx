"use client";
import { ensureAgGridModules } from "@/lib/ag-grid";
import { SERVER_URL } from "@/utils/constants";
import SectionAnchor from "@/components/section-anchor";
import { DownloadIcon } from "@radix-ui/react-icons";
import { Badge, Button, Flex, Spinner, Text } from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";
import type { ColDef } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useTheme } from "next-themes";

ensureAgGridModules();

interface EnrichedSample {
  sample: string;
  age: string | null;
  sex: string | null;
  ethnicity: string | null;
  phenotype: string | null;
  cell_type: string | null;
  tissue: string | null;
  strain: string | null;
  disease: string | null;
  assay: string | null;
  cell_line: string | null;
  treatment: string | null;
  development_stage: string | null;
  sample_type: string | null;
  genetic_modification: string | null;
}

interface EnrichedResponse {
  accession: string;
  title: string;
  n_samples: number;
  samples: EnrichedSample[];
}

const ENRICHED_FIELDS: { field: keyof EnrichedSample; header: string }[] = [
  { field: "sample", header: "Sample" },
  { field: "tissue", header: "Tissue" },
  { field: "cell_type", header: "Cell Type" },
  { field: "cell_line", header: "Cell Line" },
  { field: "disease", header: "Disease" },
  { field: "phenotype", header: "Phenotype" },
  { field: "sex", header: "Sex" },
  { field: "age", header: "Age" },
  { field: "ethnicity", header: "Ethnicity" },
  { field: "strain", header: "Strain" },
  { field: "assay", header: "Assay" },
  { field: "treatment", header: "Treatment" },
  { field: "development_stage", header: "Dev. Stage" },
  { field: "sample_type", header: "Sample Type" },
  { field: "genetic_modification", header: "Genetic Mod." },
];

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

  // Only show columns that have at least one non-null value
  const visibleFields = ENRICHED_FIELDS.filter(
    (f) =>
      f.field === "sample" ||
      data.samples.some((s) => s[f.field] != null && s[f.field] !== ""),
  );

  const columnDefs: ColDef<EnrichedSample>[] = visibleFields.map((f) => ({
    field: f.field,
    headerName: f.header,
    minWidth: f.field === "sample" ? 130 : 100,
    flex: 1,
    filter: true,
    sortable: true,
    resizable: true,
  }));

  const gridHeight = Math.min(400, 42 + data.samples.length * 42);

  const handleExportCsv = () => {
    const headers = visibleFields.map((f) => f.header);
    const escape = (val: string) => `"${String(val).replace(/"/g, '""')}"`;
    const rows = data.samples.map((s) =>
      visibleFields.map((f) => escape(s[f.field] ?? "-")),
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
        <AgGridReact<EnrichedSample>
          columnDefs={columnDefs}
          defaultColDef={{ resizable: true }}
          getRowId={(params) => params.data.sample}
          rowData={data.samples}
          theme="legacy"
        />
      </div>
    </>
  );
}
