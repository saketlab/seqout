---
description: "Install the seqout Python library and CLI tool from GitHub using uv or pip. Requires Python 3.13 or newer."
---

# Installation

## Install as a command-line tool


### Using `uv`

```bash
uv tool install "seqout @ git+https://github.com/saketlab/seqout.git#subdirectory=python"
```

> Seqout will be available via PyPI soon!

### Using `pipx`

```bash
pipx install "git+https://github.com/saketlab/seqout.git#subdirectory=python"
```

## Install as a library

To add the `seqout` library as a dependency to your local Python project, run:

### Using `uv`

```bash
uv add "seqout @ git+https://github.com/saketlab/seqout.git#subdirectory=python"
```

### Using `pip`

```bash
pip install "git+https://github.com/saketlab/seqout.git#subdirectory=python"
```

### Optional components

Parsing supplementary processed counts matrices requires the following optional dependencies: `anndata`, `h5py`, `scipy`, and `rdata`. 

To install `seqout` with these counts-matrix parsing dependencies enabled, specify the `counts` extra:

```bash
# For global CLI usage
uv tool install "seqout[counts] @ git+https://github.com/saketlab/seqout.git#subdirectory=python"

# For project library development
uv add "seqout[counts] @ git+https://github.com/saketlab/seqout.git#subdirectory=python"

# Using pip
pip install "seqout[counts] @ git+https://github.com/saketlab/seqout.git#subdirectory=python"
```
