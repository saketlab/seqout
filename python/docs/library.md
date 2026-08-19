---
description: Dataset access by accession, filtered search, and downloads of reads and supplementary files from Python.
---

# Python library

You can use `seqout` in your own Python code. The library does the same tasks
as the command-line tool.

## Connect to a backend

The `connect` function returns a client. Choose the backend with the `backend`
argument:

```python
from seqout import connect

sq = connect()                    # the web API (default)
pq = connect(backend="parquet")   # Parquet data with DuckDB
```

The client is a context manager. Use a `with` block to close it correctly:

```python
from seqout import connect

with connect() as sq:
    results = sq.search("lung cancer", db="geo")
```

!!! note
    `connect_to_seqout` is the same function with a longer name. Both work.

## Get a dataset

`get` accepts any accession from any archive seqout holds: a series, a study,
an experiment, a sample, a run, or a BioSample. The `Dataset` finds the related
records for you:

```python
with connect() as sq:
    d = sq.get("GSE168652")

    d.meta          # project metadata
    d.samples       # the per-sample records
    d.experiments   # the library preparations
    d.runs          # every run
    d.pubs          # publications
    d.links         # the same data in other archives
    d.enriched      # LLM-enriched sample metadata
```

Each field makes its request at the first use and keeps the result, so reading
one twice costs a single request. Where a field lives in a different archive
than the accession you gave, the link is followed for you: `d.runs` above reads
`SRP310139`, the SRA study the series links to. An SRA study that lists no
samples reads them from the linked GEO series in the same way.

The archive accessions stay available:

```python
d.kind      # series, study, experiment, sample, run, biosample, or submission
d.project   # the study or series this accession belongs to
d.sra       # the study that holds the runs
d.geo       # the series that holds the supplementary files
```

For a run, a sample, or an experiment accession, `detail` gives the record
itself:

```python
sq.get("SRR13927092").detail    # the run
sq.get("GSM5155196").detail     # the sample
sq.get("GSM5155196").project    # -> "GSE168652"
```

### Accessions across the archives

seqout holds records from GEO, SRA, ENA, DDBJ, ArrayExpress, GEA, and GSA. Each
uses its own accession prefixes. `get` accepts any of them and resolves the
study or series they belong to:

| you have | `kind` | `project` |
|---|---|---|
| `GSE168652`, `GSM5155196` | series, sample | `GSE168652` |
| `SRP310139`, `SRX10306523`, `SRS8447424`, `SRR13927092` | study, experiment, sample, run | the SRA study |
| `PRJNA1458007`, `SAMEA7015536` | study, biosample | the ENA study |
| `DRP016022`, `DRX817961`, `DRR839815` | study, experiment, run | the DDBJ study |
| `CRA002740`, `CRX117570`, `CRR143507`, `HRA000925` | study, experiment, run | the GSA study |
| `E-MTAB-16863`, `E-GEAD-657` | series | itself |

A series holds no sequencing runs of its own; they belong to a study in a
sequence archive. `runs` follows that link. GEO and ArrayExpress record it as a
cross-reference. GEA records no cross-reference, and names the data as a
BioProject in the project record, so that is used when no cross-reference
exists.

`runs` is empty when the dataset has none. A microarray submission such as
`E-TABM-937` has 724 samples and no sequencing data.

### When it cannot work

Some accessions have no path back to their study: the archive serves no parent
and the accession is not in the search index. `project`, and anything that needs
it, raises `SeqoutError` saying so:

```python
sq.get("SAMD01591578").project
# SeqoutError: could not find the study that SAMD01591578 (a biosample)
# belongs to. Nothing links it back: the archive serves no parent for this
# accession and it is not in the search index. Start from the study or series
# accession instead, or call sq.search('SAMD01591578') to look for it.
```

An accession the library does not recognize fails at `get`, before any request.

## Search

`search` accepts a query string with keyword filters:

```python
with connect() as sq:
    results = sq.search("lung cancer", db="geo", organism="Homo sapiens")
    for r in results:
        print(r.accession, r.title, r.citation_count)
```

A `SearchParams` object does the same and is easier to build in steps:

```python
from seqout import SearchParams

params = SearchParams(q="lung cancer", db="geo", organism="Homo sapiens")
results = sq.search(params)
```

`search` returns every match, not the first page. The server answers 200 rows
at a time and the client follows the cursor to the end, so a broad query costs
several requests. Give `limit` when a sample of the results is enough:

