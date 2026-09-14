---
description: "Programmatic data access, filtered search, matrix parsing, and file downloading using the seqout Python library."
---

# Python Library

`seqout` searches metadata, retrieves study designs, parses expression matrices, and downloads raw or processed files.

## Connect to a backend

The `connect()` function initializes a client connection. Specify the target backend using the `backend` argument:

```python
from seqout import connect

# Connect to the REST API backend (default)
sq = connect()

# Connect to the Parquet backend using DuckDB
pq = connect(backend="parquet")
```

The returned client behaves as a context manager. Use a `with` block to ensure that resources are released when the block exits:

```python
from seqout import connect

with connect() as sq:
    results = sq.search("lung cancer", db="geo")
```

> [!NOTE]
> `connect_to_seqout` is an alias for `connect`. Both names perform the same initialization.

## Retrieve study datasets

To load study metadata, call `get()` and pass an accession ID from any supported archive (such as a study, experiment, sample, run, or BioSample). 

The client automatically maps the target accession to related records across archives and returns a `Dataset` object:

```python
with connect() as sq:
    dataset = sq.get("GSE168652")

    dataset.meta          # Study-level metadata
    dataset.samples       # Per-sample metadata records
    dataset.experiments   # Library preparation metadata
    dataset.runs          # Sequencing run details and URLs
    dataset.pubs          # Associated publication records
    dataset.links         # Resolved accession mappings in other archives
    dataset.enriched      # Harmonized cell-level and sample-level metadata
```

`Dataset` fields load on first access and cache their results.

You can inspect the mapped parent accessions and archive types directly:

```python
dataset.kind      # Accession classification (e.g., series, study, sample, run)
dataset.project   # Mapped study or series accession
dataset.sra       # Parent SRA study accession
dataset.geo       # Parent GEO series accession
```

If you query a run, sample, or experiment accession, the `detail` field contains the specific record attributes:

```python
# Query detailed run metadata
run_detail = sq.get("SRR13927092").detail

# Query detailed sample metadata
sample_detail = sq.get("GSM5155196").detail
```

### Accession prefixes mapping

The library resolves accessions from GEO, SRA, ENA, DDBJ, ArrayExpress, GEA, and GSA:

| Query Accession | Accession Type | Resolved Study Accession |
|---|---|---|
| `GSE168652`, `GSM5155196` | GEO Series, GEO Sample | Mapped GEO Series |
| `SRP310139`, `SRX10306523`, `SRS8447424`, `SRR13927092` | SRA Study, Experiment, Sample, Run | Mapped SRA Study |
| `PRJNA1458007`, `SAMEA7015536` | ENA Study, BioSample | Mapped ENA Study |
| `DRP016022`, `DRX817961`, `DRR839815` | DDBJ Study, Experiment, Run | Mapped DDBJ Study |
| `CRA002740`, `CRX117570`, `CRR143507`, `HRA000925` | GSA Study, Experiment, Run, BioSample | Mapped GSA Study |
| `E-MTAB-16863`, `E-GEAD-657` | ArrayExpress/GEA Series | The Series itself |

Because microarrays do not contain sequencing runs, accessing `runs` on a microarray dataset returns an empty container.

### Unmapped accessions

If you query an accession that has no parent records in the archive index, the `project` property raises a `SeqoutError`:

```python
sq.get("SAMD01591578").project
# SeqoutError: could not find the study that SAMD01591578 (a biosample) belongs to.
```

If you query an invalid or unrecognized accession format, `get()` raises an error immediately without making an API request.

## Search for studies

To search for studies, call `search()` and pass a text query along with metadata filters:

```python
with connect() as sq:
    results = sq.search("lung cancer", db="geo", organism="Homo sapiens")
    for r in results:
        print(r.accession, r.title, r.citation_count)
```

Alternatively, you can pass a `SearchParams` object to construct queries dynamically:

```python
from seqout import SearchParams

params = SearchParams(q="lung cancer", db="geo", organism="Homo sapiens")
results = sq.search(params)
```

