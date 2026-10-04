"""
Models for the corpus-wide single-cell collection (`/single-cell/*`).

Distinct from the per-study Pentimento endpoints (`fetch_single_cell` /
`models/cohort_models.py`): this collection is one row per study with
matrix or read-derived single-cell evidence, or a declared single-cell
classification, across the whole corpus.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from seqout.models.models import Facets, FacetValue, OffsetPage, TotalContainer


class SingleCellSummary(BaseModel):
    """The `/single-cell/summary` envelope: corpus-wide totals."""

    model_config = ConfigDict(extra="allow")

    studies: int = 0
    samples: int | None = None
    cells: int | None = None
    studies_with_matrix: int = 0
    studies_with_fastq: int = 0
    studies_long_read: int = 0
    studies_with_perturbation: int = 0
    studies_human: int = 0
    n_modalities: int = 0
    first_year: int | None = None
    last_year: int | None = None


SingleCellFacetValue = FacetValue


SingleCellFacets = Facets


class SingleCellProject(BaseModel):
    """One row of `/single-cell/projects`: a study with single-cell evidence."""

    model_config = ConfigDict(extra="allow")

    study_accession: str
    title: str | None = None
    organism: str | None = None
    organisms: list[str] | None = None
    tissues: list[str] | None = None
    single_cell_modality: str | None = None
    chemistries: list[str] | None = None
    # read-derived, independent of chemistry; None when unscanned or ambiguous
    cell_or_nucleus: list[str] | None = None
    assay_l1: str | None = None
    n_samples: int | None = None
    has_matrix: bool = False
    n_cells: int | None = None
    has_fastq: bool | None = None
    n_fastq_runs: int | None = None
    has_sra: bool | None = None
    n_runs: int | None = None
    is_long_read: bool = False
    # a method named in the study text, not a confirmed design
    perturbation_method: list[str] | None = None
    intervention_kind: list[str] | None = None
    is_pooled: bool | None = None
    country: str | None = None
    pmid: str | None = None
    year: int | None = None


SingleCellProjectsResponse = OffsetPage[SingleCellProject]


class SingleCellProjects(TotalContainer[SingleCellProject]):
    """Studies matching `fetch_singlecell_projects`, with the server's total."""
