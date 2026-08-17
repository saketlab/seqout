"""
Records for the harmonised sample cohort and the read-derived screen.

Two things live here. The cohort is the harmonised data: seqout reads each
sample's free text and writes the tissue, disease, cell type, assay and age
into one vocabulary, with ontology IDs, so one filter reaches every study that
recorded the fact whatever words its submitter used.

The rest is Pentimento, which reads the sequencing reads themselves and calls
the species, the sex, the assay and any microbial sequence it finds. Those
calls often disagree with what the submitter declared, which is the point of
having them.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, field_validator

from seqout.models.models import BaseContainer


class CohortSample(BaseModel):
    """One sample in a cohort: its harmonised fields and its read-derived calls."""

    model_config = ConfigDict(extra="allow")  # the server may add fields

    sample: str | None = None
    study_accession: str | None = None

    # Harmonised fields, each with the ontology term it was matched to.
    organism: str | None = None
    taxid: str | None = None
    age: str | None = None
    age_days: float | None = None
    sex: str | None = None
    ethnicity: str | None = None
    phenotype: str | None = None
    cell_type: str | None = None
    tissue: str | None = None
    strain: str | None = None
    disease: str | None = None
    assay: str | None = None
    assay_category: str | None = None
    cell_line: str | None = None
    treatment: str | None = None
    development_stage: str | None = None
    sample_type: str | None = None
    genetic_modification: str | None = None
    tissue_primary_site: str | None = None
    tissue_site_type: str | None = None
    disease_ontology_id: str | None = None
    disease_ontology_name: str | None = None
    tissue_ontology_id: str | None = None
    tissue_ontology_name: str | None = None
    cell_type_ontology_id: str | None = None
    cell_type_ontology_name: str | None = None
    assay_ontology_id: str | None = None
    assay_ontology_name: str | None = None
    development_stage_ontology_id: str | None = None
    development_stage_ontology_name: str | None = None

    # Matrix dimensions. `cells` counts matrix columns, so for an unfiltered
    # 10x matrix these are barcodes and a sum overcounts.
    cells: int | None = None
    genes: int | None = None
    cell_count_estimated: int | None = None
    unfiltered: bool | None = None

    # Read-derived. `has_*_reads` is None when the sample was never screened
    # and False when the screen found no gated hit -- not the same thing.
    pentimento_assay: str | None = None
    assay_is_single_cell: bool | None = None
    hpv_top_type: str | None = None
    hpv_ambiguous: bool | None = None
    has_viral_reads: bool | None = None
    has_bacterial_reads: bool | None = None
    viral_kmer_mass: float | None = None
    bacterial_kmer_mass: float | None = None
    microbe_n_detections: int | None = None
    microbe_max_breadth_frac: float | None = None
    microbe_reads: float | None = None
    microbe_kmer_mass: float | None = None
    microbes_truncated: bool | None = None
    microbes: list[dict[str, Any]] | None = None


class Cohort(BaseContainer[CohortSample]):
    """Samples matching a cohort search, with what the server said about it."""

    def __init__(self, root: list[CohortSample], /, **kwargs: Any) -> None:
        super().__init__(root)
        # Carried beside the rows: the size of the whole cohort before `limit`,
        # and the filters the server understood, which is how you find out that
        # one was dropped.
        self.__dict__["total"] = kwargs.get("total", len(root))
        self.__dict__["filters"] = kwargs.get("filters") or {}

    @property
    def total(self) -> int:
        """How many samples match, before `limit` cut the result."""
        return self.__dict__["total"]

    @property
    def filters(self) -> dict[str, Any]:
        """The filters the server applied, as it understood them."""
        return self.__dict__["filters"]


class CohortResponse(BaseModel):
    """The /samples/search envelope."""

    model_config = ConfigDict(extra="ignore")

    samples: list[CohortSample] = []
    total: int = 0
    count: int = 0
    limit: int | None = None
    offset: int | None = None
    next_offset: int | None = None
    filters: dict[str, Any] = {}


class SingleCellSample(BaseModel):
    """One sample's matrix dimensions and read-derived calls."""

    model_config = ConfigDict(extra="allow")

    sample_accession: str | None = None
    cells: int | None = None
    genes: int | None = None
    nnz: int | None = None
    file_format: str | None = None
    unfiltered: bool | None = None
    n_runs: int | None = None
    n_runs_measurable: int | None = None
    species_called: str | None = None
    # A word, not a number: "high" / "medium" / "low".
    species_confidence: str | None = None
    species_ambiguous: bool | None = None
    species_mislabel: bool | None = None
    sex_verdict: str | None = None
    sex_confidence: str | None = None
    sex_panel_status: str | None = None
    sex_mixed_suspected: bool | None = None
    sex_reads_scanned: int | None = None
    y_hits: int | None = None
    xist_hits: int | None = None
    y_xist_ratio: float | None = None
    deep_n_reads: int | None = None
    assay: str | None = None
    assay_display: str | None = None
    assay_is_single_cell: bool | None = None
    calls_ambiguous: bool | None = None
    flags: list[str] | None = None
    n_flags: int | None = None
    hpv_top_type: str | None = None
    hpv_ambiguous: bool | None = None
    has_viral_reads: bool | None = None
    has_bacterial_reads: bool | None = None
    viral_kmer_mass: float | None = None
    bacterial_kmer_mass: float | None = None
    title: str | None = None
    tissue: str | None = None


