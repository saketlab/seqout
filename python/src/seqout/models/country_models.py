"""Models for the per-country collection (`/country/{code}/*`)."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from seqout.models.models import Facets, FacetValue, OffsetPage, TotalContainer


class CountrySummary(BaseModel):
    """The `/country/{code}/summary` envelope: corpus-wide totals for one country."""

    model_config = ConfigDict(extra="allow")

    studies: int = 0
    samples: int | None = None
    experiments: int | None = None
    studies_with_fastq: int = 0
    studies_with_sra: int = 0
    studies_human: int = 0
    studies_single_cell: int = 0
    studies_long_read: int = 0
    n_organisms: int = 0
    first_year: int | None = None
    last_year: int | None = None


CountryFacetValue = FacetValue


CountryFacets = Facets


class CountryProject(BaseModel):
    """One row of `/country/{code}/projects`: a study submitted from that country."""

    model_config = ConfigDict(extra="allow")

    study_accession: str
    title: str | None = None
    organism: str | None = None
    assay_l1: str | None = None
    assay_l2: str | None = None
    source: str
    n_samples: int | None = None
    n_experiments: int | None = None
    is_single_cell: bool | None = None
    single_cell_modality: str | None = None
    center_name: str | None = None
    pmid: str | None = None
    year: int | None = None
    has_fastq: bool | None = None
    has_sra: bool | None = None
    n_runs: int | None = None
    n_fastq_runs: int | None = None
    n_sra_runs: int | None = None
    has_matrix: bool | None = None
    n_cells: int | None = None
    has_long_read: bool = False
    technologies: list[str] | None = None


CountryProjectsResponse = OffsetPage[CountryProject]


class CountryProjects(TotalContainer[CountryProject]):
    """Studies matching `fetch_country_projects`, with the server's total."""
