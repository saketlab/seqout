"""
Models for the Pentimento single-cell calls on a whole study, or the corpus.

`/project/{acc}/single-cell/status` and `/summary` nest the evidence behind the
call under `evidence`; it is flattened into the row so one record says it all.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, model_validator

from seqout.models.models import BaseContainer


def _flatten_evidence(data: Any) -> Any:
    """Lift `evidence` into the row; a field the row already has wins."""
    if not isinstance(data, dict) or not isinstance(data.get("evidence"), dict):
        return data
    row = {k: v for k, v in data.items() if k != "evidence"}
    return {**data["evidence"], **row}


class _Evidence(BaseModel):
    """What backs a single-cell call: matrices, barcodes, read lengths."""

    model_config = ConfigDict(extra="allow")

    samples_with_matrix: int | None = None
    barcode_whitelist_hit: bool | None = None
    r1_length_single_cell: bool | None = None
    n_independent_evidence: int | None = None
    has_matrix: bool | None = None
    has_reads_linked: bool | None = None
    reads_scanned: bool | None = None
    # matrix_and_reads, matrix_reads_unscanned, matrix_only or reads_only
    kind: str | None = None
    # a study can file reads under more than one accession
    matrix_accessions: list[str] | None = None
    reads_accessions: list[str] | None = None

    @model_validator(mode="before")
    @classmethod
    def _lift_evidence(cls, data: Any) -> Any:
        return _flatten_evidence(data)


class SingleCellStatus(_Evidence):
    """Whether a study is single-cell, and the evidence behind the call."""

    accession: str | None = None
    queried_as: str | None = None
    source: str | None = None
    single_cell_status: str | None = None
    in_unified_metadata: bool | None = None
    in_pentimento: bool | None = None


class SingleCellStatusResult(BaseContainer[SingleCellStatus]):
    """One status row, or none when both catalogues lack the accession."""


class SingleCellStudySummary(_Evidence):
    """A study's single-cell rollup: cells, reads scanned, microbes measured."""

    study_accession: str | None = None
    source: str | None = None
    title: str | None = None
    study_cells: int | None = None
    cells_unfiltered: bool | None = None
    single_cell_file_format: str | None = None
    n_samples_reported: int | None = None
    n_samples_detailed: int | None = None
    sample_cells_total: int | None = None
    unassigned_cells: int | None = None
    sample_breakdown_complete: bool | None = None
    any_unfiltered: bool | None = None
    n_runs_linked: int | None = None
    n_runs_preflightx: int | None = None
    n_runs_measurable: int | None = None
    has_metadata: bool | None = None
    has_celltype: bool | None = None
    has_donor: bool | None = None
    has_demographics: bool | None = None
    flags: list[str] | None = None
    queried_as: str | None = None
    single_cell_status: str | None = None
    microbe_measured: bool | None = None
    n_viral_organisms: int | None = None
    n_bacterial_organisms: int | None = None


class SingleCellStudySummaryResult(BaseContainer[SingleCellStudySummary]):
    """One summary row, or none when the study is not in the Pentimento."""


class SingleCellCorpusStudy(BaseModel):
    """One row of `/single-cell/studies`: a study with single-cell evidence."""

    model_config = ConfigDict(extra="allow")

    study_accession: str | None = None
    counted_matrix: bool | None = None
    barcode_whitelist_hit: bool | None = None
    r1_length_single_cell: bool | None = None
    n_independent_evidence: int | None = None
    kind: str | None = None
    study_cells: int | None = None
    any_unfiltered: bool | None = None
    single_cell_status: str | None = None


class SingleCellCorpusStudies(BaseContainer[SingleCellCorpusStudy]):
    """Studies with single-cell evidence, one row each."""


class SingleCellStudiesResponse(BaseModel):
    """The `/single-cell/studies` envelope; it carries no total."""

    model_config = ConfigDict(extra="ignore")

    studies: list[SingleCellCorpusStudy] = []
