from __future__ import annotations

import argparse
import csv
import datetime
import io
import itertools
import json
import os
import re
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Literal

import questionary
from rich.console import Console
from rich.live import Live
from rich.panel import Panel
from rich.prompt import Prompt
from rich.table import Table

from seqout.cli.norm import (
    LABEL_FIELDS,
    SYS_PROMPT,
    EngineError,
    SampleRecord,
    autodetect_engine,
    build_records,
    engine_from_base_url,
    hf_repo_is_private,
    hf_token_from_env,
    make_engine,
    parse_labels,
    parse_model_spec,
    set_hf_token,
)
from seqout.clients.parquet import (
    _ALL_PARQUET_FILES,
    SeqoutParquetClient,
)
from seqout.constants import PARQUET_DUMP_BASE_URL
from seqout.search_plan import apply_plan, plan_search
from seqout.models.api_models import (
    ExperimentSample,
    SearchCorrection,
    SearchParams,
    SearchResult,
    StudyExperimentsResult,
    StudyRunsResult,
    StudyRunsResults,
)
from seqout.models.parquet_models import GeoSample
from seqout.seqout import connect_to_seqout
from seqout.utils import (
    StudyRunDownloadMode,
    _extract_download_info_for_study_run,
    _validate_study_runs_data,
)

if TYPE_CHECKING:
    from collections.abc import Iterator

    from seqout.clients.api import SeqoutAPIClient

VALID_PREFIXES = ("GSE", "GSM", "SRP", "SRS", "SRX")


def _accession(value: str) -> str:
    accession = value.strip()
    if not accession.upper().startswith(VALID_PREFIXES):
        raise argparse.ArgumentTypeError(
            f"invalid accession '{value}': must start with one of "
            f"{', '.join(VALID_PREFIXES)} (e.g. GSE12345)"
        )
    return accession


DateRange = tuple[datetime.date | None, datetime.date | None]
_YEAR_DIGITS = 4


def _date_bound(s: str, *, is_end: bool) -> datetime.date | None:
    """
    Parse one date bound to a date, or None.

    'dd-mm-yyyy' -> that day; 'yyyy' -> Jan 1 (start) or Dec 31 (end); '' -> None.
    """
    s = s.strip()
    if not s:
        return None
    try:
        return datetime.datetime.strptime(s, "%d-%m-%Y").date()  # noqa: DTZ007
    except ValueError:
        pass
    if s.isdigit() and len(s) == _YEAR_DIGITS:
        y = int(s)
        return datetime.date(y, 12, 31) if is_end else datetime.date(y, 1, 1)
    raise argparse.ArgumentTypeError(f"invalid date '{s}': use dd-mm-yyyy or yyyy")


def _date_range(value: str) -> DateRange:
    """
    Parse a date/range to (from, to) dates; a colon marks a range.

    '2020' -> whole of 2020; '15-08-2020' -> that single day;
    '2018:2022', '01-06-2018:', ':31-12-2022' -> open/closed ranges.
    """
    lo, sep, hi = value.partition(":")
    if not sep:  # bare token spans its full granularity (a year, or one day)
        return (_date_bound(lo, is_end=False), _date_bound(lo, is_end=True))
    lo_d, hi_d = _date_bound(lo, is_end=False), _date_bound(hi, is_end=True)
    if lo_d and hi_d and lo_d > hi_d:
        raise argparse.ArgumentTypeError(f"date range start {lo_d} is after end {hi_d}")
    return (lo_d, hi_d)


def _run_download(args: argparse.Namespace) -> None:
    parquet = args.parquet is not None
    source = args.parquet or None
    if args.supplementary:
        cmd_download_supplementary(
            args.accession, args.out, parquet=parquet, source=source
        )
    elif args.sample_supplementary:
        cmd_download_sample_supplementary(
            args.accession, args.out, parquet=parquet, source=source
        )
    elif args.runs_mode:
        cmd_download_runs(
            args.accession, args.out, args.runs_mode, parquet=parquet, source=source
        )
    elif sys.stdin.isatty() and sys.stdout.isatty():
        cmd_download_interactive(
            args.accession, args.out, parquet=parquet, source=source
        )
    else:  # non-interactive: keep the scriptable metadata-JSON default
        cmd_download(args.accession, args.out, parquet=parquet, source=source)


