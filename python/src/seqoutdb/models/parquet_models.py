import datetime

from pydantic import BaseModel


class _ExternalRef(BaseModel):
    source: str
    accession: str


class Study(BaseModel):
    accession: str
    title: str
    description: str | None = None
    overall_design: str | None = None
    pubmed_id: str | None = None
    journal: str | None = None
    citation_count: int
    aliases: list[str]
    organisms: list[str]
    library_strategies: list[str]
    assay_l1: list[str]
    assay_l2: list[str]
    num_experiments: int
    num_samples: int
    center_names: list[str]
    is_single_cell: bool
    single_cell_modality: str | None = None
    published_at: datetime.date | None = None


class _Experiment(BaseModel):
    accession: str
    title: str
    platform: str
    instrument_model: str
    library_layout: str
    library_name: str | None = None
    library_selection: str
    library_source: str
    library_strategy: str


class SRAExperiment(_Experiment):
    samples: list[str]
    design_description: str | None = None
    submission: str


class ENAExperiment(_Experiment):
    sample: str
    organism: str | None = None
    taxonomy_id: int | None = None
    host: str | None = None
    tissue_type: str | None = None
    cell_type: str | None = None
    disease: str | None = None
    dev_stage: str | None = None
    base_count: int
    read_count: int


class Sample(BaseModel):
    accession: str
    alias: str
    title: str | None = None
    description: str | None = None
    organism: str | None = None
    taxonomy_id: int
    extract_protocol: str | None = None
    growth_protocol: str | None = None
    hybridization_protocol: str | None = None
    scan_protocol: str | None = None
    characteristics: list[dict]
    supplementary_data: list[str]
