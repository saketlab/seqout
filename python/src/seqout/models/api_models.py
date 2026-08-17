from __future__ import annotations

import json
from collections import Counter
from typing import Any, Literal

from pydantic import (
    AliasChoices,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from seqout.models.models import BaseContainer

_MAX_QUERY_LENGTH = 500


def _join_authors(v: Any) -> Any:
    """
    Accept an author list as well as the joined string GEO and SRA send.

    GSA (CRA/HRA) returns authors as a list on the project endpoint.
    """
    if isinstance(v, list):
        return ", ".join(str(a) for a in v if a) or None
    return v


class SearchParams(BaseModel):
    """
    Every parameter the full-text ``/search`` endpoint accepts.

    ``extra="forbid"`` on purpose. Pydantic's default is to drop a field it
    does not declare, which turned ``search("liver", assay_l1="…")`` into an
    unfiltered search that looked filtered. A name this endpoint cannot answer
    has to say so.
    """

    model_config = ConfigDict(extra="forbid")

    q: str | None = None  # optional when at least one filter is set (query-less)
    db: Literal["geo", "sra", "arrayexpress", "ena", "gsa", "dra", "gea"] | None = None
    organism: str | None = None
    library_strategy: list[str] | None = None  # GEO/SRA only; NULL elsewhere
    library_source: list[str] | None = None  # SRA only; NULL elsewhere
    platform: list[str] | None = None  # GEO/SRA only; NULL elsewhere
    country: list[str] | None = None
    journal: list[str] | None = None
    instrument_model: list[str] | None = None
    multi_platform: bool | None = None
    sortby: Literal["citations", "journal", "year"] | None = None
    order: Literal["asc", "desc"] | None = "desc"
    date_from: str | None = None  # ISO yyyy-mm-dd; server filters on updated_at
    date_to: str | None = None
    # Read q as a boolean expression and take its terms exactly: no ontology
    # expansion, no spelling correction. A query already carrying (), "", * or
    # an uppercase OR/AND/NOT is read that way anyway; this forces it on one
    # that carries none. Unrelated to the /search/structured endpoint.
    structured: bool | None = None
    offset: int | None = None
    cursor_rank: float | None = None
    cursor_acc: str | None = None
    cursor_sort: str | None = None

    @field_validator("q")
    @classmethod
    def _query_must_be_valid(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()

        if not v:
            msg = "search query cannot be empty"
            raise ValueError(msg)
        if len(v) > _MAX_QUERY_LENGTH:
            msg = "query cannot exceed 500 characters"
            raise ValueError(msg)

        return v


class StructuredSearchParams(BaseModel):
    """
    Every parameter the ``/search/structured`` endpoint accepts.

    Deliberately without ``sortby``, ``order``, ``date_from``, ``date_to``,
    ``db`` and ``structured``: that endpoint has no such parameters, and FastAPI
    drops a query parameter it does not declare, so declaring them here would
    have moved a silent failure from this process to the server rather than
    fixing it. ``extra="forbid"`` makes passing one an error that names it.
    Use :class:`SearchParams` when you need them.
    """

    model_config = ConfigDict(extra="forbid")

    q: str | None = None
    organism: str | None = None
    library_strategy: str | None = None
    platform: str | None = None
    country: str | None = None
    source: str | None = None
    journal: str | None = None
    instrument_model: str | None = None
    multi_platform: bool | None = None
    assay_l1: str | None = None
    assay_l2: str | None = None
    geo_country: str | None = None
    geo_country_code: str | None = None
    geo_country_code_iso2: str | None = None
    geo_city: str | None = None
    geo_state: str | None = None
    geo_district: str | None = None
    geo_postcode: str | None = None
    geo_lat: float | None = None
    geo_lng: float | None = None
    geo_radius_km: float | None = None
    # Day-granularity bounds. published_* is the study's release date;
    # pub_date_* is the linked paper's, and is best-effort — only papers with a
    # full day-level date match.
    published_after: str | None = None
    published_before: str | None = None
    pub_date_after: str | None = None
    pub_date_before: str | None = None
    # Narrow to studies with a matching sample, on the harmonised fields.
    sample_tissue: str | None = None
    sample_disease: str | None = None
    sample_cell_type: str | None = None
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

    @field_validator("authors", mode="before")
    @classmethod
    def _normalize_authors(cls, v: Any) -> Any:
        return _join_authors(v)


class LinkedProject(BaseModel):
    accession: str
    source: str | None = None
    title: str | None = None
    via: str | None = None  # the table the publication link came from


class InstituteFacet(BaseModel):
    name: str
    count: int = 0


class PublicationLookupResult(BaseModel):
    """Reverse lookup: a publication (pmid/doi) -> its linked projects."""

    pmid: str | None = None
    doi: str | None = None
    title: str | None = None
    journal: str | None = None
    projects: list[LinkedProject] = []
    total_projects: int = 0

    @field_validator("pmid", mode="before")
    @classmethod
    def _pmid_to_str(cls, v: object) -> str | None:
        return str(v) if v is not None else None


class SearchResult(BaseModel):
    accession: str
    title: str
    summary: str | None = None
    updated_at: str | None = None
    organisms: list[str] = []
    countries: list[str] = []
    rank: float | None = None  # NULL on query-less (filter-only) search: no FTS score
    source: str | None = None  # absent on /author/projects rows (derive from prefix)
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

    @field_validator("authors", mode="before")
    @classmethod
    def _normalize_authors(cls, v: Any) -> Any:
        return _join_authors(v)

    def has_organism(self, org: str) -> bool:
        return any(o.casefold() == org.casefold() for o in self.organisms)


class NextCursor(BaseModel):
    rank: float | None = None  # rank-based paging; absent when sorting
    accession: str
    sort_value: float | None = None  # present when paging a sorted search


class SearchCorrection(BaseModel):
    """
    Spelling correction the backend applied to a text query.

    replaced  - corrected-query results already substituted into results.
    augmented - original results kept; typo-corrected matches ride along in
    extra_results (shown as a separate block, like the web app does).
    """

    original_query: str
    corrected_query: str
    mode: Literal["replaced", "augmented"]
    original_total: int | None = None
    extra_results: list[SearchResult] = []

    @field_validator("extra_results", mode="before")
    @classmethod
    def _null_to_empty_list(cls, v: Any) -> list:
        return v or []


class SearchResponse(BaseModel):
    results: list[SearchResult]
    total: int | None = None  # null when the backend skips the count on broad queries
    took_ms: float
    next_cursor: NextCursor | None = None
    correction: SearchCorrection | None = None

    def to_results(self) -> SearchResults:
        return SearchResults(self.results)


class BamFile(BaseModel):
    """
    One alignment file a submitter sent, and where it can be read.

    `url`/`https_url` are anonymous; `s3_url` is requester-pays and bills the
    caller, so it is reported rather than fetched. Roughly one file in seven is
    anonymously readable, and every one carries an md5.
    """

    run_accession: str | None = None
    experiment_accession: str | None = None
    filename: str | None = None
    semantic_name: str | None = None
    size: int | None = None
    md5: str | None = None
    url: str | None = None
    https_url: str | None = None
    s3_url: str | None = None

    @property
    def open_url(self) -> str | None:
        """The URL any client can read, or None when it is requester-pays."""
        return self.url or self.https_url or None

    @field_validator("size", mode="before")
    @classmethod
    def _size_to_int(cls, v: Any) -> int | None:
        return int(v) if v not in (None, "") else None

    @field_validator("url", "https_url", "s3_url", mode="before")
    @classmethod
    def _blank_to_none(cls, v: Any) -> Any:
        return v or None


class BamFiles(BaseContainer[BamFile]):
    """
    A study's alignment files.

    `total_bams` and `total_bam_bytes` are the endpoint's own headline numbers;
    both are exactly the rows summed, so they are computed rather than carried.
    """

    @property
    def total_bams(self) -> int:
        return len(self.root)

    @property
    def total_bam_bytes(self) -> int:
        return sum(b.size or 0 for b in self.root)

    @property
    def openly_readable(self) -> list[BamFile]:
        """The files this client can fetch without an account."""
        return [b for b in self.root if b.open_url]

    @property
    def requester_pays(self) -> list[BamFile]:
        """The files only a paying account can read."""
        return [b for b in self.root if not b.open_url]


class BamsResponse(BaseModel):
    """The /project/{acc}/bams envelope."""

    model_config = ConfigDict(extra="ignore")

    total_bams: int = 0
    total_bam_bytes: int = 0
    bams: list[BamFile] = []

    def to_files(self) -> BamFiles:
        return BamFiles(self.bams)


class SearchTotal(BaseModel):
    """Just the count from /search/facets; the facet buckets are ignored."""

    model_config = ConfigDict(extra="ignore")

    total: int | None = None


class SearchResults(BaseContainer[SearchResult]):
    """
    A list of search hits, with subsetting and summary helpers.

    Every method that narrows the set returns a new SearchResults, so calls
    chain. Inherited from BaseContainer: to_df, to_csv, to_dict.
    """

    def offset(self, n: int) -> SearchResults:
        """Drop the first n hits."""
        return SearchResults(self.root[n:])

    def limit(self, n: int) -> SearchResults:
        """Keep the first n hits."""
        return SearchResults(self.root[:n])

    def slice(self, start: int, stop: int) -> SearchResults:
        """Keep hits from start up to stop."""
        return SearchResults(self.root[start:stop])

    def filter(self, **kwargs: Any) -> SearchResults:
        """
        Keep hits whose fields all equal the given values.

        String comparisons ignore case. A hit missing one of the fields is
        dropped.

        Args:
            **kwargs: Field name to required value, e.g. source="geo".

        """
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
        """
        Drop hits whose fields equal the given values.

        Comparison is exact, so this is case-sensitive where filter is not.

        Args:
            **kwargs: Field name to unwanted value.

        """
        filtered = self.root
        for field, value in kwargs.items():
            filtered = [r for r in filtered if getattr(r, field, None) != value]
        return SearchResults(filtered)

    def by_source(self, source: str) -> SearchResults:
        """Keep hits from one archive, e.g. geo or sra."""
        return self.filter(source=source)

    def by_organism(self, organism: str) -> SearchResults:
        """Keep hits that list the given organism."""
        return SearchResults([r for r in self if r.has_organism(organism)])

    def organisms(self) -> Counter[str]:
        """Count how often each organism appears across the hits."""
        return Counter(org for r in self.root for org in r.organisms)

    def sources(self) -> Counter[str]:
        """Count the hits from each archive."""
        return Counter(r.source for r in self.root if r.source)

    def countries(self) -> Counter[str]:
        """Count the hits from each submitting country."""
        return Counter(c for r in self.root for c in r.countries)

    def sort_by(self, field: str, *, reverse: bool = False) -> SearchResults:
        """
        Order the hits by one field.

        Hits where the field is None sort to the end in either direction, so
        they never displace a hit that has a value.

        Args:
            field: The field to order by, e.g. citation_count.
            reverse: Order from high to low.

        """

        def sort_key(r: Any) -> Any:
            value = getattr(r, field)
            return value if value is not None else 0

        not_none = [r for r in self.root if getattr(r, field) is not None]
        none_values = [r for r in self.root if getattr(r, field) is None]

        return SearchResults(
            sorted(not_none, key=sort_key, reverse=reverse) + none_values
        )

    def top_cited(self, n: int = 10) -> SearchResults:
        """Return the n most cited hits."""
        return self.sort_by("citation_count", reverse=True).limit(n)

    def most_recent(self, n: int = 10) -> SearchResults:
        """Return the n most recently updated hits."""
        return self.sort_by("updated_at", reverse=True).limit(n)


class AuthorProjectsResponse(BaseModel):
    """All datasets linked to an author (search-card-compatible rows)."""

    q: str | None = None
    total: int = 0
    results: list[SearchResult] = []
    institutes: list[InstituteFacet] = []


class ProjectSummaryResult(BaseModel):
    accession: str
    title: str
    description: str | None = None
    organisms: list[str] | None = None


class ProjectSummaryResultList(BaseContainer[ProjectSummaryResult]):
    pass


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
    alias: list[str] = []
    title: str
    # GEO/GEA send summary and SRA sends abstract, matching the frontend fallback.
    summary: str | None = Field(
        default=None,
        validation_alias=AliasChoices("summary", "abstract"),
    )
    overall_design: str | list[str] | None = None  # GEA sends a list of protocols
    pubmed_ids: list[str] = Field(alias="pubmed_id", default=[])
    publications: list[Publication] | None = None
    samples_ref: list[str] = []
    series_type: list[str] = []
    # GEA routes from E-GEAD series to runs only through its BioProject.
    bioproject: str | None = None
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
        # GEO uses {"#text": url, "@type": kind}; DDBJ/GEA uses {"url", "name"}.
        out: list[tuple[str, str]] = []
        for item in v or []:
            if not isinstance(item, dict):
                continue
            url = item.get("#text") or item.get("url")
            if url:
                out.append((url, item.get("@type") or item.get("name") or ""))
        return out

    @field_validator(
        "alias",
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
        if not v:
            return []
        if isinstance(v, str):  # GEA sends some list fields as a bare string
            return [v]
        return v

    @field_validator("citation_count", mode="before")
    @classmethod
    def _citation_count_or_zero(cls, v: Any) -> int:
        return v or 0  # GEA/GSA send null

    @field_validator("authors", mode="before")
    @classmethod
    def _normalize_authors(cls, v: Any) -> Any:
        return _join_authors(v)

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


class ProjectCrossReferenceResult(BaseModel):
    accession: str
    link_type: str
    source: str
    # via_pmid marks a publication match, which may cover different samples.
    via_pmid: str | None = None
    title: str | None = None


class ProjectCrossReferenceList(BaseContainer[ProjectCrossReferenceResult]):
    pass


class ProjectCrossReferenceResponse(BaseModel):
    accession: str
    xref: ProjectCrossReferenceList


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


class StudyExperimentsResult(BaseModel):
    accession: str
    title: str
    design_description: str | None = None
    # library/platform fields are null for some archives (e.g. GSA experiments)
    library_layout: str | None = None
    library_name: str | None = None
    library_selection: str | None = None
    library_source: str | None = None
    library_strategy: str | None = None
    samples: list[str] = []
    platform: str | None = None
    instrument_model: str | None = None
    submission: str | None = None


class StudyExperimentsResults(BaseContainer[StudyExperimentsResult]):
    pass


class AccessionClassification(BaseModel):
    accession: str
    valid: bool
    kind: str | None = None
    entity: str | None = None
    database: str | None = None
    archive: str | None = None


class StudyRunsResult(BaseModel):
    run_accession: str
    experiment_accession: str
    study_accession: str | None = None
    library_layout: str | None = None  # null for some ENA/DDBJ runs
    run_alias: str | None = None
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


class ExperimentRunsResponse(BaseModel):
    experiment_accession: str
    total: int = 0
    runs: StudyRunsResults


class ExperimentSampleOrganism(BaseModel):
    text: str = Field(alias="#text")
    taxonomy_id: str = Field(alias="@taxid")


class ExperimentSampleChannel(BaseModel):
    source: str = Field(alias="Source")
    molecule: str | None = Field(alias="Molecule", default=None)
    organism: ExperimentSampleOrganism | None = Field(alias="Organism", default=None)
    organisms: list[ExperimentSampleOrganism] = []
    position: int = Field(alias="@position")
    characteristics: dict[str, str] = Field(alias="Characteristics")
    growth_protocol: str | None = None
    extract_protocol: str | None = None
    treatment_protocol: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _normalize_organisms(cls, data: Any) -> Any:
        # GEO sends one Organism per channel, or a list for mixed-species channels.
        if not isinstance(data, dict):
            return data
        raw = data.get("Organism")
        items = raw if isinstance(raw, list) else [raw] if raw else []
        return {**data, "Organism": items[0] if items else None, "organisms": items}

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


class SampleDetailedMetadata(BaseModel):
    sample_type: str
    project: ProjectMetadataResult
    sample: SampleMetadataResult


# GEO sample-detail is channel-shaped, unlike SRA sample-detail.
class GeoSampleDetailedMetadata(BaseModel):
    sample_type: str
    project: ProjectMetadataResult
    sample: ExperimentSample
