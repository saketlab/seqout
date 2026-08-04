---
description: Every public seqout function and class, grouped by topic.
---

# Reference

Every public function and class, grouped by what it is for. Each entry links to
its full signature, arguments, and return type.

## Connecting

| | |
| --- | --- |
| [`connect()`](client.md#seqout.seqout.connect) | Open a client against the API or the Parquet backend |
| [`connect_to_seqout()`](client.md#seqout.seqout.connect_to_seqout) | The same function under its longer name |
| [`SeqoutAPIClient`](client.md#seqout.clients.api.SeqoutAPIClient) | The API client |
| [`SeqoutParquetClient`](client.md#seqout.clients.parquet.SeqoutParquetClient) | The Parquet client |

## Datasets

| | |
| --- | --- |
| [`Dataset`](dataset.md#seqout.dataset.Dataset) | An accession and everything seqout knows about it |
| [`Dataset.meta`](dataset.md#seqout.dataset.Dataset) | The project record |
| [`Dataset.samples`](dataset.md#seqout.dataset.Dataset) | One record per sample |
| [`Dataset.experiments`](dataset.md#seqout.dataset.Dataset) | One record per library preparation |
| [`Dataset.runs`](dataset.md#seqout.dataset.Dataset) | Every sequencing run, with its file URLs |
| [`Dataset.pubs`](dataset.md#seqout.dataset.Dataset) | The publications linked to the dataset |
| [`Dataset.links`](dataset.md#seqout.dataset.Dataset) | The same data in other archives |
| [`Dataset.enriched`](dataset.md#seqout.dataset.Dataset) | Structured per-sample labels |
| [`Dataset.detail`](dataset.md#seqout.dataset.Dataset) | The record itself, for a sample or run accession |

## Searching

| | |
| --- | --- |
| [`SearchParams`](search.md#seqout.models.api_models.SearchParams) | A reusable filter set |
| [`SearchResults`](search.md#seqout.models.api_models.SearchResults) | A list-like container of hits, with subsetting and summaries |
| [`BaseContainer`](search.md#seqout.models.models.BaseContainer) | `to_df`, `to_csv`, `to_dict`, on every result container |

## Counts matrices

Needs the `counts` extra.

| | |
| --- | --- |
| [`seqout_counts()`](counts.md#seqout.counts.SeqoutCounts) | A lazy reader for a series or sample; `SeqoutCounts` is the same object |
| [`CountMatrix`](counts.md#seqout.counts_model.CountMatrix) | A matrix in AnnData orientation, with its annotation |
| [`SuppFile`](counts.md#seqout.counts_model.SuppFile) | One supplementary file, before download |
| [`Unit`](counts.md#seqout.counts_model.Unit) | A group of files that read as one matrix |

## Utilities

| | |
| --- | --- |
| [`sample_frame()`](utilities.md#seqout.utils.sample_frame) | Sample characteristics as a DataFrame indexed by accession |
| [`country_code_to_name()`](utilities.md#seqout.utils.country_code_to_name) | ISO code to country name |
| [`country_name_to_code()`](utilities.md#seqout.utils.country_name_to_code) | Country name to ISO code |
| [`SeqoutError`](utilities.md#seqout.exception.SeqoutError) | Raised when a lookup cannot be answered |
