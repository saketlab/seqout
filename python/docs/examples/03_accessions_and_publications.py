# %% [markdown]
# # Accessions and publications
#
# Move between related accessions, and find the publications and authors of a
# dataset. For a one-shot conversion on the command line, use the short
# subcommands instead, such as `seqout gse-to-srp GSE12345`.

# %%
from seqout import connect

sq = connect()

# %% [markdown]
# ## One dataset, many accessions
#
# `get` takes any accession and finds the rest. `project` is the study or series
# the accession belongs to; `geo` and `sra` name the record in each archive.

# %%
for acc in ("GSE169470", "SRP311850", "GSM5206734", "SRR13711483"):
    d = sq.get(acc)
    print(f"{acc:12} ({d.kind:7}) -> project={d.project}")

# %% [markdown]
# ## Runs of a GEO series
#
# A GEO series holds no runs. `runs` follows the link to the SRA study.

# %%
d = sq.get("GSE169470")
print(d.sra, "has", len(d.runs), "runs")

# %% [markdown]
# The single-step resolvers are still there when you want one specific hop:

# %%
print("run   -> study:", sq.resolve_study("SRR13711483"))
print("GEO   -> SRA:  ", sq.linked_study("GSE169470"))
print("SRA   -> GEO:  ", sq.linked_geo("SRP311850"))
print("GSM   -> GSE:  ", sq.gsm_series("GSM5206734"))

# %% [markdown]
# ## Publications
#
# `pubs` lists the papers of a dataset. `paper` goes the other way: it takes a
# PubMed ID or a DOI and returns the linked projects.

# %%
for p in d.pubs:
    print(p.pmid, "-", p.title, "|", p.journal)

# %%
pub = sq.paper(pmid="22406642")
print(pub.title, "|", pub.journal, "|", pub.total_projects, "datasets")
for p in pub.projects[:5]:
    print(" ", p.accession, p.source, "-", p.title)

# %% [markdown]
# ## Authors
#
# `author` returns the datasets and institutes of an author.

# %%
authored = sq.author("Aviv Regev")
print(authored.total, "datasets")
for inst in authored.institutes[:5]:
    print(" ", inst.name, f"({inst.count})")
