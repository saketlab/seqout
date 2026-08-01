# %% [markdown]
# # Getting started
#
# `seqout` reads sequencing dataset metadata from seqout.org, which collects
# records from GEO, SRA, ENA, DDBJ, ArrayExpress, GEA, and GSA into one index.
#
# This notebook covers a full session: connect to the service, search for
# datasets, open one, and read its metadata, samples, and sequencing runs. The
# later notebooks go deeper into accessions and into offline use.

# %%
from seqout import connect

sq = connect()

# %% [markdown]
# The client holds the connection settings — the base URL, the request timeout,
# and the retry policy. It is also a context manager, so a script can use
# `with connect() as sq:` to close it at the end. In a notebook a plain
# assignment is enough.
#
# ## Search
#
# `search` takes the query text. Filters are keyword arguments; `db` limits the
# result to one source.

# %%
results = sq.search("pancreatic cancer single cell", db="geo")

for r in results[:5]:
    print(r.accession, "-", r.title)

# %% [markdown]
# Each result carries the fields the web app shows: the accession, the title,
# the organisms, the centre, and the citation count of the linked paper. The
# result set has methods for the usual summaries.

# %%
print("sources: ", dict(results.sources()))
print("organisms:", dict(results.organisms().most_common(3)))

for r in results.top_cited(3):
    print(f"{r.citation_count:>5} citations  {r.accession}  {r.title[:50]}")

# %% [markdown]
# ### Filters
#
# More than one filter can apply at the same time. The query text becomes
# optional when at least one filter is set, which makes a query-less browse
# possible.

# %%
filtered = sq.search(
    "single cell",
    db="geo",
    organism="Homo sapiens",
    library_strategy=["RNA-Seq"],
    date_from="2021-01-01",
    date_to="2023-12-31",
)
len(filtered)

# %% [markdown]
# A `SearchParams` object holds the same fields. Use it when a set of filters is
# built in steps, or is used for more than one call.

# %%
from seqout import SearchParams

params = SearchParams(
    q="single cell",
    db="geo",
    organism="Homo sapiens",
    library_strategy=["RNA-Seq"],
)
len(sq.search(params))

# %% [markdown]
# ### Reading every page
#
# `search` returns the first page. `iter_search` follows the cursor and yields
# every result. Give it a `limit` unless you intend to read the whole set, which
# can be large.

# %%
import itertools

from seqout.models.api_models import SearchResults

hits = SearchResults(list(itertools.islice(sq.iter_search(params), 100)))
len(hits)

# %% [markdown]
# A result set converts to a pandas DataFrame, or writes to CSV.

# %%
hits.to_df()[["accession", "source", "title", "citation_count"]].head()

# %% [markdown]
# ## Open a dataset
#
# `get` takes an accession and returns a `Dataset`. The accession can name a
# series, a study, an experiment, a sample, or a run; the `Dataset` resolves the
# rest. Each field makes its request when it is first read, and keeps the
# result, so reading a field twice costs one request.

# %%
d = sq.get("GSE169470")

print(d.meta.title)
print("kind:      ", d.kind)
print("project:   ", d.project)
print("organisms: ", d.meta.organisms)
print("updated:   ", d.meta.updated_at)

# %% [markdown]
# ### Samples, experiments, and runs
#
# A GEO series holds the sample records. It does not hold the sequencing runs —
# those belong to a study in a sequence archive, which the series links to.
# `Dataset` follows that link, so the same three fields are read whichever
# accession you started from.

# %%
print(f"{len(d.samples):>4} samples")
print(f"{len(d.experiments):>4} experiments")
print(f"{len(d.runs):>4} runs, from {d.sra}")

# %% [markdown]
# Sample records differ between the archives. A GEO or ArrayExpress sample has
# channels, each with its organism and its characteristics. An SRA-style record
# describes the library preparation instead.

# %%
sample = d.samples[0]
print(sample.accession, "-", sample.title)

channel = sample.channels[0]
print("organism:", [o.text for o in channel.organisms])
for tag, value in list(channel.characteristics.items())[:5]:
    print(f"  {tag}: {value}")

# %% [markdown]
# ### Run files
#
# A run can offer its data in several formats: FASTQ, SRA, and the NCBI cloud
# mirrors on S3 and GCS. Which formats exist depends on the run, so check before
# you rely on one.

# %%
run = d.runs[0]
print(run.run_accession, f"({run.library_layout})")

for fmt, url in {
    "fastq": run.fastq_ftp,
    "sra": run.sra_ftp,
    "ncbi": run.ncbi_sra_url,
    "sra-lite": run.ncbi_sra_lite_url,
    "s3": run.ncbi_sra_lite_s3_url,
    "gcs": run.ncbi_sra_lite_gs_url,
}.items():
    if url:
        print(f"  {fmt:9} {url}")

# %% [markdown]
# ## Publications
#
# `pubs` lists the papers linked to the dataset. A dataset can have more than
# one: the paper that first described it, and later papers that reused the data.

# %%
for p in d.pubs:
    print(f"{p.pmid or p.doi}  {p.title}")
    print(f"   {p.journal}, {p.pub_date} - {p.citation_count} citations")

# %% [markdown]
# ## Enriched sample metadata
#
# seqout.org prepares structured labels for the samples of many projects —
# tissue, disease, cell type, assay, and their ontology terms. The field is
# empty for projects that have not been processed.

# %%
enriched = d.enriched
print(len(enriched), "samples with enriched metadata")
if len(enriched):
    enriched.to_df()[["sample", "tissue", "disease", "assay"]].head()

# %% [markdown]
# ## Downloading files
#
# Two downloaders write to disk. Both run in parallel and take `num_workers` and
# `chunk_size`; read downloads are checked against the reported size and MD5.
# The cells below are not run here, because they write files.
#
# ```python
# from pathlib import Path
#
# # processed files the submitter uploaded
# sq.download_project_supplementary_data(d.meta, Path("GSE169470"))
#
# # sequencing reads; mode is fastq, sra, sra_lite, s3, or gcs
# sq.download_study_runs_data(d.runs, Path("GSE169470/reads"), mode="fastq")
# ```
#
# ## Next
#
# This notebook stayed on the surface of `get`. The
# [working with a dataset](02_working_with_a_dataset.ipynb) notebook goes
# through each of its fields in turn and what you can do with them.
#
# After that, [accessions and archives](03_accessions_and_archives.ipynb) covers
# how an accession from any of the seven sources resolves to its study, and
# [offline with Parquet](04_offline_with_parquet.ipynb) covers reading the same
# data without the API.