The `search()` function automatically pages through results and returns all matches. To limit the number of records retrieved, specify the `limit` argument:

```python
# Retrieve all matches
results_all = sq.search("lung cancer", db="geo")

# Retrieve a maximum of 25 matches
results_limited = sq.search("lung cancer", db="geo", limit=25)
```

### Search filters

You can combine any of the following keyword arguments to filter search results:

*   `db` or `source`: Limits the search to a specific archive (e.g., `geo`, `sra`).
*   `organism`: Filters by scientific name (e.g., `Homo sapiens`).
*   `library_strategy`, `library_source`, `platform`, `instrument_model`: Filters by experimental parameters.
*   `assay_l1`, `assay_l2`: Filters by high-level assay category and specific protocol.
*   `country`, `geo_country`, `geo_city`, `geo_state`, `geo_lat`, `geo_lng`, `geo_radius_km`: Filters by geographic origin.
*   `journal`: Filters by publishing journal.
*   `multi_platform`: If `True`, returns studies that used multiple platforms.
*   `date_from`, `date_to`: Filters by database update dates.
*   `published_after`, `published_before`: Filters by study release dates.
*   `pub_date_after`, `pub_date_before`: Filters by paper publication dates.
*   `sample_tissue`, `sample_disease`, `sample_cell_type`: Filters for studies containing matching samples.

> [!WARNING]
> You cannot combine the `library_source` filter with `assay_l1`, `assay_l2`, or any `geo_*` filters because the underlying indexes are incompatible.

### Structured searches

To run exact queries using boolean logic, supply a query string containing uppercase operators (`AND`, `OR`, `NOT`), grouping parentheses `()`, or wildcard prefixes `*`:

```python
results = sq.search('("aging" OR "aged") (gut OR colon) immun*')
```

Structured searches match terms exactly with no synonym expansion or spelling correction. 

To run an exact match query without using boolean operators, set `structured=True`:

```python
# Standard search with synonym expansion
sq.search("liver cancer")

# Exact term search
sq.search("liver cancer", structured=True)
```

### Term expansion

Every query expands before it runs: the server adds each term's synonyms from eight ontologies (`MONDO`, `MeSH`, `HGNC`, `CHEBI`, `UBERON`, `CL`, `EFO`, `CVCL`), so a search for `masld` also finds `nafld`.

```python
# The words as typed; same request as structured=True
sq.search("spinal muscular atrophy", expand=False)

# Expansion on, but without these two sources
sq.search("spinal muscular atrophy", exclude_ontology=["MeSH", "CVCL"])
```

A term known to two ontologies stays available while either ontology is enabled. An unknown ontology name is refused before the request. `search/structured` filters (`assay_l1`, `geo_*`, ...) never expand, and naming an ontology with them is an error.

### Case-sensitive search

Search ignores case, so `"LINE"` also finds every "cell line". Set `case_sensitive=True` to keep only the studies whose title or summary has each query word as a whole word, in the case you typed:

```python
sq.search("LINE", case_sensitive=True)
```

The words still follow the query's `OR`, `AND` and `NOT`, and a trailing `*` still matches a prefix. Spelling correction is off. `search/structured` filters (`assay_l1`, `geo_*`, ...) have no case-sensitive match, and combining them with `case_sensitive` is an error.

### Sort search results

To sort results, specify `sortby` (`"citations"`, `"journal"`, or `"year"`) and `order` (`"desc"` or `"asc"`):

```python
results = sq.search("hepatocellular carcinoma", sortby="citations", order="desc")
```

## Explore ontology mappings

The search engine uses an ontology graph to resolve synonyms (e.g., mapping `"masld"` to `"nonalcoholic fatty liver disease"`). To inspect mapped terms, synonyms, and identifiers, call `ontology()`:

```python
with connect() as sq:
    term = sq.ontology("liver")

    print(term.xrefs)          # Mapped ontology CURIEs (e.g., UBERON:0002107)
    print(term.sources)        # Source ontologies (e.g., UBERON, MeSH)
    print(term.synonyms)       # Synonym terms matched by the search
    print(term.children)       # Child terms in the ontology hierarchy
```

