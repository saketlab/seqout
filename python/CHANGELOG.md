# Changelog

## 0.2.8

### Added

- `SeqoutListCounts(...).fragments()` to fetch a study's ATAC fragments files;
- `sample=` accepts a list in `matrices()`, `anndata()`, `raw()` and `fragments()`.

### Changed

- A one-column bulk unit is named for its GSM; the submitter's column name is stored in `obs["label"]`.
- Series-level matrix columns are matched to GSMs by sample title, description
  or a characteristic before metadata is joined. Without a one-to-one match the
  join is skipped with a warning.

### Fixed

- Retain sample ids in counts header (`key 0869 0872`).
- Agilent Feature Extraction microarray files now raise an error naming the format.
- `get(...).enriched` can now reads GSA projects even when title is null.

## 0.2.7 (2026-10-09)

- First release on PyPI.
