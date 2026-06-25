import datetime
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from enum import Enum
from pathlib import Path
from typing import Literal, get_args

import duckdb
from duckdb import DuckDBPyConnection

from seqoutdb.clients.parquet_models import Study
from seqoutdb.constants import (
    DEFAULT_DOWNLOAD_CHUNK_SIZE,
    DEFAULT_MAX_WAIT,
    DEFAULT_NUM_RETRIES,
    DEFAULT_REQ_TIMEOUT,
    PARQUET_S3_DUMP_BASE_URL,
)
from seqoutdb.exception import SeqoutError
from seqoutdb.helpers import _download_file
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


class _Datasource(Enum):
    Sra = 0
    Geo = 1
    Ena = 2
    Ae = 3
    Unknown = 4


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

    def execute_query(
        self, query: str, params: list | None = None
    ) -> DuckDBPyConnection:
        for f in _ALL_PARQUET_FILES:
            if f in query:
                query = query.replace(
                    f, f'read_parquet("{self._source}/{f}.parquet")', 1
                )

        return self._conn.execute(query, params or [])

    def _find_datasource_via_study_accession(self, study_accession: str) -> _Datasource:
        if (
            study_accession.startswith("SRP")
            or study_accession.startswith("ERP")
            or study_accession.startswith("DRP")
        ):
            return _Datasource.Sra
        elif study_accession.startswith("GSE"):
            return _Datasource.Geo
        elif (
            study_accession.startswith("PRJNA")
            or study_accession.startswith("PRJEB")
            or study_accession.startswith("PRJDB")
        ):
            return _Datasource.Ena
        elif study_accession.startswith("E-"):
            return _Datasource.Ae
        else:
            return _Datasource.Unknown

    def fetch_study(self, accession: str) -> Study:
        result = self.execute_query(
            "SELECT canonical_accession, title, description, aliases, organism_counts, library_strategy_counts, assay_l1_counts, assay_l2_counts, n_experiments, n_samples, center_names, pmid, journal, citation_count, first_published, is_single_cell, single_cell_modality FROM unified_metadata WHERE canonical_accession = ?",
            [accession],
        ).fetchone()
        if not result:
            raise SeqoutError(f"failed to fetch {accession} study")

        def _flatten_json_str_keys(json_str: str) -> list:
            return list(dict(json.loads(json_str)).keys())

        (
            accession,
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

        return Study(
            accession=accession,
            title=title,
            description=description,
            aliases=list(dict(json.loads(aliases)).values()),
            organisms=_flatten_json_str_keys(organisms),
            library_strategies=_flatten_json_str_keys(library_strategies),
            assay_l1=_flatten_json_str_keys(assay_l1),
            assay_l2=_flatten_json_str_keys(assay_l2),
            num_experiments=int(num_experiments),
            num_samples=int(num_samples),
            center_names=json.loads(center_names),
            pubmed_id=pubmed_id,
            journal=journal,
            citation_count=int(citation_count or 0),
            published_at=datetime.datetime.strptime(published_at, "%Y-%m-%d"),
            is_single_cell=is_single_cell,
            single_cell_modality=single_cell_modality,
        )

    def fetch_samples(self, study_accession: str) -> list[str]:
        samples = []

        if (
            study_accession.startswith("SRP")
            or study_accession.startswith("ERP")
            or study_accession.startswith("DRP")
        ):
            result = self.execute_query(
                "SELECT submission FROM sra_studies WHERE accession = ?",
                [study_accession],
            ).fetchone()
            if not result:
                raise SeqoutError(
                    f"failed to fetch samples for {study_accession} study"
                )

            (submission,) = result
            samples = [
                str(r[0])
                for r in self.execute_query(
                    "SELECT accession FROM sra_samples WHERE submission = ?", submission
                ).fetchmany()
            ]
        elif study_accession.startswith("GSE"):
            result = self.execute_query(
                "SELECT samples_ref FROM geo_series WHERE accession = ?",
                [study_accession],
            ).fetchone()
            if not result:
                raise SeqoutError(
                    f"failed to fetch samples for {study_accession} study"
                )

            (samples_ref_json,) = result
            samples_ref: list[dict] = json.loads(samples_ref_json)
            samples = [str(v["@ref"]) for v in samples_ref]
        elif (
            study_accession.startswith("PRJNA")
            or study_accession.startswith("PRJEB")
            or study_accession.startswith("PRJDB")
        ):
            result = self.execute_query(
                "SELECT sample_accession FROM ena_samples WHERE study_accession = ?",
                [study_accession],
            ).fetchmany()

            samples = [str(v[0]) for v in result]

        return samples

    def fetch_sample(self, accession: str):
        pass

    def close(self) -> None:
        pass

    def __enter__(self) -> "SeqoutParquetClient":
        return self

    def __exit__(self, *args) -> None:
        self.close()
