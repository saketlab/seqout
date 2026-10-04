"""
Models for the corpus-wide spatial transcriptomics collection (`/spatial/*`).

One row per study flagged single-cell modality "Spatial Transcriptomics".
Membership comes from the modality classifier unscored. `platforms` names
what the study text mentions (Visium, Xenium, MERFISH, ...), not proof a
platform was used, and is often null.
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
    "SpatialFacetValue",
    "SpatialFacets",
    "SpatialProject",
    "SpatialProjects",
    "SpatialProjectsResponse",
    "SpatialSummary",
]


class SpatialSummary(BaseModel):
    """The `/spatial/summary` envelope: corpus-wide totals."""

    model_config = ConfigDict(extra="allow")

    studies: int = 0
    studies_named_platform: int = 0
    studies_single_cell_res: int = 0
    studies_spot_res: int = 0
    studies_roi_res: int = 0
    studies_with_matrix: int = 0
    studies_with_fastq: int = 0
    studies_matrix_and_fastq: int = 0
    studies_human: int = 0
    samples: int | None = None
    cells: int | None = None
    first_year: int | None = None
    last_year: int | None = None


SpatialFacetValue = FacetValue


SpatialFacets = Facets


class SpatialProject(SingleCellEvidenceProject):
    """One row of `/spatial/projects`: a study with spatial transcriptomics evidence."""

    platforms: list[str] | None = None
    resolution: str | None = None
    technology: str | None = None
    country: str | None = None
    pmid: str | None = None
    year: int | None = None


SpatialProjectsResponse = OffsetPage[SpatialProject]


class SpatialProjects(TotalContainer[SpatialProject]):
    """Studies matching `fetch_spatial_projects`, with the server's total."""
