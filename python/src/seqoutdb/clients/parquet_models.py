import datetime

from pydantic import BaseModel


class _ExternalRef(BaseModel):
    source: str
    accession: str


class Study(BaseModel):
    accession: str
    title: str
    description: str | None = None
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
