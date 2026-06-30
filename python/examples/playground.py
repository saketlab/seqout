from pathlib import Path

from seqoutdb import connect_to_seqout

output_dir = Path("./output/parquet")
output_dir.mkdir(exist_ok=True, parents=True)

with connect_to_seqout("parquet") as sq:
    sq.download_parquet_files(output_dir=output_dir, with_pbar=True)
    sq.set_source(output_dir)
    study = sq.fetch_study("PRJDB13493")
    experiments = sq.fetch_experiments("PRJDB13493")
    samples = sq.fetch_samples("GSE137966")
