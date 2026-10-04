"""
Models for the corpus-wide perturbation collection (`/perturbation/*`).

One row per single-cell study with genetic or chemical perturbation
evidence. Detection is rule-based; `confidence` is `"high"`, `"medium"` or
`"low"`; start from `min_confidence="medium"` for studies to rely on.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from seqout.models.models import (
    Facets,
    FacetValue,
    OffsetPage,
    SingleCellEvidenceProject,
    TotalContainer,
)

__all__ = [
    "PerturbationFacetValue",
    "PerturbationFacets",
    "PerturbationProject",
    "PerturbationProjects",
    "PerturbationProjectsResponse",
    "PerturbationSummary",
]


class PerturbationSummary(BaseModel):
    """The `/perturbation/summary` envelope: corpus-wide totals."""

    model_config = ConfigDict(extra="allow")

    studies: int = 0
    studies_high_medium: int = 0
    studies_high: int = 0
    studies_genetic: int = 0
    studies_chemical: int = 0
    studies_with_matrix: int = 0
    studies_with_fastq: int = 0
    studies_matrix_and_fastq: int = 0
    studies_human: int = 0
    samples: int | None = None
    cells: int | None = None
    first_year: int | None = None
    last_year: int | None = None


PerturbationFacetValue = FacetValue


PerturbationFacets = Facets


class PerturbationProject(SingleCellEvidenceProject):
    """One row of `/perturbation/projects`: a study with perturbation evidence."""

    perturbation_type: str | None = None
    confidence: str | None = None
    genetic_confidence: str | None = None
    chemical_confidence: str | None = None
    genetic_subtypes: list[str] | None = None
    perturbation_methods: list[str] | None = None
    compounds: list[str] | None = None
    # can be non-empty even when compounds is empty (e.g. sci-Plex barcodes)
    title_compounds: list[str] | None = None
    stimuli: list[str] | None = None
    has_control_arm: bool | None = None
    n_compound_values: int | None = None
    is_pooled: bool | None = None
    evidence: list[str] | None = None
    country: str | None = None
    pmid: str | None = None
    year: int | None = None


PerturbationProjectsResponse = OffsetPage[PerturbationProject]


class PerturbationProjects(TotalContainer[PerturbationProject]):
    """Studies matching `fetch_perturbation_projects`, with the server's total."""
