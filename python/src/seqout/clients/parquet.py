import datetime
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from enum import StrEnum
from pathlib import Path
from typing import Literal, Self, get_args

import duckdb
from duckdb import DuckDBPyConnection

from seqout.constants import (
    DEFAULT_DOWNLOAD_CHUNK_SIZE,
    DEFAULT_MAX_WAIT,
    DEFAULT_NUM_RETRIES,
    DEFAULT_REQ_TIMEOUT,
    PARQUET_DUMP_BASE_URL,
)
from seqout.dataset import ShortNames
from seqout.exception import SeqoutError
from seqout.helpers import _download_file
from seqout.models.api_models import (
    AuthorProjectsResponse,
    ExperimentSample,
    GeoSampleDetailedMetadata,
    InstituteFacet,
    LinkedProject,
    ProjectMetadataResult,
    PublicationLookupResult,
    SearchResult,
    StudyExperimentsResult,
    StudyExperimentsResults,
    StudyRunsResult,
    StudyRunsResults,
)
from seqout.models.models import BaseContainer
from seqout.models.parquet_models import (
    AeSample,
    EnaExperiment,
    GeoSample,
    SraExperiment,
    Study,
    _Channel,
)
from seqout.utils import (
    StudyRunDownloadMode,
    _extract_download_info_for_study_run,
    _normalize_num_workers,
    _normalize_url,
    _validate_study_runs_data,
)

_STUDY_PREFIXES = ("SRP", "ERP", "DRP", "CRA", "HRA", "PRJ")
_RUN_PREFIXES = ("SRR", "ERR", "DRR", "CRR", "HRR")
_EXP_PREFIXES = ("SRX", "ERX", "DRX", "CRX", "HRX")
_SAMPLE_PREFIXES = ("SRS", "ERS", "DRS", "CRS", "HRS", "SAM")

# columns of run_download_links that map onto StudyRunsResult.
_RUN_COLS = (
    "run_accession, study_accession, experiment_accession, library_layout, "
    "fastq_ftp, fastq_bytes, fastq_md5, sra_ftp, sra_bytes, sra_md5, "
    "ncbi_sra_url, ncbi_sra_url_aws, ncbi_sra_normalized_url, "
    "ncbi_sra_normalized_bytes, ncbi_sra_lite_url, ncbi_sra_lite_bytes, "
    "ncbi_sra_lite_s3_url, ncbi_sra_lite_gs_url"
)

ParquetFile = Literal[
    "arrayexpress_experiments",
    "ena_studies",
    "geo_series",
    "sra_runs",
    "unified_centers",
    "arrayexpress_samples",
    "geo_contributors",
    "pubmed_metadata",
    "sra_samples",
    "unified_metadata",
    "ena_experiments",
    "geo_platforms",
    "run_download_links",
    "sra_studies",
    "ena_samples",
    "geo_samples",
    "sra_experiments",
    "sra_submissions",
    "gsa_studies",
    "gsa_experiments",
    "gsa_samples",
    "gsa_projects",
    "dra_studies",
    "dra_experiments",
    "dra_samples",
    "dra_runs",
    "dra_submissions",
    "gea_experiments",
    "gea_samples",
]

_ALL_PARQUET_FILES: list[ParquetFile] = list(get_args(ParquetFile))


class _Datasource(StrEnum):
    Sra = "sra"
    Geo = "geo"
    Ena = "ena"
    Ae = "ae"
    Unknown = "unknown"