If a term is not present in the ontology graph, the function returns `None`.

The `max_hops` argument (values 1 to 4, default 2) bounds the synonym search depth. To skip child node lookups and speed up queries, set `children=False`:

```python
sq.ontology("breast cancer", children=False)
```

### Map a metadata column to ontology identifiers

Metadata tables hold free text: `"T cell"`, `"hepatocyte"`, `"HeLa"`. `map_to_ontology()` looks each label up in that same graph and puts the CURIEs beside it, as `<column>_ontology_id`:

```python
meta = pd.DataFrame({"celltype": ["T cell", "hepatocyte", "HeLa"]})

sq.map_to_ontology(meta, "celltype")
#      celltype         celltype_ontology_id
# 0      T cell      CL:0000084,MeSH:D013601
# 1  hepatocyte      CL:0000182,MeSH:D022781
# 2        HeLa        CVCL_0030,EFO:0001185

# Cell Ontology identifiers alone, and several columns at once
sq.map_to_ontology(meta, ["celltype", "tissue"], ontology="CL")

# Let a label with no identifier of its own borrow from a synonym
sq.map_to_ontology(meta, "celltype", use_synonyms=True)
```

Unknown labels and empty cells become NA. Labels use their own identifiers by default. `use_synonyms=True` fills missing identifiers from synonyms within `max_hops` (default 1). Synonym links can join narrower concepts, such as `"t cell"` and `"immature t cell"`. Each distinct label requires one request.

## Find publications and authors

Use these helper methods to query publications, authors, and metadata classes:

```python
with connect() as sq:
    # Resolve datasets linked to a PMID
    pub_datasets = sq.paper(pmid="34764296")

    # Resolve datasets linked to an author
    author_datasets = sq.author("Aviv Regev")

    # Check accession classification
    classification = sq.classify("GSE168652")

    # Retrieve short summaries for multiple projects
    summaries = sq.summaries(["GSE168652", "GSE100379"])
```

## Construct sample cohorts

To compile a cohort of individual samples across all studies, use `sample_search()`. You must supply at least one filter argument.

```python
with connect() as sq:
    cohort = sq.sample_search(
        organism="Homo sapiens", sex="female", tissue="liver", age_min_years=50
    )
    print(f"Matches found: {cohort.total}")
```

You can pass CURIEs to filter by ontology terms. The search automatically includes samples mapped to descendant subtypes unless you set `include_descendants=False`:

```python
sq.sample_search(disease_ontology_id="MONDO:0005061", include_descendants=False)
```

Specify the `microbe` argument to filter for samples containing specific read-derived microbial sequences:

```python
# Find cervix samples containing HPV sequences
hpv_samples = sq.sample_search(tissue="cervix", microbe="HPV")
```

### A worked cohort: HPV16 in single-cell cervical cancer

Add filters one at a time and read `total` to see how each narrows the cohort:

```python
with connect() as sq:
    # Cervical cancer and its subtypes, by ontology term
    sq.sample_search(disease_ontology_id="MONDO:0002974", limit=1).total

    # ...that were sequenced as single cell
    sq.sample_search(
        disease_ontology_id="MONDO:0002974", single_cell_only=True, limit=1
    ).total

    # ...and whose reads carry HPV16, as called by the Pentimento screen
    cohort = sq.sample_search(
        disease_ontology_id="MONDO:0002974",
        single_cell_only=True,
        hpv_type="HPV16",
    )
    for s in cohort:
        print(s.sample, s.study_accession, s.cells, s.hpv_top_type)
```

`hpv_type` selects one strain. `microbe="HPV"` includes all strains and attaches
detections, including k-mer mass, breadth, and source run, to each row:

```python
cohort = sq.sample_search(
    disease_ontology_id="MONDO:0002974", single_cell_only=True, microbe="HPV"
)
for s in cohort:
    print(s.sample, [(d["organism"], d["breadth_frac"]) for d in s.microbes])
```

