"""
A complete workflow: search, pick a dataset, then pull everything it has.

Run with `uv run python examples/seqout_example.py`. Output goes to ./output.
"""

import shutil
from pathlib import Path

from seqout import connect
from seqout.exception import SeqoutError

output_dir = Path("./output")
shutil.rmtree(output_dir, ignore_errors=True)
output_dir.mkdir(exist_ok=True)

with connect() as sq:
    # 1. Search. A bare query string plus keyword filters is enough.
    results = sq.search("16S rRNA amplicon sequencing").top_cited(50)
    print(f"{len(results)} results")

    # 2. Look at the set as a whole.
    print("  by archive: ", dict(results.sources()))
    print("  by organism:", dict(results.organisms().most_common(3)))
    results.to_csv(output_dir / "results.csv")

    # Titles and organisms for the top 10, in one request.
    sq.summaries([r.accession for r in results.limit(10)]).to_csv(
        output_dir / "top10_summaries.csv"
    )

    # 3. Open the top dataset. `get` takes any accession — series, study,
    # experiment, sample or run — and finds the related records itself.
    d = sq.get(results[0].accession)
    print(f"\n{d.accession}: {d.meta.title}")
    print(f"  organisms: {d.meta.organisms}")
    print(f"  archives:  geo={d.geo} sra={d.sra}")

    # 4. Publications.
    for p in d.pubs:
        print(f"  paper: {p.pmid or p.doi} - {p.title} ({p.journal})")

    # 5. Contents. A GEO series holds no runs, so `runs` and `experiments` go to
    # the linked SRA study on their own; there is no accession juggling here.
    print(
        f"  {len(d.samples)} samples, "
        f"{len(d.experiments)} experiments, {len(d.runs)} runs"
    )
    d.samples.to_csv(output_dir / "samples.csv")
    d.experiments.to_csv(output_dir / "experiments.csv")
    d.runs.to_csv(output_dir / "runs.csv")
    d.links.to_csv(output_dir / "cross_refs.csv")

    # LLM-enriched per-sample metadata: tissue, disease, assay, cell type.
    enriched = d.enriched
    if len(enriched):
        enriched.to_csv(output_dir / "enriched_metadata.csv")

    # 6. What a run offers. Not every format is present for every run.
    if len(d.runs):
        run = d.runs[0]
        print(f"\n  {run.run_accession}:")
        for fmt, url in {
            "fastq": run.fastq_ftp,
            "sra": run.sra_ftp,
            "s3": run.ncbi_sra_lite_s3_url,
            "gcs": run.ncbi_sra_lite_gs_url,
        }.items():
            if url:
                print(f"    {fmt:6} {url}")

    # 7. Download the processed files the submitter uploaded. To fetch the raw
    # reads instead, use download_study_runs_data(d.runs, out_dir, "fastq").
    if d.meta.supplementary_data:
        print(f"\n  downloading {len(d.meta.supplementary_data)} supplementary files")
        sq.download_project_supplementary_data(
            metadata=d.meta,
            out_dir=output_dir / "supplementary_data",
            num_workers=10,
            with_pbar=True,
        )

    # 8. The same dataset, reached from four different accessions. Whichever one
    # you start from, `geo` and `sra` name the same pair of archive records.
    series = sq.get("GSE168652")
    print(f"\n  starting points for {series.accession}:")
    for acc in (
        series.accession,
        series.sra,
        series.samples[0].accession,
        series.runs[0].run_accession,
    ):
        other = sq.get(acc)
        print(f"    {acc:12} ({other.kind:10}) -> geo={other.geo} sra={other.sra}")

    # 9. Nothing above is GEO-specific. seqout holds seven archives and the same
    # fields read them all; array-based sources report no runs because they have
    # none.
    print("\n  the same fields, every archive:")
    for acc in ("CRA002740", "HRA000925", "DRP016022", "E-GEAD-1086", "PRJNA1458007"):
        other = sq.get(acc)
        print(
            f"    {acc:14} ({other.kind:10}) "
            f"{len(other.samples):>4} samples, {len(other.runs):>4} runs"
        )

    # An accession that leads nowhere says so, instead of returning something
    # empty and leaving you to guess why.
    try:
        sq.get("SAMD01591578").project
    except SeqoutError as e:
        print(f"\n  {e}")

print(f"\nwrote {output_dir}/")
