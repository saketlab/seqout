---
description: "Install the seqout Python library and CLI tool using uv or pip. Requires Python 3.13 or newer."
---

# Installation

## Prerequisites

The package requires **Python 3.13 or newer**.

## Install using uv

[uv](https://docs.astral.sh/uv/) is the recommended package manager for installing the CLI tool and library.

### Install as a command-line tool

To install the global `seqout` executable on your system path, run:

```bash
uv tool install seqout
```

This command installs the CLI tool in an isolated virtual environment, preventing dependency conflicts with other system or project packages. 

*   To update the tool, run `uv tool upgrade seqout`.
*   To uninstall the tool, run `uv tool uninstall seqout`.

### Add to a project library

To add the `seqout` library as a dependency to your local Python project, run:

```bash
uv add seqout
```

### Run without installing

To run a single CLI command without installing the package permanently, use `uvx`:

```bash
uvx seqout search "lung cancer"
```

## Install using pip

You can also install `seqout` using `pip` inside your active virtual environment:

```bash
pip install seqout
```

## Verify the installation

To verify that the installation succeeded, run the help command:

```bash
seqout --help
```

This command prints the help menu containing the list of available subcommands.

## Optional components

Parsing supplementary processed counts matrices requires the following optional dependencies: `anndata`, `h5py`, `scipy`, and `rdata`. 

To install `seqout` with these counts-matrix parsing dependencies enabled, specify the `counts` extra:

```bash
# For global CLI usage
uv tool install "seqout[counts]"

# For project library development
uv add "seqout[counts]"

# Using pip
pip install "seqout[counts]"
```
