from pathlib import Path

from seqoutdb import connect_to_seqout

output_dir = Path("./output/parquet")
output_dir.mkdir(exist_ok=True, parents=True)

with connect_to_seqout("parquet") as sq:
    sq.download_parquet_files(output_dir=output_dir, with_pbar=True)
    sq.set_source(output_dir)
    result = sq.fetch_study("GSE151088")
    samples = sq.fetch_samples(result.accession)
    print(samples)
