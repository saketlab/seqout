# %% [markdown]
# # Search and filter
#
# Combine filters, page through every result, and load the results into pandas.

# %%
import itertools

from seqout import SearchParams, connect_to_seqout
from seqout.models.api_models import SearchResults

sq = connect_to_seqout(backend="api")

# %% [markdown]
# ## Filters
#
# `SearchParams` accepts many filters at once. The query text is optional when
# you give at least one filter.

# %%
params = SearchParams(
    q="single cell",
    db="geo",
    organism="Homo sapiens",
    library_strategy=["RNA-Seq"],
    date_from="2021-01-01",
    date_to="2023-12-31",
)
results = sq.search(params)
len(results)

# %% [markdown]
# ## Every result
#
# `search` returns one page. `iter_search` yields every result across all pages.

# %%
hits = SearchResults(list(itertools.islice(sq.iter_search(params), 100)))
len(hits)

# %% [markdown]
# ## Sort, tabulate, and save

# %%
for r in hits.top_cited(5):
    print(r.citation_count, r.accession, "-", r.title)

# %%
df = hits.to_df()
df[["accession", "source", "title", "citation_count"]].head()

# %%
hits.to_csv("results.csv")
