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
            "normalize sample metadata for an accession "
            f"({', '.join(VALID_PREFIXES)}), e.g. --norm GSE12345 --model my-model"
        ),
    )
    parser.add_argument(
        "--model",
        metavar="MODEL",
        help="model to use with --norm (optional)",
    )

    args = parser.parse_args()

    if args.enriched is None and args.norm is None:
        print(
            "Nothing to do. Use --enriched ACCESSION to fetch enriched sample "
            "metadata, or --norm ACCESSION [--model MODEL] to normalize it.\n"
            "Run `seqoutdb --help` for more details.",
            file=sys.stderr,
        )
        raise SystemExit(1)

    if args.norm is not None:
        # TODO: implement normalization
        print(f"hello world (norm={args.norm}, model={args.model})")

    if args.enriched is not None:
        with Seqout() as sq:
            result = sq.fetch_project_enriched_metadata(args.enriched)

        if not result:
            print(
                f"No enriched metadata found for '{args.enriched}'.", file=sys.stderr
            )
            raise SystemExit(1)

        print(result.to_df().to_string(index=False))


if __name__ == "__main__":
    main()