def _add_parquet_flag(p: argparse.ArgumentParser) -> None:
    """
    Add the shared --parquet backend switch to a subcommand.

    Bare --parquet uses the configured/default parquet source; an optional
    value overrides it with a URL or local dir for this run. Fully local, with no
    call to the API.
    """
    p.add_argument(
        "--parquet",
        nargs="?",
        const="",
        default=None,
        metavar="SRC",
        help="use the local/remote parquet backend instead of the API; "
        "optionally pass a URL or local dir (default: configured source)",
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="seqout",
        description="Command line interface for seqout.org",
    )
    parser.add_argument(
        "--enriched",
        type=_accession,
        metavar="ACCESSION",
        help=(
            "fetch LLM-enriched sample metadata for an accession "
            f"({', '.join(VALID_PREFIXES)}), e.g. --enriched GSE12345"
        ),
    )
    parser.add_argument(
        "--norm",
        type=_accession,
        metavar="ACCESSION",
        help=(
            "normalize a project's sample metadata with a local model "
            f"({', '.join(VALID_PREFIXES)}), e.g. --norm GSE12345"
        ),
    )
    parser.add_argument(
        "--model",
        metavar="ENGINE/MODEL",
        help=(
            "model to use with --norm, as engine/model "
            "(ollama, llamacpp, lmstudio). "
            "Defaults to ollama/hf.co/saketlab/seqoutlm-1B-GGUF"
        ),
    )
    parser.add_argument(
        "--port",
        type=int,
        metavar="PORT",
        help=(
            "port the local model server listens on. A running server there is "
            "reused; otherwise --model is started on it "
            "(default: 8080 llamacpp, 1234 lmstudio, 11434 ollama)"
        ),
    )
    parser.add_argument(
        "--base-url",
        metavar="URL",
        help=(
            "talk to an already-running OpenAI-compatible server at this URL "
            "(e.g. http://host:8080/v1); never starts one. Overrides --model/--port"
        ),
    )

    sub = parser.add_subparsers(dest="command", metavar="COMMAND")

    p_show = sub.add_parser(
        "show",
        help="show a project's samples/experiments as a table",
        description=(
            "Show the samples (GEO/ArrayExpress) or experiments (SRA/ENA) of a project."
        ),
    )
    p_show.add_argument(
        "accession",
        help="project accession, e.g. GSE12345, SRP123456, E-MTAB-1234",
    )
    _add_parquet_flag(p_show)

    p_pmid = sub.add_parser(
        "pmid",
        help="show all datasets linked to a publication (PMID or DOI)",
        description="List every dataset linked to a PubMed ID or DOI.",
    )
    p_pmid.add_argument("id", help="a PubMed ID (e.g. 34764296) or DOI (10.xxxx/...)")
    _add_parquet_flag(p_pmid)

    p_author = sub.add_parser(
        "author",
        help="show all datasets linked to an author",
        description="List every dataset an author is linked to via its publication.",
    )
    p_author.add_argument("name", help="author name, e.g. 'Saket Choudhary'")
    _add_parquet_flag(p_author)

    p_dl = sub.add_parser(
        "download",
        help="download a project's or sample's metadata to a local JSON file",
        description="Save metadata for a project or sample as JSON.",
    )
    p_dl.add_argument("accession", help="project or sample accession")
    p_dl.add_argument(
        "-o",
        "--out",
        help="output file/dir for metadata (default ./<accession>.json), "
        "or output dir for data files (default ./<accession>/)",
    )
    g = p_dl.add_mutually_exclusive_group()
    g.add_argument(
        "--supplementary",
        action="store_true",
        help="download the project's supplementary files instead of metadata",
    )
    g.add_argument(
        "--sample-supplementary",
        dest="sample_supplementary",
        action="store_true",
        help="download per-sample supplementary files (GEO series or GSM sample)",
    )
    for flag, mode in [
        ("--fastq", "fastq"),
        ("--sra", "sra"),
        ("--sra-lite", "sra_lite"),
        ("--s3", "s3"),
        ("--gcs", "gcs"),
    ]:
        g.add_argument(
            flag,
            dest="runs_mode",
            action="store_const",
            const=mode,
            help=(
                "download study run files in"
                f" {mode} format (study accession, e.g. SRP/PRJ)"
            ),
        )
    _add_parquet_flag(p_dl)

    p_search = sub.add_parser(
        "search",
        help="full-text search for projects",
        description="Full-text search across GEO, SRA, ArrayExpress and ENA.",
    )
    p_search.add_argument(
        "query",
        nargs="?",
        help='search text, e.g. "lung cancer single cell". Optional if at least '
        "one filter (-O/-S/-P/-C/-d/--db) is given",
    )
    p_search.add_argument(
        "--db",
        choices=["geo", "sra", "arrayexpress", "ena", "gsa", "dra", "gea"],
        help="restrict to one source (default: all)",
    )
    p_search.add_argument(
        "-O",
        "--organism",
        metavar="NAME",
        help='filter by exact scientific name, e.g. "Homo sapiens"',
    )
    p_search.add_argument(
        "-S",
        "--strategy",
        dest="library_strategy",
        nargs="+",
        metavar="STRATEGY",
        help="filter by library strategy, e.g. RNA-Seq ATAC-seq (GEO/SRA only)",
    )
    p_search.add_argument(
        "-P",
        "--platform",
        nargs="+",
        metavar="PLATFORM",
        help="filter by sequencing platform, e.g. ILLUMINA (GEO/SRA only)",
    )
    p_search.add_argument(
        "-C",
        "--source",
        dest="library_source",
        nargs="+",
        metavar="SOURCE",
        help="filter by library source, e.g. GENOMIC TRANSCRIPTOMIC (SRA only)",
    )
    p_search.add_argument(
        "--country",
        nargs="+",
        metavar="NAME",
        help="filter by the study's country, e.g. Japan",
    )
    p_search.add_argument(
        "--journal",
        nargs="+",
        metavar="NAME",
        help="filter by the linked paper's journal, e.g. Nature",
    )
    p_search.add_argument(
        "--instrument",
        dest="instrument_model",
        nargs="+",
        metavar="MODEL",
        help='filter by instrument, e.g. "Illumina NovaSeq 6000"',
    )
    p_search.add_argument(
        "--multi-platform",
        dest="multi_platform",
        action="store_true",
        help="only studies that used two or more platforms",
    )
    p_search.add_argument(
        "--assay",
        dest="assay_l2",
        metavar="ASSAY",
        help="filter by assay method, e.g. RNA-seq ATAC-seq ChIP-seq",
    )
    p_search.add_argument(
        "--assay-class",
        dest="assay_l1",
        metavar="CLASS",
        help='filter by broad assay class, e.g. Transcriptomic',
    )
    p_search.add_argument(
        "--exact",
        dest="structured",
        action="store_true",
        help="read the query as a boolean expression and take its terms "
        'exactly: no ontology expansion. Supports (), "", * and OR/AND/NOT',
    )
    p_search.add_argument(
        "-o",
        "--saveto",
        dest="save_to",
        type=Path,
        metavar="FILE",
        help="write results to FILE instead of paging; format from extension "
        "(.json, .tsv, else csv)",
    )
    p_search.add_argument(
        "--sort",
        dest="sortby",
        choices=["citations", "journal", "year"],
        help="sort results by this field",
    )
    p_search.add_argument(
        "-p",
        "--page-size",
        dest="limit",
        type=int,
        default=20,
        metavar="N",
        help="results per page in interactive mode (default: 20)",
    )
    p_search.add_argument(
        "-d",
        "--date",
        dest="date_range",
        type=_date_range,
        metavar="DATE[:DATE]",
        help="filter by date (dd-mm-yyyy or yyyy), e.g. 2020, "
        "15-08-2020, 2018:2022, 01-06-2018:31-12-2022, :2022",
    )
    p_search.add_argument(
        "-m",
        "--max",
        dest="max_results",
        type=int,
        default=None,
        metavar="N",
        help="stop after this many results total (default: unlimited)",
    )

    # Generic convert covers ArrayExpress/GEA accessions with no clean a-to-b name.
    p_conv = sub.add_parser(
        "convert",
        help="convert accessions to a related kind (any source)",
        description="Map accessions to related ones using seqout's metadata.",
    )
    p_conv.add_argument("accession", nargs="+", help="one or more accessions")
    p_conv.add_argument(
        "--to",
        dest="to_kind",
        required=True,
        choices=_CONVERT_TO_CHOICES,
        help="target kind: study/experiment/sample/run or srp/srx/srs/srr/gsm/gse",
    )
    p_conv.add_argument(
        "-o", "--saveto", dest="save_to", metavar="FILE", help="write results to FILE"
    )
    _add_parquet_flag(p_conv)

    # Source names in a-to-b commands are hints; conversion auto-detects the accession.
    for name in _CONVERT_COMMANDS:
        tgt = name.split("-to-")[1].upper()
        p_c = sub.add_parser(name, help=f"get {tgt} accessions")
        p_c.add_argument("accession", nargs="+", help="one or more accessions")
        p_c.add_argument(
            "-o",
            "--saveto",
            dest="save_to",
            metavar="FILE",
            help="write results to FILE",
        )
        _add_parquet_flag(p_c)

    p_pq = sub.add_parser(
        "parquet",
        help="parquet backend: download, query, and explore local data dumps",
        description=(
            "Work with the parquet-based local backend: download the seqout "
            "parquet dump, run SQL queries, and fetch studies/samples/experiments."
        ),
    )
    pq_sub = p_pq.add_subparsers(dest="pq_command", metavar="COMMAND")

    pq_dl = pq_sub.add_parser(
        "download",
        help="download parquet data files to a local directory",
        description="Download the seqout parquet dumps to a local directory.",
    )
    pq_dl.add_argument(
        "output_dir",
        type=Path,
        help="directory to store the downloaded parquet files",
    )
    pq_dl.add_argument(
        "--files",
        nargs="*",
        choices=list(_ALL_PARQUET_FILES),
        default=_ALL_PARQUET_FILES,
        help="specific parquet files to download (default: all)",
    )
    pq_dl.add_argument(
        "--with-pbar",
        action="store_true",
        help="show a progress bar during download",
    )
    pq_dl.add_argument(
        "--num-workers",
        type=int,
        default=None,
        help="number of parallel download workers",
    )
    pq_dl.add_argument(
        "--source",
        default=None,
        help="base URL to download from (default: the configured/seqout source)",
    )

    pq_query = pq_sub.add_parser(
        "query",
        help="run a raw SQL query against the parquet files",
        description=(
            "Run a SQL query on the parquet files. Table names are resolved "
            "automatically to their parquet file paths."
        ),
    )
    pq_query.add_argument(
        "--source",
        default=None,
        help="URL or local dir with the parquet files "
        "(default: configured source, else seqout's hosted dump)",
    )
    pq_query.add_argument(
        "sql",
        help="SQL query to execute (e.g. SELECT * FROM unified_metadata LIMIT 5)",
    )
    pq_query.add_argument(
        "--csv",
        action="store_true",
        help="output results as CSV instead of a rich table",
    )
    pq_query.add_argument(
        "-n",
        "--limit",
        type=int,
        default=50,
        help="max rows to display (default: 50)",
    )

    pq_show = pq_sub.add_parser(
        "show",
        help="show a study or its samples/experiments from parquet",
        description=(
            "Display study metadata, samples (GEO/AE), or experiments "
            "(SRA/ENA) from the parquet dump."
        ),
    )
    pq_show.add_argument(
        "--source",
        default=None,
        help="URL or local dir with the parquet files "
        "(default: configured source, else seqout's hosted dump)",
    )
    pq_show.add_argument(
        "accession",
        help="study accession, e.g. GSE12345, SRP123456, PRJDB13493",
    )
    pq_show.add_argument(
        "--samples",
        action="store_true",
        help="show samples instead of study metadata (GEO/AE only)",
    )
    pq_show.add_argument(
        "--experiments",
        action="store_true",
        help="show experiments instead of study metadata (SRA/ENA only)",
    )

    pq_source = pq_sub.add_parser(
        "set-source",
        help="set the default parquet source (a URL or local directory)",
        description="Persist the parquet source used by query/show/download.",
    )
    pq_source.add_argument(
        "source",
        help="a URL (https://host/path) or a local directory with the parquet files",
    )

    args = parser.parse_args()

    subcommands = {
        "search": lambda: cmd_search(
            args.query,
            args.db,
            args.limit,
            args.sortby,
            args.max_results,
            args.date_range,
            args.organism,
            args.library_strategy,
            args.platform,
            args.library_source,
            args.save_to,
            args.country,
            args.journal,
            args.instrument_model,
            args.multi_platform,
            args.assay_l1,
            args.assay_l2,
            args.structured,
        ),
        "show": lambda: cmd_show(
            args.accession,
            parquet=args.parquet is not None,
            source=args.parquet or None,
        ),
        "pmid": lambda: cmd_pmid(
            args.id, parquet=args.parquet is not None, source=args.parquet or None
        ),
        "author": lambda: cmd_author(
            args.name, parquet=args.parquet is not None, source=args.parquet or None
        ),
        "convert": lambda: cmd_convert(
            args.accession,
            args.to_kind,
            args.save_to,
            parquet=args.parquet is not None,
            source=args.parquet or None,
        ),
        "download": lambda: _run_download(args),
        "parquet": lambda: cmd_parquet(args),
    }
    handler = subcommands.get(args.command)
    if handler is not None:
        handler()
        return
    if args.command in _CONVERT_COMMANDS:
        cmd_convert(
            args.accession,
            args.command.split("-to-")[1],
            args.save_to,
            parquet=args.parquet is not None,
            source=args.parquet or None,
        )
        return

    if args.enriched is None and args.norm is None:
        raise SystemExit(1)
    if args.norm is not None:
        run_norm(args.norm, args.model, port=args.port, base_url=args.base_url)
    if args.enriched is not None:
        with connect_to_seqout(backend="api") as sq:
            result = sq.fetch_project_enriched_metadata(args.enriched)
        if not result:
            raise SystemExit(1)


# Prefix fallback mirrors the backend classifier when classify is unreachable.
_PREFIX_ENTITY: list[tuple[tuple[str, ...], str, str]] = [
    (("GSE",), "series", "geo"),
    (("E-",), "experiment", "arrayexpress"),  # ArrayExpress / GEA (project-level)
    (("PRJ", "CRA", "HRA"), "bioproject", "bioproject"),
    (("SRP", "ERP", "DRP"), "study", "sra"),
    (("SRX", "ERX", "DRX", "CRX", "HRX"), "experiment", "sra"),
    (("SRR", "ERR", "DRR", "CRR", "HRR"), "run", "sra"),
    (("GSM",), "sample", "geo"),
    (("SRS", "ERS", "DRS", "HRS", "SAM"), "sample", "sra"),
]


def _classify(sq: SeqoutAPIClient, acc: str) -> tuple[str | None, str | None]:
    """Ask the backend (entity, database) for an accession; fall back to prefixes."""
    try:
        info = sq.classify_accession(acc)
        if info.valid and info.entity:
            return info.entity, info.database
    except Exception:  # noqa: S110 -- any failure falls back to prefixes
        pass
    up = acc.upper()
    for prefixes, entity, database in _PREFIX_ENTITY:
        if up.startswith(prefixes):
            return entity, database
    return None, None