```python
with connect() as sq:
    everything = sq.search("lung cancer", db="geo")   # every match
    a_taste = sq.search("lung cancer", db="geo", limit=25)
```

### The filters

Every filter works with a query and without one, and the filters combine.

| Filter | What it selects |
| --- | --- |
| `db`, `source` | one archive |
| `organism` | the organism of the study |
| `library_strategy`, `library_source`, `platform`, `instrument_model` | how the library was made and read |
| `assay_l1`, `assay_l2` | the assay class and the method |
| `country`, `geo_country`, `geo_city`, `geo_state`, `geo_lat`, `geo_lng`, `geo_radius_km` | where the study comes from |
| `journal` | the journal of the linked paper |
| `multi_platform` | studies that used two or more platforms |
| `date_from`, `date_to` | when the record last changed |
| `published_after`, `published_before` | when the study was released |
| `pub_date_after`, `pub_date_before` | when the linked paper was published |
| `sample_tissue`, `sample_disease`, `sample_cell_type` | studies with a matching sample |

Two endpoints answer a search and they take different filters, but you do not
have to know which is which: the filters choose. A name that is not a filter is
refused rather than ignored, so a typo cannot return an unfiltered search that
looks filtered.

```python
sq.search("liver", organsim="Homo sapiens")
# ValidationError: organsim - Extra inputs are not permitted
```

There is one exception to combining freely. `library_source` cannot be used
together with `assay_l1`, `assay_l2` or a `geo_*` filter, because no search
answers both.

`year_from`, `year_to` and `center` are gone. The two year bounds meant the
publication year on one endpoint and the last-updated year on the other, so use
`date_from`/`date_to` for the record's date and `published_after`/
`published_before` for the study's release date. `center` was ignored by the
full-text search; every result row carries `center_name`, so filter on that.

### Structured search

A query can be a boolean expression rather than a bag of words. Group terms
with `()`, quote a phrase with `""`, end a term with `*` to match its prefix,
and join them with an uppercase `OR`, `AND` or `NOT`.

```python
sq.search('("aging" OR "aged") (gut OR colon) immun*')
```

Adjacent terms are joined with an implicit `AND`. A structured search takes
your terms exactly: the ordinary search expands a query through the ontology
graph and corrects a likely typo, and this one does neither.

The operators are what selects this reading, so you do not have to ask for it,
and only uppercase counts — `"colon or gut"` is prose. Pass `structured=True`
to force the exact reading on a query with no operators of its own.

```python
sq.search("liver cancer")                     # expanded and corrected
sq.search("liver cancer", structured=True)    # exactly these terms
```

Only the full-text search reads operators, so a boolean query combined with
`assay_l1`, `assay_l2` or a `geo_*` filter is refused rather than silently read
as words.

### Sorting and paging

`sortby` takes `"citations"`, `"journal"` or `"year"`, and `order` takes
`"desc"` (the default) or `"asc"`. Both work with every filter.

```python
sq.search("hepatocellular carcinoma", sortby="citations")
```

`search` is the only search function, and it always answers in full. Use
`limit` to stop early:

```python
top = sq.search("liver", assay_l2="ATAC-seq", sortby="citations", limit=50)
```

Some combinations are finished off in Python rather than by the server: a day
bound or a sort asked for alongside `assay_l1`, `assay_l2` or a `geo_*` filter,
because the endpoint those filters select has neither parameter. Those calls
read every page before they answer, since a row that moves in Python has to
move before a limit counts.

## The ontology behind a search

A plain keyword search does not match words, it matches concepts: a query for
`masld` also finds studies that say `nonalcoholic fatty liver disease`, because
an ontology graph joins the two. `ontology` looks one term up in that graph and
reports what it knows.

```python
with connect() as sq:
    term = sq.ontology("liver")

term.xrefs           # ['UBERON:0002107', 'MeSH:D008099'] -- the source IDs
term.sources         # ['MeSH', 'UBERON'] -- the ontologies they come from
term.synonyms        # what a search for "liver" also matches
term.synonym_total   # how many there are, which can exceed len(synonyms)
term.children        # the terms below it: 'caudate lobe of liver', ...
```

Each synonym and each child carries its own `xrefs`, and a child says whether
it can expand further:

```python
for child in term.children:
    print(child.name, child.xrefs, "▸" if child.has_children else "")
```

A term the graph does not have answers `None`, not an error, so a loop over
many words does not stop at the first one it misses.

```python
known = [t for t in map(sq.ontology, words) if t is not None]
```

`max_hops` (1 to 4, default 2) bounds the walk over the synonym links only.
Children are always the direct children of the resulting synonym cluster, at
any `max_hops`. Pass `children=False` to skip the children query, which is much
cheaper when the identifiers are all you want.

```python
sq.ontology("breast cancer", max_hops=1, children=False)
```

The server caps synonyms at 500 and children at 300. `synonym_total` gives the
true synonym count, and `children_truncated` says whether the children hit
their cap.

It reads the REST API and says so on a Parquet client: the ontology graph is a
separate database and is not in the dump.

## Find publications and authors

```python
with connect() as sq:
    pub = sq.paper(pmid="34764296")               # a publication -> its projects
    authored = sq.author("Aviv Regev")            # an author -> their datasets
    kind = sq.classify("GSE168652")               # what an accession is
    rows = sq.summaries(["GSE168652", "GSE100379"])  # many projects, one request
```

## Sample cohorts

`sample_search` searches the samples of every study using harmonised data.

At least one filter is required; an unfiltered call would return the whole
corpus.

```python
with connect() as sq:
    liver = sq.sample_search(
        organism="Homo sapiens", sex="female", tissue="liver", age_min_years=50
    )

    len(liver)      # what came back
    liver.total     # how many match, before limit
    liver.filters   # what the server understood
```

The filters fall into four groups. The first three read the harmonised data;
the fourth reads the reads.

| Group | Filters |
| --- | --- |
| Harmonised field | `organism`, `tissue`, `disease`, `cell_type`, `assay`, `sex`, `strain`, `treatment`, and the other sample fields |
| Harmonised ontology ID | `disease_ontology_id`, `tissue_ontology_id`, `cell_type_ontology_id`, `assay_ontology_id`, `development_stage_ontology_id` |
| Range | `age_min_years`, `age_max_years`, `min_cell_count`, `max_cell_count`, `min_gene_count`, `max_gene_count` |
| Read-derived | `single_cell_only`, `has_viral_reads`, `has_bacterial_reads`, `hpv_type`, `microbe`, `microbe_class`, `microbe_min_breadth`, `microbe_min_kmer_mass`, `microbe_validated_only` |

An age filter excludes a sample whose age was never recorded, so
`age_min_years=0` means "has a recorded age". A name that is not a filter is
refused, with a suggestion when it is close to a real one.

Give an ontology term as a CURIE. The search expands it through the ontology
graph, so it also matches the subtypes of that term; pass
`include_descendants=False` for the exact term only.

```python
sq.sample_search(disease_ontology_id="MONDO:0005061", limit=200)
```

A `microbe` filter narrows the cohort to samples carrying a matching detection
and attaches the detections to each row, so "cervical single-cell RNA-seq with
HPV quantification" is one call:

```python
hpv = sq.sample_search(
    tissue="cervix", microbe="HPV", sort="cell_count", order="desc", limit=10
)
```

The screening reference names the organisms HPV16, HPV18 and so on, so search
`"HPV"` — `"papillomavirus"` matches nothing.

## What the reads contain

The harmonised fields report what the submitter declared. seqout also screens
the reads themselves, and those calls often disagree.

`single_cell` returns the matrix dimensions and the read-derived calls for each
sample of a study:

```python
with connect() as sq:
    sc = sq.single_cell("GSE168652")

    sc.study.study_cells     # 25642
    sc.n_samples_total       # 2
    [(s.sample_accession, s.cells, s.sex_verdict) for s in sc]
```

`cells` counts matrix columns; for an unfiltered 10x matrix those are barcodes,
so the number is an upper bound and a sum overcounts. `has_viral_reads` and
`has_bacterial_reads` are `None` when the sample was never screened and `False`
when the screen found no gated hit — not the same thing.

`microbes` shows the detections behind those flags, one row per organism. It
returns every detection, not only the ones that pass the gate, so a sample
whose flag is `False` can still list organisms:

