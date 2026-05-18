from __future__ import annotations

import csv
from collections import Counter
from typing import TYPE_CHECKING, Iterable, Iterator, Literal

from pydantic import BaseModel, field_validator, model_validator

from seqoutdb._internal._constants import COUNTRY_CODE_MAP

if TYPE_CHECKING:
    from pandas import DataFrame


class SearchParams(BaseModel):
    q: str
    db: Literal["geo", "sra", "arrayexpress", "ena"] | None = None
    sortby: Literal["citations", "journal", "year"] | None = None
    order: Literal["asc", "desc"] | None = "desc"
    cursor_rank: float | None = None
    cursor_acc: str | None = None
    cursor_sort: str | None = None

    @field_validator("q")
    @classmethod
    def _query_must_be_valid(cls, v: str) -> str:
        v = v.strip()

        if not v:
            raise ValueError("search query cannot be empty")
        if len(v) > 500:
            raise ValueError("query cannot exceed 500 characters")

        return v


class Publication(BaseModel):
    doi: str | None = None
    issn: str | None = None
    pmid: str | None = None
    title: str | None = None
    authors: str | None = None
    journal: str | None = None
    pub_date: str | None = None
    citation_count: int | None = None
    journal_h_index: int | None = None
    journal_i10_index: int | None = None
    journal_works_count: int | None = None
    journal_cited_by_count: int | None = None
    journal_2yr_mean_citedness: float | None = None


class SearchResult(BaseModel):
    accession: str
    title: str
    summary: str
    updated_at: str | None = None
    organisms: list[str] = []
    countries: list[str] = []
    rank: float
    source: str
    total_count: int
    instrument_models: list[str] = []
    publications: list[Publication] = []
    pmid: str | None = None
    publication_title: str | None = None
    journal: str | None = None
    doi: str | None = None
    authors: str | None = None
    citation_count: int | None = None
    center_name: str | None = None
    country_code: str | None = None
    is_single_cell: bool | None = None

    @field_validator(
        "organisms", "countries", "instrument_models", "publications", mode="before"
    )
    @classmethod
    def _null_to_empty_list(cls, v):
        return v or []

    @field_validator("countries", mode="after")
    @classmethod
    def _lowercase_list(cls, v):
        return [item.lower() for item in v]

    @model_validator(mode="after")
    def _normalize_countries(self):
        if not self.country_code:
            if self.countries:
                self.country_code = self.countries[0].upper()

        self.countries = [COUNTRY_CODE_MAP.get(code, code) for code in self.countries]
        return self

    def has_organism(self, org: str) -> bool:
        return org.lower() in self.organisms


class NextCursor(BaseModel):
    rank: float
    accession: str


class SearchResponse(BaseModel):
    results: list[SearchResult]
    total: int
    took_ms: float
    next_cursor: NextCursor | None = None

    def to_results(self) -> SearchResults:
        return SearchResults(self.results)


# wrapper over list of search results with a bunch of util methods
class SearchResults:
    def __init__(self, results: Iterable[SearchResult]):
        self._results: list[SearchResult] = list(results)

    def __iter__(self) -> Iterator[SearchResult]:
        return iter(self._results)

    def __len__(self):
        return len(self._results)

    def offset(self, n: int) -> SearchResults:
        return SearchResults(self._results[n:])

    def limit(self, n: int) -> SearchResults:
        return SearchResults(self._results[:n])

    def slice(self, start: int, stop: int) -> SearchResults:
        return SearchResults(self._results[start:stop])

    def filter(self, **kwargs) -> SearchResults:
        filtered = self._results

        for field, value in kwargs.items():
            is_string_filter = isinstance(value, str)
            filtered = [
                r
                for r in filtered
                if (field_val := getattr(r, field, None)) is not None
                and (
                    field_val.casefold() == value.casefold()
                    if is_string_filter
                    and isinstance(
                        field_val, str
                    )  # if the field is a string then do case insensitive matching
                    else field_val == value
                )
            ]

        return SearchResults(filtered)

    def exclude(self, **kwargs) -> SearchResults:
        filtered = self._results
        for field, value in kwargs.items():
            filtered = [r for r in filtered if not getattr(r, field, None) == value]
        return SearchResults(filtered)

    def by_source(self, source: str) -> SearchResults:
        return self.filter(source=source)

    def by_organism(self, organism: str) -> SearchResults:
        return SearchResults(r for r in self if r.has_organism(organism))

    def organisms(self) -> Counter[str]:
        return Counter(org for r in self._results for org in r.organisms)

    def sources(self) -> Counter[str]:
        return Counter(r.source for r in self._results if r.source)

    def countries(self) -> Counter[str]:
        return Counter(c for r in self._results for c in r.countries)

    def sort_by(self, field: str, reverse: bool = False) -> SearchResults:
        def sort_key(r):
            value = getattr(r, field)
            return value if value is not None else 0

        not_none = [r for r in self._results if getattr(r, field) is not None]
        none_values = [r for r in self._results if getattr(r, field) is None]

        return SearchResults(
            sorted(not_none, key=sort_key, reverse=reverse) + none_values
        )

    def top_cited(self, n: int = 10) -> SearchResults:
        return self.sort_by("citation_count", reverse=True).limit(n)

    def most_recent(self, n: int = 10) -> SearchResults:
        return self.sort_by("updated_at", reverse=True).limit(n)

    def to_dict(self) -> list[dict]:
        return [r.model_dump() for r in self._results]

    def to_csv(self, path: str) -> None:
        with open(path, "w", newline="") as f:
            if not self._results:
                return

            writer = csv.DictWriter(f, fieldnames=self._results[0].model_fields.keys())
            writer.writeheader()
            writer.writerows(self.to_dict())

    def to_df(self) -> DataFrame:
        import pandas

        return pandas.DataFrame(self.to_dict())
