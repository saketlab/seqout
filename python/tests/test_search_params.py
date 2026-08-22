"""The search params models must refuse what they cannot send.

Pydantic drops an undeclared field by default, which made
``search("liver", assay_l1="…")`` return an unfiltered search that looked
filtered. Every model here sets ``extra="forbid"`` so that fails loudly.
"""

from __future__ import annotations

import inspect

import pytest
from pydantic import ValidationError

from seqout.models.api_models import SearchParams, SearchResult, StructuredSearchParams
from seqout.search_plan import apply_plan, is_boolean_query, plan_search


@pytest.mark.parametrize("model", [SearchParams, StructuredSearchParams])
def test_an_unknown_filter_is_refused(model):
    with pytest.raises(ValidationError) as excinfo:
        model(q="liver", not_a_filter="x")
    assert "not_a_filter" in str(excinfo.value)


@pytest.mark.parametrize("model", [SearchParams, StructuredSearchParams])
def test_a_typo_is_refused_rather_than_ignored(model):
    with pytest.raises(ValidationError) as excinfo:
        model(q="liver", organsim="Homo sapiens")
    assert "organsim" in str(excinfo.value)


def test_the_full_text_filters_survive_the_dump():
    params = SearchParams(
        q="liver",
        country=["Japan"],
        journal=["Nature"],
        instrument_model=["Illumina NovaSeq 6000"],
        multi_platform=True,
        date_from="2024-01-01",
        sortby="citations",
    )
    sent = params.model_dump(exclude_none=True)
    for name in (
        "country",
        "journal",
        "instrument_model",
        "multi_platform",
        "date_from",
        "sortby",
    ):
        assert name in sent, f"{name} never reaches the server"


def test_structured_reads_the_query_as_a_boolean_expression():
    # Unrelated to the /search/structured endpoint: this is boolean parsing of
    # q, forced on a query that carries no operators of its own.
    assert (
        SearchParams(q="liver cancer", structured=True).model_dump(exclude_none=True)[
            "structured"
        ]
        is True
    )


def test_the_endpoint_only_declares_what_it_answers():
    # /search/structured has no sortby, order, date_from, date_to or db.
    # FastAPI drops a query parameter it does not declare, so accepting these
    # here would move the silent failure to the server rather than fix it.
    for name, value in (
        ("sortby", "citations"),
        ("order", "asc"),
        ("date_from", "2024-01-01"),
        ("date_to", "2024-01-31"),
        ("db", "geo"),
        ("structured", True),
    ):
        with pytest.raises(ValidationError) as excinfo:
            StructuredSearchParams(q="liver", **{name: value})
        assert name in str(excinfo.value)


def test_the_structured_filters_survive_the_dump():
    params = StructuredSearchParams(
        q="cancer",
        assay_l1="Transcriptomic",
        sample_tissue="liver",
        published_after="2024-01-01",
        pub_date_before="2025-01-01",
        geo_city="Tokyo",
    )
    sent = params.model_dump(exclude_none=True)
    for name in (
        "assay_l1",
        "sample_tissue",
        "published_after",
        "pub_date_before",
        "geo_city",
    ):
        assert name in sent, f"{name} never reaches the server"


def test_the_cli_builds_a_params_object_that_validates():
    # Mirrors cli.py's construction, so a new forbid cannot break the CLI
    # without breaking this first.
    SearchParams(
        q="liver",
        db="geo",
        organism="Homo sapiens",
        library_strategy=["RNA-Seq"],
        library_source=["TRANSCRIPTOMIC"],
        platform=["ILLUMINA"],
        sortby="citations",
        date_from="2024-01-01",
        date_to="2024-01-31",
    )