```python
m = sq.microbes("GSM5155196", kind="viral")

[(o.organism, o.n_unitigs, o.max_breadth_frac) for o in m]
# [('HPV16', 45, 0.1732), ('HPV35', 1, 0.0052), ('HHV7', 1, 0.0013)]

m.measurable        # False means never screened, which rules nothing out
m.detections        # per-run rows, before the rollup
m.by_kingdom        # summed weight per kingdom
m.control_kingdoms  # held out of the totals: the spike-in and the calibrator
```

The spike-in control and the negative control are never summed into the totals,
and reagent and skin organisms are excluded unless `include_background=True`.

All three read the REST API and say so on a Parquet client: neither the
harmonised sample table nor the Pentimento tables are in the dump.

## Counts matrices

`SeqoutCounts` resolves the supplementary files of a GEO accession and groups
them into units. A unit is the smallest set of files that reads as one matrix:
a 10x `matrix.mtx` with its barcodes and features, or a single `.h5`, `.h5ad`,
`.rds` or table file. Nothing is downloaded until you ask for a matrix, because
a GEO payload can run to tens of gigabytes.

Reading counts needs the `counts` extra: `uv add 'seqout[counts]'`.

```python
from seqout import SeqoutCounts

c = SeqoutCounts("GSE297547")
c.manifest()[["unit", "sample", "format", "preferred", "has_metadata"]]
```

`preferred` marks the unit `matrix()` picks for each sample. `assay` selects
between the modalities of a CITE-seq or multiome sample: `"rna"` is the
default, and `"adt"`, `"hto"` and `"atac"` are recognised.

```python
m = c.matrix(sample="GSM8994520")   # one unit
m.shape                             # cells by genes
a = c.anndata()                     # every preferred unit, concatenated
```

`CountMatrix` holds the matrix in `X`, the cell annotation in `obs` and the
gene annotation in `var`, cells by genes throughout. The R client stores the
transpose, genes by cells, which is what Seurat expects.

### Choose which samples to read

`samples()` filters the study's samples through the harmonised cohort search
and keeps only the ones that ship a readable unit. Use it on a series that
mixes tissues or assays.

```python
liver = c.samples(tissue="liver", min_cell_count=1000)
liver[["sample", "unit", "format", "cells", "tissue"]]

m = c.matrix(sample=liver["unit"].iloc[0])
```

### Bind samples together

`bind_counts` concatenates matrices on the genes they share. `max_cells` caps
the cells kept per matrix, drawn at random; pass `seed` for a reproducible
draw.

```python
from seqout import bind_counts

merged = bind_counts(c.matrices(), max_cells=1200, seed=0)
merged.obs["sample"]
```

`c.anndata()` is the same call over every preferred unit.

### Label clusters by marker set

`quick_annotation` scores each cell as the mean expression of a marker set's
genes, averages that within each cluster, and labels the cluster with its
highest-scoring set.

```python
from seqout import quick_annotation

markers = {"neuron": ["NEUROD2", "TBR1"], "microglia": ["CX3CR1", "C1QA"]}
labels = quick_annotation(adata, adata.obs["leiden"], markers)

adata.obs["celltype"] = labels[adata.obs["leiden"].astype(str)].to_numpy()
```

Scores are unscaled across sets, so a housekeeping-heavy set can out-score a
sparse but specific one. Read `labels.attrs["scores"]` before you trust a
label.

## Supplementary files

`Dataset.supplementary` lists the processed files a submitter uploaded: count
matrices, annotations, archives. Read it before downloading — a GEO series can
run to tens of gigabytes.

```python
with connect() as sq:
    files = sq.get("GSE168652").supplementary

    len(files)          # 3
    files.series        # the ones the series carries itself
    files.per_sample    # the ones belonging to one sample
```

`sample` is `None` on the series' own files and the accession on the rest. A
GEO sample lists only its own, since reading them through the series would ask
for a parent the archive does not always serve and would answer with the whole
series:

```python
sq.get("GSM5155196").supplementary   # 1 file, that sample's
```

GEO writes a literal `"NONE"` for a sample that carries no files, so entries
without a URL are dropped rather than turned into rows that cannot be fetched.
SRA, ENA, DDBJ and GSA studies hold no processed files of their own and answer
empty; their files live in the linked GEO or ArrayExpress record.

To fetch them, `download_project_supplementary_data` takes the project metadata
and a directory.

## Alignment files

`Dataset.bams` lists the BAMs a submitter sent. These are not the reads: they
are aligned to a reference the submitter chose, and often carry work the reads
alone do not reconstruct — barcode tags, methylation calls, long-read
structural evidence.

