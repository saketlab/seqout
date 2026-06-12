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
    from rich.panel import Panel
    from rich.progress import (
        BarColumn,
        MofNCompleteColumn,
        Progress,
        SpinnerColumn,
        TextColumn,
        TimeElapsedColumn,
    )
    from rich.table import Table

    from rich.prompt import Prompt

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

    # 3. run inference per sample
    results: list[tuple[str, dict | None, str]] = []
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        MofNCompleteColumn(),
        TimeElapsedColumn(),
        console=console,
    ) as progress:
        task = progress.add_task("Normalizing samples", total=len(records))
        for r in records:
            progress.update(task, description=f"Normalizing {r.sample}")
            try:
                raw = engine.chat(SYS_PROMPT, r.user_prompt())
                labels = parse_labels(raw)
            except Exception as e:
                raw, labels = f"<error: {e}>", None
            results.append((r.sample, labels, raw))
            progress.advance(task)

    # 4. render the model response in the for-ref.md 16-field format. With a
    #    single sample, lay it out vertically (field/value); with several, use
    #    one row per sample (fields as columns).
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

    if len(results) == 1:
        sample, labels, raw = results[0]
        if labels is None:
            invalid_panel(sample, raw)
        else:
            table = Table(
                title=sample,
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

    table = Table(
        title="Normalized labels",
        show_lines=True,
        header_style="bold green",
    )
    table.add_column("sample", style="bold cyan", no_wrap=True)
    for f in LABEL_FIELDS:
        table.add_column(f, overflow="fold")
    for sample, labels, raw in results:
        if labels is None:
            table.add_row(sample, *(["[red]—[/]"] * len(LABEL_FIELDS)))
        else:
            table.add_row(sample, *(cell(labels.get(f)) for f in LABEL_FIELDS))
    # Render at the table's natural width so columns don't get crushed on a
    # narrower terminal (it fits cleanly when the terminal is wide enough).
    min_width = 14 * (len(LABEL_FIELDS) + 1)
    if console.size.width >= min_width:
        console.print(table)
    else:
        Console(width=min_width).print(table)

    for sample, labels, raw in results:
        if labels is None:
            invalid_panel(sample, raw)


if __name__ == "__main__":
    main()
