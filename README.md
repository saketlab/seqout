<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./public/logo-dark.webp">
    <source media="(prefers-color-scheme: light)" srcset="./public/logo-light.webp">
    <img src="./public/logo-light.webp" height="72" alt="Seqout">
  </picture>
</div>

<p align="center">
  <img src="https://img.shields.io/badge/license-BSD--3--Clause-blue" alt="License">
  <img src="https://img.shields.io/github/actions/workflow/status/saketlab/seqout/deploy.yml" alt="Build Status">
  <img src="https://img.shields.io/github/last-commit/saketlab/seqout" alt="Last Commit">
</p>

Seqout is a search engine for finding genomic datasets across NCBI and EBI portals.

https://github.com/user-attachments/assets/db55a7e8-7f90-4b90-865b-89d8e88601ae

Apart from text-based search, Seqout also offers dataset discovery via semantic similarity using vector embeddings. For example, check out: [seqout.org/p/GSE153562#similar](https://seqout.org/p/GSE153562#similar).

https://github.com/user-attachments/assets/d1ed4a93-0a0d-4037-b1ab-4cf42cf8c464

We also have a map of 800K+ datasets in a two-dimensional space, obtained via UMAP projection of the vector embeddings of the datasets. View it at [seqout.org/map](https://seqout.org/map).

Seqout also has an MCP server to help work with genomic datasets using AI agents (such as Claude, Codex, Antigravity etc.). Visit [seqout.org/mcp](https://seqout.org/mcp) for more information.

Additionally, we also provide an _enriched_ view of samples and experiments with standardized attributes. For example, check out: [seqout.org/p/GSE44255#samples=enriched](https://seqout.org/p/GSE44255#samples=enriched).