Age filters exclude samples without recorded ages. Check age coverage before filtering:

```python
with connect() as sq:
    # age_min_years=0 means "has a recorded age at all"
    sq.sample_search(
        disease_ontology_id="MONDO:0002974",
        single_cell_only=True,
        age_min_years=0,
        limit=1,
    ).total
```

Ages come back harmonised as `age_days`; `age` is the submitter's own string,
in whatever unit they used.

### The distribution of HPV types across cervical cancer

Drop `single_cell_only`, keep `microbe="HPV"`, and count the detections. A
sample can carry more than one strain, so the counts sum to more than the
cohort:

```python
from collections import Counter

with connect() as sq:
    cohort = sq.sample_search(disease_ontology_id="MONDO:0002974", microbe="HPV")

any_hit = Counter(d["organism"] for s in cohort for d in s.microbes)
gated = Counter(
    d["organism"]
    for s in cohort
    for d in s.microbes
    if d["is_viral_evidence"]
)

any_hit.most_common()
gated.most_common()  # only the ones that pass the screen's viral gate
```

Both counts on one axis show how much of the tail is trace signal:

```python
import pandas as pd

dist = pd.DataFrame({"any detection": any_hit, "passes the gate": gated}).fillna(0)
dist.sort_values("any detection").plot.barh()  # needs matplotlib
```

A detection is a k-mer hit against the reference, down to a few unitigs
against a mostly uncovered genome, which is why the two tables differ.
`is_viral_evidence` is the screen's gate; `breadth_frac` and `kmer_mass` are the
inputs for custom thresholds.

`hpv_top_type` covers samples processed by the Pentimento single-cell pass.
`microbes` holds strain detections beyond that coverage.

The denominator includes only screened samples with detections, so these counts cannot estimate HPV prevalence.

From here, `sq.get(s.study_accession)` opens the study behind any row, and
`SeqoutListCounts` reads its matrices.

## Query read-derived quality metrics

To query quality metrics generated by screening raw sequencing reads, use `single_cell()` and `microbes()`:

```python
with connect() as sq:
    # Query single-cell metrics for a study
    sc_metrics = sq.single_cell("GSE168652")
    for sample in sc_metrics:
        print(sample.sample_accession, sample.cells, sample.sex_verdict)
```

To list all microbial detections (including those below reporting thresholds), call `microbes()`:

```python
with connect() as sq:
    detections = sq.microbes("GSM5155196", kind="viral")
    for d in detections:
        print(d.organism, d.n_unitigs, d.max_breadth_frac)
```

## Read counts matrices

Use `SeqoutListCounts` to resolve, download, and parse processed supplementary files into matrices. This feature requires the `counts` installation extra.

Query the file manifest without downloading files:

```python
from seqout import SeqoutListCounts

counts = SeqoutListCounts("GSE297547")
manifest = counts.manifest()
```

To download and parse a specific sample unit into an `AnnData` object, call `matrix()`:

```python
# Parse a specific sample matrix (cells by genes)
adata_sample = counts.matrix(sample="GSM8994520")

# Download and concatenate all preferred matrices in the study
adata_cohort = counts.anndata()
```

The study's sample-level covariates are available as `design`, indexed by accession. Reading it costs no extra request, and the same values are broadcast onto `obs`:

```python
counts.design
```

### Filter samples within a study

To filter samples in a study using harmonized metadata before loading them, call `samples()`:

```python
# Identify liver samples with at least 1000 cells
liver_samples = counts.samples(tissue="liver", min_cell_count=1000)

# Load the first matching sample matrix
adata_liver = counts.matrix(sample=liver_samples["unit"].iloc[0])
```

### Concatenate sample matrices

To merge multiple matrices on shared genes, use `bind_counts()`. You can cap the cells kept per matrix using `max_cells` and specify a random `seed` for reproducibility:

```python
from seqout import bind_counts

merged_adata = bind_counts(counts.matrices(), max_cells=1200, seed=0)
```

### Bulk studies

