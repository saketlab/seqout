import re
import shutil
import sys
from pathlib import Path

from seqoutdb import SearchParams, Seqout, country_code_to_name

output_dir = Path("./output")
shutil.rmtree(output_dir, ignore_errors=True)  # delete the folder
output_dir.mkdir(exist_ok=True)  # create it freshly

with Seqout() as sq:
    # find top 50 cited papers related to 16S rRNA amplicon sequencing
    response = sq.search(
        params=SearchParams(q="16S rRNA amplicon sequencing")
    ).top_cited(50)

    # get project summaries for first 10 papers from response
    sq.bulk_fetch_project_summary([r.accession for r in response.slice(0, 10)]).to_csv(
        output_dir / "top10_prj_summaries.csv"
    )

    # print countries with their full name and count
    for code, count in response.countries().items():
        name = country_code_to_name(code)
        if name is None:
            print(f"failed to get country name for {code}", file=sys.stderr)
            continue
        print(f"{name} - {count}")

    # split data related to the top cited papers based on country
    countries_dir = output_dir / "countries"
    countries_dir.mkdir()
    for c in response.countries():
        response.filter(country_code=c).to_csv(countries_dir / f"{c.lower()}.csv")

    # pick the top paper for doing futher analysis
    accession_id = response[0].accession

    # export samples and cross references to a csv file
    sq.fetch_samples(accession_id).to_csv(output_dir / "samples.csv")
    sq.fetch_cross_references(accession_id).to_csv(output_dir / "cross_refs.csv")

    # fetch project metadata
    metadata = sq.fetch_project_metadata(accession_id)

    # download supplementary data related to the project
    sq.download_project_supplementary_data(
        metadata=metadata,
        out_dir=output_dir / "supplementary_data",
        n_workers=10,
        verbose=True,
    )

    # export llm enriched sample metadata to a csv file
    sq.fetch_project_enriched_metadata(accession_id).to_csv(
        output_dir / "enriched_metadata.csv"
    )

    # search for corresponding sra study id for the above geo series
    relations = metadata.relations
    study_id: str | None = None

    for r in relations:
        if r.type is None or r.target is None:
            continue

        if r.type.upper() == "SRA":
            pat = re.compile("(?:SRP)[A-Z0-9]+")
            matches = re.findall(pat, r.target)

            if len(matches) > 0:
                study_id = matches[0]
                break

    if study_id is not None:
        # exporting all the information related to the study's experiment to a csv file
        sq.fetch_study_experiments(study_id).to_csv(output_dir / "experiments.csv")

        # fetching all runs of the study's experiment and then exporting to a csv file
        runs = sq.fetch_study_runs(study_id)
        runs.to_csv(output_dir / "runs.csv")

        # downloading fastq files related to all the runs of the study's experiment
        sq.download_study_runs_data(
            runs=runs,
            out_dir=output_dir / "runs",
            mode="fastq",
            n_workers=10,
        )
    else:
        print("no sra study id was found")
