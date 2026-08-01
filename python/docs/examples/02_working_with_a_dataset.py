# %% [markdown]
# # Working with a dataset
#
# `get` returns a `Dataset`: a view of one accession and everything seqout knows
# about it. This notebook goes through each field, what it holds, and what you
# can do with it.
#
# The example is GSE114725, a single-cell study of the breast tumour immune
# environment, with 56 samples and 173 sequencing runs.

# %%
import pandas as pd

from seqout import connect

sq = connect()
d = sq.get("GSE114725")
d

# %% [markdown]
# Nothing has been fetched yet. `Dataset` reads a field the first time you ask
# for it and keeps the answer, so a field costs one request however often you
# use it, and a field you never touch costs nothing.
#
# The fields are:
#
# | field | holds |
# |---|---|
# | `meta` | the project record: title, summary, design, dates, supplementary files |
# | `samples` | one record per sample |
# | `experiments` | one record per library preparation |
# | `runs` | one record per sequencing run, with its file URLs |
# | `pubs` | the publications linked to the dataset |
# | `links` | the same data in other archives |
# | `enriched` | structured labels for the samples, where seqout has prepared them |
# | `detail` | the record for the accession itself, when it names a sample or a run |
#
# and four that say where the data sits: `kind`, `project`, `geo`, `sra`.

# %% [markdown]
# ## meta — the project record
#
# `meta` is the study description as the archive holds it.

# %%
m = d.meta

print(m.title)
print()
print(m.summary[:300], "...")
print()
print("design:    ", (m.overall_design or "")[:120])
print("organisms: ", m.organisms)
print("centre:    ", m.center_name, f"({m.country_code})")
print("published: ", m.published_at, "| updated:", m.updated_at)
print("type:      ", m.series_type)
print("single cell:", m.is_single_cell, "-", m.single_cell_modality)

# %% [markdown]
# ### Supplementary files
#
# `supplementary_data` lists the processed files the submitter uploaded — count
# matrices, annotations, archives — as `(url, type)` pairs. These are usually
# what you want when you do not intend to reprocess the raw reads.

# %%
for url, kind in m.supplementary_data:
    print(f"{kind:6} {url.rsplit('/', 1)[-1]}")

# %% [markdown]
# `download_project_supplementary_data` fetches all of them in parallel. It is
# not run here because it writes to disk.
#
# ```python
# from pathlib import Path
# sq.download_project_supplementary_data(d.meta, Path("GSE114725"))
# ```
#
# ### Similar datasets
#
# `neighbors` holds the datasets nearest to this one in seqout's embedding of
# study text. It is a way to find related work that does not share an author or
# a citation.

# %%
for n in m.neighbors[:8]:
    print(f"{n.accession:14} {n.source}")

# %% [markdown]
# Those accessions go straight back into `get`, or into `summaries` to read all
# their titles in one request.

# %%
sq.summaries([n.accession for n in m.neighbors[:5]]).to_df()[["accession", "title"]]

# %% [markdown]
# ## samples — one record per sample
#
# A GEO or ArrayExpress sample carries channels. Each channel has its organism,
# its source material, the protocols used, and a `characteristics` dictionary
# whose keys are chosen by the submitter.

# %%
s = d.samples[0]

print(s.accession, "-", s.title)
print("type:    ", s.sample_type)
print("platform:", s.platform_ref)

ch = s.channels[0]
print("organism:", [o.text for o in ch.organisms])
print("source:  ", ch.source)
for tag, value in ch.characteristics.items():
    print(f"  {tag}: {value}")

# %% [markdown]
# Because the keys vary between submissions, the useful move is to flatten the
# characteristics of every sample into one table and look at what the study
# actually recorded.

# %%
samples = pd.DataFrame(
    {"sample": s.accession, "title": s.title, **s.channels[0].characteristics}
    for s in d.samples
)
samples.head()

# %% [markdown]
# From there the usual pandas work applies — count the levels of a variable,
# then select the samples you want.

# %%
print(samples["resident tissue"].value_counts().to_dict())

tumour = samples[samples["resident tissue"] == "breast tumor"]
print(len(tumour), "tumour samples:", list(tumour["sample"])[:4])

# %% [markdown]
# Samples carry their own supplementary files, separate from the project's.

# %%
for s in d.samples[:3]:
    for url in s.supplementary_data:
        print(s.accession, url.rsplit("/", 1)[-1])

# %% [markdown]
# `download_files` takes a bare list of URLs, which is how you fetch the
# per-sample files for a subset you have selected:
#
# ```python
# urls = [u for s in d.samples if s.accession in set(tumour["sample"])
#         for u in s.supplementary_data]
# sq.download_files(urls, Path("GSE114725/tumour"))
# ```
#
# Any result set writes to CSV or converts to a DataFrame directly, without the
# flattening above, when the raw record is what you want:
#
# ```python
# d.samples.to_csv("samples.csv")
# ```

# %% [markdown]
# ## experiments — the library preparations
#
# An experiment describes how a library was made and on what instrument. A GEO
# series holds none of its own; these come from the linked sequence archive.

# %%
e = d.experiments[0]
print(e.accession, "-", e.title)
print("strategy: ", e.library_strategy, "|", e.library_selection, "|", e.library_source)
print("layout:   ", e.library_layout)
print("platform: ", e.platform, "-", e.instrument_model)
print("samples:  ", e.samples)

# %% [markdown]
# The summary that matters for most studies is which instruments were used, and
# whether the libraries are consistent.

# %%
exps = d.experiments.to_df()
exps.groupby(["instrument_model", "library_strategy"]).size().rename("experiments")

