from typing import Literal

from pydantic import BaseModel, field_validator


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
    def query_must_be_valid(cls, v: str) -> str:
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
    updated_at: str
    organisms: list[str] = []
    countries: list[str] = []
    rank: float
    source: str
    total_count: int
    instrument_models: list[str] = []
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
    def null_to_empty_list(cls, v):
        return v or []


class NextCursor(BaseModel):
    rank: float
    accession: str


class SearchResponse(BaseModel):
    results: list[SearchResult]
    total: int
    took_ms: float
    next_cursor: NextCursor | None = None
