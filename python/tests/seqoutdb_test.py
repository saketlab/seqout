from seqoutdb import SearchParams, Seqout

with Seqout() as sq:
    results = sq.search(params=SearchParams(q="oxford nanopore"))
    # get top 20 cited papers from china on "oxford nanopore" from geo
    results.filter(country_code="chn", source="geo").top_cited(n=20).to_csv(
        "./output/dump.csv"
    )