# %% [markdown]
# ## runs — the sequencing data
#
# A run is one sequencing run of one library, and carries the URLs to its files.
# `runs` reads every run, not the preview page the API returns by default.

# %%
r = d.runs[0]

print(r.run_accession, f"({r.library_layout})")
print("experiment:", r.experiment_accession)
print("study:     ", r.study_accession)
print()
for fmt, url in {
    "fastq": r.fastq_ftp,
    "sra": r.sra_ftp,
    "s3": r.ncbi_sra_lite_s3_url,
    "gcs": r.ncbi_sra_lite_gs_url,
}.items():
    if url:
        print(f"  {fmt:6} {url}")

# %% [markdown]
# The FASTQ fields are semicolon-joined when a run has more than one file, which
# is normal for paired-end data: the sizes and the MD5 sums line up with the
# URLs.

# %%
print("urls: ", r.fastq_ftp.split(";"))
print("bytes:", r.fastq_bytes.split(";"))
print("md5:  ", r.fastq_md5.split(";"))

# %% [markdown]
# Sum those sizes before you start a download. This study is larger than it
# looks from the sample count.

# %%
total = sum(
    int(part)
    for run in d.runs
    for part in str(run.fastq_bytes or "").split(";")
    if part.strip().isdigit()
)
print(f"{len(d.runs)} runs, {total / 1e9:.1f} GB of FASTQ")
print("layouts:", pd.Series([run.library_layout for run in d.runs]).value_counts().to_dict())

# %% [markdown]
# `download_study_runs_data` takes the runs you pass it, so a subset is just a
# filtered list. Files are fetched in parallel and checked against the size and
# MD5 above.
#
# ```python
# first_two = StudyRunsResults(list(d.runs)[:2])
# sq.download_study_runs_data(first_two, Path("reads"), mode="fastq")
# ```
#
# The mode is `fastq`, `sra`, `sra_lite`, `s3`, or `gcs`. Not every run offers
# every mode, so check before you commit to one.

# %%
pd.Series(
    {
        "fastq": sum(1 for run in d.runs if run.fastq_ftp),
        "sra": sum(1 for run in d.runs if run.sra_ftp),
        "s3": sum(1 for run in d.runs if run.ncbi_sra_lite_s3_url),
        "gcs": sum(1 for run in d.runs if run.ncbi_sra_lite_gs_url),
    },
    name="runs offering this format",
)

# %% [markdown]
# ## pubs — the publications
#
# A dataset can be linked to more than one paper: the one that described it, and
# later papers that reused the data. Each carries the journal metrics seqout
# holds.

# %%
for p in d.pubs:
    print(p.title)
    print(f"  pmid {p.pmid} | doi {p.doi}")
    print(f"  {p.journal}, {p.pub_date} - {p.citation_count} citations")
    print(f"  authors: {(p.authors or '')[:80]}")

# %% [markdown]
# The reverse lookup goes through `paper`, which takes a PubMed ID or a DOI and
# returns every dataset linked to it.

# %%
pub = sq.paper(pmid=d.pubs[0].pmid)
print(pub.total_projects, "datasets linked to this paper")
pd.DataFrame(p.model_dump() for p in pub.projects[:5])

# %% [markdown]
# ## links — the same data elsewhere
#
# `links` lists the accessions other archives use for this data. A link with
# `source` of `pmid` was matched through a shared publication rather than a
# declared cross-reference, so it may not cover the same samples.

# %%
d.links.to_df()

# %% [markdown]
# ## enriched — structured sample labels
#
# seqout.org prepares normalized labels for the samples of some projects —
# tissue, disease, cell type, assay, and their ontology terms. Coverage is
# partial; the field is empty for a project that has not been processed, as
# here.

# %%
print(len(d.enriched), "samples with enriched labels")

# %% [markdown]
# For a project that has them, the result tabulates like any other field:
#
# ```python
# d.enriched.to_df()[["sample", "tissue", "disease", "cell_type", "assay"]]
# ```
#
# The command-line tool can also produce these locally with a small language
# model — see `seqout --norm`, described in the
# [normalization](../normalization.md) page.

# %% [markdown]
# ## detail — the record for a child accession
#
# When the accession you passed to `get` names a sample or a run rather than a
# study, `detail` gives that record. For a study or a series it is `None`,
# because `meta` already holds it.

# %%
run = sq.get("SRR7191509")
print(run.kind, "->", run.detail.run_accession, "in study", run.detail.study_accession)

sample = sq.get("GSM3148585")
print(sample.kind, "->", sample.detail.sample.title)
print("belongs to:", sample.detail.project.accession)

# %% [markdown]
# ## Where the data sits
#
# The last four fields report what `get` resolved. `kind` comes from the
# accession pattern and costs no request; the others may need one.

# %%
for accession in ("GSE168652", "SRP310139", "GSM5155196", "SRR13927092"):
    x = sq.get(accession)
    print(f"{accession:12} kind={x.kind:10} project={x.project:12} geo={x.geo} sra={x.sra}")

# %% [markdown]
# Those four accessions name the same dataset, so all of them arrive at the same
# pair of archive records, and the fields above read the same whichever one you
# start from.
#
# GSE114725 is a reminder that this is not always so tidy. It is a GEO
# SuperSeries, and its samples belong to the SubSeries beneath it, so
# `sq.get("GSM3148585").project` is GSE114727 rather than GSE114725. The `links`
# table above shows that relationship.

# %%
print(sq.get("GSM3148585").project, "- the SubSeries the sample belongs to")

# %% [markdown]
# The [accessions and archives](03_accessions_and_archives.ipynb) notebook
# covers how the resolution works, and what happens when it cannot.
