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

    args = parser.parse_args()

    if args.enriched is None and args.norm is None:
        print(
            "Nothing to do. Use --enriched ACCESSION to fetch enriched sample "
            "metadata, or --norm ACCESSION [--model ENGINE/MODEL] to normalize it "
            "with a local model.\nRun `seqoutdb --help` for more details.",
            file=sys.stderr,
        )
        raise SystemExit(1)

    if args.norm is not None:
        run_norm(args.norm, args.model)

    if args.enriched is not None:
        with Seqout() as sq:
            result = sq.fetch_project_enriched_metadata(args.enriched)

        if not result:
            print(
                f"No enriched metadata found for '{args.enriched}'.", file=sys.stderr
            )
            raise SystemExit(1)

        print(result.to_df().to_string(index=False))


def run_norm(accession: str, model_spec: str | None) -> None:
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

    # 2. pick the model: an explicit --model wins; otherwise reuse whatever a
    #    running llama.cpp / LM Studio / ollama server already has loaded; and if
    #    nothing is running, fall back to the default (pull on first use).
    if model_spec is not None:
        engine_name, model_name = parse_model_spec(model_spec)
        engine = make_engine(engine_name, model_name)
        detected = False
    else:
        found = autodetect_engine()
        if found is not None:
            engine, engine_name, model_name = found
            detected = True
        else:
            engine_name, model_name = parse_model_spec(None)
            engine = make_engine(engine_name, model_name)
            detected = False

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
    with Live(live_table, console=console, transient=True, refresh_per_second=12) as live:
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
