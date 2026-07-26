from __future__ import annotations

import json
from collections import Counter
from typing import Any, Literal

from pydantic import (
    BaseModel,
    Field,
    field_validator,
    model_validator,
)

from seqoutdb.models.models import BaseContainer

_MAX_QUERY_LENGTH = 500


# full-text search
class SearchParams(BaseModel):
    q: str
    db: Literal["geo", "sra", "arrayexpress", "ena", "gsa", "dra", "gea"] | None = None
    organism: str | None = None  # exact scientific name, e.g. "Homo sapiens"
    sortby: Literal["citations", "journal", "year"] | None = None
    order: Literal["asc", "desc"] | None = "desc"
    date_from: str | None = None  # ISO yyyy-mm-dd; server filters on updated_at
    date_to: str | None = None
    cursor_rank: float | None = None
    cursor_acc: str | None = None
    cursor_sort: str | None = None

    @field_validator("q")
    @classmethod
    def _query_must_be_valid(cls, v: str) -> str:
        v = v.strip()

        if not v:
            msg = "search query cannot be empty"
            raise ValueError(msg)
        if len(v) > _MAX_QUERY_LENGTH:
            msg = "query cannot exceed 500 characters"
            raise ValueError(msg)

        return v


class StructuredSearchParams(BaseModel):
    q: str | None = None
    organism: str | None = None
    library_strategy: str | None = None
    platform: str | None = None
    country: str | None = None
    center: str | None = None
    year_from: int | None = None
    year_to: int | None = None
    source: str | None = None
    journal: str | None = None
    instrument_model: str | None = None
    multi_platform: bool | None = None
    assay_l1: str | None = None
    assay_l2: str | None = None
    geo_country_code_iso2: str | None = None
    geo_lat: float | None = None
    geo_lng: float | None = None
    geo_radius_km: float | None = None
    cursor_rank: float | None = None
    cursor_acc: str | None = None


class Publication(BaseModel):
    doi: str | None = None
    issn: str | None = None
    pmid: str | None = None
    title: str | None = None
    authors: str | None = None
    journal: str | None = None
    pub_date: str | None = None
    citation_count: int | None = None
    journal_h_index: int | None = None
    journal_i10_index: int | None = None
    journal_works_count: int | None = None
    journal_cited_by_count: int | None = None
    journal_2yr_mean_citedness: float | None = None

    @field_validator("pub_date", mode="before")
    @classmethod
    def _pub_date_to_str(cls, v: object) -> str | None:
        return str(v) if v is not None else None  # API sends a bare int year sometimes


class SearchResult(BaseModel):
    accession: str
    title: str
    summary: str | None = None
    updated_at: str | None = None
    organisms: list[str] = []
    countries: list[str] = []
    rank: float
    source: str
    total_count: int | None = None
    instrument_models: list[str] = []
    publications: list[Publication] = []
    pmid: str | None = None
    publication_title: str | None = None
    journal: str | None = None
    doi: str | None = None
    authors: str | None = None
    citation_count: int = 0
    center_name: str | None = None
    country_code: str | None = None
    is_single_cell: bool | None = None
    single_cell_modality: str | None = None

    @field_validator(
        "organisms", "countries", "instrument_models", "publications", mode="before"
    )
    @classmethod
    def _null_to_empty_list(cls, v: Any) -> list:
        return v or []

    @field_validator("citation_count", mode="before")
    @classmethod
    def _normalize_nullable_ints(cls, v: Any) -> int:
        return v or 0

    @field_validator("countries", mode="after")
    @classmethod
    def _lowercase_list(cls, v: list[str]) -> list[str]:
        return [item.lower() for item in v]

    @model_validator(mode="after")
    def _normalize_countries(self) -> SearchResult:
        if self.countries:
            self.country_code = self.countries[0].upper()

        self.countries = [code.upper() for code in self.countries]
        return self

    def has_organism(self, org: str) -> bool:
        return any(o.casefold() == org.casefold() for o in self.organisms)


class NextCursor(BaseModel):
    rank: float | None = None  # rank-based paging; absent when sorting
    accession: str
    sort_value: float | None = None  # present when paging a sorted search


class SearchResponse(BaseModel):
    results: list[SearchResult]
    total: int | None = None  # null when the backend skips the count on broad queries
    took_ms: float
    next_cursor: NextCursor | None = None

    def to_results(self) -> SearchResults:
        return SearchResults(self.results)


