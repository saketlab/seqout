from __future__ import annotations

import argparse
import csv
import io
import json
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Literal

import questionary
from rich.console import Console
from rich.live import Live
from rich.panel import Panel
from rich.prompt import Prompt
from rich.table import Table

from seqoutdb.cli.norm import (
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
from seqoutdb.clients.parquet import (
    _ALL_PARQUET_FILES,
    SeqoutParquetClient,
)
from seqoutdb.models.api_models import (
    ExperimentSample,
    SearchParams,
    StudyExperimentsResult,
    StudyRunsResult,
    StudyRunsResults,
)
from seqoutdb.models.parquet_models import GeoSample
from seqoutdb.seqout import connect_to_seqout
from seqoutdb.utils import (
    StudyRunDownloadMode,
    _extract_download_info_for_study_run,
    _validate_study_runs_data,
)

if TYPE_CHECKING:
    from seqoutdb.clients.api import SeqoutAPIClient

VALID_PREFIXES = ("GSE", "GSM", "SRP", "SRS", "SRX")


def _accession(value: str) -> str:
    accession = value.strip()
    if not accession.upper().startswith(VALID_PREFIXES):
        raise argparse.ArgumentTypeError(
            f"invalid accession '{value}': must start with one of "
            f"{', '.join(VALID_PREFIXES)} (e.g. GSE12345)"
        )
    return accession


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="seqoutdb",
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

    p_search = sub.add_parser(
        "search",
        help="full-text search for projects",
        description="Full-text search across GEO, SRA, ArrayExpress and ENA.",
    )
    p_search.add_argument("query", help='search text, e.g. "lung cancer single cell"')
    p_search.add_argument(
        "--db",
        choices=["geo", "sra", "arrayexpress", "ena"],
        help="restrict to one source (default: all)",
    )
    p_search.add_argument(
        "--sort",
        dest="sortby",
        choices=["citations", "journal", "year"],
        help="sort results by this field",
    )
    p_search.add_argument(
        "-n",
        "--limit",
        type=int,
        default=20,
        help="max results to show (default: 20)",
    )

    # parquet backend subcommand
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
        help="download parquet data files from S3",
        description="Download the seqout parquet dumps from S3 to a local directory.",
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
        type=Path,
        default=Path(),
        help="directory containing the parquet files (default: current dir)",
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
        type=Path,
        default=Path(),
        help="directory containing the parquet files (default: current dir)",
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
        help="set the parquet source directory (used by subsequent commands)",
        description="Persist the source directory for parquet files.",
    )
    pq_source.add_argument(
        "source_dir",
        type=Path,
        help="path to the directory containing parquet files",
    )

    args = parser.parse_args()

    if args.command == "search":
        cmd_search(args.query, args.db, args.limit, args.sortby)
        return

    if args.command == "show":
        cmd_show(args.accession)
        return

    if args.command == "download":
        if args.supplementary:
            cmd_download_supplementary(args.accession, args.out)
        elif args.runs_mode:
            cmd_download_runs(args.accession, args.out, args.runs_mode)
        else:
            cmd_download(args.accession, args.out)
        return

    if args.command == "parquet":
        cmd_parquet(args)
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