def cmd_show_run(sq: SeqoutAPIClient, acc: str, console: Console) -> None:
    try:
        with console.status(f"[bold]Fetching {acc}…[/]"):
            run = sq.fetch_run(acc)
    except Exception as e:
        console.print(f"[red]Failed to fetch {acc}:[/] {e}")
        raise SystemExit(1) from e

    parent = " · ".join(
        p
        for p in (
            f"study {run.study_accession}" if run.study_accession else "",
            f"experiment {run.experiment_accession}"
            if run.experiment_accession
            else "",
        )
        if p
    )
    table = Table(
        title=run.run_accession,
        title_style="bold",
        header_style="bold green",
    )
    table.add_column("field", style="cyan", no_wrap=True)
    table.add_column("value", overflow="fold")
    for field, value in (
        ("library_layout", run.library_layout),
        ("fastq_ftp", run.fastq_ftp),
        ("fastq_bytes", run.fastq_bytes),
        ("fastq_md5", run.fastq_md5),
        ("sra_ftp", run.sra_ftp),
        ("ncbi_sra_url", run.ncbi_sra_url),
        ("ncbi_sra_lite_url", run.ncbi_sra_lite_url),
    ):
        if value not in (None, "", []):
            table.add_row(field, str(value))
    renderables = [table]
    if parent:
        renderables.insert(
            0,
            Panel(f"[dim]part of[/] {parent}", border_style="cyan", expand=False),
        )
    _page(console, *renderables)


def cmd_show(
    accession: str, *, parquet: bool = False, source: str | None = None
) -> None:
    if parquet:
        _cmd_show_parquet(accession.strip(), source)
        return

    console = Console()
    acc = accession.strip()

    show_samples = False
    title: str | None = None
    description: str | None = None
    organisms: list[str] = []
    keys = "experiments"
    samples: list[ExperimentSample] = []
    experiments: list[StudyExperimentsResult] = []
    try:
        with connect_to_seqout(backend="api") as sq:
            with console.status(f"[bold]Identifying {acc}…[/]"):
                entity, database = _classify(sq, acc)
            # AE/GEA E-* accessions classify as experiments but behave as projects.
            is_project = (
                entity in ("series", "study", "bioproject")
                or database == "arrayexpress"
            )
            if not is_project:
                if entity == "run":
                    cmd_show_run(sq, acc, console)
                    return
                cmd_show_sample(sq, acc, console)
                return
            show_samples = entity == "series" or database == "arrayexpress"
            with console.status(f"[bold]Fetching {acc}…[/]"):
                title, description, organisms = _project_header(sq, acc)
                if show_samples:
                    samples = list(sq.fetch_samples(acc))
                    keys = "samples"
                else:
                    experiments = list(sq.fetch_study_experiments(acc))
                    keys = "experiments"
    except Exception as e:
        console.print(f"[red]Failed to fetch {acc}:[/] {e}")
        raise SystemExit(1) from e

    n = len(samples) if show_samples else len(experiments)
    orgs = ", ".join(organisms) or "[dim]—[/]"
    body = (
        f"[bold]{title or acc}[/]\n[dim]{acc}[/]  •  organisms: {orgs}  •  {n} {keys}"
    )
    if description:
        body += f"\n\n{description.strip()}"
    panel = Panel(body, border_style="cyan", expand=False)

    if not (samples or experiments):
        console.print(panel)
        console.print(f"[yellow]No {keys} found for {acc}.[/]")
        return

    table = Table(show_lines=False, header_style="bold green")
    if show_samples:
        table.add_column("accession", style="bold cyan", no_wrap=True)
        table.add_column("title", overflow="fold")
        table.add_column("type", no_wrap=True)
        table.add_column("organism", overflow="fold")
        for s in samples:
            org = s.channels[0].organism.text if s.channels[0].organism else "—"
            table.add_row(s.accession, s.title or "—", s.sample_type or "—", org)
    else:
        table.add_column("accession", style="bold cyan", no_wrap=True)
        table.add_column("title", overflow="fold")
        table.add_column("strategy", no_wrap=True)
        table.add_column("platform", no_wrap=True)
        table.add_column("instrument", overflow="fold")
        table.add_column("#", justify="right")
        for e in experiments:
            table.add_row(
                e.accession,
                e.title or "—",
                e.library_strategy,
                e.platform,
                e.instrument_model,
                str(len(e.samples)),
            )
    _page(console, panel, table)


def _cmd_show_parquet(acc: str, source: str | None) -> None:
    """Show --parquet: study/experiments/samples/run straight from parquet."""
    console = Console()
    up = acc.upper()
    client = _open_backend(parquet=True, source=source)

    if up.startswith(RUN_PREFIXES):
        cmd_show_run(client, acc, console)  # parquet.fetch_run returns StudyRunsResult
        return

    is_geo_ae = up.startswith(("GSE", "E-"))
    if not (is_geo_ae or up.startswith(_STUDY_PREFIXES)):
        console.print(
            f"[yellow]{acc}: sample-level detail isn't available on the parquet "
            "backend.[/] Show its study/series, or drop --parquet for the API."
        )
        return

    try:
        study = client.fetch_study(acc)
        orgs = ", ".join(study.organisms or []) or "[dim]—[/]"
        console.print(
            Panel(
                f"[bold]{study.title}[/]\n[dim]{study.accession}[/]  •  "
                f"organisms: {orgs}  •  {study.num_experiments} experiments, "
                f"{study.num_samples} samples",
                border_style="cyan",
                expand=False,
            )
        )
    except Exception:
        console.print(Panel(f"[bold]{acc}[/]", border_style="cyan", expand=False))

    try:
        if is_geo_ae:
            samples = client.fetch_samples(acc)
            if not samples:
                console.print(f"[yellow]No samples found for {acc}.[/]")
                return
            table = Table(show_lines=False, header_style="bold green")
            table.add_column("accession", style="bold cyan", no_wrap=True)
            table.add_column("title", overflow="fold")
            table.add_column("organism", overflow="fold")
            for s in samples:
                org = s.channels[0].organism if s.channels else None
                table.add_row(s.accession, s.title or "—", org or "—")
        else:
            experiments = client.fetch_experiments(acc)
            if not experiments:
                console.print(f"[yellow]No experiments found for {acc}.[/]")
                return
            table = Table(show_lines=False, header_style="bold green")
            table.add_column("accession", style="bold cyan", no_wrap=True)
            table.add_column("title", overflow="fold")
            table.add_column("strategy", no_wrap=True)
            table.add_column("platform", no_wrap=True)
            table.add_column("instrument", overflow="fold")
            for e in experiments:
                table.add_row(
                    e.accession,
                    e.title or "—",
                    e.library_strategy,
                    e.platform,
                    e.instrument_model,
                )
    except Exception as e:
        console.print(
            f"[yellow]No per-sample/experiment detail for {acc} on parquet[/] "
            f"[dim]({e})[/]"
        )
        return
    _page(console, table)


def cmd_show_sample(sq: SeqoutAPIClient, acc: str, console: Console) -> None:
    try:
        with console.status(f"[bold]Fetching {acc}…[/]"):
            if acc.upper().startswith("GSM"):
                detail = sq.fetch_geo_sample_detailed_metadata(acc)
            else:
                detail = sq.fetch_sample_detailed_metadata(acc)
    except Exception as e:
        console.print(f"[red]Failed to fetch {acc}:[/] {e}")
        raise SystemExit(1) from e

    s = detail.sample
    proj = detail.project
    panel = Panel(
        f"[dim]part of[/] [bold]{proj.accession}[/]: {proj.title}",
        border_style="cyan",
        expand=False,
    )

    table = Table(
        title=acc, title_style="bold", header_style="bold green", show_lines=False
    )
    table.add_column("field", style="cyan", no_wrap=True)
    table.add_column("value", overflow="fold")

    def row(field: str, value: object) -> None:
        if value not in (None, "", []):
            table.add_row(field, str(value))

    if isinstance(s, ExperimentSample):
        org = s.channels[0].organism.text if s.channels[0].organism else None
        row("title", s.title)
        row("description", s.description)
        row("sample_type", s.sample_type)
        row("organism", org)
        row("platform", s.platform_ref)
        row("published", s.published_at)
        attrs = s.channels[0].characteristics if s.channels else {}
    else:
        row("title", s.title)
        row("alias", s.alias)
        row("description", s.description)
        row("scientific_name", s.scientific_name)
        row("taxon_id", s.taxon_id)
        row("submission", s.submission)
        attrs = s.attributes or {}

    if attrs:
        table.add_section()
        for k, v in attrs.items():
            row(k, v)

    _page(console, panel, table)


def _results_table(title: str, rows: list) -> Table:
    table = Table(title=title, title_style="bold", header_style="bold green")
    table.add_column("accession", style="bold cyan", no_wrap=True)
    table.add_column("src", no_wrap=True)
    table.add_column("title", overflow="fold")
    table.add_column("organisms", overflow="fold")
    table.add_column("cited", justify="right")
    for r in rows:
        table.add_row(
            r.accession,
            r.source or _source_from_prefix(r.accession) or "—",
            r.title,
            ", ".join(r.organisms) or "—",
            str(r.citation_count) if r.citation_count else "—",
        )
    return table


def _source_from_prefix(acc: str) -> str | None:
    """Best-effort source label from an accession prefix (author rows omit it)."""
    up = acc.upper()
    if up.startswith("E-GEAD"):
        return "gea"
    for prefixes, _entity, database in _PREFIX_ENTITY:
        if up.startswith(prefixes):
            return database
    return None


_SAVE_COLS = [
    "accession",
    "source",
    "title",
    "organisms",
    "countries",
    "citation_count",
    "journal",
    "doi",
    "pmid",
    "updated_at",
]


def _save_results(results: list, path: Path) -> None:
    """Write results to path; format from extension (.json, .tsv, else csv)."""
    if path.suffix.lower() == ".json":
        path.write_text(
            json.dumps([r.model_dump(mode="json") for r in results], indent=2),
        )
        return
    delimiter = "\t" if path.suffix.lower() == ".tsv" else ","
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f, delimiter=delimiter)
        writer.writerow(_SAVE_COLS)
        for r in results:
            writer.writerow(
                [
                    r.accession,
                    r.source,
                    r.title,
                    "; ".join(r.organisms),
                    "; ".join(r.countries),
                    r.citation_count,
                    r.journal or "",
                    r.doi or "",
                    r.pmid or "",
                    r.updated_at or "",
                ]
            )


