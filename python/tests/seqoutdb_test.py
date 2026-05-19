from seqoutdb import SearchParams, Seqout, country_name_to_code

with Seqout() as sq:
    # find top cited papers related to brca1
    response = sq.search(params=SearchParams(q="BRCA1")).top_cited()
    # split them into different csv files based on country
    for c in response.countries():
        country_code = country_name_to_code(c)
        if country_code is None:
            print(f"failed to retrieve country code for {c}")
            continue

        response.filter(country_code=country_code).to_csv(
            f"./output/{country_code.lower()}.csv"
        )

    # get samples and cross references for the top cited paper
    accession_id = response.results[0].accession
    samples = sq.samples_by_accession(accession_id)
    cross_references = sq.cross_reference_lookup_by_accession(accession_id)
