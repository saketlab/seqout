import re
import shutil
import sys
from pathlib import Path

from seqoutdb import SearchParams, Seqout, country_code_to_name

output_dir = Path("./output")
shutil.rmtree(output_dir, ignore_errors=True)  # delete the folder
output_dir.mkdir(exist_ok=True)  # create it freshly

with Seqout() as sq:
    # find top 50 cited papers related to scRNA-seq from SRA
    response = sq.search(params=SearchParams(q="scRNA-seq")).top_cited(50)

    # print names of the countries with their counts
    for code, count in response.countries().items():
        name = country_code_to_name(code)
        if name is None:
            print(f"failed to get country name for {code}", file=sys.stderr)
            continue

        print(f"{name} - {count}")

    # split them into different CSV files based on country
    countries_dir = output_dir / "countries"
    countries_dir.mkdir()
    for c in response.countries():
        response.filter(country_code=c).to_csv(str(countries_dir / f"{c.lower()}.csv"))

    # picking the top paper for doing futher analysis
    accession_id = response[0].accession

    # exporting samples and cross references to a CSV file
    sq.fetch_samples(accession_id).to_csv(str(output_dir / "samples.csv"))
    sq.fetch_cross_references(accession_id).to_csv(str(output_dir / "references.csv"))

    # fetch the project metadata
    metadata = sq.fetch_project_metadata(accession_id)

    # download supplementary data of the project
    sq.download_project_supplementary_data(
        metadata=metadata,
        out_dir=output_dir / "supplementary_data",
        n_workers=8,
        chunk_size=2048,
        verbose=True,
    )

    # fetch LLM enriched sample metadata and store it in CSV file
    sq.fetch_project_enriched_metadata(accession_id).to_csv(
        str(output_dir / "enriched_metadata.csv")
    )

    # searching for corresponding SRA study ID for this GEO series
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
        # saving all the information related to the study's experiment in a CSV file
        sq.fetch_study_experiments(study_id).to_csv(str(output_dir / "experiments.csv"))

        # fetching all runs of the study
        runs = sq.fetch_study_runs(study_id)
        runs.to_csv(str(output_dir / "runs.csv"))

        # downloading fastq files related for all the runs of that study
        sq.download_study_runs_data(
            runs=runs,
            out_dir=output_dir / "study_runs",
            mode="fastq",
            n_workers=10,
        )
    else:
        print("no SRA study was found")
