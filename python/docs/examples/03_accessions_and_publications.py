# %% [markdown]
# # Accessions and publications
#
# Move between related accessions, and find the publications and authors of a
# dataset. For a one-shot conversion on the command line, use the short
# subcommands instead, such as `seqout gse-to-srp GSE12345`.

# %%
from seqout import connect_to_seqout

sq = connect_to_seqout(backend="api")

# %% [markdown]
# ## Resolve and cross-reference
#
# `resolve_study` maps a run, experiment, or sample to its study. `linked_study`
# and `linked_geo` cross the GEO/SRA boundary. `gsm_series` maps a GEO sample to
# its series.

# %%
print("run   -> study:", sq.resolve_study("SRR13711483"))
print("GEO   -> SRA:  ", sq.linked_study("GSE169470"))
print("SRA   -> GEO:  ", sq.linked_geo("SRP311850"))
print("GSM   -> GSE:  ", sq.gsm_series("GSM5206734"))

# %% [markdown]
# ## Runs of a GEO series
#
# A GEO series links to an SRA study. Resolve the study, then list its runs.

# %%
srp = sq.linked_study("GSE169470")
print(srp, "has", len(sq.fetch_study_runs(srp, full=True)), "runs")

# %% [markdown]
# ## Publications
#
# `find_publication` takes a PubMed ID or a DOI and returns the linked projects.

# %%
pub = sq.find_publication(pmid="22406642")
print(pub.title, "|", pub.journal, "|", pub.total_projects, "datasets")
for p in pub.projects[:5]:
    print(" ", p.accession, p.source, "-", p.title)

# %% [markdown]
# ## Authors
#
# `search_author_projects` returns the datasets and institutes of an author.

# %%
authored = sq.search_author_projects("Aviv Regev")
print(authored.total, "datasets")
for inst in authored.institutes[:5]:
    print(" ", inst.name, f"({inst.count})")