Read the list before you fetch. A study can run to hundreds of gigabytes, and
most files sit in requester-pays storage that no anonymous client can read.

```python
with connect() as sq:
    bams = sq.get("ERP117016").bams

    bams.total_bams        # 412
    bams.total_bam_bytes   # 1_579_858_598
    bams.openly_readable   # what this client can fetch
    bams.requester_pays    # what needs an account that pays egress
```

`Dataset.bams` and `download_bams` take any accession. A study answers with all
of its alignments; an experiment or a run answers with only its own:

```python
with connect() as sq:
    sq.get("ERP117016").bams    # 412 files
    sq.get("ERR3507860").bams   # the one run's
```

`download_bams` fetches the open ones and names the rest, with the command that
would get them, so a partly-open study still yields what it can:

```python
with connect() as sq:
    paths = sq.download_bams("ERP117016", Path("bams/"))
```

Every row carries an md5, and each file is verified as it lands. A file that
fails is deleted rather than kept, because a corrupt alignment still reads.
Submitters name their own files, so two runs can send the same name; those are
prefixed with the run accession.

It reads the REST API and says so on a Parquet client: the dump has the SRA
side of this but not the ArrayExpress one, so answering there would be silently
partial.

## Cite a dataset

`citations` returns BibTeX for the papers behind a dataset, ready to write to a
`.bib` file. `type="all"` adds the papers that reanalysed the data afterwards.

```python
with connect() as sq:
    print(sq.citations("GSE151530"))
    Path("refs.bib").write_text(sq.citations("GSE168652", type="all"))
```

A dataset with no linked paper answers with an empty string, not an error, so a
loop over many accessions does not stop at the first gap.

It reads the REST API and says so on a Parquet client. The dump has no record
of the reanalysis papers, and only about a third of its publication rows carry
a date, so an entry built from it would be missing its year without saying so.
For the same papers as data rather than text, read `Dataset.pubs`.

## The lower-level methods

`get` calls these. Use them when you want one specific request. Each is tied to
one endpoint, so you have to give it an accession that endpoint accepts:

```python
with connect() as sq:
    meta = sq.fetch_project_metadata("GSE12345")
    samples = sq.fetch_samples("GSE12345")               # GEO, AE, GEA only
    experiments = sq.fetch_study_experiments("SRP123456")
    runs = sq.fetch_study_runs("SRP123456", full=True)   # every run
    exp_runs = sq.fetch_experiment_runs("SRX10306523")   # the runs of one experiment
    study = sq.resolve_study("SRR13711483")              # a run -> its study
```

!!! note
    The `full=True` argument returns every run. Without it, the API returns a
    preview of the first 500 runs. `Dataset.runs` always uses `full=True`.

`resolve_study` asks the endpoint that knows, chosen by what the accession
names: `/run/{acc}` for a run, `/sample-detail/{acc}` for a sample, an
experiment's first run for the rest. Full-text search is the last resort, since
not every accession is indexed. `Dataset.project` wraps it and raises with the
detail when nothing answers.

## Use the Parquet backend

The Parquet backend has the same methods. Set the data source first:

```python
with connect(backend="parquet") as pq:
    pq.set_source("https://seqout.org/data")   # a URL or a local directory
    d = pq.get("GSE169470")
    runs = d.runs
    pub = pq.paper(pmid="22406642")
```

Because both clients share the same method names and the same return models,
you can change the backend without a change to the rest of your code.

!!! warning "Parquet limits"
    The Parquet backend reads the whole data file for a filter. Over a remote
    URL, this is slow for the large tables. A local directory is much faster.
    Also, `author` on Parquet matches GEO authors only, and `links`, `enriched`,
    `classify`, and `summaries` are not available there.

## Return types

The methods return Pydantic models. A list of records is a `BaseContainer`. A
container has helper methods for data work:

```python
runs = sq.fetch_study_runs("SRP123456", full=True)

runs.to_dict()          # a list of dictionaries
runs.to_df()            # a pandas DataFrame
runs.to_csv("runs.csv") # write a CSV file
len(runs)               # the number of records
```

## Import the client classes directly

`connect` is the normal way to get a client. To import a client class directly,
use the full path:

```python
from seqout.clients.api import SeqoutAPIClient
from seqout.clients.parquet import SeqoutParquetClient
```
