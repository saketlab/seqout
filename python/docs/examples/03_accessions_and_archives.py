# %% [markdown]
# # Accessions and archives
#
# One dataset usually exists in more than one archive under more than one
# accession. A study submitted to GEO gets a `GSE` accession for the series and
# a `GSM` for each sample, while its reads go to SRA under an `SRP` study with
# `SRX` experiments and `SRR` runs. The same pattern repeats in the other
# archives with different letters.
#
# Which accession you have decides which endpoint can answer a question about
# it, and the archives do not agree on how a child accession points back at its
# parent. This notebook covers how `seqout` handles that, and what happens when
# a link is missing.

# %%
import pandas as pd

from seqout import connect

sq = connect()

# %% [markdown]
# ## From a child accession to its study
#
# `get` accepts any of these and resolves the study or series it belongs to.
# `project` holds the result.

# %%
for accession in (
    "SRR13927092",   # SRA run
    "SRX10306523",   # SRA experiment
    "SRS8447424",    # SRA sample
    "GSM5155196",    # GEO sample
    "CRR143507",     # GSA run
    "CRX117570",     # GSA experiment
    "DRX817961",     # DDBJ experiment
    "SAMEA7015536",  # ENA BioSample
):
    d = sq.get(accession)
    print(f"{accession:14} ({d.kind:10}) -> {d.project}")

# %% [markdown]
# No single endpoint answers this for every archive, so `seqout` tries them in
# order of how exact they are:
#
# 1. For a run, `/run/{accession}` carries the study accession. This answers for
#    SRA and DDBJ, but not for GSA runs.
# 2. For a sample or an experiment, `/sample-detail/{accession}` carries the
#    project. This answers for GEO, SRA, and GSA.
# 3. For an experiment that step 2 misses, the experiment's first run is looked
#    up and resolved through step 1.
# 4. Anything still unresolved is looked for in the full-text index, which holds
#    some but not all child accessions.
#
# The single-step resolvers are public if you want one specific hop:

# %%
print("run   -> study:", sq.resolve_study("SRR14049273"))
print("GEO   -> SRA:  ", sq.linked_study("GSE169470"))
print("SRA   -> GEO:  ", sq.linked_geo("SRP311850"))
print("GSM   -> GSE:  ", sq.gsm_series("GSM5206734"))

# %% [markdown]
# ## Reading the same fields from every archive
#
# Once an accession resolves, the fields are the same. The table below reads one
# study from each of the seven sources.

# %%
ACCESSIONS = [
    "GSE168652",     # GEO
    "SRP310139",     # SRA
    "PRJNA1458007",  # ENA
    "DRP016022",     # DDBJ (DRA)
    "CRA002740",     # GSA, open access
    "HRA000925",     # GSA, human
    "E-GEAD-657",    # GEA
    "E-MTAB-16863",  # ArrayExpress
    "E-TABM-937",    # ArrayExpress, microarray
]


def summarize(accession: str) -> dict:
    d = sq.get(accession)
    return {
        "accession": accession,
        "kind": d.kind,
        "sequencing study": d.sra,
        "samples": len(d.samples),
        "experiments": len(d.experiments),
        "runs": len(d.runs),
        "papers": len(d.pubs),
    }


pd.DataFrame(summarize(a) for a in ACCESSIONS)

# %% [markdown]
# The `sequencing study` column shows where the runs came from. GEO and
# ArrayExpress record a cross-reference to that study; GEA records none, and
# names its data as a BioProject in the project record instead, so that is used
# when no cross-reference exists.
#
# `E-TABM-937` reports no runs because it is a microarray submission. It has 724
# sample records and no sequencing data. A zero here means the dataset has none,
# not that the lookup failed.

# %% [markdown]
# ## Cross-references
#
# `links` lists the other accessions an archive records for the same data. The
# `link_type` says how the link was made; a link through `pmid` means the two
# studies share a publication rather than a declared cross-reference, so they
# may not cover the same samples.

# %%
sq.get("GSE169470").links.to_df()

# %% [markdown]
# ## When an accession does not resolve
#
# Some accessions have no path back to a study. DDBJ and NCBI BioSample IDs are
# the common case: the archive holds no parent record for them, and they are not
# in the full-text index. Reading `project`, or any field that needs it, raises
# `SeqoutError` with the detail.

# %%
from seqout.exception import SeqoutError

try:
    sq.get("SAMD01591578").project
except SeqoutError as e:
    print(e)

# %% [markdown]
# An accession that does not match any known pattern fails at `get`, before a
# request is sent.

# %%
try:
    sq.get("GSE12345abc")
except SeqoutError as e:
    print(e)
