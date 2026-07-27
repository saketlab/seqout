# %% [markdown]
# # Offline with Parquet
#
# The Parquet backend reads seqout data with DuckDB and does not call the API.
# Use it for offline work, large batch jobs, and your own SQL.

# %%
from seqout import connect_to_seqout

pq = connect_to_seqout(backend="parquet")

# %% [markdown]
# ## Set the data source
#
# The source is a URL or a local directory. This example uses the public URL,
# `https://seqout.org/data`. You can also download the files from that same
# address and point the source at a local directory (see the last cell).

# %%
pq.set_source("https://seqout.org/data")

# %% [markdown]
# ## Get a study
#
# The Parquet backend has the same methods as the API backend.

# %%
study = pq.fetch_study("GSE169470")
print(study.title)
print(study.num_experiments, "experiments,", study.num_samples, "samples")

# %% [markdown]
# ## Run your own SQL
#
# `execute_query` runs SQL with DuckDB. The backend maps each table name to its
# Parquet file. Do not reuse a table name as a column alias, because the backend
# finds table names by text; use a distinct alias such as `AS n`. The result
# converts to pandas with `.df()`.

# %%
pq.execute_query(
    "SELECT source, COUNT(*) AS n FROM unified_metadata GROUP BY source ORDER BY n DESC"
).df()

# %% [markdown]
# ## Work with a local copy
#
# A query over a remote URL is slow for the large tables. Download the files
# once, then query them from disk:
#
# ```bash
# seqout parquet download /data/seqout
# ```

# %%
# pq.set_source("/data/seqout")   # after you download the files
# print(len(pq.fetch_study_runs("SRP311850")), "runs")