def _page(console: Console, *renderables: object) -> None:
    """
    Show renderables in a scrollable pager on a TTY (arrows + mouse), else print.

    Uses the system pager (less): -R keeps colors, -S enables left/right scroll
    for wide tables, -F skips paging when the output already fits on one screen.
    """
    if not sys.stdout.isatty():
        for r in renderables:
            console.print(r)
        return
    os.environ.setdefault("LESS", "-R -S -F -X")
    with console.pager(styles=True):
        for r in renderables:
            console.print(r)


def _project_header(
    sq: SeqoutAPIClient,
    acc: str,
) -> tuple[str | None, str | None, list[str]]:
    """
    Return (title, description, organisms) for a project.

    The full-metadata model is fragile across GEA/GSA field quirks, so fall back
    to the light summary endpoint (title+description) when it chokes.
    """
    try:
        m = sq.fetch_project_metadata(acc)
    except Exception:  # noqa: S110 -- try the light summary endpoint instead
        pass
    else:
        return m.title, (m.summary or None), (m.organisms or [])
    try:
        s = sq.fetch_project_summary(acc)
    except Exception:
        return None, None, []
    else:
        return s.title, (s.description or None), (s.organisms or [])


def _read_key() -> str:
    """
    Read one keypress, decoding arrow keys. POSIX only.

    Returns "left"/"right" for arrows, else the raw char ("q", esc, ctrl-c).
    """
    # Lazy POSIX imports keep the module importable on Windows.
    import select  # noqa: PLC0415
    import termios  # noqa: PLC0415
    import tty  # noqa: PLC0415

    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    try:
        tty.setraw(fd)
        # os.read on the fd avoids sys.stdin buffering, which hides
        # arrow-key tails from select
        ch = os.read(fd, 1).decode(errors="ignore")
        if ch == "\x1b" and select.select([fd], [], [], 0.05)[0]:
            ch += os.read(fd, 2).decode(errors="ignore")
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)
    return {"\x1b[C": "right", "\x1b[D": "left"}.get(ch, ch)


def _paged_search(
    console: Console,
    query: str,
    it: Iterator[SearchResult],
    page_size: int,
) -> None:
    buffer: list = []
    exhausted = False

    def ensure(n: int) -> None:
        nonlocal exhausted
        while not exhausted and len(buffer) < n:
            try:
                buffer.append(next(it))
            except StopIteration:
                exhausted = True

    with console.status("[bold]Searching…[/]"):
        ensure(page_size)

    if not buffer:
        console.print(f"[yellow]No results for[/] {query!r}.")
        return

    page = 0
    while True:
        ensure((page + 1) * page_size)
        rows = buffer[page * page_size : (page + 1) * page_size]
        pages = f"/{-(-len(buffer) // page_size)}" if exhausted else "+"
        console.clear()
        console.print(_results_table(f"{query!r} — page {page + 1}{pages}", rows))
        console.print(
            "[dim]← prev · → next · q quit — `seqout show <accession>` to inspect[/]",
        )
        key = _read_key()
        if key in ("q", "\x1b", "\x03"):
            break
        if key == "right":
            ensure((page + 2) * page_size)
            if len(buffer) > (page + 1) * page_size:
                page += 1
        elif key == "left":
            page = max(0, page - 1)


def _merge_augmented(
    extra: list[SearchResult],
    results: Iterator[SearchResult],
) -> Iterator[SearchResult]:
    """
    Yield the corrected extras first, then the rest of the literal stream.

    Any accession already shown as an extra is dropped from the stream; the
    backend can list a corrected hit in both places.
    """
    seen = {(r.source, r.accession) for r in extra}
    yield from extra
    for r in results:
        if (r.source, r.accession) not in seen:
            yield r


def _print_correction(console: Console, correction: SearchCorrection | None) -> None:
    """Surface the backend's spelling correction, mirroring the web banner."""
    if correction is None:
        return
    orig, fixed = correction.original_query, correction.corrected_query
    if correction.mode == "replaced":
        console.print(
            f"[yellow]Showing results for[/] {fixed!r} "
            f"[dim](corrected from {orig!r})[/]"
        )
    elif correction.extra_results:
        console.print(
            f"[yellow]Did you mean[/] {fixed!r}? "
            f"[dim]added {len(correction.extra_results)} match(es) below[/]"
        )


def cmd_search(
    query: str | None,
    db: Literal["geo", "sra", "arrayexpress", "ena", "gsa", "dra", "gea"] | None,
    limit: int,
    sortby: Literal["citations", "journal", "year"] | None,
    max_results: int | None = None,
    date_range: DateRange | None = None,
    organism: str | None = None,
    library_strategy: list[str] | None = None,
    platform: list[str] | None = None,
    library_source: list[str] | None = None,
    save_to: Path | None = None,
    country: list[str] | None = None,
    journal: list[str] | None = None,
    instrument_model: list[str] | None = None,
    multi_platform: bool = False,
    assay_l1: str | None = None,
    assay_l2: str | None = None,
    structured: bool = False,
) -> None:
    console = Console()
    date_from, date_to = date_range or (None, None)
    filters = {
        "db": db,
        "organism": organism,
        "library_strategy": library_strategy,
        "library_source": library_source,
        "platform": platform,
        "country": country,
        "journal": journal,
        "instrument_model": instrument_model,
        "multi_platform": multi_platform or None,
        "assay_l1": assay_l1,
        "assay_l2": assay_l2,
        "date_from": date_from.isoformat() if date_from else None,
        "date_to": date_to.isoformat() if date_to else None,
    }
    if not query and not any(filters.values()):
        console.print(
            "[red]Provide a search query or at least one filter[/] "
            "(-O/-S/-P/-C/-d/--db/--country/--journal/--assay).",
        )
        raise SystemExit(1)
    label = query or "(filter-only)"  # query is optional in query-less search
    try:
        # plan_search picks the endpoint from the filters and says what is left
        # for the client to do, so the command line never names an endpoint.
        plan = plan_search(
            query, sortby=sortby, structured=structured or None, **filters
        )
        params = plan.params
    except Exception as e:
        console.print(f"[red]Invalid query:[/] {e}")
        raise SystemExit(1) from e

    try:
        with connect_to_seqout(backend="api") as sq:
            # Page 0 carries spelling correction while later pages carry only results.
            correction, it = sq.search_with_correction(params)
            if plan.has_local_work:
                # The endpoint the filters chose has no sortby and no day
                # bounds; apply them here rather than lose them.
                it = iter(apply_plan(it, plan))
            _print_correction(console, correction)
            augmented = correction and correction.mode == "augmented"
            if augmented and correction.extra_results:
                # Augmented corrected matches are displayed first, matching the web app.
                it = _merge_augmented(correction.extra_results, it)
            if save_to is None and sys.stdin.isatty() and sys.stdout.isatty():
                if max_results is not None:
                    it = itertools.islice(it, max_results)
                _paged_search(console, label, it, limit)
                return
            with console.status("[bold]Searching…[/]"):
                results = list(itertools.islice(it, max_results or limit))
    except Exception as e:
        console.print(f"[red]Search failed:[/] {e}")
        raise SystemExit(1) from e

    if not results:
        console.print(f"[yellow]No results for[/] {label}.")
        return
    if save_to is not None:
        _save_results(results, save_to)
        console.print(f"[green]Saved {len(results)} result(s) to[/] {save_to}")
        return
    console.print(_results_table(f"{label} — {len(results)} result(s)", results))
    console.print("[dim]Tip: `seqout show <accession>` to inspect a result.[/]")


SAMPLE_PREFIXES = (
    "GSM",
    "SRS",
    "SRX",
    "SRR",
    "ERS",
    "ERX",
    "ERR",
    "DRS",
    "DRX",
    "DRR",
    "SAM",
)


_STUDY_PREFIXES = ("SRP", "ERP", "DRP", "CRA", "HRA", "PRJ")


def _resolve_accession(sq: SeqoutAPIClient, acc: str, want: str) -> str | None:
    """
    Resolve a project to its sibling of the kind needed via cross-references.

    want="runs" -> an SRA/ENA study (SRP/ERP/DRP, or PRJ) for run downloads;
    want="geo"  -> a GEO series / ArrayExpress (GSE/E-) for supplementary files.
    Returns acc unchanged if it's already the right kind, else the linked
    accession, else None.
    """
    targets = _STUDY_PREFIXES if want == "runs" else ("GSE", "E-")
    if acc.upper().startswith(targets):
        return acc
    # Client-owned cross-source lookup keeps this backend-agnostic.
    return sq.linked_study(acc) if want == "runs" else sq.linked_geo(acc)


def cmd_download(
    accession: str, out: str | None, *, parquet: bool = False, source: str | None = None
) -> None:
    console = Console()
    acc = accession.strip()
    up = acc.upper()

    if parquet and up.startswith(SAMPLE_PREFIXES):
        console.print(
            f"[yellow]Sample metadata JSON for {acc} isn't available on the "
            "parquet backend.[/] Use a project accession, or drop --parquet."
        )
        raise SystemExit(1)

    try:
        with (
            _open_backend(parquet=parquet, source=source) as sq,
            console.status(f"[bold]Fetching {acc}…[/]"),
        ):
            if up.startswith(SAMPLE_PREFIXES):
                if up.startswith("GSM"):
                    detail = sq.fetch_geo_sample_detailed_metadata(acc)
                else:
                    detail = sq.fetch_sample_detailed_metadata(acc)
                data = detail.model_dump()
            else:
                is_geo = up.startswith(("GSE", "E-"))
                try:
                    meta = sq.fetch_project_metadata(acc)
                    project = meta.model_dump()
                except Exception:
                    project = None  # Header is best effort; samples are the payload.
                rows = (
                    sq.fetch_samples(acc) if is_geo else sq.fetch_study_experiments(acc)
                )
                data = {"accession": acc, "project": project, "samples": rows.to_dict()}
    except Exception as e:
        console.print(f"[red]Failed to fetch {acc}:[/] {e}")
        raise SystemExit(1) from e

    dest = Path(out) if out else Path(f"{acc}.json")
    if dest.is_dir():
        dest = dest / f"{acc}.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(data, indent=2, default=str, ensure_ascii=False))
    console.print(
        f"[green]✓[/] wrote [bold]{dest}[/]  [dim]({dest.stat().st_size:,} bytes)[/]"
    )