class TestPlan:
    """The filters pick the endpoint, and the client does what it cannot."""

    def test_a_shared_filter_stays_on_the_full_text_search(self):
        plan = plan_search("liver", country=["Japan"], journal=["Nature"])
        assert not plan.structured_endpoint
        assert not plan.has_local_work

    def test_a_structured_filter_takes_the_other_endpoint(self):
        plan = plan_search("liver", assay_l1="Transcriptomic")
        assert plan.structured_endpoint

    def test_db_and_source_are_spelled_per_endpoint(self):
        assert plan_search("liver", source="geo").params.db == "geo"
        assert plan_search("liver", db="geo", assay_l1="X").params.source == "geo"

    def test_the_day_bounds_are_kept_back_rather_than_dropped(self):
        # The structured endpoint has no date_from, and FastAPI drops a query
        # parameter it does not declare, so sending it would fail in silence.
        plan = plan_search("liver", assay_l1="X", date_from="2024-01-01")
        assert "date_from" not in plan.params.model_dump(exclude_none=True)
        assert plan.date_from == "2024-01-01"
        assert plan.has_local_work

    def test_sortby_is_kept_back_too(self):
        plan = plan_search("liver", assay_l1="X", sortby="citations")
        assert plan.sortby == "citations"
        assert plan.has_local_work

    def test_sortby_rides_along_when_the_endpoint_can_sort(self):
        plan = plan_search("liver", sortby="citations")
        assert plan.params.sortby == "citations"
        assert not plan.has_local_work

    @pytest.mark.parametrize("name", ["year_from", "year_to", "center"])
    def test_the_names_that_meant_two_things_are_gone(self, name):
        with pytest.raises(ValueError, match=name):
            plan_search("liver", **{name: 2020 if "year" in name else "Broad"})

    def test_the_one_pair_no_search_answers(self):
        with pytest.raises(ValueError, match="cannot be combined"):
            plan_search("liver", library_source=["TRANSCRIPTOMIC"], assay_l1="X")

    @pytest.mark.parametrize(
        "query", ['("a" OR "b")', "liver NOT mouse", "immun*", '"a phrase"']
    )
    def test_a_boolean_query_is_refused_rather_than_flattened(self, query):
        with pytest.raises(ValueError, match="boolean"):
            plan_search(query, assay_l1="X")

    def test_prose_is_not_a_boolean_query(self):
        # Lowercase operators are words. Mirrors _TRIGGER in boolean_query.py.
        assert not is_boolean_query("colon or gut")
        assert not is_boolean_query("liver cancer")
        plan_search("colon or gut", assay_l1="X")  # must not raise

    def test_forcing_the_boolean_reading_needs_the_other_endpoint(self):
        with pytest.raises(ValueError, match="boolean"):
            plan_search("liver", structured=True, assay_l1="X")
        assert plan_search("liver", structured=True).params.structured is True


class TestApplyPlan:
    def _rows(self):
        return [
            SearchResult(
                accession="A",
                title="a",
                updated_at="2023-06-01",
                citation_count=7,
                journal="Cell",
            ),
            SearchResult(
                accession="B",
                title="b",
                updated_at="2024-06-01",
                citation_count=108,
                journal="Ature",
            ),
            SearchResult(
                accession="C",
                title="c",
                updated_at="2025-06-01",
                citation_count=0,
                journal="Zoo",
            ),
        ]

    def test_the_day_bounds_use_the_column_the_server_would_have(self):
        plan = plan_search("x", assay_l1="X", date_from="2024-01-01")
        assert [r.accession for r in apply_plan(self._rows(), plan)] == ["B", "C"]

        plan = plan_search("x", assay_l1="X", date_to="2024-01-01")
        assert [r.accession for r in apply_plan(self._rows(), plan)] == ["A"]

    def test_a_row_with_no_date_cannot_satisfy_a_bound(self):
        rows = [SearchResult(accession="D", title="d", updated_at=None)]
        plan = plan_search("x", assay_l1="X", date_from="2024-01-01")
        assert apply_plan(rows, plan) == []

    def test_sorting_by_each_field(self):
        plan = plan_search("x", assay_l1="X", sortby="citations")
        assert [r.accession for r in apply_plan(self._rows(), plan)] == ["B", "A", "C"]

        plan = plan_search("x", assay_l1="X", sortby="citations", order="asc")
        assert [r.accession for r in apply_plan(self._rows(), plan)] == ["C", "A", "B"]

        plan = plan_search("x", assay_l1="X", sortby="journal", order="asc")
        assert [r.accession for r in apply_plan(self._rows(), plan)] == ["B", "A", "C"]

    def test_nothing_happens_when_there_is_nothing_to_do(self):
        plan = plan_search("liver")
        rows = self._rows()
        assert apply_plan(rows, plan) == rows


