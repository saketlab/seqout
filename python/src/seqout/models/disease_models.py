"""
Models for the disease-collection endpoints (`/disease/{collection}/*`).

`"rare"` (NIH GARD) and `"nord"` (NORD) return `DiseaseSummary`/
`DiseaseProject`; any other `collection` is free MONDO text and returns
`OntologyTermSummary`/`DiseaseTermProject`.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict

from seqout.models.models import Facets, FacetValue, OffsetPage, TotalContainer

# anything else is sent as free MONDO text
DISEASE_CURATED_COLLECTIONS = frozenset({"rare", "nord"})


class DiseaseSummary(BaseModel):
    """The `/disease/{collection}/summary` envelope for a curated collection."""

    model_config = ConfigDict(extra="allow")

    studies: int = 0
    samples: int = 0
    cells: int | None = None
    studies_single_cell: int = 0
    studies_cells_measured: int = 0
    studies_human: int = 0
    studies_human_primary: int = 0
    studies_model: int = 0
    studies_cell_line: int = 0
    studies_with_ancestry: int = 0
    stated_male: int = 0
    stated_female: int = 0
    stated_missing: int = 0
    reads_male: int = 0
    reads_female: int = 0


class OntologyTermSummary(BaseModel):
    """
    Corpus totals for a free-text term resolved against an ontology.

    Shared by `/disease/{collection}/summary` (a non-curated `collection`)
    and `/tissue/{term}/summary`. `resolution` is `"exact"` when `term`
    matched a label verbatim, `"substring"` when it only matched as a
    substring of one; `matched_labels` names what actually matched, before
    expansion to descendants. `matched_samples` is scoped to exactly the
    resolved id set, unlike the study-level `samples` total.
    """

    model_config = ConfigDict(extra="allow")

    studies: int = 0
    samples: int | None = None
    experiments: int | None = None
    matched_samples: int | None = None
    studies_with_fastq: int = 0
    studies_with_sra: int = 0
    studies_human: int = 0
    studies_single_cell: int = 0
    studies_long_read: int = 0
    n_organisms: int = 0
    first_date: str | None = None
    last_date: str | None = None
    term: str = ""
    resolution: str = ""
    matched_labels: list[str] = []


DiseaseFacetValue = FacetValue


DiseaseFacets = Facets


class DiseaseProject(BaseModel):
    """One row of `/disease/{collection}/projects` for a curated collection."""

    model_config = ConfigDict(extra="allow")

    study_accession: str
    title: str | None = None
    organisms: list[str] | None = None
    n_samples: int = 0
    n_diseases: int = 0
    cells: int | None = None
    assay_category: str | None = None
    stated_male: int = 0
    stated_female: int = 0
    stated_missing: int = 0
    diseases: list[str] | None = None
    mondo_ids: list[str] | None = None
    catalogue_diseases: list[str] | None = None
    catalogue_diseases_direct: list[str] | None = None
    ancestors: list[str] | None = None
    n_samples_in_scope: int = 0
    ancestries: list[str] | None = None
    inheritance: list[str | None] | None = None
    has_fastq: bool | None = None
    has_sra: bool | None = None
    n_fastq_runs: int | None = None
    n_sra_runs: int | None = None


class OntologyTermProjectBase(BaseModel):
    """
    Shared row shape for a study matching a free-text ontology term.

    Common to `/disease/{collection}/projects` (`DiseaseTermProject`) and
    `/tissue/{term}/projects` (`TissueProject`); each subclass appends its
    own match-count column.
    """

    model_config = ConfigDict(extra="allow")

    study_accession: str
    title: str | None = None
    organism: str | None = None
    assay_l1: str | None = None
    assay_l2: str | None = None
    source: str
    journal: str | None = None
    country_code_iso2: str | None = None
    pub_date: str | None = None
    n_samples: int | None = None
    n_experiments: int | None = None
    is_single_cell: bool | None = None
    single_cell_modality: str | None = None


class DiseaseTermProject(OntologyTermProjectBase):
    """One row of `/disease/{collection}/projects` for a free-text MONDO term."""

    n_samples_with_disease: int | None = None
    has_fastq: bool | None = None
    has_sra: bool | None = None
    n_runs: int | None = None
    n_fastq_runs: int | None = None
    n_sra_runs: int | None = None
    is_long_read: bool = False


DiseaseProjectsResponse = OffsetPage[DiseaseProject]


class OntologyTermCursor(BaseModel):
    """
    A `next_cursor` from an ontology-term-mode `/projects` page.

    Shared by `/tissue/{term}/projects` and the free-text branch of
    `/disease/{collection}/projects`. Both page by keyset on
    `(sort_val, study_accession)`, not `offset`, because a broad term (e.g.
    "blood") matches tens of thousands of studies. Pass `sort_value`/`accession`
    back verbatim as the next call's `cursor_sort`/`cursor_acc`. The curated
    (`rare`/`nord`) path still pages by `offset`.
    """

    model_config = ConfigDict(extra="ignore")

    sort_value: Any = None
    accession: str = ""


class CursorPage[T: BaseModel](BaseModel):
    """A `/projects` envelope paged by keyset; no `next_cursor` on the last page."""

    model_config = ConfigDict(extra="ignore")

    total: int = 0
    count: int = 0
    next_cursor: OntologyTermCursor | None = None
    results: list[T] = []


DiseaseTermProjectsResponse = CursorPage[DiseaseTermProject]


class DiseaseProjects(TotalContainer[DiseaseProject]):
    """Studies matching a curated `fetch_disease_projects` call, with the total."""


class DiseaseTermProjects(TotalContainer[DiseaseTermProject]):
    """Studies matching a free-text `fetch_disease_projects` call, with the total."""


class DiseaseAlias(BaseModel):
    """One `/disease/aliases` match: a name and the MONDO ids it resolves to."""

    model_config = ConfigDict(extra="ignore")

    display_name: str
    alias: str
    mondo_ids: list[str] = []
    sources: list[str] = []


class DiseaseAliasResponse(BaseModel):
    """The `/disease/aliases` envelope."""

    model_config = ConfigDict(extra="ignore")

    query: str = ""
    total: int = 0
    count: int = 0
    truncated: bool = False
    results: list[DiseaseAlias] = []


class DiseaseAliasResults(TotalContainer[DiseaseAlias]):
    """Matches from `fetch_disease_aliases`, with the server's total and truncation."""

    def __init__(self, root: list[DiseaseAlias], /, **kwargs: Any) -> None:
        super().__init__(root, **kwargs)
        self.__dict__["truncated"] = kwargs.get("truncated", False)

    @property
    def truncated(self) -> bool:
        """Whether `total` exceeds the page this call returned."""
        return self.__dict__["truncated"]
