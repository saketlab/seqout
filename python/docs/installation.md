---
description: Installing seqout with uv or pip. Requires Python 3.13.
---

# Installation

## Requirements

You need Python 3.13 or later.

## Install with uv

[uv](https://docs.astral.sh/uv/) is the fastest way to install the tool. Which
command you want depends on how you will use it.

To keep the `seqout` command on your PATH, install it as a tool:

```bash
uv tool install seqout
```

This puts the command-line tool in its own environment, so it does not touch
the Python you use for your own work. Upgrade it later with
`uv tool upgrade seqout`, and remove it with `uv tool uninstall seqout`.

To add `seqout` to a project, so your code can import it:

```bash
uv add seqout
```

To run the command-line tool one time, without a permanent install, use
`uvx`:

```bash
uvx seqout search "lung cancer"
```

## Install with pip

You can also install the tool with `pip`:

```bash
pip install seqout
```

## Check the installation

```bash
seqout --help
```

This prints the list of subcommands.

## Optional features

The counts readers need `anndata`, `h5py`, `scipy` and `rdata`, which are not
installed by default. Ask for the `counts` extra when you want them:

```bash
uv tool install "seqout[counts]"   # the command-line tool
uv add "seqout[counts]"            # a project
pip install "seqout[counts]"
```