def cmd_download_supplementary(
    accession: str, out: str | None, *, parquet: bool = False, source: str | None = None
) -> None:
    console = Console()
    acc = accession.strip()
    out_dir = Path(out) if out else Path(acc)
    try:
        with _open_backend(parquet=parquet, source=source) as sq:
            with console.status(f"[bold]Looking up {acc}…[/]"):
                geo = _resolve_accession(sq, acc, "geo") or acc
                if geo != acc:
                    console.print(f"[dim]{acc} → {geo} (linked GEO series)[/]")
                meta = sq.fetch_project_metadata(geo)
            n = len(meta.supplementary_data)
            if not n:
                console.print(f"[yellow]No supplementary files listed for {geo}.[/]")
                return
            console.print(
                f"Downloading [bold]{n}[/] supplementary file(s) → [bold]{out_dir}/[/]"
            )
            sq.download_project_supplementary_data(meta, out_dir)
    except RuntimeError as e:
        console.print(f"[red]{e}[/]")
        raise SystemExit(1) from e
    except Exception as e:
        console.print(f"[red]Failed:[/] {e}")
        raise SystemExit(1) from e
    console.print(f"[green]✓[/] done → [bold]{out_dir}/[/]")


RUN_PREFIXES = ("SRR", "ERR", "DRR")

# Non-fastq modes carry size/md5 in the sra_* fields.
_MODE_FIELDS = {
    "fastq": ("fastq_ftp", "fastq_bytes", "fastq_md5"),
    "sra": ("sra_ftp", "sra_bytes", "sra_md5"),
    "sra_lite": ("ncbi_sra_lite_url", "sra_bytes", "sra_md5"),
    "s3": ("ncbi_sra_lite_s3_url", "sra_bytes", "sra_md5"),
    "gcs": ("ncbi_sra_lite_gs_url", "sra_bytes", "sra_md5"),
}


_KILOBYTE = 1024


def _fmt_bytes(b: str) -> str:
    try:
        n = float(b)
    except (TypeError, ValueError):
        return b or "?"
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < _KILOBYTE or unit == "TB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= _KILOBYTE
    return f"{n:.1f} TB"


def _sum_run_bytes(runs: StudyRunsResults, mode: str) -> int:
    """Total bytes across runs for a download mode (fields are ';'-joined per run)."""
    field = _MODE_FIELDS[mode][1]
    total = 0
    for r in runs:
        raw = getattr(r, field, None)
        for part in str(raw or "").split(";"):
            if part.strip().isdigit():
                total += int(part)
    return total


def _mode_available(runs: StudyRunsResults, mode: str) -> bool:
    url_field = _MODE_FIELDS[mode][0]
    return any(getattr(r, url_field, None) for r in runs)


def _resolve_run_study(sq: SeqoutAPIClient, run_acc: str) -> str | None:
    return sq.resolve_study(run_acc)


def _select_run_files(
    console: Console, run: StudyRunsResult, mode: StudyRunDownloadMode
) -> StudyRunsResults | None:
    """Return a StudyRunsResults holding run with only the chosen files, or None."""
    try:
        _validate_study_runs_data(StudyRunsResults([run]), mode)
    except ValueError as e:
        console.print(f"[red]{e}[/]")
        return None

    urls, sizes, md5s = _extract_download_info_for_study_run(run, mode)
    files = list(zip(urls, sizes, md5s, strict=False))

    if run.library_layout == "PAIRED" and len(urls) == 1:
        console.print(
            "[yellow]⚠ Interleaved PE:[/] paired-end reads are in a single interleaved "
            "file. Use [bold]fasterq-dump --split-3[/] to extract R1/R2."
        )

    if len(files) > 1 and sys.stdin.isatty():
        choices = [
            questionary.Choice(
                title=f"{u.split('/')[-1]}  ({_fmt_bytes(b)})", value=f, checked=False
            )
            for f in files
            for u, b, _ in [f]
        ]
        plain = questionary.Style(
            [("highlighted", "noreverse"), ("selected", "noreverse")]
        )
        picks = questionary.checkbox(
            f"{run.run_accession}: select {mode} files "
            "(space to toggle, enter to confirm)",
            choices=choices,
            style=plain,
        ).ask()
        if picks is None:  # cancelled (ctrl-c / esc)
            console.print("[yellow]Cancelled.[/]")
            return None
        if not picks:
            console.print("[yellow]Nothing selected.[/]")
            return None
        files = picks

    url_f, bytes_f, md5_f = _MODE_FIELDS[mode]
    sel = run.model_copy(
        update={
            url_f: ";".join(u for u, _, _ in files),
            bytes_f: ";".join(b for _, b, _ in files),
            md5_f: ";".join(m for _, _, m in files),
        }
    )
    console.print(f"Selected [bold]{len(files)}[/] file(s).")
    return StudyRunsResults([sel])


def cmd_download_runs(
    accession: str,
    out: str | None,
    mode: StudyRunDownloadMode,
    *,
    parquet: bool = False,
    source: str | None = None,
) -> None:
    console = Console()
    acc = accession.strip()
    up = acc.upper()
    out_dir = Path(out) if out else Path(acc)
    try:
        with _open_backend(parquet=parquet, source=source) as sq:
            if up.startswith(RUN_PREFIXES):
                with console.status(f"[bold]Resolving {acc}…[/]"):
                    study = _resolve_run_study(sq, acc)
                    if study is None:
                        console.print(
                            f"[yellow]Couldn't find the study for run {acc}.[/]"
                        )
                        raise SystemExit(1)
                    runs = sq.fetch_study_runs(study, full=True)
                run = next((r for r in runs if r.run_accession.upper() == up), None)
                if run is None:
                    console.print(f"[yellow]Run {acc} not found in {study}.[/]")
                    raise SystemExit(1)
                console.print(f"[dim]{acc} → {study}[/]")
                runs = _select_run_files(console, run, mode)
                if runs is None:
                    return
            else:
                with console.status(f"[bold]Fetching runs for {acc}…[/]"):
                    study = _resolve_accession(sq, acc, "runs")
                    if study is None:
                        console.print(
                            "[yellow]No SRA/ENA study linked to"
                            f" {acc}; can't fetch runs.[/]"
                        )
                        raise SystemExit(1)
                    if study != acc:
                        console.print(f"[dim]{acc} → {study} (linked SRA study)[/]")
                    runs = sq.fetch_study_runs(study, full=True)
                if not runs:
                    console.print(f"[yellow]No runs found for {study}.[/]")
                    return

            console.print(
                "Downloading"
                f" [bold]{len(runs)}[/] run(s) as [bold]{mode}[/] → [bold]{out_dir}/[/]"
            )
            sq.download_study_runs_data(runs, out_dir, mode=mode)
    except ValueError as e:
        console.print(f"[red]{e}[/]")
        raise SystemExit(1) from e
    except RuntimeError as e:
        console.print(f"[red]{e}[/]")
        raise SystemExit(1) from e
    except Exception as e:
        console.print(f"[red]Failed:[/] {e}")
        raise SystemExit(1) from e
    console.print(f"[green]✓[/] done → [bold]{out_dir}/[/]")


_PLAIN_QSTYLE = questionary.Style(
    [("highlighted", "noreverse"), ("selected", "noreverse")]
)


def _sample_supplementary_urls(sq: SeqoutAPIClient, acc: str) -> list[str]:
    """
    Per-sample supplementary file URLs.

    One GSM's own, or every sample's in a GEO series / ArrayExpress experiment.
    Empty for SRA (no such concept).
    """
    up = acc.upper()
    try:
        if up.startswith("GSM"):
            detail = sq.fetch_geo_sample_detailed_metadata(acc)
            return list(detail.sample.supplementary_data or [])
        if up.startswith(("GSE", "E-")):
            return [
                u for s in sq.fetch_samples(acc) for u in (s.supplementary_data or [])
            ]
    except Exception:  # best-effort inventory; absence hides the option
        return []
    return []


def cmd_download_sample_supplementary(
    accession: str, out: str | None, *, parquet: bool = False, source: str | None = None
) -> None:
    console = Console()
    acc = accession.strip()
    out_dir = Path(out) if out else Path(acc)
    try:
        with _open_backend(parquet=parquet, source=source) as sq:
            with console.status(f"[bold]Looking up samples for {acc}…[/]"):
                urls = _sample_supplementary_urls(sq, acc)
            if not urls:
                console.print(
                    f"[yellow]No per-sample supplementary files for {acc}.[/]"
                )
                return
            console.print(
                f"Downloading [bold]{len(urls)}[/] sample file(s) → [bold]{out_dir}/[/]"
            )
            sq.download_files(urls, out_dir)
    except RuntimeError as e:
        console.print(f"[red]{e}[/]")
        raise SystemExit(1) from e
    except Exception as e:
        console.print(f"[red]Failed:[/] {e}")
        raise SystemExit(1) from e
    console.print(f"[green]✓[/] done → [bold]{out_dir}/[/]")


def _runs_label(label: str, runs: StudyRunsResults) -> str:
    """Append known fastq/sra-lite totals to a run-group menu label."""
    sizes = " · ".join(
        f"{m} {_fmt_bytes(str(_sum_run_bytes(runs, m)))}"
        for m in ("fastq", "sra_lite")
        if _sum_run_bytes(runs, m)
    )
    return f"{label}  ({sizes})" if sizes else label


