"""
Verify what a given install can actually import.
"""

import argparse
import importlib
import sys

CORE = [
    "seqout",
    "seqout.counts",
    "seqout.counts_ftp",
    "seqout.counts_io",
    "seqout.counts_model",
    "seqout.counts_names",
    "seqout.counts_rds",
    "seqout.counts_readers",
    "seqout.dataset",
    "seqout.helpers",
    "seqout.seqout",
    "seqout.utils",
    "seqout.cli.cli",
    "seqout.clients.api",
    "seqout.clients.parquet",
    "seqout.models.api_models",
    "seqout.models.parquet_models",
]

OPTIONAL = ["anndata", "h5py", "rdata", "scipy.io", "scipy.sparse"]
ACCELERATORS = ["isal"]


def check(modules: list[str], *, required: bool) -> list[str]:
    failures = []
    for name in modules:
        try:
            importlib.import_module(name)
        except ImportError as e:
            print(f"  {name}: {e}")
            if required:
                failures.append(name)
        else:
            print(f"  {name}: ok")
    return failures


def main() -> int:
    ap = argparse.ArgumentParser()
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--base", action="store_true", help="no extras installed")
    mode.add_argument("--counts", action="store_true", help="counts extra installed")
    args = ap.parse_args()

    print(f"python {sys.version.split()[0]}")
    print("core modules:")
    failures = check(CORE, required=True)

    print("optional dependencies:")
    failures += check(OPTIONAL, required=args.counts)

    print("accelerators:")
    check(ACCELERATORS, required=False)

    if args.base:
        leaked = [m for m in OPTIONAL if m.split(".")[0] in sys.modules]
        if leaked:
            print(f"FAIL: base install imported optional deps: {leaked}")
            return 1

    if failures:
        print(f"FAIL: {len(failures)} required import(s) failed")
        return 1
    print("all good")
    return 0


if __name__ == "__main__":
    sys.exit(main())
