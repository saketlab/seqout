"""
Models for the tissue collection (`/tissue/{term}/*`).

`term` is always free text resolved against UBERON.
`/tissue/{term}/projects` is keyset-paginated on `(sort_val, accession)`, not
`offset`; see `OntologyTermCursor`.
"""

from __future__ import annotations

from seqout.models.disease_models import (
    CursorPage,
    OntologyTermCursor,
    OntologyTermProjectBase,
    OntologyTermSummary,
)
from seqout.models.models import Facets, FacetValue, TotalContainer

__all__ = [
    "OntologyTermCursor",
    "OntologyTermSummary",
    "TissueFacetValue",
    "TissueFacets",
    "TissueProject",
    "TissueProjects",
    "TissueProjectsResponse",
]


TissueFacetValue = FacetValue


TissueFacets = Facets


class TissueProject(OntologyTermProjectBase):
    """One row of `/tissue/{term}/projects`: a study with a sample in that tissue."""

    # samples with any resolved tissue, not just term
    n_samples_with_tissue: int | None = None
    has_fastq: bool | None = None
    has_sra: bool | None = None
    n_runs: int | None = None
    n_fastq_runs: int | None = None
    n_sra_runs: int | None = None
    is_long_read: bool = False


TissueProjectsResponse = CursorPage[TissueProject]


class TissueProjects(TotalContainer[TissueProject]):
    """Studies matching `fetch_tissue_projects`, with the server's total."""