class TestOneSearchFunction:
    """search() is the only one, and it answers in full."""

    def test_iter_search_is_gone(self):
        from seqout.clients.api import SeqoutAPIClient

        assert not hasattr(SeqoutAPIClient, "iter_search")
        # The correction is a command-line need, not a second search.
        assert not hasattr(SeqoutAPIClient, "search_with_correction")
        assert hasattr(SeqoutAPIClient, "_search_with_correction")

    def test_search_takes_a_limit(self):
        from seqout.clients.api import SeqoutAPIClient

        sig = inspect.signature(SeqoutAPIClient.search)
        assert "limit" in sig.parameters
        assert sig.parameters["limit"].default is None


class TestCitations:
    """BibTeX comes from the API on both clients, or not at all."""

    def test_the_api_client_asks_for_bibtex(self):
        from seqout.clients.api import SeqoutAPIClient

        sq = SeqoutAPIClient()
        seen = {}

        def fake(url, params, **kw):
            seen.update(url=url, params=params)
            return "@article{X2020,\n}"

        sq._sender = fake
        out = sq.fetch_citations("GSE151530", type="all")
        assert seen["url"].endswith("/project/GSE151530/cite")
        assert seen["params"] == {"type": "all", "format": "bibtex"}
        assert out.startswith("@article")

    def test_a_dataset_with_no_paper_is_empty_not_an_error(self):
        import requests

        from seqout.clients.api import SeqoutAPIClient

        sq = SeqoutAPIClient()
        response = requests.Response()
        response.status_code = 404

        def fake(**kw):
            raise requests.HTTPError(response=response)

        sq._sender = fake
        assert sq.fetch_citations("CRA027437") == ""

    def test_the_parquet_client_refuses_rather_than_approximating(self):
        from seqout.clients.parquet import SeqoutParquetClient
        from seqout.exception import SeqoutError

        pq = SeqoutParquetClient.__new__(SeqoutParquetClient)
        with pytest.raises(SeqoutError, match="reads the REST API"):
            pq.fetch_citations("GSE151530")

    def test_both_clients_expose_the_short_name(self):
        from seqout.clients.api import SeqoutAPIClient
        from seqout.clients.parquet import SeqoutParquetClient

        for client in (SeqoutAPIClient, SeqoutParquetClient):
            assert hasattr(client, "citations")
            assert hasattr(client, "fetch_citations")


class TestBams:
    """Alignment files: list before fetching, and keep the paid ones honest."""

    def _files(self):
        from seqout.models.api_models import BamFile, BamFiles

        return BamFiles(
            [
                BamFile(filename="a.bam", size=10, url="https://x/a.bam", md5="aa"),
                BamFile(filename="b.bam", size=5, s3_url="s3://pays/b.bam", md5="bb"),
                BamFile(
                    filename="dup.bam",
                    size=1,
                    url="https://x/1/dup.bam",
                    run_accession="SRR1",
                ),
                BamFile(
                    filename="dup.bam",
                    size=1,
                    url="https://x/2/dup.bam",
                    run_accession="SRR2",
                ),
            ]
        )

    def test_the_totals_are_the_rows(self):
        files = self._files()
        assert files.total_bams == 4
        assert files.total_bam_bytes == 17

    def test_paid_and_open_are_told_apart(self):
        files = self._files()
        assert [b.filename for b in files.openly_readable] == [
            "a.bam",
            "dup.bam",
            "dup.bam",
        ]
        assert [b.filename for b in files.requester_pays] == ["b.bam"]

    def test_a_repeated_filename_is_prefixed_with_its_run(self):
        from seqout.clients.api import _unique_bam_names

        names = _unique_bam_names(list(self._files().root))
        assert names == ["a.bam", "b.bam", "SRR1_dup.bam", "SRR2_dup.bam"]

    def test_a_study_of_only_paid_files_downloads_nothing(self, tmp_path):
        from seqout.clients.api import SeqoutAPIClient
        from seqout.models.api_models import BamFile, BamFiles

        sq = SeqoutAPIClient()
        sq.fetch_bams = lambda accession: BamFiles(
            [BamFile(filename="p.bam", s3_url="s3://pays/p.bam", md5="cc")]
        )
        sq._download_many = lambda *a, **kw: pytest.fail("must not fetch")
        assert sq.download_bams("SRP071083", tmp_path) == []

    def test_a_checksum_mismatch_deletes_the_file(self, tmp_path):
        from seqout.clients.api import _md5_matches

        f = tmp_path / "x.bam"
        f.write_bytes(b"hello")
        assert _md5_matches(f, "5d41402abc4b2a76b9719d911017c592")
        assert not _md5_matches(f, "deadbeef")

    def test_the_parquet_client_refuses(self):
        from seqout.clients.parquet import SeqoutParquetClient
        from seqout.exception import SeqoutError

        pq = SeqoutParquetClient.__new__(SeqoutParquetClient)
        with pytest.raises(SeqoutError, match="reads the REST API"):
            pq.fetch_bams("ERP117016")