class SearchResults(BaseContainer[SearchResult]):
    def offset(self, n: int) -> SearchResults:
        return SearchResults(self.root[n:])

    def limit(self, n: int) -> SearchResults:
        return SearchResults(self.root[:n])

    def slice(self, start: int, stop: int) -> SearchResults:
        return SearchResults(self.root[start:stop])

    def filter(self, **kwargs: Any) -> SearchResults:
        filtered = self.root

        for field, value in kwargs.items():
            is_string_filter = isinstance(value, str)
            filtered = [
                r
                for r in filtered
                if (field_val := getattr(r, field, None)) is not None
                and (
                    field_val.casefold() == value.casefold()
                    if is_string_filter and isinstance(field_val, str)
                    else field_val == value
                )
            ]

        return SearchResults(filtered)

    def exclude(self, **kwargs: Any) -> SearchResults:
        filtered = self.root
        for field, value in kwargs.items():
            filtered = [r for r in filtered if getattr(r, field, None) != value]
        return SearchResults(filtered)

    def by_source(self, source: str) -> SearchResults:
        return self.filter(source=source)

    def by_organism(self, organism: str) -> SearchResults:
        return SearchResults([r for r in self if r.has_organism(organism)])

    def organisms(self) -> Counter[str]:
        return Counter(org for r in self.root for org in r.organisms)

    def sources(self) -> Counter[str]:
        return Counter(r.source for r in self.root if r.source)

    def countries(self) -> Counter[str]:
        return Counter(c for r in self.root for c in r.countries)

    def sort_by(self, field: str, *, reverse: bool = False) -> SearchResults:
        def sort_key(r: Any) -> Any:
            value = getattr(r, field)
            return value if value is not None else 0

        not_none = [r for r in self.root if getattr(r, field) is not None]
        none_values = [r for r in self.root if getattr(r, field) is None]

        return SearchResults(
            sorted(not_none, key=sort_key, reverse=reverse) + none_values
        )

    def top_cited(self, n: int = 10) -> SearchResults:
        return self.sort_by("citation_count", reverse=True).limit(n)

    def most_recent(self, n: int = 10) -> SearchResults:
        return self.sort_by("updated_at", reverse=True).limit(n)


# project summary
class ProjectSummaryResult(BaseModel):
    accession: str
    title: str
    description: str | None = None
    organisms: list[str] | None = None


class ProjectSummaryResultList(BaseContainer[ProjectSummaryResult]):
    pass


# project metadata
class ProjectMetadataRelation(BaseModel):
    type: str | None = Field(alias="@type", default=None)
    target: str | None = Field(alias="@target", default=None)


class ProjectMetadataNeighbor(BaseModel):
    x_2d: float | None = None
    x_3d: float | None = None
    y_2d: float | None = None
    y_3d: float | None = None
    z_3d: float | None = None
    source: str
    accession: str


class ProjectMetadataResult(BaseModel):
    accession: str
    alias: list[str] | str | None = None
    title: str
    summary: str | None = None
    overall_design: str | None = None
    pubmed_ids: list[str] = Field(alias="pubmed_id", default=[])
    publications: list[Publication] | None = None
    samples_ref: list[str] = []
    series_type: list[str] = []
    relations: list[ProjectMetadataRelation] = Field(alias="relation", default=[])
    neighbors: list[ProjectMetadataNeighbor] = []
    supplementary_data: list[tuple[str, str]] = []
    published_at: str | None = None
    updated_at: str | None = None
    organisms: list[str] | None = None
    pmid: str | None = None
    publication_title: str | None = None
    journal: str | None = None
    doi: str | None = None
    authors: str | None = None
    citation_count: int = 0
    center_name: str | None = None
    country_code: str | None = None
    is_single_cell: bool | None = None
    single_cell_modality: str | None = None

    @field_validator("supplementary_data", mode="before")
    @classmethod
    def _flatten_supplementary_data(cls, v: Any) -> list[tuple[str, str]]:
        return [(item["#text"], item["@type"]) for item in v]

    @field_validator(
        "relations",
        "neighbors",
        "samples_ref",
        "series_type",
        "supplementary_data",
        "pubmed_ids",
        mode="before",
    )
    @classmethod
    def _null_to_empty_list(cls, v: Any) -> list:
        return v or []

    @field_validator("relations", mode="before")
    @classmethod
    def _filter_invalid_relations(cls, v: Any) -> list:
        if not v:
            return []

        return [
            item
            for item in v
            if isinstance(item, dict) and item.get("@type") and item.get("@target")
        ]


# project cross references
class ProjectCrossReferenceResult(BaseModel):
    accession: str
    link_type: str
    source: str


class ProjectCrossReferenceList(BaseContainer[ProjectCrossReferenceResult]):
    pass


class ProjectCrossReferenceResponse(BaseModel):
    accession: str
    xref: ProjectCrossReferenceList


# llm enriched sample metadata
class ProjectLLMEnrichedSampleMetadataResult(BaseModel):
    sample: str
    age: str | None = None
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
    organism: str | None = None
    taxid: str | None = None
    tissue_primary_site: str | None = None
    tissue_site_type: str | None = None
    cell_count: int | None = None
    gene_count: int | None = None
    cell_count_estimated: int | None = None
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