def cmd_show(accession: str) -> None:
    console = Console()
    acc = accession.strip()
    up = acc.upper()
    sample_prefixes = (
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
    if up.startswith(sample_prefixes):
        cmd_show_sample(acc, console)
        return
    is_geo = up.startswith(("GSE", "E-"))

    samples: list[ExperimentSample] = []
    experiments: list[StudyExperimentsResult] = []
    try:
        with (
            connect_to_seqout(backend="api") as sq,
            console.status(f"[bold]Fetching {acc}…[/]"),
        ):
            try:
                meta = sq.fetch_project_metadata(acc)
            except Exception:
                meta = None
            if is_geo:
                samples = list(sq.fetch_samples(acc))
                keys = "samples"
            else:
                experiments = list(sq.fetch_study_experiments(acc))
                keys = "experiments"
    except Exception as e:
        console.print(f"[red]Failed to fetch {acc}:[/] {e}")
        raise SystemExit(1) from e

    if meta is not None:
        organisms = ", ".join(meta.organisms or []) or "[dim]—[/]"
        n = len(samples) if is_geo else len(experiments)
        body = (
            f"[bold]{meta.title}[/]\n[dim]{meta.accession}[/]  •  "
            f"organisms: {organisms}  •  {n} {keys}"
        )
        console.print(Panel(body, border_style="cyan", expand=False))

    if is_geo:
        if not samples:
            console.print(f"[yellow]No samples found for {acc}.[/]")
            return
        table = Table(
            show_lines=False, header_style="bold green"
        )
        table.add_column("accession", style="bold cyan", no_wrap=True)
        table.add_column("title", overflow="fold")
        table.add_column("type", no_wrap=True)
        table.add_column("organism", overflow="fold")
        for s in samples:
            org = s.channels[0].organism.text if s.channels[0].organism else "—"
            table.add_row(s.accession, s.title or "—", s.sample_type or "—", org)
        console.print(table)
    else:
        if not experiments:
            console.print(f"[yellow]No experiments found for {acc}.[/]")
            return
        table = Table(
            show_lines=False, header_style="bold green"
        )
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
        console.print(table)


def cmd_show_sample(acc: str, console: Console) -> None:
    try:
        with (
            connect_to_seqout(backend="api") as sq,
            console.status(f"[bold]Fetching {acc}…[/]"),
        ):
            if acc.upper().startswith("GSM"):
                detail = sq.fetch_geo_sample_detailed_metadata(acc)
            else:
                detail = sq.fetch_sample_detailed_metadata(acc)
    except Exception as e:
        console.print(f"[red]Failed to fetch {acc}:[/] {e}")
        raise SystemExit(1) from e

    s = detail.sample
    proj = detail.project
    console.print(
        Panel(
            f"[dim]part of[/] [bold]{proj.accession}[/]: {proj.title}",
            border_style="cyan",
            expand=False,
        )
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

    console.print(table)


def cmd_search(
    query: str,
    db: Literal["geo", "sra", "arrayexpress", "ena"] | None,
    limit: int,
    sortby: Literal["citations", "journal", "year"] | None,
) -> None:
    console = Console()
    try:
        params = SearchParams(q=query, db=db, sortby=sortby)
    except Exception as e:
        console.print(f"[red]Invalid query:[/] {e}")
        raise SystemExit(1) from e

    try:
        with (
            connect_to_seqout(backend="api") as sq,
            console.status("[bold]Searching…[/]"),
        ):
            results = list(sq.iter_search(params, limit=limit))
    except Exception as e:
        console.print(f"[red]Search failed:[/] {e}")
        raise SystemExit(1) from e

    if not results:
        console.print(f"[yellow]No results for[/] {query!r}.")
        return

    table = Table(
        title=f"{query!r} — {len(results)} result(s)",
        title_style="bold",
        header_style="bold green",
    )
    table.add_column("accession", style="bold cyan", no_wrap=True)
    table.add_column("src", no_wrap=True)
    table.add_column("title", overflow="fold")
    table.add_column("organisms", overflow="fold")
    table.add_column("cited", justify="right")
    for r in results:
        table.add_row(
            r.accession,
            r.source,
            r.title,
            ", ".join(r.organisms) or "—",
            str(r.citation_count) if r.citation_count else "—",
        )
    console.print(table)
    console.print("[dim]Tip: `seqoutdb show <accession>` to inspect a result.[/]")


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


def _resolve_accession(sq: SeqoutAPIClient, acc: str, want: str) -> str | None:
    """
    Resolve a project to its sibling of the kind needed via cross-references.

    want="runs" -> an SRA/ENA study (SRP/ERP/DRP, or PRJ) for run downloads;
    want="geo"  -> a GEO series / ArrayExpress (GSE/E-) for supplementary files.
    Returns acc unchanged if it's already the right kind, else the linked
    accession, else None.
    """
    targets = ("SRP", "ERP", "DRP", "PRJ") if want == "runs" else ("GSE", "E-")
    if acc.upper().startswith(targets):
        return acc
    try:
        cands = [
            r.accession
            for r in sq.fetch_cross_references(acc)
            if r.accession.upper().startswith(targets)
        ]
    except Exception:
        return None
    if want == "runs":  # prefer a real study accession over a BioProject
        for c in cands:
            if c.upper().startswith(("SRP", "ERP", "DRP")):
                return c
    return cands[0] if cands else None


def cmd_download(accession: str, out: str | None) -> None:
    console = Console()
    acc = accession.strip()
    up = acc.upper()

    try:
        with (
            connect_to_seqout(backend="api") as sq,
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
                    project = None  # best-effort header, samples are the point
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


def cmd_download_supplementary(accession: str, out: str | None) -> None:
    console = Console()
    acc = accession.strip()
    out_dir = Path(out) if out else Path(acc)
    try:
        with connect_to_seqout(backend="api") as sq:
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
    except RuntimeError as e:  # partial-failure summary from the client
        console.print(f"[red]{e}[/]")
        raise SystemExit(1) from e
    except Exception as e:
        console.print(f"[red]Failed:[/] {e}")
        raise SystemExit(1) from e
    console.print(f"[green]✓[/] done → [bold]{out_dir}/[/]")


RUN_PREFIXES = ("SRR", "ERR", "DRR")

# per-mode (url, bytes, md5) field names on StudyRunsResult; non-fastq modes all
# carry size/md5 in the sra_* fields (mirrors _extract_download_info_for_study_run).
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


def _resolve_run_study(sq: SeqoutAPIClient, run_acc: str) -> str | None:
    try:
        res = sq.search(SearchParams(q=run_acc))
    except Exception:
        return None
    for r in res:
        if r.accession.upper().startswith(("SRP", "ERP", "DRP", "PRJ")):
            return r.accession
    return None


def _select_run_files(
    console: Console, run: StudyRunsResult, mode: StudyRunDownloadMode
) -> StudyRunsResults | None:
    """Return a StudyRunsResults holding `run` with only the chosen files, or None."""
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
    accession: str, out: str | None, mode: StudyRunDownloadMode
) -> None:
    console = Console()
    acc = accession.strip()
    up = acc.upper()
    out_dir = Path(out) if out else Path(acc)
    try:
        with connect_to_seqout(backend="api") as sq:
            if up.startswith(RUN_PREFIXES):
                # a single run: resolve to its study, grab that run, pick files
                with console.status(f"[bold]Resolving {acc}…[/]"):
                    study = _resolve_run_study(sq, acc)
                    if study is None:
                        console.print(
                            f"[yellow]Couldn't find the study for run {acc}.[/]"
                        )
                        raise SystemExit(1)
                    runs = sq.fetch_study_runs(study)
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
                    runs = sq.fetch_study_runs(study)
                if not runs:
                    console.print(f"[yellow]No runs found for {study}.[/]")
                    return

            console.print(
                "Downloading"
                f" [bold]{len(runs)}[/] run(s) as [bold]{mode}[/] → [bold]{out_dir}/[/]"
            )
            sq.download_study_runs_data(runs, out_dir, mode=mode)
    except ValueError as e:  # e.g. mode unavailable for these runs
        console.print(f"[red]{e}[/]")
        raise SystemExit(1) from e
    except RuntimeError as e:  # partial-failure / verification summary
        console.print(f"[red]{e}[/]")
        raise SystemExit(1) from e
    except Exception as e:
        console.print(f"[red]Failed:[/] {e}")
        raise SystemExit(1) from e
    console.print(f"[green]✓[/] done → [bold]{out_dir}/[/]")


def run_norm(
    accession: str,
    model_spec: str | None,
    port: int | None = None,
    base_url: str | None = None,
) -> None:
    console = Console()

    # 1. fetch all samples for the project
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
    except Exception as e:  # network / API errors
        console.print(f"[red]Failed to fetch samples for {accession}:[/] {e}")
        raise SystemExit(1) from e

    if not records:
        console.print(f"[yellow]No samples found for {accession}.[/]")
        raise SystemExit(1)

    # 2. pick the model. --base-url points at an already-running server and never
    #    starts one. Otherwise: reuse a server already running on the target port
    #    (even when --model was given), and only start one if nothing is there —
    #    using --model if supplied, else the default (pull/download on first use).
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

    # If the model has to be downloaded from a private/gated HF repo, ask for a
    # token up front (skipped when one is already in the environment, or when the
    # server is already serving it — that path doesn't download).
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

    # 3. Single sample -> vertical field/value table (no streaming benefit).
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

    # 3b. Several samples -> stream one row per sample into a live table as each
    #     finishes, then leave the full table rendered at its natural width.
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

    # Final, full-width render (the live view is transient and cleared on exit;
    # live_table already holds every row).
    live_table.caption = None
    min_width = 14 * (len(LABEL_FIELDS) + 1)
    target = console if console.size.width >= min_width else Console(width=min_width)
    target.print(live_table)

    for sample, raw in invalid:
        invalid_panel(sample, raw)


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
    try:
        with (
            connect_to_seqout(backend="parquet") as sq,
            console.status(f"[bold]Downloading {len(files)} parquet file(s)…[/]"),
        ):
            sq.download_parquet_files(
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
    source = args.source
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
    source = args.source
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
    source_dir = args.source_dir
    if not source_dir.exists():
        console.print(f"[red]Directory not found:[/] {source_dir}")
        raise SystemExit(1)
    console.print(f"[green]✓[/] parquet source set to [bold]{source_dir.resolve()}[/]")
    tip = (
        "[dim]Tip: pass --source <dir> to 'parquet query' "
        "and 'parquet show' commands.[/]"
    )
    console.print(tip)


if __name__ == "__main__":
    main()