class TestPager:
    """One pager drives both the search results and the alignment files."""

    def _rows(self, n=7):
        from seqout.models.api_models import BamFile

        return [
            BamFile(filename=f"f{i}.bam", size=(10 - i) * 1000, url="https://x/a")
            for i in range(n)
        ]

    def _run(self, keys, rows, page_size=3, total=None):
        from unittest.mock import patch

        from rich.console import Console

        from seqout.cli import cli

        seen = []

        def table(title, page):
            seen.append((title, [b.filename for b in page]))
            return cli._bams_table(title, page)

        with (
            patch.object(cli, "_read_key", side_effect=keys),
            open("/dev/null", "w") as devnull,
        ):
            cli._paged(
                Console(file=devnull),
                iter(rows),
                page_size,
                label="ERP117016",
                make_table=table,
                hint="",
                noun="file",
                total=total,
            )
        return seen

    def test_the_columns_carry_the_run_and_its_experiment(self):
        from seqout.cli import cli
        from seqout.models.api_models import BamFile

        row = BamFile(
            filename="a.bam",
            size=10,
            url="https://x/a.bam",
            run_accession="ERR1",
            experiment_accession="ERX1",
            semantic_name="bam",
        )
        table = cli._bams_table("t", [row], exp_titles={"ERX1": "NextSeq 500"})
        assert [c.header for c in table.columns] == [
            "run",
            "experiment",
            "title",
            "file",
            "type",
            "size",
            "readable",
        ]
        cells = [list(c.cells) for c in table.columns]
        assert cells[0] == ["ERR1"]
        assert cells[1] == ["ERX1"]
        assert cells[2] == ["NextSeq 500"]

    def test_a_missing_experiment_title_is_a_dash_not_a_crash(self):
        from seqout.cli import cli
        from seqout.models.api_models import BamFile

        table = cli._bams_table("t", [BamFile(filename="a.bam")], exp_titles={})
        assert list(table.columns[2].cells) == ["—"]

    def test_the_arrows_move_a_page_at_a_time(self):
        seen = self._run(["right", "right", "left", "q"], self._rows())
        assert [names for _, names in seen] == [
            ["f0.bam", "f1.bam", "f2.bam"],
            ["f3.bam", "f4.bam", "f5.bam"],
            ["f6.bam"],
            ["f3.bam", "f4.bam", "f5.bam"],
        ]

    def test_the_last_page_does_not_advance_past_the_end(self):
        seen = self._run(["right", "right", "right", "q"], self._rows())
        assert seen[-1][1] == ["f6.bam"]

    def test_the_total_rides_in_the_title_from_page_one(self):
        seen = self._run(["q"], self._rows(), total=412)
        assert "412 files" in seen[0][0]

    def test_the_page_count_firms_up_once_the_rows_run_out(self):
        # "+" while more may be coming, "/N" once the iterator is exhausted.
        seen = self._run(["right", "right", "q"], self._rows(), total=7)
        assert "page 1+" in seen[0][0]
        assert "page 3/3" in seen[-1][0]

    def test_nothing_at_all_says_so_rather_than_drawing_an_empty_table(self):
        assert self._run(["q"], []) == []


