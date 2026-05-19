import shutil
import sys
from pathlib import Path

from seqoutdb import SearchParams, Seqout, country_code_to_name

output_dir = Path("./output")
shutil.rmtree(output_dir, ignore_errors=True)  # delete the folder
output_dir.mkdir(exist_ok=True)  # create it freshly

with Seqout() as sq:
    # find top 50 cited papers related to scRNA-seq
    response = sq.search(params=SearchParams(q="scRNA-seq")).top_cited(50)

    # print names of the countries related to those above papers
    for code, count in response.countries().items():
        name = country_code_to_name(code)
        if name is None:
            print(f"failed to get country name for {code}", file=sys.stderr)
            continue

        print(f"{name} - {count}")

    # split them into different csv files based on country
    countries_dir = output_dir / "countries"
    countries_dir.mkdir()
    for c in response.countries():
        response.filter(country_code=c).to_csv(str(countries_dir / f"{c.lower()}.csv"))

    # get samples and cross references for the top cited paper
    accession_id = response[0].accession

    # export samples and cross references to csv
    sq.fetch_samples(accession_id).to_csv(str(output_dir / "samples.csv"))
    sq.fetch_cross_references(accession_id).to_csv(str(output_dir / "references.csv"))

    # download supplementary data of the project
    metadata = sq.fetch_project_metadata(accession_id)
    sq.download_supplementary_data(metadata, Path("./output"))
