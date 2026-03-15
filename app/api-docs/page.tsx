import SearchBar from "@/components/search-bar";
import { CodeBlock, EndpointCard } from "@/components/api-docs-client";
import {
  Badge,
  Callout,
  Code,
  Flex,
  Link,
  Text,
} from "@radix-ui/themes";

const BASE = "https://seqout.org/api";

type Param = {
  name: string;
  type: string;
  required?: boolean;
  default?: string;
  description: string;
  location?: "path" | "query" | "body";
};

type Endpoint = {
  method: "GET" | "POST";
  path: string;
  summary: string;
  description: string;
  params: Param[];
  exampleParams?: Record<string, string>;
  exampleBody?: string;
  responseHint?: string;
};

type Category = {
  title: string;
  id: string;
  endpoints: Endpoint[];
};


const API: Category[] = [
  {
    title: "Search",
    id: "search",
    endpoints: [
      {
        method: "GET",
        path: "/search",
        summary: "Search all databases",
        description:
          "Full-text search across GEO, SRA, ArrayExpress and ENA. Results are ranked by relevance. Supports cursor-based pagination and sorting by citations, journal, or year.",
        params: [
          { name: "q", type: "string", required: true, description: "Search query (1-500 chars)" },
          { name: "db", type: "string", description: "Filter to a database: geo, sra, arrayexpress, or ena" },
          { name: "sortby", type: "string", description: "Sort by: citations, journal, or year" },
          { name: "order", type: "string", default: "desc", description: "Sort order: asc or desc" },
          { name: "cursor_rank", type: "float", description: "Pagination cursor (rank of last result)" },
          { name: "cursor_acc", type: "string", description: "Pagination cursor (accession of last result)" },
          { name: "cursor_sort", type: "string", description: "Pagination cursor for sorted results" },
        ],
        exampleParams: { q: "CRISPR screen" },
        responseHint: '{"results": [...], "total": 1234, "took_ms": 45.2, "next_cursor": {"rank": 0.12, "accession": "GSE123456"}}',
      },
      {
        method: "GET",
        path: "/search/geo",
        summary: "Search GEO only",
        description: "Full-text search restricted to the GEO database.",
        params: [
          { name: "q", type: "string", required: true, description: "Search query" },
          { name: "cursor_rank", type: "float", description: "Pagination cursor (rank)" },
          { name: "cursor_acc", type: "string", description: "Pagination cursor (accession)" },
        ],
        exampleParams: { q: "single cell RNA-seq brain" },
      },
      {
        method: "GET",
        path: "/search/sra",
        summary: "Search SRA only",
        description: "Full-text search restricted to the SRA database.",
        params: [
          { name: "q", type: "string", required: true, description: "Search query" },
          { name: "cursor_rank", type: "float", description: "Pagination cursor (rank)" },
          { name: "cursor_acc", type: "string", description: "Pagination cursor (accession)" },
        ],
        exampleParams: { q: "ChIP-seq H3K27ac" },
      },
      {
        method: "GET",
        path: "/search/structured",
        summary: "Structured search with metadata filters",
        description:
          "Search with structured filters for organism, library strategy, platform, country, center, date range, journal, instrument model, geographic location, and assay type. All filters are optional and can be combined.",
        params: [
          { name: "q", type: "string", description: "Optional text query" },
          { name: "organism", type: "string", description: "Scientific name (e.g. Homo sapiens)" },
          { name: "library_strategy", type: "string", description: "Library strategy (e.g. RNA-Seq, ChIP-Seq)" },
          { name: "platform", type: "string", description: "Sequencing platform (e.g. ILLUMINA)" },
          { name: "country", type: "string", description: "Submitter country" },
          { name: "center", type: "string", description: "Submitting center (partial match)" },
          { name: "year_from", type: "int", description: "Start year (1900-2100)" },
          { name: "year_to", type: "int", description: "End year (1900-2100)" },
          { name: "source", type: "string", description: "Database: geo, sra, arrayexpress, ena, or all" },
          { name: "journal", type: "string", description: "Journal name" },
          { name: "instrument_model", type: "string", description: "Instrument model" },
          { name: "assay_l1", type: "string", description: "Assay level 1 category" },
          { name: "assay_l2", type: "string", description: "Assay level 2 category" },
          { name: "geo_country_code_iso2", type: "string", description: "ISO-2 country code for geographic filter" },
          { name: "geo_lat", type: "float", description: "Latitude for geographic radius search" },
          { name: "geo_lng", type: "float", description: "Longitude for geographic radius search" },
          { name: "geo_radius_km", type: "float", description: "Radius in km (0.1-20000, requires lat/lng)" },
          { name: "cursor_rank", type: "float", description: "Pagination cursor (rank)" },
          { name: "cursor_acc", type: "string", description: "Pagination cursor (accession)" },
        ],
        exampleParams: { organism: "Mus musculus", library_strategy: "RNA-Seq", year_from: "2023" },
      },
    ],
  },
  {
    title: "Projects",
    id: "projects",
    endpoints: [
      {
        method: "GET", path: "/project/{accession}", summary: "Get project metadata",
        description: "Retrieve full metadata for a project. Works with GEO (GSE*), SRA (SRP/ERP/DRP*), BioProject (PRJ*), and ArrayExpress (E-*) accessions.",
        params: [{ name: "accession", type: "string", required: true, location: "path", description: "Project accession (e.g. GSE196830, SRP123456, E-MTAB-1234)" }],
        exampleParams: { accession: "GSE196830" },
        responseHint: '{"accession": "GSE196830", "title": "...", "summary": "...", "organisms": [...], ...}',
      },
      {
        method: "GET", path: "/project/{accession}/metadata", summary: "Get project title and description",
        description: "Lightweight endpoint returning only the title and description.",
        params: [{ name: "accession", type: "string", required: true, location: "path", description: "Project accession" }],
        exampleParams: { accession: "GSE196830" },
      },
      {
        method: "GET", path: "/project/{accession}/xref", summary: "Cross-reference lookup",
        description: "Find related accessions across archives (e.g. find the SRA study linked to a GEO series).",
        params: [{ name: "accession", type: "string", required: true, location: "path", description: "Project accession" }],
        exampleParams: { accession: "GSE196830" },
      },
      {
        method: "GET", path: "/project/{accession}/cite", summary: "Get BibTeX citation",
        description: "Get citation data for a project's linked publications. Supports JSON or BibTeX format.",
        params: [
          { name: "accession", type: "string", required: true, location: "path", description: "Project accession" },
          { name: "type", type: "string", default: "original", description: "Citation scope: original or all" },
          { name: "format", type: "string", default: "json", description: "Response format: json or bibtex" },
        ],
        exampleParams: { accession: "GSE196830", format: "bibtex" },
      },
      {
        method: "GET", path: "/project/{accession}/enriched", summary: "AI-enriched sample metadata",
        description: "LLM-extracted structured metadata (tissue, cell type, disease, sex, age, etc.) for each sample. Returns 404 if no enriched data exists.",
        params: [
          { name: "accession", type: "string", required: true, location: "path", description: "Project accession" },
          { name: "human_readable_age", type: "bool", default: "true", description: "Convert age from hours to readable format" },
        ],
        exampleParams: { accession: "GSE196830" },
        responseHint: '{"accession": "GSE196830", "title": "...", "n_samples": 24, "samples": [{"sample": "GSM...", "tissue": "brain", "cell_type": "neuron", ...}]}',
      },
    ],
  },
  {
    title: "Experiments & Samples", id: "experiments-samples",
    endpoints: [
      { method: "GET", path: "/project/{study}/experiments", summary: "List study experiments", description: "Get all experiments for an SRA/BioProject study.", params: [{ name: "study", type: "string", required: true, location: "path", description: "Study accession (SRP/ERP/DRP/PRJ*)" }], exampleParams: { study: "SRP123456" } },
      { method: "GET", path: "/project/{study}/runs", summary: "List FASTQ download links", description: "Get all runs with FASTQ/SRA download URLs, file sizes, and MD5 checksums.", params: [{ name: "study", type: "string", required: true, location: "path", description: "Study accession (SRP/ERP/DRP)" }], exampleParams: { study: "SRP123456" }, responseHint: '{"total_runs": 48, "paired_runs": 48, "single_runs": 0, "total_fastq_bytes": 123456789, "runs": [...]}' },
      { method: "GET", path: "/sample/{accession}", summary: "Get sample metadata", description: "Retrieve metadata for a single sample accession.", params: [{ name: "accession", type: "string", required: true, location: "path", description: "Sample accession (SRS/DRS/ERS/SAM*)" }], exampleParams: { accession: "SRS1234567" } },
      { method: "GET", path: "/sample-detail/{accession}", summary: "Get full sample detail", description: "Get sample with parent project, experiment, and run data. Accepts experiment (SRX), sample (SRS/GSM), or BioSample (SAM*) accessions.", params: [{ name: "accession", type: "string", required: true, location: "path", description: "Accession (SRX/SRS/GSM/SAM*)" }], exampleParams: { accession: "GSM1234567" } },
      { method: "GET", path: "/geo/series/{accession}/samples", summary: "List GEO/ArrayExpress samples", description: "Get all samples for a GEO series or ArrayExpress experiment.", params: [{ name: "accession", type: "string", required: true, location: "path", description: "GEO series (GSE*) or ArrayExpress (E-*) accession" }], exampleParams: { accession: "GSE196830" } },
    ],
  },
  {
    title: "Downloads", id: "downloads",
    endpoints: [
      { method: "GET", path: "/project/{study}/runs/download", summary: "Download run links as TSV", description: "Stream a TSV file with all run accessions and FASTQ download URLs.", params: [{ name: "study", type: "string", required: true, location: "path", description: "Study accession (SRP/ERP/DRP)" }], exampleParams: { study: "SRP123456" } },
      { method: "GET", path: "/project/{study}/metadata/download", summary: "Download merged metadata CSV", description: "Stream a CSV file with merged experiment, sample, and run metadata.", params: [{ name: "study", type: "string", required: true, location: "path", description: "Study accession (SRP/ERP/DRP)" }], exampleParams: { study: "SRP123456" } },
      { method: "GET", path: "/project/{study}/download/{mode}", summary: "Download bash script", description: "Generate a bash script to download FASTQ or SRA files. Modes: fastq, sra, sra_lite, s3, gcs.", params: [{ name: "study", type: "string", required: true, location: "path", description: "Study accession (SRP/ERP/DRP)" }, { name: "mode", type: "string", required: true, location: "path", description: "Download mode: fastq, sra, sra_lite, s3, or gcs" }], exampleParams: { study: "SRP123456", mode: "fastq" } },
      { method: "GET", path: "/project/{accession}/supplementary/download", summary: "Download supplementary files script", description: "Generate a bash script to download supplementary files for GEO or ArrayExpress projects.", params: [{ name: "accession", type: "string", required: true, location: "path", description: "GEO (GSE*) or ArrayExpress (E-*) accession" }], exampleParams: { accession: "GSE196830" } },
      { method: "POST", path: "/bulk/metadata", summary: "Bulk metadata download", description: "Generate a ZIP file containing CSV metadata for multiple accessions.", params: [{ name: "accessions", type: "string[]", required: true, location: "body", description: "Array of project accessions" }], exampleBody: '{"accessions": ["GSE196830", "SRP123456"]}' },
      { method: "POST", path: "/bulk/project-metadata", summary: "Bulk project metadata lookup", description: "Get title, description, and organisms for multiple projects in one request.", params: [{ name: "accessions", type: "string[]", required: true, location: "body", description: "Array of project accessions" }], exampleBody: '{"accessions": ["GSE196830", "GSE200000"]}', responseHint: '[{"accession": "GSE196830", "title": "...", "description": "...", "organisms": ["Homo sapiens"]}]' },
    ],
  },
  {
    title: "Statistics", id: "statistics",
    endpoints: [
      { method: "GET", path: "/stats/growth", summary: "Database growth over time", description: "Monthly growth of projects, experiments, or data volume (bases/bytes) across databases.", params: [{ name: "mode", type: "string", required: true, description: "Metric: projects, experiments, or bases" }, { name: "db", type: "string", description: "Filter to: geo, sra, arrayexpress, or ena" }], exampleParams: { mode: "projects" } },
      { method: "GET", path: "/stats/organism-growth", summary: "Organism growth over time", description: "Monthly experiment counts for a specific organism, with cumulative totals.", params: [{ name: "organism", type: "string", required: true, description: "Scientific name (e.g. Homo sapiens)" }, { name: "mode", type: "string", default: "absolute", description: "absolute or percentage" }, { name: "db", type: "string", description: "Filter to a single database" }], exampleParams: { organism: "Homo sapiens", mode: "absolute" } },
      { method: "GET", path: "/stats/organism-totals", summary: "Total experiments per organism", description: "Ranked list of organisms by total experiment count, with optional year range filter.", params: [{ name: "year_from", type: "int", description: "Start year" }, { name: "year_to", type: "int", description: "End year" }, { name: "limit", type: "int", description: "Max organisms (1-10000)" }], exampleParams: { limit: "10" } },
      { method: "GET", path: "/stats/organism-search", summary: "Search organisms by name", description: "Search for organisms by partial name match. Returns scientific name, total experiments, and common name.", params: [{ name: "q", type: "string", required: true, description: "Search term" }, { name: "limit", type: "int", default: "20", description: "Max results (1-100)" }], exampleParams: { q: "drosophila" } },
      { method: "GET", path: "/stats/global-contributions", summary: "Geographic contributions", description: "Aggregated lat/lng data for mapping where sequencing data is generated globally.", params: [{ name: "organism", type: "string", description: "Filter by dominant scientific name" }, { name: "assay_l1", type: "string", description: "Filter by assay level 1" }, { name: "assay_l2", type: "string", description: "Filter by assay level 2" }], exampleParams: { organism: "Homo sapiens" } },
      { method: "GET", path: "/stats/global-contributions/accessions", summary: "Accessions by country", description: "Get all project accessions from a country, optionally filtered by organism and assay.", params: [{ name: "country", type: "string", required: true, description: "Country name" }, { name: "organism", type: "string", description: "Filter by organism" }, { name: "assay_l2", type: "string", description: "Filter by assay type" }], exampleParams: { country: "India" }, responseHint: "GSE100001\\nGSE100002\\nSRP200003\\n..." },
    ],
  },
  {
    title: "Lookup & Resolution", id: "lookup",
    endpoints: [
      { method: "GET", path: "/accession/{accession}/project", summary: "Resolve accession to parent project", description: "Given a sample (SRS/GSM) or experiment (SRX) accession, find the parent project.", params: [{ name: "accession", type: "string", required: true, location: "path", description: "Sample or experiment accession" }], exampleParams: { accession: "SRX1234567" }, responseHint: '{"project_accession": "SRP123456"}' },
      { method: "GET", path: "/prj/{prj_accession}", summary: "Resolve BioProject to study", description: "Resolve a BioProject accession (PRJNA/PRJEB/PRJDA) to its GSE or SRP study.", params: [{ name: "prj_accession", type: "string", required: true, location: "path", description: "BioProject accession (PRJ*)" }], exampleParams: { prj_accession: "PRJNA123456" } },
      { method: "GET", path: "/common-name", summary: "Get common name for organism", description: "Look up the common name for a scientific organism name.", params: [{ name: "scientific_name", type: "string", required: true, description: "Scientific name (e.g. Homo sapiens)" }], exampleParams: { scientific_name: "Mus musculus" } },
      { method: "GET", path: "/organisms", summary: "List all organisms", description: "Get the full list of organisms in the database with experiment counts.", params: [{ name: "common_names", type: "bool", default: "false", description: "Include common names" }], exampleParams: { common_names: "true" } },
    ],
  },
];