def _single_run(sq: SeqoutAPIClient, acc: str, up: str) -> StudyRunsResults | None:
    """Resolve a pasted run accession to its study and return only that run."""
    try:
        study = _resolve_run_study(sq, acc)
        if not study:
            return None
        run = next(
            (
                r
                for r in sq.fetch_study_runs(study, full=True)
                if r.run_accession.upper() == up
            ),
            None,
        )
    except Exception:
        return None
    return StudyRunsResults([run]) if run is not None else None


def _download_run_group(
    console: Console, sq: SeqoutAPIClient, runs: StudyRunsResults, out_dir: Path
) -> None:
    """Interactive run download: pick a format, confirm the size, then fetch."""
    modes = [m for m in _MODE_FIELDS if _mode_available(runs, m)]
    if not modes:
        console.print("[yellow]No downloadable run files found.[/]")
        return
    mode = questionary.select(
        "Format?",
        choices=modes,
        default="fastq" if "fastq" in modes else modes[0],
        style=_PLAIN_QSTYLE,
    ).ask()
    if mode is None:
        return
    total = _sum_run_bytes(runs, mode)
    size = f" ({_fmt_bytes(str(total))})" if total else ""
    if not questionary.confirm(
        f"Download {len(runs)} run(s) as {mode}{size} into {out_dir}/?",
        default=False,
        style=_PLAIN_QSTYLE,
    ).ask():
        console.print("[yellow]Cancelled.[/]")
        return
    console.print(f"Downloading [bold]{len(runs)}[/] run(s) as [bold]{mode}[/]…")
    sq.download_study_runs_data(runs, out_dir, mode=mode)
    console.print(f"[green]✓[/] done → [bold]{out_dir}/[/]")


def cmd_download_interactive(
    accession: str, out: str | None, *, parquet: bool = False, source: str | None = None
) -> None:
    """
    Interactive picker for download <acc> with no mode flag on a TTY.

    Inventory what's available for the accession, let the user pick one group,
    then fetch it.
    """
    console = Console()
    acc = accession.strip()
    up = acc.upper()
    out_dir = Path(out) if out else Path(acc)
    groups: list[dict] = []

    try:
        with _open_backend(parquet=parquet, source=source) as sq:
            with console.status(f"[bold]Inspecting {acc}…[/]"):
                if up.startswith(RUN_PREFIXES):
                    runs = _single_run(sq, acc, up)
                    if runs:
                        groups.append(
                            {
                                "kind": "runs",
                                "label": _runs_label(f"Run {acc}", runs),
                                "runs": runs,
                            }
                        )
                else:
                    groups.append({"kind": "metadata", "label": "Metadata (JSON)"})
                    geo = _resolve_accession(sq, acc, "geo")
                    if geo:
                        try:
                            meta = sq.fetch_project_metadata(geo)
                        except Exception:
                            meta = None
                        if meta and meta.supplementary_data:
                            groups.append(
                                {
                                    "kind": "project_supp",
                                    "label": "Project supplementary"
                                    f" — {len(meta.supplementary_data)} file(s)",
                                }
                            )
                    supp = _sample_supplementary_urls(sq, acc)
                    if supp:
                        groups.append(
                            {
                                "kind": "sample_supp",
                                "label": f"Sample supplementary — {len(supp)} file(s)",
                                "urls": supp,
                            }
                        )
                    if not up.startswith(SAMPLE_PREFIXES):
                        study = _resolve_accession(sq, acc, "runs")
                        runs = None
                        if study:
                            try:
                                runs = sq.fetch_study_runs(study, full=True)
                            except Exception:
                                runs = None
                        if runs:
                            label = f"Run data — {len(runs)} run(s)"
                            groups.append(
                                {
                                    "kind": "runs",
                                    "label": _runs_label(label, runs),
                                    "runs": runs,
                                }
                            )

            if not groups:
                console.print(f"[yellow]Nothing downloadable found for {acc}.[/]")
                return
            if len(groups) == 1 and groups[0]["kind"] == "metadata":
                console.print(f"[dim]Only metadata is available for {acc}.[/]")
            choice = questionary.select(
                f"{acc}: what do you want to download?",
                choices=[
                    questionary.Choice(g["label"], value=i)
                    for i, g in enumerate(groups)
                ],
                style=_PLAIN_QSTYLE,
            ).ask()
            if choice is None:
                console.print("[yellow]Cancelled.[/]")
                return
            g = groups[choice]

            if g["kind"] == "sample_supp":
                console.print(
                    f"Downloading [bold]{len(g['urls'])}[/] file(s) →"
                    f" [bold]{out_dir}/[/]"
                )
                sq.download_files(g["urls"], out_dir)
                console.print(f"[green]✓[/] done → [bold]{out_dir}/[/]")
                return
            if g["kind"] == "runs":
                _download_run_group(console, sq, g["runs"], out_dir)
                return
    except RuntimeError as e:
        console.print(f"[red]{e}[/]")
        raise SystemExit(1) from e
    except Exception as e:
        console.print(f"[red]Failed:[/] {e}")
        raise SystemExit(1) from e

    if g["kind"] == "metadata":
        cmd_download(acc, out, parquet=parquet, source=source)
    elif g["kind"] == "project_supp":
        cmd_download_supplementary(acc, out, parquet=parquet, source=source)


# Mesh prefixes cover SRA, ENA, DDBJ/DRA, GSA, BioProjects and GEO samples.
_MESH_ENTITY = {
    ("SRP", "ERP", "DRP", "CRA", "HRA", "PRJ"): "study",
    ("SRR", "ERR", "DRR", "CRR", "HRR"): "srr",
    ("SRX", "ERX", "DRX", "CRX", "HRX"): "srx",
    ("SRS", "ERS", "DRS", "CRS", "HRS", "SAM"): "srs",
    ("GSM",): "gsm",
}
# GEO-derived SRA experiment titles start "GSM123: ...", the GSM<->SRX link.
_GSM_TITLE = re.compile(r"^(GSM\d+)\s*:")
_TARGET_COL = {
    "study": "study",
    "srp": "study",
    "erp": "study",
    "drp": "study",
    "cra": "study",
    "hra": "study",
    "run": "srr",
    "srr": "srr",
    "err": "srr",
    "drr": "srr",
    "crr": "srr",
    "experiment": "srx",
    "srx": "srx",
    "erx": "srx",
    "drx": "srx",
    "crx": "srx",
    "sample": "srs",
    "srs": "srs",
    "ers": "srs",
    "drs": "srs",
    "crs": "srs",
    "gsm": "gsm",
}
_CONVERT_TO_CHOICES = (
    "study",
    "experiment",
    "sample",
    "run",
    "srp",
    "srx",
    "srs",
    "srr",
    "gsm",
    "gse",
    "pmid",
    "doi",
)

_ARCHIVE_ENTITIES = {
    "ena": ("erp", "erx", "err", "ers"),
    "dra": ("drp", "drx", "drr", "drs"),
    "gsa": ("cra", "crx", "crr", "crs"),
}


def _archive_convert_commands() -> tuple[str, ...]:
    """All intra-archive a-to-b command names for ENA/DDBJ/GSA."""
    cmds: list[str] = []
    for tokens in _ARCHIVE_ENTITIES.values():
        cmds += [f"{a}-to-{b}" for a in tokens for b in tokens if a != b]
    return tuple(cmds)


_CONVERT_COMMANDS = (
    "gse-to-gsm",
    "gse-to-srp",
    "gsm-to-gse",
    "gsm-to-srp",
    "gsm-to-srr",
    "gsm-to-srs",
    "gsm-to-srx",
    "srp-to-gse",
    "srp-to-srr",
    "srp-to-srs",
    "srp-to-srx",
    "srr-to-gsm",
    "srr-to-srp",
    "srr-to-srs",
    "srr-to-srx",
    "srs-to-gsm",
    "srs-to-srx",
    "srx-to-srp",
    "srx-to-srr",
    "srx-to-srs",
    "srp-to-pmid",
    "gse-to-pmid",
    "ae-to-pmid",
    "ena-to-pmid",
    "srp-to-doi",
    "gse-to-doi",
    "pmid-to-gse",
    "pmid-to-srp",
    "doi-to-gse",
    "doi-to-srp",
    *_archive_convert_commands(),
)
_SAMPLE_SOURCES = ("GSE", "E-")


def _mesh_column(up: str) -> str | None:
    for prefixes, col in _MESH_ENTITY.items():
        if up.startswith(prefixes):
            return col
    return None


def _mesh_project(
    sq: SeqoutAPIClient, study: str, col: str, up: str, target: str
) -> list[str]:
    rows = _sra_mesh(sq, study)
    if col != "study":
        rows = [r for r in rows if r[col] and r[col].upper() == up]
    return list(dict.fromkeys(r[target] for r in rows if r[target]))  # ordered dedup


def _sra_mesh(sq: SeqoutAPIClient, srp: str) -> list[dict]:
    """study<->run<->experiment<->sample<->gsm rows for one SRA study."""
    runs = sq.fetch_study_runs(srp, full=True)
    exps = sq.fetch_study_experiments(srp)
    srx_samples = {e.accession: (list(e.samples or []) or [None]) for e in exps}
    srx_gsm = {
        e.accession: (m.group(1) if (m := _GSM_TITLE.match(e.title or "")) else None)
        for e in exps
    }
    seen_srx: set[str] = set()
    rows: list[dict] = []
    for r in runs:
        srx = r.experiment_accession
        seen_srx.add(srx)
        rows.extend(
            {
                "study": r.study_accession or srp,
                "srx": srx,
                "srr": r.run_accession,
                "srs": srs,
                "gsm": srx_gsm.get(srx),
            }
            for srs in srx_samples.get(srx, [None])
        )
    for e in exps:  # experiments/samples that carry no runs still map
        if e.accession not in seen_srx:
            rows.extend(
                {
                    "study": srp,
                    "srx": e.accession,
                    "srr": None,
                    "srs": srs,
                    "gsm": srx_gsm.get(e.accession),
                }
                for srs in srx_samples[e.accession]
            )
    return rows