class SingleCellStudy(BaseModel):
    """The study-wide row that comes with the per-sample breakdown."""

    model_config = ConfigDict(extra="allow")

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
    n_runs_measurable: int | None = None
    has_metadata: bool | None = None
    has_celltype: bool | None = None
    has_donor: bool | None = None
    has_demographics: bool | None = None
    flags: list[str] | None = None


class SingleCellSamples(BaseContainer[SingleCellSample]):
    """A study's per-sample breakdown, with the study row beside it."""

    def __init__(self, root: list[SingleCellSample], /, **kwargs: Any) -> None:
        super().__init__(root)
        self.__dict__["study"] = kwargs.get("study")
        self.__dict__["n_samples_total"] = kwargs.get("n_samples_total")

    @property
    def study(self) -> SingleCellStudy | None:
        """The study-wide row: total cells, run counts, what metadata exists."""
        return self.__dict__["study"]

    @property
    def n_samples_total(self) -> int | None:
        """How many samples the study has a breakdown for."""
        return self.__dict__["n_samples_total"]


class SingleCellResponse(BaseModel):
    """The /project/{acc}/single-cell envelope: a study row plus its samples."""

    model_config = ConfigDict(extra="allow")

    samples: list[SingleCellSample] = []
    n_samples_detailed: int | None = None


class MicrobeOrganism(BaseModel):
    """One organism detected in a sample, summed over its runs."""

    model_config = ConfigDict(extra="allow")

    organism: str | None = None
    kingdom: str | None = None
    class_: str | None = None
    n_organisms: int | None = None
    n_unitigs: int | None = None
    kmer_mass: float | None = None
    reads: float | None = None
    covered_bp: float | None = None
    max_breadth_frac: float | None = None
    is_validated_viral: bool | None = None
    is_viral_evidence: bool | None = None
    is_validated_bacterial: bool | None = None

    @field_validator("class_", mode="before")
    @classmethod
    def _from_class(cls, v: Any) -> Any:
        return v


class MicrobeDetection(BaseModel):
    """One organism in one run, before the per-sample rollup."""

    model_config = ConfigDict(extra="allow")

    run_accession: str | None = None
    gsm_accession: str | None = None
    sample_accession: str | None = None
    study_accession: str | None = None
    organism: str | None = None
    kingdom: str | None = None
    n_unitigs: int | None = None
    kmer_mass: float | None = None
    reads: float | None = None
    covered_bp: float | None = None
    breadth_frac: float | None = None
    measurable: bool | None = None
    is_background: bool | None = None
    is_validated_viral: bool | None = None
    is_viral_evidence: bool | None = None
    is_validated_bacterial: bool | None = None


class MicrobeTotals(BaseModel):
    """Summed detection weight, for a kingdom or for the sample as a whole."""

    model_config = ConfigDict(extra="allow")

    n_organisms: int | None = None
    n_unitigs: int | None = None
    kmer_mass: float | None = None
    reads: float | None = None
    covered_bp: float | None = None
    max_breadth_frac: float | None = None


class Microbes(BaseContainer[MicrobeOrganism]):
    """
    What was found in a sample's reads, and whether it could be found at all.

    An empty result with `measurable` False reports missing data: the sample was
    never screened, so nothing is ruled out.
    """

    def __init__(self, root: list[MicrobeOrganism], /, **kwargs: Any) -> None:
        super().__init__(root)
        for name in (
            "detections",
            "measurable",
            "n_runs",
            "totals",
            "by_kingdom",
            "control_kingdoms",
        ):
            self.__dict__[name] = kwargs.get(name)

    @property
    def detections(self) -> list[MicrobeDetection]:
        """Every organism in every run, before the rollup."""
        return self.__dict__["detections"] or []

    @property
    def measurable(self) -> bool | None:
        """Whether the sample was screened at all. False means no data."""
        return self.__dict__["measurable"]

    @property
    def n_runs(self) -> int | None:
        return self.__dict__["n_runs"]

    @property
    def totals(self) -> MicrobeTotals | None:
        return self.__dict__["totals"]

    @property
    def by_kingdom(self) -> dict[str, MicrobeTotals]:
        return self.__dict__["by_kingdom"] or {}

    @property
    def control_kingdoms(self) -> list[str]:
        """Kingdoms held out of the totals: the spike-in and the calibrator."""
        return self.__dict__["control_kingdoms"] or []


class MicrobesResponse(BaseModel):
    """The /sample/{acc}/microbes envelope."""

    model_config = ConfigDict(extra="allow")

    sample_accession: str | None = None
    measurable: bool | None = None
    n_runs: int | None = None
    totals: MicrobeTotals | None = None
    control_kingdoms: list[str] = []
    by_kingdom: dict[str, MicrobeTotals] = {}
    by_organism: list[MicrobeOrganism] = []
    detections: list[MicrobeDetection] = []
