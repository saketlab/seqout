# Installation

## Requirements

You need Python 3.12 or later.

## Install with uv

[uv](https://docs.astral.sh/uv/) is the fastest way to install the tool. To add
`seqoutdb` to a project, run this command:

```bash
uv add seqoutdb
```

To run the command-line tool one time, without a permanent install, use
`uvx`:

```bash
uvx seqoutdb search "lung cancer"
```

## Install with pip

You can also install the tool with `pip`:

```bash
pip install seqoutdb
```

## Check the installation

```bash
seqoutdb --help
```

This prints the list of subcommands.

## Optional features

Some commands need extra software:

- The `--norm` option runs a local language model. It needs a model server,
  such as Ollama, llama.cpp, or LM Studio.

