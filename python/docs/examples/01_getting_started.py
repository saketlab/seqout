# %% [markdown]
# # Getting started
#
# `seqout` gets sequencing dataset metadata from seqout.org. This notebook
# covers the first steps: connect, search, and open a dataset.

# %%
from seqout import connect

sq = connect()

# %% [markdown]
# ## Search
#
# Give the query as a string. Filters go in as keyword arguments.

# %%
results = sq.search("pancreatic cancer single cell", db="geo")
for r in results[:5]:
    print(r.accession, "-", r.title)

# %% [markdown]
# ## Open a dataset
#
# `get` accepts any accession — a series, a study, an experiment, a sample, or a
# run. It finds the related records for you, so you do not have to know which
# archive holds which part.

# %%
d = sq.get("GSE169470")

print(d.meta.title)
print("organisms:", d.meta.organisms, "| pmid:", d.meta.pmid)
print("archives: geo =", d.geo, "| sra =", d.sra)

# %% [markdown]
# ## Samples and runs
#
# A GEO series holds no sequencing runs; the linked SRA study does. `runs`
# crosses that link on its own.

# %%
print(len(d.samples), "samples")
print(len(d.runs), "runs from", d.sra)

# %% [markdown]
# Each field makes its request at the first use and keeps the result, so the
# lines above cost one request each, not one for every use.

# %% [markdown]
# ## Run data formats
#
# A run can offer the data in several formats — FASTQ, SRA, and the NCBI cloud
# mirrors (NCBI, S3, GCS). Not every format is present for every run. Print the
# ones this run has:

# %%
run = d.runs[0]
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

# %% [markdown]
# ## Start from any accession
#
# A sample or a run resolves to its parent in the same way.

# %%
sq.get(run.run_accession).project