function buildUrl(path: string, exampleParams?: Record<string, string>): string {
  let url = `${BASE}${path}`;
  const qp: string[] = [];
  if (exampleParams) {
    for (const [k, v] of Object.entries(exampleParams)) {
      if (url.includes(`{${k}}`)) {
        url = url.replace(`{${k}}`, encodeURIComponent(v));
      } else {
        qp.push(`${k}=${encodeURIComponent(v)}`);
      }
    }
  }
  if (qp.length) url += `?${qp.join("&")}`;
  return url;
}

function buildCurl(ep: Endpoint): string {
  if (ep.method === "POST" && ep.exampleBody) {
    return `curl -X POST "${buildUrl(ep.path, ep.exampleParams)}" \\\n  -H "Content-Type: application/json" \\\n  -d '${ep.exampleBody}'`;
  }
  return `curl "${buildUrl(ep.path, ep.exampleParams)}"`;
}

function buildPython(ep: Endpoint): string {
  const url = buildUrl(ep.path, ep.exampleParams);
  if (ep.method === "POST" && ep.exampleBody) {
    return `import requests\nimport json\n\npayload = json.loads('${ep.exampleBody}')\nresponse = requests.post("${url}", json=payload)\ndata = response.json()\nprint(data)`;
  }
  return `import requests\n\nresponse = requests.get("${url}")\ndata = response.json()\nprint(data)`;
}

