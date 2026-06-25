import datetime
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from enum import StrEnum
from pathlib import Path
from typing import Literal, get_args, overload

import duckdb
from duckdb import DuckDBPyConnection

from seqoutdb.constants import (
    DEFAULT_DOWNLOAD_CHUNK_SIZE,
    DEFAULT_MAX_WAIT,
    DEFAULT_NUM_RETRIES,
    DEFAULT_REQ_TIMEOUT,
    PARQUET_S3_DUMP_BASE_URL,
)
from seqoutdb.exception import SeqoutError
from seqoutdb.helpers import _download_file
from seqoutdb.models.models import BaseContainer
from seqoutdb.models.parquet_models import ENAExperiment, SRAExperiment, Study
from seqoutdb.utils import _normalize_num_workers

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
]

_ALL_PARQUET_FILES: list[ParquetFile] = list(get_args(ParquetFile))


class _Datasource(StrEnum):
    Sra = "sra"
    Geo = "geo"
    Ena = "ena"
    Ae = "ae"
    Unknown = "unknown"


class SeqoutParquetClient:
    def __init__(
        self,
        base_url: str = PARQUET_S3_DUMP_BASE_URL,
        timeout: int = DEFAULT_REQ_TIMEOUT,
        num_retries: int = DEFAULT_NUM_RETRIES,
        max_wait: int = DEFAULT_MAX_WAIT,
    ):
        self._base_url = base_url
        self._timeout = timeout
        self._num_retries = num_retries
        self._max_wait = max_wait
        self._source = base_url

        self._conn = duckdb.connect()
        self._setup_duckdb()

    def _setup_duckdb(self):
        try:
            self._conn.execute("LOAD httpfs;")
            self._conn.execute("SET enable_http_metadata_cache=true;")
        except duckdb.CatalogException:
            self._conn.execute("INSTALL httpfs; LOAD httpfs;")

    def set_source(self, source_dir: Path | str):
        self._source = source_dir

    def download_parquet_files(
        self,
        output_dir: Path,
        files: list[ParquetFile] = _ALL_PARQUET_FILES,
        num_workers: int | None = None,
        chunk_size: int = DEFAULT_DOWNLOAD_CHUNK_SIZE,
        with_pbar: bool = False,
    ):
        num_workers = _normalize_num_workers(num_workers)
        url_to_dest: dict[str, Path] = {}
        for f in files:
            url_to_dest[f"{PARQUET_S3_DUMP_BASE_URL}/{f}.parquet"] = (
                output_dir / f"{f}.parquet"
            )

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
        if (
            study_accession.startswith("SRP")
            or study_accession.startswith("ERP")
            or study_accession.startswith("DRP")
        ):
            return _Datasource.Sra
        elif study_accession.startswith("GSE"):
            return _Datasource.Geo
        elif study_accession.startswith("PRJ"):
            return _Datasource.Ena
        elif study_accession.startswith("E-"):
            return _Datasource.Ae
        else:
            return _Datasource.Unknown

    def execute_query(
        self, query: str, params: list | None = None
    ) -> DuckDBPyConnection:
        for f in _ALL_PARQUET_FILES:
            if f in query:
                query = query.replace(
                    f, f'read_parquet("{self._source}/{f}.parquet")', 1
                )

        return self._conn.execute(query, params or [])

    def fetch_study(self, accession: str) -> Study:
        result = self.execute_query(
            "SELECT canonical_accession, source, title, description, aliases, organism_counts, library_strategy_counts, assay_l1_counts, assay_l2_counts, n_experiments, n_samples, center_names, pmid, journal, citation_count, first_published, is_single_cell, single_cell_modality FROM unified_metadata WHERE canonical_accession = ?",
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
            published_at=datetime.datetime.strptime(published_at, "%Y-%m-%d"),
            is_single_cell=is_single_cell,
            single_cell_modality=single_cell_modality,
        )

    @overload
    def _fetch_experiments_helper(
        self, study_accession: str, datasource: Literal["sra"]
    ) -> BaseContainer[SRAExperiment]: ...
    @overload
    def _fetch_experiments_helper(
        self, study_accession: str, datasource: Literal["ena"]
    ) -> BaseContainer[ENAExperiment]: ...

    def _fetch_experiments_helper(
        self, study_accession: str, datasource: Literal["sra", "ena"]
    ) -> BaseContainer[SRAExperiment] | BaseContainer[ENAExperiment]:
        if datasource == "sra":
            rel = self.execute_query(
                "SELECT accession, design_description, library_layout, library_name, library_selection, library_source, library_strategy, samples, platform, instrument_model, title, submission FROM sra_experiments WHERE study = ?",
                [study_accession],
            )

            cols = [desc[0] for desc in rel.description]
            experiments: list[SRAExperiment] = []

            for r in rel.fetchmany():
                d = dict(zip(cols, r))
                d["samples"] = json.loads(d["samples"])
                experiments.append(SRAExperiment.model_validate(d))
            return BaseContainer(experiments)
        else:
            rel = self.execute_query(
                "SELECT experiment_accession AS accession, experiment_title AS title, instrument_platform AS platform, instrument_model, library_layout, library_name, library_selection, library_source, library_strategy, sample_accession AS sample, scientific_name AS organism, tax_id AS taxonomy_id, host, tissue_type, cell_type, disease, dev_stage, base_count, read_count FROM ena_experiments WHERE study_accession = ?",
                [study_accession],
            )

            cols = [desc[0] for desc in rel.description if desc[0]]
            experiments: list[ENAExperiment] = []

            for r in rel.fetchmany():
                d = dict(zip(cols, r))
                experiments.append(ENAExperiment.model_validate(d))
            return BaseContainer(experiments)

    def fetch_experiments(
        self, study_accession: str
    ) -> BaseContainer[SRAExperiment] | BaseContainer[ENAExperiment]:
        datasource = self._datasource_from_study_accession(study_accession)
        if datasource != datasource.Sra and datasource != datasource.Ena:
            raise SeqoutError(
                f"experiments can be only fetched for accessions related to SRA or ENA. {study_accession} is from {datasource}"
            )

        datasource_str = "sra" if datasource == datasource.Sra else "ena"
        return self._fetch_experiments_helper(study_accession, datasource_str)

    def close(self) -> None:
        pass

    def __enter__(self) -> "SeqoutParquetClient":
        return self

    def __exit__(self, *args) -> None:
        self.close()
