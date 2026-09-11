"""
Models for the long-read (PacBio / Oxford Nanopore) collection.

`LongreadRun` also backs the single-cell response's `longread_chemistry` list,
where the enclosing study supplies `study_accession`.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, RootModel

from seqout.models.models import BaseContainer


class LongreadRun(BaseModel):
    """One PacBio or Oxford Nanopore run's chemistry call."""

    model_config = ConfigDict(extra="allow")

    run_accession: str | None = None
    study_accession: str | None = None
    instrument_platform: str | None = None
    instrument_model: str | None = None
    chemistry: str | None = None
    # exact=bam header, declared=ont protocol, bucket=instrument_model, else unknown
    chemistry_confidence: str | None = None
    chemistry_source: str | None = None
    basecaller_software: str | None = None
    basecaller_software_version: str | None = None
    flow_cell_id: str | None = None
    ont_pore: str | None = None
    ont_kit: str | None = None
    ont_speed_bps: float | None = None
    ont_model_tier: str | None = None
    pacbio_platform_model: str | None = None
    pacbio_chemistry_code: str | None = None
    pacbio_binding_kit: str | None = None
    pacbio_sequencing_kit: str | None = None
    pacbio_smrtcell_kit: str | None = None


class LongreadChemistryResponse(BaseModel):
    """The `/project/{acc}/longread-chemistry` envelope."""

    model_config = ConfigDict(extra="ignore")

    accession: str
    runs: list[LongreadRun] = []


class LongreadSummary(BaseModel):
    """The `/longread/summary` envelope: corpus-wide totals."""

    model_config = ConfigDict(extra="allow")

    studies: int = 0
    experiments: int | None = None
    samples: int | None = None
    studies_pacbio: int = 0
    studies_nanopore: int = 0
    studies_both: int = 0
    studies_long_read_only: int = 0
    studies_hybrid: int = 0
    studies_human: int = 0
    studies_with_fastq: int = 0
    studies_single_cell: int = 0
    studies_exact_chemistry: int = 0
    first_year: int | None = None
    last_year: int | None = None


class LongreadFacetValue(BaseModel):
    """One value of one `/longread/facets` facet."""

    model_config = ConfigDict(extra="ignore")

    value: str | None = None
    studies: int = 0


class LongreadProject(BaseModel):
    """One row of `/longread/projects`: a study with a long-read experiment."""

    model_config = ConfigDict(extra="allow")

    study_accession: str
    accessions: list[str] = []
    archives: list[str] = []
    technologies: list[str] = []
    platforms: list[str] = []
    instrument_models: list[str] = []
    library_strategies: list[str] = []
    n_experiments: int | None = None
    n_experiments_total: int | None = None
    # None: no experiment rows to judge hybrid status by
    long_read_only: bool | None = None
    title: str | None = None
    organism: str | None = None
    organisms: list[str] = []
    n_samples: int | None = None
    assay_l1: str | None = None
    is_single_cell: bool | None = None
    country: str | None = None
    pmid: str | None = None
    first_published: str | None = None
    year: int | None = None
    has_fastq: bool | None = None
    has_sra: bool | None = None
    n_runs: int | None = None
    n_fastq_runs: int | None = None
    n_sra_runs: int | None = None
    chemistries: list[str] | None = None
    n_chemistry_runs: int | None = None
    n_chemistry_exact: int | None = None


class LongreadFacets(RootModel[dict[str, list[LongreadFacetValue]]]):
    """The `/longread/facets` envelope: facet name to its values and counts."""


class LongreadProjectsResponse(BaseModel):
    """The `/longread/projects` envelope."""

    model_config = ConfigDict(extra="ignore")

    total: int = 0
    count: int = 0
    offset: int = 0
    results: list[LongreadProject] = []


class LongreadProjects(BaseContainer[LongreadProject]):
    """Studies matching `fetch_longread_projects`, with the server's total."""

    def __init__(self, root: list[LongreadProject], /, **kwargs: Any) -> None:
        super().__init__(root)
        self.__dict__["total"] = kwargs.get("total", len(root))

    @property
    def total(self) -> int:
        """How many studies match, before `limit` cut the result."""
        return self.__dict__["total"]
