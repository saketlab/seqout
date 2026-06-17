import argparse
import sys

from seqoutdb import Seqout

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
        description="Show the samples (GEO/ArrayExpress) or experiments (SRA/ENA) of a project.",
    )
    p_show.add_argument(
        "accession",
        help="project accession, e.g. GSE12345, SRP123456, E-MTAB-1234",
    )

    args = parser.parse_args()

    if args.command == "show":
        cmd_show(args.accession)
        return

    if args.enriched is None and args.norm is None:
        print(
            "Nothing to do. Try a command (e.g. `seqoutdb show GSE12345`), or use "
            "--enriched ACCESSION / --norm ACCESSION.\n"
            "Run `seqoutdb --help` for more details.",
            file=sys.stderr,
        )
        raise SystemExit(1)

    if args.norm is not None:
        run_norm(args.norm, args.model, port=args.port, base_url=args.base_url)

    if args.enriched is not None:
        with Seqout() as sq:
            result = sq.fetch_project_enriched_metadata(args.enriched)

        if not result:
            print(f"No enriched metadata found for '{args.enriched}'.", file=sys.stderr)
            raise SystemExit(1)

        print(result.to_df().to_string(index=False))


def cmd_show(accession: str) -> None:
    from rich.console import Console
    from rich.panel import Panel
    from rich.table import Table

    console = Console()
    acc = accession.strip()
    up = acc.upper()
    sample_prefixes = ("GSM", "SRS", "SRX", "SRR", "ERS", "ERX", "ERR", "DRS", "DRX", "DRR", "SAM")
    if up.startswith(sample_prefixes):
        cmd_show_sample(acc, console)
        return
    is_geo = up.startswith(("GSE", "E-"))

    try:
        with Seqout() as sq, console.status(f"[bold]Fetching {acc}…[/]"):
            try:
                meta = sq.fetch_project_metadata(acc)
            except Exception:
                meta = None  # header is best-effort; the table is the point
            rows = sq.fetch_samples(acc) if is_geo else sq.fetch_study_experiments(acc)
    except Exception as e:
        console.print(f"[red]Failed to fetch {acc}:[/] {e}")
        raise SystemExit(1)

    if meta is not None:
        organisms = ", ".join(meta.organisms or []) or "[dim]—[/]"
        body = f"[bold]{meta.title}[/]\n[dim]{meta.accession}[/]  •  organisms: {organisms}  •  {len(rows)} {'samples' if is_geo else 'experiments'}"
        console.print(Panel(body, border_style="cyan", expand=False))

    if not rows:
        console.print(
            f"[yellow]No {'samples' if is_geo else 'experiments'} found for {acc}.[/]"
        )
        return

    table = Table(show_lines=False, header_style="bold green", row_styles=["", "dim"])
    if is_geo:
        table.add_column("accession", style="bold cyan", no_wrap=True)
        table.add_column("title", overflow="fold")
        table.add_column("type", no_wrap=True)
        table.add_column("organism", overflow="fold")
        for s in rows:
            org = (
                s.channels[0].organism.text
                if s.channels and s.channels[0].organism
                else "—"
            )
            table.add_row(s.accession, s.title or "—", s.sample_type or "—", org)
    else:
        table.add_column("accession", style="bold cyan", no_wrap=True)
        table.add_column("title", overflow="fold")
        table.add_column("strategy", no_wrap=True)
        table.add_column("platform", no_wrap=True)
        table.add_column("instrument", overflow="fold")
        table.add_column("#", justify="right")
        for e in rows:
            table.add_row(
                e.accession,
                e.title or "—",
                e.library_strategy,
                e.platform,
                e.instrument_model,
                str(len(e.samples)),
            )
    console.print(table)


def cmd_show_sample(acc: str, console) -> None:
    from rich.panel import Panel
    from rich.table import Table

    is_geo = acc.upper().startswith("GSM")
    try:
        with Seqout() as sq, console.status(f"[bold]Fetching {acc}…[/]"):
            detail = (
                sq.fetch_geo_sample_detailed_metadata(acc)
                if is_geo
                else sq.fetch_sample_detailed_metadata(acc)
            )
    except Exception as e:
        console.print(f"[red]Failed to fetch {acc}:[/] {e}")
        raise SystemExit(1)

    s = detail.sample
    proj = detail.project
    console.print(
        Panel(
            f"[dim]part of[/] [bold]{proj.accession}[/]: {proj.title}",
            border_style="cyan",
            expand=False,
        )
    )

    table = Table(title=acc, title_style="bold", header_style="bold green", show_lines=False)
    table.add_column("field", style="cyan", no_wrap=True)
    table.add_column("value", overflow="fold")

    def row(field, value):
        if value not in (None, "", []):
            table.add_row(field, str(value))

    if is_geo:  # ExperimentSample
        org = s.channels[0].organism.text if s.channels and s.channels[0].organism else None
        row("title", s.title)
        row("description", s.description)
        row("sample_type", s.sample_type)
        row("organism", org)
        row("platform", s.platform_ref)
        row("published", s.published_at)
        attrs = s.channels[0].characteristics if s.channels else {}
    else:  # SampleMetadataResult
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


def run_norm(
    accession: str,
    model_spec: str | None,
    port: int | None = None,
    base_url: str | None = None,
) -> None:
    from rich.console import Console
    from rich.live import Live
    from rich.panel import Panel
    from rich.prompt import Prompt
    from rich.table import Table

    from seqoutdb.norm import (
        LABEL_FIELDS,
        SYS_PROMPT,
        EngineError,
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

    console = Console()

    # 1. fetch all samples for the project
    try:
        with console.status("[bold]Fetching samples…[/]") as status:
            records = build_records(
                Seqout(),
                accession,
                on_progress=lambda m: status.update(f"[bold]{m}…[/]"),
            )
    except ValueError as e:
        console.print(f"[red]Error:[/] {e}")
        raise SystemExit(1)
    except Exception as e:  # network / API errors
        console.print(f"[red]Failed to fetch samples for {accession}:[/] {e}")
        raise SystemExit(1)

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
            raise SystemExit(1)
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
        raise SystemExit(1)
    except Exception as e:
        console.print(f"\n[red]Failed to prepare the model:[/] {e}")
        raise SystemExit(1)

    console.print()

    def cell(value) -> str:
        return str(value) if value is not None else "[dim]null[/]"

    def invalid_panel(sample: str, raw: str) -> None:
        console.print(
            Panel(
                raw[:400] or "[dim](empty response)[/]",
                title=f"[yellow]{sample}: no valid JSON[/]",
                border_style="yellow",
            )
        )

    def normalize(record):
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
    def build_table() -> "Table":
        t = Table(title="Normalized labels", show_lines=True, header_style="bold green")
        t.add_column("sample", style="bold cyan", no_wrap=True)
        for f in LABEL_FIELDS:
            t.add_column(f, overflow="fold")
        return t

    def add_result_row(t, sample, labels):
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


if __name__ == "__main__":
    main()