Bulk series work the same way. Per-sample count files read as one observation each, so
`anndata()` returns samples by genes with the study's sample characteristics in `obs`:

```python
counts = SeqoutListCounts("GSE135251")   # 216 bulk liver samples, htseq-count output
adata = counts.anndata()                 # (216, 64253)
adata.obs[["group in paper", "fibrosis stage", "nas score"]].head()
```

`counts.design` returns the same characteristics as a DataFrame, one row per sample,
without reading a matrix. That is the design table a differential-expression model needs:

```python
from pydeseq2.dds import DeseqDataSet
from pydeseq2.ds import DeseqStats

adata.obs["condition"] = adata.obs["group in paper"].astype(str)
sub = adata[adata.obs["condition"].isin(["control", "NASH_F4"])].copy()
sub = sub[:, sub.X.sum(axis=0) >= 10].copy()   # DESeq2's usual pre-filter

dds = DeseqDataSet(adata=sub, design="~condition")
dds.deseq2()
res = DeseqStats(dds, contrast=["condition", "NASH_F4", "control"])
res.summary()
```

htseq and STAR summary rows (`__no_feature`, `N_unmapped`, and the rest) are dropped
while reading, so they never reach the library-size estimate.

### Annotate cell clusters

Use `quick_annotation()` to assign cluster labels based on a dictionary of cell-type marker genes:

```python
from seqout import quick_annotation

markers = {
    "neuron": ["NEUROD2", "TBR1"], 
    "microglia": ["CX3CR1", "C1QA"]
}

# Generate cluster predictions
labels = quick_annotation(adata, adata.obs["leiden"], markers)

# Apply predictions to the AnnData object
adata.obs["celltype"] = labels[adata.obs["leiden"].astype(str)].to_numpy()
```

The raw scores are stored in `labels.attrs["scores"]`.

## Download supplementary and alignment files

To download processed study files, inspect the list and call `download_project_supplementary_data()`:

```python
with connect() as sq:
    dataset = sq.get("GSE168652")
    files_list = dataset.supplementary

    # Download supplementary files to disk
    sq.download_project_supplementary_data(dataset.meta, Path("downloads/"))
```

To list and download submitted BAM alignment files, query the `bams` property and call `download_bams()`:

```python
with connect() as sq:
    bams = sq.get("ERP117016").bams
    print(f"Openly readable files: {len(bams.openly_readable)}")

    # Download openly readable BAMs and output commands for requester-pays files
    sq.download_bams("ERP117016", Path("bams/"))
```

## Lower-level API methods

The `Dataset` class wraps lower-level API methods. You can call these methods directly if you need to query specific endpoints:

```python
with connect() as sq:
    meta = sq.fetch_project_metadata("GSE12345")
    samples = sq.fetch_samples("GSE12345")
    experiments = sq.fetch_study_experiments("SRP123456")
    runs = sq.fetch_study_runs("SRP123456", full=True)
    exp_runs = sq.fetch_experiment_runs("SRX10306523")
    study_id = sq.resolve_study("SRR13711483")
```

## Work with the Parquet backend

The Parquet backend shares the same method names and model definitions as the REST API backend. You can switch to Parquet mode without changing your data manipulation code:

```python
from seqout import connect

with connect(backend="parquet") as pq:
    pq.set_source("https://seqout.org/data")
    dataset = pq.get("GSE169470")
    runs = dataset.runs
```

For Parquet backend limitations and configuration details, see [Parquet Backend](parquet.md).

## Output formats and containers

API methods return Pydantic models. Lists of records are wrapped in a `BaseContainer` object, which provides methods for data conversion:

```python
runs = sq.fetch_study_runs("SRP123456", full=True)

# Convert to a list of Python dictionaries
runs_dict = runs.to_dict()

# Convert to a pandas DataFrame
runs_df = runs.to_df()

# Export directly to a CSV file
runs.to_csv("runs.csv")
```

## Direct imports

The client classes can also be imported directly:

```python
from seqout.clients.api import SeqoutAPIClient
from seqout.clients.parquet import SeqoutParquetClient
```
