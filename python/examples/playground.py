from pathlib import Path

from seqout import connect

output_dir = Path("./output/parquet")
output_dir.mkdir(exist_ok=True, parents=True)

with connect("parquet") as sq:
    sq.download_parquet_files(output_dir=output_dir, with_pbar=True)
    sq.set_source(output_dir)
    study = sq.fetch_study("PRJDB13493")
    experiments = sq.fetch_experiments("PRJDB13493")
    samples = sq.fetch_samples("GSE137966")
