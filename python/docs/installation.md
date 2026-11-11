---
description: "Install the seqout Python library and CLI tool from GitHub using uv or pip. Requires Python 3.13 or newer."
---

# Installation

## Install as a command-line tool


### Using `uv`

```bash
uv tool install seqout
```

### Using `pipx`

```bash
pipx install seqout
```

## Install as a library

To add the `seqout` library as a dependency to your local Python project, run:

### Using `uv`

```bash
uv add seqout
```

### Using `pip`

```bash
pip install seqout
```

To download the latest developmental build, get `seqout` directly from GitHub:

```bash
uv add "git+https://github.com/saketlab/seqout.git#subdirectory=python"
```

### Optional components

Parsing supplementary processed counts matrices requires the following optional dependencies: `anndata`, `h5py`, `scipy`, and `rdata`. 

To install `seqout` with these counts-matrix parsing dependencies enabled, specify the `counts` extra:

```bash
uv add "seqout[counts]"
```
These dependencies are used in the [`SeqoutListCounts`](/reference/counts/) routine for directly getting count matrices in AnnData format from the dataset accession number, without the need for manual preprocessing.