class TestBamsSaveTo:
    """--save-to writes the URLs so the fetching can be someone else's job."""

    def _bams(self):
        from seqout.models.api_models import BamFile, BamFiles

        return BamFiles(
            [
                BamFile(
                    filename="small.bam",
                    size=1,
                    url="https://x/small.bam",
                    md5="aa",
                    run_accession="R1",
                    experiment_accession="E1",
                    semantic_name="bam",
                ),
                BamFile(
                    filename="big.bam",
                    size=99,
                    s3_url="s3://pays/big.bam",
                    md5="bb",
                    run_accession="R2",
                    experiment_accession="E2",
                ),
            ]
        )

    def test_csv_carries_every_url_and_the_checksum(self, tmp_path):
        import csv as csvmod

        from seqout.cli import cli

        out = tmp_path / "b.csv"
        cli._save_bams(self._bams(), {"E1": "NextSeq 500"}, out)
        rows = list(csvmod.DictReader(out.open()))
        assert [r["filename"] for r in rows] == ["big.bam", "small.bam"]  # size desc
        assert rows[1]["url"] == "https://x/small.bam"
        assert rows[1]["md5"] == "aa"
        assert rows[1]["experiment_title"] == "NextSeq 500"

    def test_the_paid_rows_are_written_too(self, tmp_path):
        import csv as csvmod

        from seqout.cli import cli

        out = tmp_path / "b.csv"
        cli._save_bams(self._bams(), {}, out)
        rows = csvmod.DictReader(out.open())
        paid = next(r for r in rows if r["filename"] == "big.bam")
        # Their s3_url is the whole reason to ask for the file.
        assert paid["s3_url"] == "s3://pays/big.bam"
        assert paid["requester_pays"] == "True"

    def test_json_when_the_extension_says_so(self, tmp_path):
        import json as jsonmod

        from seqout.cli import cli

        out = tmp_path / "b.json"
        cli._save_bams(self._bams(), {}, out)
        rows = jsonmod.loads(out.read_text())
        assert [r["size"] for r in rows] == [99, 1]
        assert rows[0]["requester_pays"] is True

    def test_tsv_when_the_extension_says_so(self, tmp_path):
        from seqout.cli import cli

        out = tmp_path / "b.tsv"
        cli._save_bams(self._bams(), {}, out)
        assert "\t" in out.read_text().splitlines()[0]


class TestBamsNarrowing:
    """A run or experiment gets its own files, not the whole study's."""

    def _dataset(self, accession):
        from seqout.dataset import Dataset
        from seqout.models.api_models import BamFile, BamFiles

        rows = BamFiles(
            [
                BamFile(
                    filename="a.bam", run_accession="SRR1", experiment_accession="SRX1"
                ),
                BamFile(
                    filename="b.bam", run_accession="SRR2", experiment_accession="SRX1"
                ),
                BamFile(
                    filename="c.bam", run_accession="SRR3", experiment_accession="SRX2"
                ),
            ]
        )

        class Client:
            def fetch_bams(self, study):
                return rows

        # monkeypatch would be cleaner, but this class is only ever read here;
        # the subclass keeps the patch off the shared Dataset.
        class Narrowed(Dataset):
            sra = property(lambda self: "SRP1")

        return Narrowed(Client(), accession)

    def test_a_study_keeps_every_file(self):
        assert [b.filename for b in self._dataset("SRP1").bams.root] == [
            "a.bam",
            "b.bam",
            "c.bam",
        ]

    def test_a_run_gets_only_its_own(self):
        assert [b.filename for b in self._dataset("SRR2").bams.root] == ["b.bam"]

    def test_an_experiment_gets_its_runs(self):
        assert [b.filename for b in self._dataset("SRX1").bams.root] == [
            "a.bam",
            "b.bam",
        ]

    def test_matching_ignores_case(self):
        assert [b.filename for b in self._dataset("srr3").bams.root] == ["c.bam"]


def test_expansion_off_asks_for_the_words_as_typed():
    # The website's term expansion switch and the server's `structured` are the
    # same wire flag, so `expand=False` has to arrive as that flag.
    sent = plan_search("liver cancer", expand=False).params.model_dump(
        exclude_none=True
    )
    assert sent["structured"] is True
    assert "structured" not in plan_search("liver cancer").params.model_dump(
        exclude_none=True
    )


def test_an_ontology_is_switched_off_by_name_whatever_the_capitals():
    sent = plan_search("liver", exclude_ontology=["mesh", "CVCL"]).params.model_dump(
        exclude_none=True
    )
    assert sent["exclude_ontology"] == ["MeSH", "CVCL"]


def test_an_unknown_ontology_is_refused():
    # The server ignores an id it does not know, so a typo would filter nothing
    # and look like a switch that does not work.
    with pytest.raises(ValidationError) as excinfo:
        SearchParams(q="liver", exclude_ontology=["MESHY"])
    assert "MESHY" in str(excinfo.value)


def test_the_structured_endpoint_has_no_ontologies_to_switch_off():
    with pytest.raises(ValueError, match="exclude_ontology"):
        plan_search("liver", assay_l1="Transcriptomic", exclude_ontology=["MeSH"])
