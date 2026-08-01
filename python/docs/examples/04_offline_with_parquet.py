# %% [markdown]
# # Offline with Parquet
#
# seqout publishes its tables as Parquet files. The Parquet backend reads them
# with DuckDB and sends no request to the API, which suits offline work, large
# batch jobs, and queries the API does not expose.
#
# The trade-off is coverage and speed. A Parquet query filters by reading the
# file, so a query over the remote URL is slow for the large tables, and a few
# API features have no Parquet equivalent. Both are covered below.

# %%
from seqout import connect

pq = connect(backend="parquet")

# %% [markdown]
# ## The data source
#
# The source is a URL or a local directory. The public dump is at
# `https://seqout.org/data`, which is also the default.

# %%
pq.set_source("https://seqout.org/data")

# %% [markdown]
# For repeated work, download the files once and read them from disk. The
# command below writes about 15 GB, most of it the run download links table.
#
# ```bash
# seqout parquet download /data/seqout
# ```
#
# ```python
# pq.set_source("/data/seqout")
# ```
#
# ## The same methods as the API backend
#
# Both clients carry the same method names and return the same models, so code
# written against one runs against the other.

# %%
study = pq.fetch_study("GSE169470")

print(study.title)
print(study.num_experiments, "experiments,", study.num_samples, "samples")
print("organisms:", study.organisms)

# %% [markdown]
# `get` works here too. It crosses the GEO/SRA link through the `aliases` column
# of the unified metadata table rather than through the API's cross-reference
# endpoint.

# %%
d = pq.get("GSE169470")
print("geo =", d.geo, "| sra =", d.sra)

# %% [markdown]
# ## Your own SQL
#
# `execute_query` runs SQL through DuckDB. The backend replaces each table name
# in the query with a read of its Parquet file. Because it finds table names by
# text, do not reuse a table name as a column alias — use a distinct alias such
# as `AS n`. The result has `.df()` for pandas.

# %%
pq.execute_query(
    "SELECT source, COUNT(*) AS n FROM unified_metadata GROUP BY source ORDER BY n DESC"
).df()

# %% [markdown]
# This is the main reason to use the backend directly: aggregate questions that
# no API endpoint answers.

# %%
pq.execute_query(
    """
    SELECT
        dominant_scientific_name AS organism,
        COUNT(*) AS studies,
        ROUND(AVG(n_samples), 1) AS mean_samples
    FROM unified_metadata
    WHERE is_single_cell AND dominant_scientific_name IS NOT NULL
    GROUP BY organism
    ORDER BY studies DESC
    LIMIT 10
    """
).df()

# %% [markdown]
# ## What the Parquet backend does not do
#
# Some fields have no table in the dump. Reading them raises `SeqoutError` that
# names the field and says to use the API backend.

# %%
from seqout.exception import SeqoutError

for field in ("links", "enriched"):
    try:
        getattr(pq.get("GSE169470"), field)
    except SeqoutError as e:
        print(f"{field}: {e}")

# %% [markdown]
# `classify` and `summaries` are also API-only. Two further differences are
# worth knowing:
#
# - `author` on Parquet matches GEO contributor names by substring. The API
#   version searches publication author lists across every source, so the two
#   return different sets.
# - `run_download_links.parquet` is about 11.6 GB and is not sorted by study, so
#   a run lookup over the remote URL reads a large part of the file. Use a local
#   copy for that work.
