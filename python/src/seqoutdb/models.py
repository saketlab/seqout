from __future__ import annotations

from collections import Counter
from typing import Iterable, Iterator, Literal

from pydantic import BaseModel, field_validator

from seqoutdb._internal._constants import COUNTRY_CODE_MAP


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
        "organisms",
        "countries",
        "instrument_models",
        "instrument_models",
        "publications",
        mode="before",
    )
    @classmethod
    def _null_to_empty_list(cls, v) -> list:
        return v or []

    @field_validator("organisms", "countries", "instrument_models", mode="after")
    @classmethod
    def _lowercase_list(cls, v) -> list[str]:
        return [item.lower() for item in v]

    @field_validator("countries", mode="after")
    @classmethod
    def _expand_country_codes(cls, v: list[str]) -> list[str]:
        return [COUNTRY_CODE_MAP.get(code, code) for code in v]

    def has_organism(self, org: str) -> bool:
        return org.lower() in self.organisms


class NextCursor(BaseModel):
    rank: float
    accession: str


# wrapper over list of search results with a bunch of util methods
class SearchResults:
    def __init__(self, results: Iterable[SearchResult]):
        self._results: list[SearchResult] = list(results)

    def __iter__(self) -> Iterator[SearchResult]:
        return iter(self._results)

    def __len__(self):
        return len(self._results)

    def filter(self, **kwargs) -> SearchResults:
        filtered = self._results
        for field, value in kwargs.items():
            filtered = [r for r in filtered if getattr(r, field, None) == value]
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


class SearchResponse(BaseModel):
    results: list[SearchResult]
    total: int
    took_ms: float
    next_cursor: NextCursor | None = None

    def to_results(self) -> SearchResults:
        return SearchResults(self.results)
