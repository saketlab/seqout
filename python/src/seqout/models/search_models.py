"""Models for search aids and filter vocabularies (`/search/*`, `/filters/*`)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict

from seqout.models.models import BaseContainer, TotalContainer


class SuggestedCorrection(BaseModel):
    """One misspelt word and the word the index suggests for it."""

    model_config = ConfigDict(extra="allow")

    original: str | None = None
    suggested: str | None = None
    distance: int | None = None


class SearchSuggestion(BaseModel):
    """One corrected spelling of a whole query."""

    model_config = ConfigDict(extra="allow")

    corrected_query: str
    corrections: list[SuggestedCorrection] = []


class SearchSuggestions(BaseContainer[SearchSuggestion]):
    """Corrected spellings of a query; empty when it needs no correction."""


class SearchSuggestResponse(BaseModel):
    """The `/search/suggest` envelope."""

    model_config = ConfigDict(extra="ignore")

    suggestions: list[SearchSuggestion] = []


class SearchFacetBucket(BaseModel):
    """One value of one `/search/facets` facet, as the server sends it."""

    model_config = ConfigDict(extra="ignore")

    value: str | None = None
    count: int = 0
    score: float = 0.0


class SearchFacetsResponse(BaseModel):
    """The `/search/facets` envelope: buckets per facet, plus the match total."""

    model_config = ConfigDict(extra="ignore")

    facets: dict[str, list[SearchFacetBucket]] = {}
    total: int | None = None
    max_rank: float | None = None


class SearchFacetValue(BaseModel):
    """One facet value of a search's match set; `score` sums the match rank."""

    facet: str
    value: str | None = None
    count: int = 0
    score: float = 0.0


class SearchFacetCounts(TotalContainer[SearchFacetValue]):
    """Facet counts over a search's full match set, with `total` and `max_rank`."""

    def __init__(self, root: list[SearchFacetValue], /, **kwargs: Any) -> None:
        super().__init__(root, **kwargs)
        self.__dict__["max_rank"] = kwargs.get("max_rank")

    @property
    def max_rank(self) -> float | None:
        """The best match rank in the set; 0 or None without a query."""
        return self.__dict__["max_rank"]


class FilterValue(BaseModel):
    """One value a search filter accepts, with its record count."""

    model_config = ConfigDict(extra="allow")

    value: str | None = None
    count: int | None = None


class FilterValues(TotalContainer[FilterValue]):
    """Values a search filter accepts; `total` is how many the server knows."""


class FilterValuesResponse(BaseModel):
    """The `{total, values}` envelope every `/filters/*` endpoint returns."""

    model_config = ConfigDict(extra="ignore")

    total: int | None = None
    values: list[FilterValue] = []


class Organism(BaseModel):
    """One organism on record, with its common name when asked for."""

    model_config = ConfigDict(extra="allow")

    scientific_name: str | None = None
    common_name: str | None = None


class Organisms(BaseContainer[Organism]):
    """Every organism recorded across archives."""

    def __init__(self, root: list[Organism], /, **kwargs: Any) -> None:
        super().__init__(root)
        self.__dict__["common_names"] = kwargs.get("common_names", False)

    def to_dict(self) -> list[dict]:
        """Return the records; `common_name` only when it was asked for."""
        if self.__dict__["common_names"]:
            return super().to_dict()
        return [{"scientific_name": r.scientific_name} for r in self.root]


class OrganismsResponse(BaseModel):
    """The `/organisms` envelope: bare names, or name records with common names."""

    model_config = ConfigDict(extra="ignore")

    organisms: list[str | Organism] = []


class AssayValue(BaseModel):
    """One assay value and its study count, at level `assay_l1` or `assay_l2`."""

    model_config = ConfigDict(extra="allow")

    level: str
    value: str | None = None
    count: int | None = None


class AssayValues(BaseContainer[AssayValue]):
    """Both assay levels, told apart by the `level` column."""


class AssayFiltersResponse(BaseModel):
    """The two assay groups of `/stats/global-contribution-filters`."""

    model_config = ConfigDict(extra="ignore")

    assay_l1: list[FilterValue] = []
    assay_l2: list[FilterValue] = []


class PlatformCount(BaseModel):
    """One sequencing platform, with its record count in each archive."""

    model_config = ConfigDict(extra="ignore")

    platform: str | None = None
    display_name: str | None = None
    total: int | None = None
    geo: int | None = None
    sra: int | None = None
    ena: int | None = None
    gsa: int | None = None
    dra: int | None = None
    gea: int | None = None


class PlatformCounts(BaseContainer[PlatformCount]):
    """Sequencing platforms and their per-archive record counts."""


class PlatformsResponse(BaseModel):
    """The `/platforms` envelope."""

    model_config = ConfigDict(extra="ignore")

    platforms: list[PlatformCount] = []