def _gsm_series(sq: SeqoutAPIClient, gsm: str) -> str | None:
    """Return the GEO series (GSE) a GEO sample belongs to."""
    return sq.gsm_series(gsm)


def _study_of(sq: SeqoutAPIClient, acc: str, col: str) -> str | None:
    """Resolve a mesh-source accession to its study root."""
    if col == "study":
        return acc
    if col == "gsm":  # GSM reaches runs through its GEO series link.
        gse = _gsm_series(sq, acc)
        return _resolve_accession(sq, gse, "runs") if gse else None
    return _resolve_run_study(sq, acc)


# reverse literature targets -> the accession prefix(es) to keep (None = all).
_PUB_TARGET_PREFIX = {"gse": ("GSE",), "srp": ("SRP",)}


def _is_pmid(up: str) -> bool:
    return up.isdigit()


def _is_doi(acc: str) -> bool:
    return acc.startswith("10.") and "/" in acc


def _project_of(sq: SeqoutAPIClient, acc: str, up: str) -> str | None:
    """Return the project/series accession that carries an accession's pubs."""
    if up.startswith(("GSE", "E-")) or _mesh_column(up) == "study":
        return acc
    if up.startswith("GSM"):
        return _gsm_series(sq, acc)
    return _resolve_run_study(sq, acc)


def _accession_pubs(sq: SeqoutAPIClient, acc: str, up: str, kind: str) -> list[str]:
    """Forward: accession -> its publication ids (kind = 'pmid' or 'doi')."""
    proj = _project_of(sq, acc, up)
    if not proj:
        return []
    try:
        meta = sq.fetch_project_metadata(proj)
    except Exception:
        return []
    ordered = [getattr(meta, kind, None)]  # flat id first, then per-publication
    ordered += [getattr(p, kind, None) for p in (meta.publications or [])]
    return list(dict.fromkeys(v for v in ordered if v))


def _publication_projects(
    sq: SeqoutAPIClient, acc: str, up: str, target: str
) -> list[str]:
    """Reverse: a publication id -> linked project accessions, filtered by target."""
    res = (
        sq.find_publication(pmid=acc) if up.isdigit() else sq.find_publication(doi=acc)
    )
    prefixes = _PUB_TARGET_PREFIX.get(target)
    accs = [
        p.accession
        for p in res.projects
        if not prefixes or p.accession.upper().startswith(prefixes)
    ]
    return list(dict.fromkeys(accs))


def _convert_special(
    sq: SeqoutAPIClient, acc: str, up: str, to_kind: str
) -> list[str] | None:
    """
    Non-mesh conversions (literature, GEO-family samples, GEO-series resolve).

    Returns the result list, or None to fall through to the study mesh.
    """
    if _is_pmid(up) or _is_doi(acc):
        return _publication_projects(sq, acc, up, to_kind)
    if to_kind in ("pmid", "doi"):
        return _accession_pubs(sq, acc, up, to_kind)
    if to_kind in ("sample", "gsm") and up.startswith(_SAMPLE_SOURCES):
        return [s.accession for s in sq.fetch_samples(acc)]
    if to_kind == "gse":
        geo = (
            _gsm_series(sq, acc)
            if up.startswith("GSM")
            else _resolve_accession(sq, acc, "geo")
        )
        return [geo] if geo else []
    return None


def _convert_one(
    sq: SeqoutAPIClient, acc: str, up: str, to_kind: str, console: Console
) -> list[str]:
    special = _convert_special(sq, acc, up, to_kind)
    if special is not None:
        return special

    target = _TARGET_COL.get(to_kind)
    col = _mesh_column(up) if target else None
    result = None
    if target and col is not None:
        study = _study_of(sq, acc, col)
        if not study:
            console.print(f"[yellow]{acc}: couldn't resolve to a study.[/]")
            return []
        result = _mesh_project(sq, study, col, up, target)
    elif target and up.startswith(_SAMPLE_SOURCES):
        study = _resolve_accession(sq, acc, "runs")
        if study and target == "study":
            result = [study]  # The linked project itself needs no mesh.
        elif study:
            result = _mesh_project(sq, study, "study", up, target)

    if result is None:
        console.print(f"[yellow]{acc}: → {to_kind} not supported for this source.[/]")
        return []
    return result


def cmd_convert(
    accessions: list[str],
    to_kind: str,
    save_to: str | None,
    *,
    parquet: bool = False,
    source: str | None = None,
) -> None:
    console = Console()
    pairs: list[tuple[str, str]] = []
    try:
        with (
            _open_backend(parquet=parquet, source=source) as sq,
            console.status("[bold]Resolving…[/]"),
        ):
            for raw in accessions:
                acc = raw.strip()
                results = _convert_one(sq, acc, acc.upper(), to_kind, console)
                pairs.extend((acc, r) for r in results)
    except Exception as e:
        console.print(f"[red]Failed:[/] {e}")
        raise SystemExit(1) from e

    if not pairs:
        console.print("[yellow]No results.[/]")
        return
    if save_to:
        Path(save_to).write_text("\n".join(f"{a}\t{b}" for a, b in pairs) + "\n")
        console.print(f"[green]✓[/] wrote {len(pairs)} row(s) → [bold]{save_to}[/]")
        return
    table = Table(box=None)
    table.add_column("input", style="dim")
    table.add_column(to_kind)
    for a, b in pairs:
        table.add_row(a, b)
    console.print(table)


def cmd_pmid(ident: str, *, parquet: bool = False, source: str | None = None) -> None:
    console = Console()
    ident = ident.strip()
    is_doi = _is_doi(ident)
    try:
        with (
            _open_backend(parquet=parquet, source=source) as sq,
            console.status(f"[bold]Looking up {ident}…[/]"),
        ):
            res = (
                sq.find_publication(doi=ident)
                if is_doi
                else sq.find_publication(pmid=ident)
            )
    except Exception as e:
        console.print(f"[red]Failed:[/] {e}")
        raise SystemExit(1) from e

    if not res.pmid and not res.projects:
        console.print(f"[yellow]No publication found for {ident}.[/]")
        return

    body = f"[bold]{res.title or '(title unavailable)'}[/]"
    meta = [
        b
        for b in (
            res.journal,
            f"PMID {res.pmid}" if res.pmid else None,
            f"doi:{res.doi}" if res.doi else None,
        )
        if b
    ]
    if meta:
        body += "\n[dim]" + "  ·  ".join(meta) + "[/]"
    panel = Panel(body, title="publication", border_style="green", expand=False)

    table = Table(
        title=f"{res.total_projects} linked dataset(s)",
        title_style="bold",
        header_style="bold green",
    )
    table.add_column("accession", style="bold cyan", no_wrap=True)
    table.add_column("src", no_wrap=True)
    table.add_column("title", overflow="fold")
    for p in res.projects:
        table.add_row(p.accession, p.source or "—", p.title or "—")
    _page(console, panel, table)


def cmd_author(name: str, *, parquet: bool = False, source: str | None = None) -> None:
    console = Console()
    name = name.strip()
    try:
        with (
            _open_backend(parquet=parquet, source=source) as sq,
            console.status(f"[bold]Finding datasets by {name}…[/]"),
        ):
            resp = sq.search_author_projects(name)
    except Exception as e:
        console.print(f"[red]Failed:[/] {e}")
        raise SystemExit(1) from e

    if not resp.results:
        console.print(f"[yellow]No datasets found for author '{name}'.[/]")
        return

    renderables: list[object] = []
    if resp.institutes:
        top = "  ·  ".join(f"{i.name} ({i.count})" for i in resp.institutes[:8])
        renderables.append(Panel(top, title="institutes", border_style="dim"))
    renderables.append(
        _results_table(f"{resp.total} dataset(s) linked to '{name}'", resp.results)
    )
    _page(console, *renderables)


