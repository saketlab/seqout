# seqout (development version)

* NanoString nCounter `.RCC` files are read as counts
* Count tables whose sample columns are numeric ids (`key 2683 2685 ...`) are
  read with that header instead of as headerless data.
* Downloads retry HTTP 408, 429 and 5xx (NCBI answers 503 under load) and
  discard the error page before retrying.

# seqout 0.2.6

* `download_supplementary()`, `download_runs()`, `download_bams()` and
  `download_dump()` now require `dest_dir`. They used to default to a directory
  under the working directory; name it explicitly, e.g.
  `DownloadRuns("SRR12012336", "SRR12012336")`.
* New `seqout_online()` (`SeqoutOnline()`) reports whether the API is reachable,
  checked once per session.
* `seqout_matrix()` reads `.h5ad` and 10x `.h5` files that h5py compressed with
  LZF (GSE300265) when Bioconductor's rhdf5filters is installed 

# seqout 0.2.5

* `seqout_matrix()` no longer aborts with "'length = N' in coercion to 'logical(1)'" on
  tar and `.rds` units (GSE192693, GSE255298). The units table's per-unit `assay` column
  was shadowing the requested assay inside the reader.
* genevintage moved from Imports to Suggests. `SeqoutGeneNames()`,
  `SeqoutCorrectNames()` and `SeqoutSex()` ask you to install it from
  https://saketlab.r-universe.dev when it is missing.