function buildR(ep: Endpoint): string {
  const url = buildUrl(ep.path, ep.exampleParams);
  if (ep.method === "POST" && ep.exampleBody) {
    const escaped = ep.exampleBody.replace(/"/g, '\\"');
    return `library(httr2)\nlibrary(jsonlite)\n\npayload <- fromJSON("${escaped}")\nresp <- request("${url}") |>\n  req_method("POST") |>\n  req_body_json(payload) |>\n  req_perform()\n\ndata <- resp_body_json(resp)\nstr(data)`;
  }
  return `library(httr2)\nlibrary(jsonlite)\n\nresp <- request("${url}") |>\n  req_perform()\n\ndata <- resp_body_json(resp)\nstr(data)`;
}


export default function ApiDocsPage() {
  return (
    <>
      <SearchBar />
      <Flex
        gap="4"
        py={{ initial: "4", md: "4" }}
        px={{ initial: "4", md: "0" }}
        ml={{ initial: "0", md: "13rem" }}
        mr={{ initial: "0", md: "16rem" }}
        direction="column"
      >
        <Text size={{ initial: "6", md: "8" }} weight="bold">
          API Reference
        </Text>
        <Text size={{ initial: "2", md: "3" }} style={{ color: "var(--gray-11)" }}>
          The seqout API provides programmatic access to over 1 million GEO, SRA,
          ENA &amp; ArrayExpress projects. All endpoints are free, require no
          authentication, and return JSON unless noted otherwise.
        </Text>

        <Callout.Root>
          <Callout.Text size={{ initial: "2", md: "3" }}>
            Base URL: <Code size="2">{BASE}</Code>
            {" "}&mdash; Interactive Swagger docs at{" "}
            <Link href={`${BASE}/docs`} target="_blank">{BASE}/docs</Link>
            {" "}&mdash; For LLM integration see the{" "}
            <Link href="/mcp">MCP Server</Link>
          </Callout.Text>
        </Callout.Root>

        <Flex gap="2" wrap="wrap">
          {API.map((cat) => (
            <Badge key={cat.id} size="2" variant="soft" asChild style={{ cursor: "pointer" }}>
              <a href={`#${cat.id}`}>{cat.title}</a>
            </Badge>
          ))}
        </Flex>

        {API.map((cat) => (
          <Flex key={cat.id} direction="column" gap="3" id={cat.id}>
            <Text size={{ initial: "4", md: "6" }} weight="medium">
              {cat.title}
            </Text>
            {cat.endpoints.map((ep) => (
              <EndpointCard
                key={`${ep.method}-${ep.path}`}
                ep={{
                  method: ep.method,
                  path: ep.path,
                  summary: ep.summary,
                  description: ep.description,
                  params: ep.params,
                  responseHint: ep.responseHint,
                  curl: buildCurl(ep),
                  python: buildPython(ep),
                  r: buildR(ep),
                  tryUrl: ep.method === "GET" ? buildUrl(ep.path, ep.exampleParams) : undefined,
                }}
              />
            ))}
          </Flex>
        ))}

        <Flex direction="column" gap="2" id="rate-limits" pt="2">
          <Text size={{ initial: "4", md: "6" }} weight="medium">
            Rate Limits
          </Text>
          <Text size="2" style={{ color: "var(--gray-11)" }}>
            Most endpoints allow 60 requests/minute per IP. Search endpoints allow
            30 requests/minute. Bulk and download endpoints allow 10 requests/minute.
            Responses include standard rate limit headers.
          </Text>
        </Flex>

        <Flex direction="column" gap="2" id="pagination" pt="2">
          <Text size={{ initial: "4", md: "6" }} weight="medium">
            Pagination
          </Text>
          <Text size="2" style={{ color: "var(--gray-11)" }}>
            Search endpoints use cursor-based pagination. Each response includes a{" "}
            <Code size="1">next_cursor</Code> object. Pass its fields as query
            parameters to fetch the next page. When <Code size="1">next_cursor</Code>{" "}
            is null, there are no more results.
          </Text>
          <CodeBlock code={`# First page\ncurl "${BASE}/search?q=CRISPR"\n\n# Next page (use next_cursor from response)\ncurl "${BASE}/search?q=CRISPR&cursor_rank=0.12&cursor_acc=GSE123456"`} />
        </Flex>
      </Flex>
    </>
  );
}