def run_norm(
    accession: str,
    model_spec: str | None,
    port: int | None = None,
    base_url: str | None = None,
) -> None:
    console = Console()

    try:
        with console.status("[bold]Fetching samples…[/]") as status:
            records = build_records(
                connect_to_seqout(backend="api"),
                accession,
                on_progress=lambda m: status.update(f"[bold]{m}…[/]"),
            )
    except ValueError as e:
        console.print(f"[red]Error:[/] {e}")
        raise SystemExit(1) from e
    except Exception as e:
        console.print(f"[red]Failed to fetch samples for {accession}:[/] {e}")
        raise SystemExit(1) from e

    if not records:
        console.print(f"[yellow]No samples found for {accession}.[/]")
        raise SystemExit(1)

    # --base-url wins, then an already-running server, then --model
    detected = False
    if base_url is not None:
        try:
            engine, engine_name, model_name = engine_from_base_url(base_url)
        except EngineError as e:
            console.print(f"[red]{e}[/]")
            raise SystemExit(1) from e
        detected = True
    else:
        found = autodetect_engine(port)
        if found is not None:
            engine, engine_name, model_name = found
            detected = True
        else:
            engine_name, model_name = parse_model_spec(model_spec)
            engine = make_engine(engine_name, model_name, port=port)

    label = f"[dim]Engine:[/] {engine_name}   [dim]Model:[/] {model_name}"
    if detected:
        label += "   [green](detected running server)[/]"
    console.print(label)

    # Prompt for an HF token only before a private or gated repo download.
    repo = engine.hf_repo()
    if (
        repo
        and not hf_token_from_env()
        and sys.stdin.isatty()
        and hf_repo_is_private(repo)
    ):
        console.print(
            f"[yellow]{repo} looks private/gated on HuggingFace.[/] "
            "Paste an access token (from https://huggingface.co/settings/tokens), "
            "or leave blank to skip."
        )
        token = Prompt.ask("  HF token", password=True, default="", show_default=False)
        if token.strip():
            set_hf_token(token.strip())

    try:
        with console.status("[bold]Preparing model…[/]") as status:
            engine.ensure_ready(status=lambda m: status.update(f"[bold]{m}…[/]"))
    except EngineError as e:
        console.print(f"\n[red]Cannot run inference:[/]\n{e}")
        raise SystemExit(1) from e
    except Exception as e:
        console.print(f"\n[red]Failed to prepare the model:[/] {e}")
        raise SystemExit(1) from e

    console.print()

    def cell(value: object) -> str:
        return str(value) if value is not None else "[dim]null[/]"

    def invalid_panel(sample: str, raw: str) -> None:
        console.print(
            Panel(
                raw[:400] or "[dim](empty response)[/]",
                title=f"[yellow]{sample}: no valid JSON[/]",
                border_style="yellow",
            )
        )

    def normalize(record: SampleRecord) -> tuple[dict[str, str] | None, str]:
        try:
            raw = engine.chat(SYS_PROMPT, record.user_prompt())
            return parse_labels(raw), raw
        except Exception as e:
            return None, f"<error: {e}>"

    if len(records) == 1:
        r = records[0]
        with console.status(f"[bold]Normalizing {r.sample}…[/]"):
            labels, raw = normalize(r)
        if labels is None:
            invalid_panel(r.sample, raw)
            return
        table = Table(
            title=r.sample,
            show_lines=False,
            header_style="bold green",
            title_style="bold",
        )
        table.add_column("field", style="cyan", no_wrap=True)
        table.add_column("value", overflow="fold")
        for f in LABEL_FIELDS:
            table.add_row(f, cell(labels.get(f)))
        console.print(table)
        return

    def build_table() -> Table:
        t = Table(title="Normalized labels", show_lines=True, header_style="bold green")
        t.add_column("sample", style="bold cyan", no_wrap=True)
        for f in LABEL_FIELDS:
            t.add_column(f, overflow="fold")
        return t

    def add_result_row(t: Table, sample: str, labels: dict[str, str] | None) -> None:
        if labels is None:
            t.add_row(sample, *(["[red]—[/]"] * len(LABEL_FIELDS)))
        else:
            t.add_row(sample, *(cell(labels.get(f)) for f in LABEL_FIELDS))

    invalid: list[tuple[str, str]] = []
    live_table = build_table()
    n = len(records)
    with Live(
        live_table, console=console, transient=True, refresh_per_second=12
    ) as live:
        for i, r in enumerate(records, 1):
            labels, raw = normalize(r)
            if labels is None:
                invalid.append((r.sample, raw))
            add_result_row(live_table, r.sample, labels)
            live_table.caption = f"normalized {i}/{n}"
            live.update(live_table)

    # The final table needs its own width because the live render is transient.
    live_table.caption = None
    min_width = 14 * (len(LABEL_FIELDS) + 1)
    target = console if console.size.width >= min_width else Console(width=min_width)
    target.print(live_table)

    for sample, raw in invalid:
        invalid_panel(sample, raw)


_PARQUET_SOURCE_FILE = Path.home() / ".config" / "seqout" / "parquet_source"


def _is_url(s: str) -> bool:
    return s.startswith(("http://", "https://"))


def _normalize_source(source: str) -> str:
    """Strip a URL's trailing slash; expand a local path to absolute."""
    if _is_url(source):
        return source.rstrip("/")
    return str(Path(source).expanduser().resolve())


def _load_parquet_source() -> str | None:
    try:
        return _PARQUET_SOURCE_FILE.read_text(encoding="utf-8").strip() or None
    except OSError:
        return None


def _save_parquet_source(source: str) -> None:
    _PARQUET_SOURCE_FILE.parent.mkdir(parents=True, exist_ok=True)
    _PARQUET_SOURCE_FILE.write_text(source + "\n", encoding="utf-8")


def _resolve_parquet_source(arg: str | None) -> str:
    """Resolve the parquet source: --source flag > env > persisted > default URL."""
    if arg:
        return _normalize_source(arg)
    env = os.environ.get("SEQOUT_PARQUET_SOURCE")
    if env:
        return _normalize_source(env)
    return _load_parquet_source() or PARQUET_DUMP_BASE_URL


def _open_backend(
    *, parquet: bool = False, source: str | None = None
) -> SeqoutAPIClient | SeqoutParquetClient:
    """
    Open the backend a command runs against.

    Default is the API; --parquet switches to a fully local/remote DuckDB
    backend (no network to the API), honouring the same source resolution as
    the parquet subcommand.
    """
    if parquet:
        client = SeqoutParquetClient()
        client.set_source(_resolve_parquet_source(source))
        return client
    return connect_to_seqout(backend="api")


def cmd_parquet(args: argparse.Namespace) -> None:
    console = Console()

    if args.pq_command == "download":
        cmd_pq_download(args, console)
    elif args.pq_command == "query":
        cmd_pq_query(args, console)
    elif args.pq_command == "show":
        cmd_pq_show(args, console)
    elif args.pq_command == "set-source":
        cmd_pq_set_source(args, console)
    else:
        console.print("[yellow]No parquet command specified.[/]")
        console.print("Available: download, query, show, set-source")
        raise SystemExit(1)


def cmd_pq_download(args: argparse.Namespace, console: Console) -> None:
    output_dir = args.output_dir
    files = args.files or _ALL_PARQUET_FILES
    source = _resolve_parquet_source(args.source)
    if not _is_url(source):  # can't download from a local directory
        source = PARQUET_DUMP_BASE_URL
        console.print(f"[dim]Source is a local dir; downloading from {source}[/]")
    try:
        with console.status(f"[bold]Downloading {len(files)} parquet file(s)…[/]"):
            SeqoutParquetClient(base_url=source).download_parquet_files(
                output_dir=output_dir,
                files=files,
                num_workers=args.num_workers,
                with_pbar=args.with_pbar,
            )
    except Exception as e:
        console.print(f"[red]Failed to download parquet files:[/] {e}")
        raise SystemExit(1) from e
    console.print(
        f"[green]✓[/] downloaded [bold]{len(files)}[/] parquet file(s) "
        f"→ [bold]{output_dir}/[/]"
    )


def cmd_pq_query(args: argparse.Namespace, console: Console) -> None:
    source = _resolve_parquet_source(args.source)
    sql = args.sql
    limit = args.limit
    try:
        sq = SeqoutParquetClient()
        sq.set_source(source)
        result = sq.execute_query(sql)
        rows = result.fetchmany(limit)
        cols = [desc[0] for desc in result.description] if result.description else []
        if not rows:
            console.print("[yellow]Query returned no rows.[/]")
            return
        if args.csv:
            buf = io.StringIO()
            w = csv.writer(buf)
            w.writerow(cols)
            w.writerows(rows)
            console.print(buf.getvalue())
        else:
            table = Table(
                title=f"Query result ({len(rows)} row(s))",
                header_style="bold green",
            )
            for col in cols:
                table.add_column(str(col), overflow="fold")
            for row in rows:
                display = [str(v) if v is not None else "[dim]null[/]" for v in row]
                table.add_row(*display)
            console.print(table)
            if len(rows) >= limit:
                msg = (
                    f"[dim]Showing first {limit} rows. Increase --limit to see more.[/]"
                )
                console.print(msg)
    except Exception as e:
        console.print(f"[red]Query failed:[/] {e}")
        raise SystemExit(1) from e


def cmd_pq_show(args: argparse.Namespace, console: Console) -> None:
    source = _resolve_parquet_source(args.source)
    accession = args.accession
    try:
        sq = SeqoutParquetClient()
        sq.set_source(source)

        if args.samples:
            samples = sq.fetch_samples(accession)
            if not samples:
                console.print(f"[yellow]No samples found for {accession}.[/]")
                return
            table = Table(
                title=f"Samples for {accession}",
                header_style="bold green",
            )
            table.add_column("accession", style="bold cyan", no_wrap=True)
            table.add_column("title", overflow="fold")
            table.add_column("type", no_wrap=True)
            for s in samples:
                if isinstance(s, GeoSample):
                    org = s.channels[0].organism or "—"
                else:
                    org = s.organism or "—"
                table.add_row(s.accession, s.title or "—", org)
            console.print(table)
        elif args.experiments:
            experiments = sq.fetch_experiments(accession)
            if not experiments:
                console.print(f"[yellow]No experiments found for {accession}.[/]")
                return
            table = Table(
                title=f"Experiments for {accession}",
                header_style="bold green",
            )
            table.add_column("accession", style="bold cyan", no_wrap=True)
            table.add_column("strategy", no_wrap=True)
            table.add_column("platform", no_wrap=True)
            table.add_column("instrument", overflow="fold")
            for e in experiments:
                table.add_row(
                    e.accession,
                    e.library_strategy,
                    e.platform,
                    e.instrument_model,
                )
            console.print(table)
        else:
            study = sq.fetch_study(accession)
            orgs = ", ".join(study.organisms or []) or "[dim]—[/]"
            console.print(
                Panel(
                    f"[bold]{study.title}[/]\n"
                    f"[dim]{study.accession}[/]  •  "
                    f"organisms: {orgs}  •  "
                    f"{study.num_experiments} experiments, "
                    f"{study.num_samples} samples",
                    border_style="cyan",
                    expand=False,
                )
            )
    except Exception as e:
        console.print(f"[red]Failed to fetch from parquet:[/] {e}")
        raise SystemExit(1) from e


def cmd_pq_set_source(args: argparse.Namespace, console: Console) -> None:
    source = _normalize_source(args.source)
    if not _is_url(source) and not Path(source).is_dir():
        console.print(f"[red]Not a URL or an existing directory:[/] {args.source}")
        raise SystemExit(1)
    _save_parquet_source(source)
    console.print(f"[green]✓[/] parquet source set to [bold]{source}[/]")
    console.print(
        "[dim]Used by 'parquet query/show/download'. "
        "Override per-command with --source.[/]"
    )


if __name__ == "__main__":
    main()
