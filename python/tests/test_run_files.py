"""Run-file listing and download choice, matching the R client's run_files()."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import pytest

from seqout.clients.api import SeqoutAPIClient
from seqout.models.api_models import RunFile, StudyRunsResult, StudyRunsResults


def _run(acc: str = "SRR1", **fields: Any) -> StudyRunsResult:
    return StudyRunsResult(run_accession=acc, experiment_accession="SRX1", **fields)


def test_a_paired_fastq_run_lists_both_mates_with_size_and_checksum():
    run = _run(
        fastq_ftp="ftp/SRR1_1.fastq.gz;ftp/SRR1_2.fastq.gz",
        fastq_bytes="100;200",
        fastq_md5="m1;m2",
    )
    assert run.files("fastq") == [
        RunFile(
            run="SRR1",
            mode="fastq",
            url="ftp/SRR1_1.fastq.gz",
            name="SRR1_1.fastq.gz",
            bytes=100,
            md5="m1",
        ),
        RunFile(
            run="SRR1",
            mode="fastq",
            url="ftp/SRR1_2.fastq.gz",
            name="SRR1_2.fastq.gz",
            bytes=200,
            md5="m2",
        ),
    ]


def test_a_size_list_that_does_not_line_up_with_the_urls_is_not_trusted():
    run = _run(fastq_ftp="ftp/a_1.fastq.gz;ftp/a_2.fastq.gz", fastq_bytes="100")
    assert [(f.bytes, f.md5) for f in run.files("fastq")] == [(None, None)] * 2


def test_sra_prefers_the_aws_mirror_sized_from_the_normalized_copy():
    run = _run(
        ncbi_sra_url_aws="https://aws/SRR1",
        ncbi_sra_normalized_url="https://ncbi/SRR1",
        ncbi_sra_normalized_bytes=829,
        sra_ftp="ftp/SRR1.sra",
    )
    assert run.files("sra") == [
        RunFile(
            run="SRR1", mode="sra", url="https://aws/SRR1", name="SRR1.sra", bytes=829
        )
    ]


def test_sra_lite_is_sized_from_its_own_field_and_carries_no_checksum():
    run = _run(
        ncbi_sra_lite_url="https://ncbi/SRR1.lite.1",
        ncbi_sra_lite_bytes="504",
        sra_bytes="999",
        sra_md5="full-copy",
    )
    [f] = run.files("sra_lite")
    assert (f.bytes, f.md5, f.name) == (504, None, "SRR1.sra")


def test_no_mode_takes_the_first_copy_each_run_offers():
    runs = StudyRunsResults(
        [
            _run("SRR1", fastq_ftp="ftp/SRR1.fastq.gz", ncbi_sra_lite_url="x"),
            _run("SRR2", ncbi_sra_lite_url="https://ncbi/SRR2.lite.1"),
            _run("SRR3"),
        ]
    )
    assert [(f.run, f.mode) for f in runs.files()] == [
        ("SRR1", "fastq"),
        ("SRR2", "sra_lite"),
    ]
    assert runs.formats() == {"fastq": 1, "sra": 0, "sra_lite": 2}


def test_total_bytes_counts_unsized_files_as_zero():
    runs = StudyRunsResults(
        [
            _run("SRR1", fastq_ftp="a;b", fastq_bytes="1;2"),
            _run("SRR2", fastq_ftp="c", fastq_bytes="?"),
        ]
    )
    assert runs.total_bytes("fastq") == 3


@pytest.mark.parametrize("mode", ["s3", "gcs"])
def test_requester_pays_modes_are_refused(mode):
    with pytest.raises(ValueError, match="requester-pays"):
        _run(ncbi_sra_lite_s3_url="s3://b/SRR1").files(mode)


def test_an_unknown_mode_is_refused():
    with pytest.raises(ValueError, match="mode must be one of"):
        _run().files("bam")


def test_download_names_files_skips_runs_without_a_copy_and_warns(caplog):
    sq = SeqoutAPIClient()
    got = {}

    def fake_download_files(urls, out_dir, *, names=None, **kw):
        got.update(urls=urls, names=names)

    sq.download_files = fake_download_files
    runs = StudyRunsResults(
        [
            _run("SRR1", ncbi_sra_url_aws="https://aws/SRR1"),
            _run("SRR2"),
        ]
    )
    with caplog.at_level(logging.WARNING):
        sq.download_study_runs_data(runs, Path("out"), mode="sra")
    assert got == {"urls": ["https://aws/SRR1"], "names": ["SRR1.sra"]}
    assert "SRR2" in caplog.text


def test_download_fails_when_no_run_is_served_in_the_mode():
    with pytest.raises(ValueError, match="No run is served as fastq"):
        SeqoutAPIClient().download_study_runs_data(
            StudyRunsResults([_run()]), Path("out"), mode="fastq"
        )