class ProjectLLMEnrichedSampleMetadataResults(
    BaseContainer[ProjectLLMEnrichedSampleMetadataResult]
):
    pass


class ProjectLLMEnrichedSampleMetadataResponse(BaseModel):
    accession: str
    title: str
    n_samples: int
    single_cell_modality: str | None = None
    version: str
    samples: ProjectLLMEnrichedSampleMetadataResults


# study experiments
class StudyExperimentsResult(BaseModel):
    accession: str
    title: str
    design_description: str | None = None
    library_layout: str
    library_name: str | None = None
    library_selection: str
    library_source: str
    library_strategy: str
    samples: list[str]
    platform: str
    instrument_model: str
    submission: str


class StudyExperimentsResults(BaseContainer[StudyExperimentsResult]):
    pass


# study runs
class StudyRunsResult(BaseModel):
    run_accession: str
    experiment_accession: str
    library_layout: str
    run_alias: str
    fastq_ftp: str | None = None
    fastq_bytes: str | None = None
    fastq_md5: str | None = None
    sra_ftp: str | None = None
    sra_bytes: str | None = None
    sra_md5: str | None = None
    ncbi_sra_url: str | None = None
    ncbi_sra_url_aws: str | None = None
    ncbi_sra_normalized_url: str | None = None
    ncbi_sra_normalized_bytes: int | None = None
    ncbi_sra_lite_url: str | None = None
    ncbi_sra_lite_bytes: str | None = None
    ncbi_sra_lite_s3_url: str | None = None
    ncbi_sra_lite_gs_url: str | None = None


class StudyRunsResults(BaseContainer[StudyRunsResult]):
    pass


class StudyRunsResponse(BaseModel):
    total_runs: int
    paired_runs: int
    single_runs: int
    total_fastq_bytes: int
    runs: StudyRunsResults


# experiment samples
class ExperimentSampleOrganism(BaseModel):
    text: str = Field(alias="#text")
    taxonomy_id: str = Field(alias="@taxid")


class ExperimentSampleChannel(BaseModel):
    source: str = Field(alias="Source")
    molecule: str | None = Field(alias="Molecule", default=None)
    organism: ExperimentSampleOrganism | None = Field(alias="Organism", default=None)
    position: int = Field(alias="@position")
    characteristics: dict[str, str] = Field(alias="Characteristics")
    growth_protocol: str | None = None
    extract_protocol: str | None = None
    treatment_protocol: str | None = None

    @field_validator("characteristics", mode="before")
    @classmethod
    def _flatten_characteristics(cls, v: Any) -> dict[str, str]:
        if isinstance(v, dict):  # single characteristic isn't wrapped in a list
            v = [v]
        result: dict[str, str] = {}
        for item in v or []:
            result[item["@tag"]] = item["#text"]
        return result


class ExperimentSample(BaseModel):
    accession: str
    title: str
    description: str | None = None
    sample_type: str | None = None
    channel_count: int
    channels: list[ExperimentSampleChannel]
    platform_ref: str | None = None
    supplementary_data: list[str] = []
    hybridization_protocol: str | None = None
    scan_protocol: str | None = None
    published_at: str | None = None
    updated_at: str | None = None

    @field_validator("supplementary_data", mode="before")
    @classmethod
    def _flatten_supplementary_data(cls, v: Any) -> list[str]:
        if not v:
            return []
        if isinstance(v, dict):  # single file isn't wrapped in a list
            v = [v]
        return [item["#text"] for item in v]


class ExperimentSampleList(BaseContainer[ExperimentSample]):
    pass


# sample metadata
class SampleMetadataResult(BaseModel):
    accession: str
    alias: str | None = None
    title: str
    description: str | None = None
    scientific_name: str | None = None
    taxon_id: int
    submission: str
    external_ids: dict | None = Field(alias="external_id", default=None)
    links: dict | None = None
    attributes: dict | None = Field(alias="attributes_json", default=None)

    @field_validator("external_ids", "attributes", "links", mode="before")
    @classmethod
    def _parse_json_str(cls, v: Any) -> Any:
        if isinstance(v, str):
            return json.loads(v)
        return v


# sample detailed metadata
class SampleDetailedMetadata(BaseModel):
    sample_type: str
    project: ProjectMetadataResult
    sample: SampleMetadataResult


# GEO sample detail: same /sample-detail/{acc} endpoint, but a GSM's `sample` is a
# channels-based ExperimentSample rather than an SRA SampleMetadataResult.
class GeoSampleDetailedMetadata(BaseModel):
    sample_type: str
    project: ProjectMetadataResult
    sample: ExperimentSample