class SeqoutParquetClient(ShortNames):
    def __init__(
        self,
        base_url: str = PARQUET_DUMP_BASE_URL,
        timeout: int = DEFAULT_REQ_TIMEOUT,
        num_retries: int = DEFAULT_NUM_RETRIES,
        max_wait: int = DEFAULT_MAX_WAIT,
    ) -> None:
        self._base_url = base_url
        self._timeout = timeout
        self._num_retries = num_retries
        self._max_wait = max_wait
        self._source = base_url

        self._conn = duckdb.connect()
        self._setup_duckdb()

    def _setup_duckdb(self) -> None:
        try:
            self._conn.execute("LOAD httpfs;")
        except duckdb.CatalogException:
            self._conn.execute("INSTALL httpfs; LOAD httpfs;")
        self._conn.execute("SET enable_http_metadata_cache=true;")
        self._conn.execute("SET enable_object_cache=true;")
        # a library writing progress bars to stderr breaks piped output
        self._conn.execute("SET enable_progress_bar=false;")

    def set_source(self, source_dir: Path | str) -> None:
        """Point the backend at a Parquet dump: a URL or a local directory."""
        self._source = source_dir

    def download_parquet_files(
        self,
        output_dir: Path,
        files: list[ParquetFile] = _ALL_PARQUET_FILES,
        num_workers: int | None = None,
        chunk_size: int = DEFAULT_DOWNLOAD_CHUNK_SIZE,
        *,
        with_pbar: bool = False,
    ) -> None:
        """
        Download Parquet files from the current source into output_dir.

        Args:
            output_dir: Created if it does not exist.
            files: Which tables to fetch. Defaults to every table.
            num_workers: Parallel downloads. Defaults to the core count less two.
            chunk_size: Bytes per read from the socket.
            with_pbar: Show a per-file progress bar.

        The full set runs to tens of GB; run_download_links alone is about 11 GB.

        """
        num_workers = _normalize_num_workers(num_workers)
        url_to_dest: dict[str, Path] = {}
        for f in files:
            url_to_dest[f"{self._base_url}/{f}.parquet"] = output_dir / f"{f}.parquet"

        with ThreadPoolExecutor(num_workers) as pool:
            futures = {
                pool.submit(
                    _download_file,
                    url=url,
                    dest_path=dest_path,
                    chunk_size=chunk_size,
                    num_retries=self._num_retries,
                    timeout=self._timeout,
                    max_wait=self._max_wait,
                    with_pbar=with_pbar,
                ): url
                for url, dest_path in url_to_dest.items()
            }

            for f in as_completed(futures):
                f.result()

    def _datasource_from_study_accession(self, study_accession: str) -> _Datasource:
        if study_accession.startswith(("SRP", "ERP", "DRP")):
            return _Datasource.Sra
        if study_accession.startswith("GSE"):
            return _Datasource.Geo
        if study_accession.startswith("PRJ"):
            return _Datasource.Ena
        if study_accession.startswith("E-"):
            return _Datasource.Ae
        return _Datasource.Unknown

    def execute_query(
        self, query: str, params: list | None = None
    ) -> DuckDBPyConnection:
        """
        Run SQL through DuckDB, resolving table names to their Parquet files.

        Each known table name in the query is rewritten to a read_parquet call
        against the current source. Because the match is textual, a table name
        used as a column alias is rewritten too and the query fails; pick a
        distinct alias.

        Args:
            query: The SQL to run.
            params: Values for the query's placeholders.

        """
        for f in _ALL_PARQUET_FILES:
            if f in query:
                query = query.replace(
                    f, f'read_parquet("{self._source}/{f}.parquet")', 1
                )

        return self._conn.execute(query, params or [])

    def fetch_study(self, accession: str) -> Study:
        """Fetch one study from the unified metadata table."""
        result = self.execute_query(
            "SELECT canonical_accession, source, title, description, aliases, "
            "organism_counts, library_strategy_counts, assay_l1_counts, "
            "assay_l2_counts, n_experiments, n_samples, center_names, pmid, "
            "journal, citation_count, first_published, is_single_cell, "
            "single_cell_modality FROM unified_metadata WHERE canonical_accession = ?",
            [accession],
        ).fetchone()
        if not result:
            raise SeqoutError(f"failed to fetch {accession} study")

        def _flatten_json_str_keys(json_str: str | None) -> list:
            if not json_str:
                return []
            return list(dict(json.loads(json_str)).keys())

        (
            accession,
            source,
            title,
            description,
            aliases,
            organisms,
            library_strategies,
            assay_l1,
            assay_l2,
            num_experiments,
            num_samples,
            center_names,
            pubmed_id,
            journal,
            citation_count,
            published_at,
            is_single_cell,
            single_cell_modality,
        ) = result

        overall_design: str | None = None

        if source == "geo":
            result = self.execute_query(
                "SELECT overall_design FROM geo_series WHERE accession = ?", [accession]
            ).fetchone()
            if result:
                (overall_design,) = result

        return Study(
            accession=accession,
            title=title,
            description=description,
            overall_design=overall_design,
            aliases=list(dict(json.loads(aliases)).values()),
            organisms=_flatten_json_str_keys(organisms),
            library_strategies=_flatten_json_str_keys(library_strategies),
            assay_l1=_flatten_json_str_keys(assay_l1),
            assay_l2=_flatten_json_str_keys(assay_l2),
            num_experiments=int(num_experiments or 0),
            num_samples=int(num_samples or 0),
            center_names=json.loads(center_names),
            pubmed_id=pubmed_id,
            journal=journal,
            citation_count=int(citation_count or 0),
            published_at=datetime.datetime.strptime(published_at, "%Y-%m-%d").replace(
                tzinfo=datetime.UTC
            ),
            is_single_cell=is_single_cell,
            single_cell_modality=single_cell_modality,
        )

    def _fetch_experiments_helper(
        self, study_accession: str, datasource: Literal["sra", "ena"]
    ) -> BaseContainer[SraExperiment] | BaseContainer[EnaExperiment]:
        if datasource == "sra":
            rel = self.execute_query(
                "SELECT accession, design_description, library_layout, "
                "library_name, library_selection, library_source, "
                "library_strategy, samples, platform, instrument_model, "
                "title, submission FROM sra_experiments WHERE study = ?",
                [study_accession],
            )

            cols = [desc[0] for desc in rel.description]
            experiments: list[SraExperiment] = []

            for r in rel.fetchall():
                d = dict(zip(cols, r, strict=False))
                d["samples"] = json.loads(d["samples"])
                experiments.append(SraExperiment.model_validate(d))
            return BaseContainer(experiments)

        rel = self.execute_query(
            "SELECT experiment_accession AS accession, experiment_title AS title, "
            "instrument_platform AS platform, instrument_model, library_layout, "
            "library_name, library_selection, library_source, library_strategy, "
            "sample_accession AS sample, scientific_name AS organism, "
            "tax_id AS taxonomy_id, host, tissue_type, cell_type, "
            "disease, dev_stage, base_count, read_count "
            "FROM ena_experiments WHERE study_accession = ?",
            [study_accession],
        )

        cols = [desc[0] for desc in rel.description if desc[0]]
        experiments: list[EnaExperiment] = []

        for r in rel.fetchall():
            d = dict(zip(cols, r, strict=False))
            experiments.append(EnaExperiment.model_validate(d))
        return BaseContainer(experiments)

    def fetch_experiments(
        self, study_accession: str
    ) -> BaseContainer[SraExperiment] | BaseContainer[EnaExperiment]:
        """
        Fetch the experiments of an SRA or ENA study.

        Raises:
            SeqoutError: If the accession belongs to another source.

        """
        datasource = self._datasource_from_study_accession(study_accession)
        if datasource not in (datasource.Sra, datasource.Ena):
            raise SeqoutError(
                "experiments can be only fetched for accessions related to"
                f" SRA or ENA. {study_accession} is from {datasource}"
            )

        datasource_str = "sra" if datasource == datasource.Sra else "ena"
        return self._fetch_experiments_helper(study_accession, datasource_str)

    def _fetch_samples_helper(
        self, study_accession: str, datasource: Literal["geo", "ae"]
    ) -> BaseContainer[GeoSample] | BaseContainer[AeSample]:
        if datasource == "geo":
            result = self.execute_query(
                "SELECT samples_ref FROM geo_series WHERE accession = ?",
                [study_accession],
            ).fetchone()
            if not result:
                raise SeqoutError(
                    f"failed to fetch samples for {study_accession} study"
                )

            # samples_ref may be a plain GSM list or a list of @ref objects.
            samples = [
                str(v["@ref"] if isinstance(v, dict) else v)
                for v in json.loads(result[0])
            ]
            placeholders = ", ".join(["?"] * len(samples))

            rel = self.execute_query(
                "SELECT accession, channel_count, channels AS channels_json, "  # noqa: S608
                "title, description, platform_ref AS platform, "
                "supplementary_data AS supplementary_data_json, "
                "hybridization_protocol, scan_protocol FROM geo_samples "
                f"WHERE accession IN ({placeholders})",
                samples,
            )

            cols = [desc[0] for desc in rel.description if desc[0]]
            geo_samples: list[GeoSample] = []

            def _first_organism(ch: dict) -> dict:
                # a channel with more than one species arrives as a list.
                org = ch.get("Organism")
                if isinstance(org, list):
                    org = org[0] if org else None
                return dict(org) if org else {}

            for r in rel.fetchall():
                d = dict(zip(cols, r, strict=False))
                channels: list[dict] = json.loads(d["channels_json"])
                d["channels"] = [
                    _Channel(
                        position=ch["@position"],
                        characteristics=ch["Characteristics"],
                        molecule=ch["Molecule"],
                        organism=_first_organism(ch).get("#text"),
                        taxonomy_id=_first_organism(ch).get("@taxid"),
                        source=ch["Source"],
                        extract_protocol=ch.get("Extract-Protocol"),
                        growth_protocol=ch.get("Growth-Protocol"),
                        treatment_protocol=ch.get("Treatment-Protocol"),
                    )
                    for ch in channels
                ]
                d["supplementary_data"] = [
                    str(v["#text"]).replace("ftp://", "https://", 1)
                    for v in json.loads(d["supplementary_data_json"])
                    if v["@type"] != "unknown"
                ]
                geo_samples.append(GeoSample.model_validate(d))

            return BaseContainer(geo_samples)
        ae_samples: list[AeSample] = []
        return BaseContainer(ae_samples)

    def fetch_samples(
        self, study_accession: str
    ) -> BaseContainer[GeoSample] | BaseContainer[AeSample]:
        """
        Fetch the samples of a GEO series or ArrayExpress experiment.

        Raises:
            SeqoutError: If the accession belongs to another source.

        """
        datasource = self._datasource_from_study_accession(study_accession)
        if datasource not in (datasource.Geo, datasource.Ae):
            raise SeqoutError(
                "samples can be only fetched for accessions related to"
                f" GEO or AE. {study_accession} is from {datasource}"
            )

        datasource_str = "geo" if datasource == datasource.Geo else "ae"
        return self._fetch_samples_helper(study_accession, datasource_str)

    # Method names and models match SeqoutAPIClient for backend-neutral CLI paths.

    def _query_rows(self, sql: str, params: list | None = None) -> list[dict]:
        rel = self.execute_query(sql, params)
        cols = [d[0] for d in rel.description]
        return [dict(zip(cols, r, strict=False)) for r in rel.fetchall()]

    def _row_to_run(self, d: dict) -> StudyRunsResult:
        nb = d.get("ncbi_sra_normalized_bytes")
        d["ncbi_sra_normalized_bytes"] = int(nb) if nb not in (None, "") else None
        return StudyRunsResult.model_validate(d)

    def fetch_study_runs(
        self, study_id: str, *, full: bool = False
    ) -> StudyRunsResults:
        """
        Fetch the sequencing runs of a study, with their file URLs.

        Args:
            study_id: A study accession.
            full: Accepted for parity with the API client. Parquet always reads
                every run.

        """
        _ = full
        rows = self._query_rows(
            f"SELECT {_RUN_COLS} FROM run_download_links WHERE study_accession = ?",  # noqa: S608
            [study_id],
        )
        return StudyRunsResults([self._row_to_run(r) for r in rows])

    def fetch_run(self, run_id: str) -> StudyRunsResult:
        """
        Fetch one run.

        Raises:
            SeqoutError: If the run is absent from the dump.

        """
        rows = self._query_rows(
            f"SELECT {_RUN_COLS} FROM run_download_links "  # noqa: S608
            "WHERE run_accession = ? LIMIT 1",
            [run_id],
        )
        if not rows:
            raise SeqoutError(f"run {run_id} not found in the parquet dump")
        return self._row_to_run(rows[0])

    def fetch_study_experiments(self, study_id: str) -> StudyExperimentsResults:
        """Fetch the library preparations of a study."""
        rows = self._query_rows(
            "SELECT accession, title, design_description, library_layout, "
            "library_name, library_selection, library_source, library_strategy, "
            "samples, platform, instrument_model, submission "
            "FROM sra_experiments WHERE study = ?",
            [study_id],
        )
        exps: list[StudyExperimentsResult] = []
        for d in rows:
            d["samples"] = json.loads(d["samples"]) if d.get("samples") else []
            exps.append(StudyExperimentsResult.model_validate(d))
        return StudyExperimentsResults(exps)

    def find_publication(
        self, *, pmid: str | None = None, doi: str | None = None
    ) -> PublicationLookupResult:
        """Look a publication up by PubMed ID or DOI and list the projects it names."""
        if doi and not pmid:
            rows = self._query_rows(
                "SELECT pmid, title, journal, doi FROM pubmed_metadata "
                "WHERE doi = ? LIMIT 1",
                [doi],
            )
        else:
            rows = self._query_rows(
                "SELECT pmid, title, journal, doi FROM pubmed_metadata "
                "WHERE pmid = ? LIMIT 1",
                [pmid],
            )
        pub = rows[0] if rows else {}
        resolved_pmid = pub.get("pmid") or pmid
        projects: list[LinkedProject] = []
        if resolved_pmid:
            prows = self._query_rows(
                "SELECT canonical_accession, source, title FROM unified_metadata "
                "WHERE pmid = ?",
                [str(resolved_pmid)],
            )
            projects = [
                LinkedProject(
                    accession=r["canonical_accession"],
                    source=r.get("source"),
                    title=r.get("title"),
                )
                for r in prows
            ]
        return PublicationLookupResult(
            pmid=resolved_pmid,
            doi=pub.get("doi") or doi,
            title=pub.get("title"),
            journal=pub.get("journal"),
            projects=projects,
            total_projects=len(projects),
        )

    def search_author_projects(
        self, name: str, limit: int = 200
    ) -> AuthorProjectsResponse:
        """
        List datasets whose GEO contributor names contain the given name.

        The dump carries author names for GEO only, so this is a GEO substring
        match. The API client searches publication author lists across every
        source, so the two return different sets.

        Args:
            name: Substring to match against contributor names.
            limit: Maximum datasets to return.

        """
        rows = self._query_rows(
            "SELECT c.accession AS accession, u.title AS title, "
            "u.dominant_scientific_name AS organism, "
            "c.organization AS organization "
            "FROM geo_contributors c "
            "LEFT JOIN unified_metadata u ON u.canonical_accession = c.accession "
            "WHERE c.person ILIKE '%' || ? || '%' LIMIT ?",
            [name, limit],
        )
        seen: set[str] = set()
        results: list[SearchResult] = []
        inst: dict[str, int] = {}
        for r in rows:
            org = r.get("organization")
            if org:
                inst[org] = inst.get(org, 0) + 1
            acc = r["accession"]
            if acc in seen:
                continue
            seen.add(acc)
            results.append(
                SearchResult(
                    accession=acc,
                    title=r.get("title") or acc,
                    source="geo",
                    organisms=[r["organism"]] if r.get("organism") else [],
                )
            )
        institutes = [
            InstituteFacet(name=k, count=v)
            for k, v in sorted(inst.items(), key=lambda kv: -kv[1])
        ]
        return AuthorProjectsResponse(
            q=name, total=len(results), results=results, institutes=institutes
        )

    def fetch_project_metadata(self, accession: str) -> ProjectMetadataResult:
        """
        Fetch the project record from the unified metadata table.

        Raises:
            SeqoutError: If the project is absent from the dump.

        """
        rows = self._query_rows(
            "SELECT canonical_accession, source, title, description, "
            "organism_counts, pmid, journal, citation_count "
            "FROM unified_metadata WHERE canonical_accession = ?",
            [accession],
        )
        if not rows:
            raise SeqoutError(f"project {accession} not found in the parquet dump")
        r = rows[0]
        organisms = (
            list(json.loads(r["organism_counts"]).keys())
            if r.get("organism_counts")
            else []
        )
        pmid = r.get("pmid")
        doi = None
        if pmid:
            drows = self._query_rows(
                "SELECT doi FROM pubmed_metadata WHERE pmid = ? LIMIT 1", [str(pmid)]
            )
            doi = drows[0].get("doi") if drows else None
        supp: list = []
        if r.get("source") == "geo":
            srows = self._query_rows(
                "SELECT supplementary_data FROM geo_series WHERE accession = ? LIMIT 1",
                [accession],
            )
            if srows and srows[0].get("supplementary_data"):
                supp = json.loads(srows[0]["supplementary_data"])
        pubs = (
            [{"pmid": str(pmid), "doi": doi, "journal": r.get("journal")}]
            if pmid
            else []
        )
        return ProjectMetadataResult.model_validate(
            {
                "accession": accession,
                "title": r.get("title") or accession,
                "summary": r.get("description"),
                "organisms": organisms,
                "pmid": str(pmid) if pmid else None,
                "doi": doi,
                "journal": r.get("journal"),
                "citation_count": r.get("citation_count") or 0,
                "supplementary_data": supp,
                "publications": pubs,
            }
        )

    def fetch_geo_sample_detailed_metadata(
        self, sample_id: str
    ) -> GeoSampleDetailedMetadata:
        """
        Fetch one GSM, including the supplementary files it carries.

        Raises:
            SeqoutError: If the sample is absent from the dump.

        """
        rows = self._query_rows(
            "SELECT accession, title, description, sample_type, channel_count, "
            "channels, platform_ref, supplementary_data, hybridization_protocol, "
            "scan_protocol, published_at, updated_at "
            "FROM geo_samples WHERE accession = ?",
            [sample_id],
        )
        if not rows:
            raise SeqoutError(f"sample {sample_id} not found in the parquet dump")
        row = dict(rows[0])
        for key in ("channels", "supplementary_data"):
            if isinstance(row.get(key), str):
                row[key] = json.loads(row[key])
        series = self.gsm_series(sample_id)
        return GeoSampleDetailedMetadata(
            sample_type=row.get("sample_type") or "",
            project=self.fetch_project_metadata(series)
            if series
            else ProjectMetadataResult(accession=sample_id, title=sample_id),
            sample=ExperimentSample.model_validate(row),
        )

    def resolve_study(self, accession: str) -> str | None:
        """Resolve a child accession (run/experiment/sample) to its study root."""
        up = accession.upper()
        if up.startswith(_STUDY_PREFIXES):
            return accession
        if up.startswith(_RUN_PREFIXES):
            rows = self._query_rows(
                "SELECT study_accession FROM run_download_links "
                "WHERE run_accession = ? LIMIT 1",
                [accession],
            )
            return rows[0].get("study_accession") if rows else None
        if up.startswith(_EXP_PREFIXES):
            rows = self._query_rows(
                "SELECT study FROM sra_experiments WHERE accession = ? LIMIT 1",
                [accession],
            )
            return rows[0].get("study") if rows else None
        if up.startswith(_SAMPLE_PREFIXES):
            rows = self._query_rows(
                "SELECT study FROM sra_experiments "
                "WHERE samples LIKE '%' || ? || '%' LIMIT 1",
                [accession],
            )
            return rows[0].get("study") if rows else None
        return None

    def linked_study(self, accession: str) -> str | None:
        """Return a GEO/AE series' linked SRA (preferred) or ENA study, via aliases."""
        rows = self._query_rows(
            "SELECT aliases FROM unified_metadata "
            "WHERE canonical_accession = ? LIMIT 1",
            [accession],
        )
        if not rows or not rows[0].get("aliases"):
            return None
        aliases = json.loads(rows[0]["aliases"])
        return aliases.get("sra") or aliases.get("ena") or None

    def linked_geo(self, accession: str) -> str | None:
        """Return the GEO series whose aliases point back at an SRA/ENA study."""
        rows = self._query_rows(
            "SELECT canonical_accession FROM unified_metadata "
            "WHERE source = 'geo' AND aliases LIKE '%' || ? || '%' LIMIT 1",
            [accession],
        )
        return rows[0].get("canonical_accession") if rows else None

    def gsm_series(self, gsm: str) -> str | None:
        """Return the GEO series (GSE) a GEO sample (GSM) belongs to."""
        rows = self._query_rows(
            "SELECT accession FROM geo_series "
            "WHERE samples_ref LIKE '%' || ? || '%' LIMIT 1",
            [gsm],
        )
        return rows[0].get("accession") if rows else None

    # Separate downloader avoids an API-client dependency until a third backend exists.

    def _download_many(
        self,
        url_to_dest: dict[str, Path],
        num_workers: int | None,
        chunk_size: int,
        *,
        with_pbar: bool,
    ) -> None:
        num_workers = _normalize_num_workers(num_workers)
        with ThreadPoolExecutor(num_workers) as pool:
            futures = {
                pool.submit(
                    _download_file,
                    url=url,
                    dest_path=dest_path,
                    chunk_size=chunk_size,
                    num_retries=self._num_retries,
                    timeout=self._timeout,
                    max_wait=self._max_wait,
                    with_pbar=with_pbar,
                ): url
                for url, dest_path in url_to_dest.items()
            }
            for f in as_completed(futures):
                f.result()

    def download_files(
        self,
        urls: list[str],
        out_dir: Path,
        *,
        num_workers: int | None = None,
        chunk_size: int = DEFAULT_DOWNLOAD_CHUNK_SIZE,
        with_pbar: bool = False,
    ) -> None:
        """Download a bare list of URLs into out_dir."""
        out_dir.mkdir(parents=True, exist_ok=True)
        url_to_dest: dict[str, Path] = {}
        for url in urls:
            normalized_url = _normalize_url(url)
            url_to_dest[normalized_url] = out_dir / Path(normalized_url.split("/")[-1])
        self._download_many(url_to_dest, num_workers, chunk_size, with_pbar=with_pbar)

    def download_project_supplementary_data(
        self,
        metadata: ProjectMetadataResult,
        out_dir: Path,
        *,
        num_workers: int | None = None,
        chunk_size: int = DEFAULT_DOWNLOAD_CHUNK_SIZE,
        with_pbar: bool = False,
    ) -> None:
        """Download a project's supplementary files into out_dir."""
        out_dir.mkdir(parents=True, exist_ok=True)
        url_to_dest: dict[str, Path] = {}
        for url, _ in metadata.supplementary_data:
            normalized_url = _normalize_url(url)
            url_to_dest[normalized_url] = out_dir / Path(normalized_url.split("/")[-1])
        self._download_many(url_to_dest, num_workers, chunk_size, with_pbar=with_pbar)

    def download_study_runs_data(
        self,
        runs: StudyRunsResults,
        out_dir: Path,
        mode: StudyRunDownloadMode,
        *,
        num_workers: int | None = None,
        chunk_size: int = DEFAULT_DOWNLOAD_CHUNK_SIZE,
        with_pbar: bool = True,
    ) -> None:
        """
        Download the read files of every run into out_dir.

        Args:
            runs: The runs to fetch. Pass a filtered list to fetch a subset.
            out_dir: Created if it does not exist.
            mode: Which copy to take: fastq, sra, sra_lite, s3, or gcs.
            num_workers: Parallel downloads.
            chunk_size: Bytes per read from the socket.
            with_pbar: Show a per-file progress bar.

        """
        _validate_study_runs_data(runs, mode)
        out_dir.mkdir(parents=True, exist_ok=True)
        url_to_dest: dict[str, Path] = {}
        for r in runs:
            run_urls, run_bytes, run_md5s = _extract_download_info_for_study_run(
                r, mode
            )
            if not run_urls or not run_bytes or not run_md5s:
                raise ValueError(
                    f"failed to extract download info for {r.run_accession}"
                )
            for url in run_urls:
                normalized_url = _normalize_url(url)
                url_to_dest[normalized_url] = out_dir / Path(
                    normalized_url.split("/")[-1]
                )
        self._download_many(url_to_dest, num_workers, chunk_size, with_pbar=with_pbar)

    def close(self) -> None:
        """Release client resources. The DuckDB connection is closed on exit."""

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()
