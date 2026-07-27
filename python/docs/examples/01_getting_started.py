# %% [markdown]
# # Getting started
#
# `seqout` gets sequencing dataset metadata from seqout.org. This notebook
# covers the first steps: connect, search, and open a project.

# %%
from seqout import SearchParams, connect_to_seqout

sq = connect_to_seqout(backend="api")

# %% [markdown]
# ## Search
#
# Put the query and any filters in a `SearchParams` object.

# %%
results = sq.search(SearchParams(q="pancreatic cancer single cell", db="geo"))
for r in results[:5]:
    print(r.accession, "-", r.title)

# %% [markdown]
# ## Project metadata

# %%
meta = sq.fetch_project_metadata("GSE169470")
print(meta.title)
print("organisms:", meta.organisms, "| pmid:", meta.pmid)

# %% [markdown]
# ## Experiments and runs
#
# Call these on a study accession. `full=True` returns every run instead of the
# preview page.

# %%
experiments = sq.fetch_study_experiments("SRP311850")
runs = sq.fetch_study_runs("SRP311850", full=True)
print(len(experiments), "experiments,", len(runs), "runs")

# %% [markdown]
# A run can offer the data in several formats — FASTQ, SRA, and the NCBI cloud
# mirrors (NCBI, S3, GCS). Not every format is present for every run. Print the
# ones this run has:

# %%
run = runs[0]
print(run.run_accession)
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
